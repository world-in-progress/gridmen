"""Read-only, schema-aligned display index. No assembly or sampling occurs here.

Native lattice layers contain original IDs. Coarser layers contain sufficient
statistics, never majority-of-majorities. Files are sparse, memory mapped and
built once per source revision; viewport queries only visit intersecting nodes.
"""
from __future__ import annotations

import hashlib
import json
import math
import mmap
import errno
import sqlite3
import struct
import tempfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, closing, contextmanager
from itertools import pairwise
from pathlib import Path

import numpy as np

# Template hooks use this owner even with Uvicorn's src.* application entrypoint.
from gridmen_backend import display_cache

FILES = ('grid.meta.json', 'cell_topo.bin', 'edge_topo.bin', 'ne.txt')
VERSION = 11
TILE = 64
CELL = struct.Struct('!QdddddBBBBB')
EDGE = struct.Struct('!IQBddddQQdi')
DISPLAY_RECORD = struct.Struct('<Q7dII')
DISPLAY_DTYPE = np.dtype([('id', '<u8'), ('bounds', '<f8', (4,)),
                          ('area', '<f8'), ('z', '<f8'), ('min', '<f8'),
                          ('level', '<u4'), ('land', '<u4')])
NODE = np.dtype([('id', '<u8'), ('area', '<f8'), ('z', '<f8'),
                 ('min', '<f8'), ('level', '<u2'), ('land', 'u1')])


def require(ok, message):
    if not ok:
        raise ValueError(message)


def fingerprint(source: Path):
    result = []
    for name in FILES:
        stat = (source / name).stat()
        result.append((name, stat.st_size, stat.st_mtime_ns))
    return result


def checked_meta(source):
    raw = json.loads((source / 'grid.meta.json').read_text())
    meta = {key: raw[key] for key in ('epsg', 'bounds', 'grid_info', 'alignment_origin')}
    b, origin, sizes = meta['bounds'], meta['alignment_origin'], meta['grid_info']
    require(len(b) == 4 and all(math.isfinite(x) for x in b)
            and b[2] > b[0] and b[3] > b[1], 'Invalid metadata bounds')
    require(len(origin) == 2 and all(math.isfinite(x) for x in origin), 'Invalid alignment_origin')
    require(isinstance(meta['epsg'], int) and meta['epsg'] > 0, 'Invalid epsg')
    require(sizes and len(sizes) < 65536, 'Missing grid_info')
    for i, size in enumerate(sizes):
        require(len(size) == 2 and all(math.isfinite(x) and x > 0 for x in size), 'Invalid grid_info')
        if i:
            ratios = [sizes[i - 1][j] / size[j] for j in (0, 1)]
            require(all(r >= 1 and math.isclose(r, round(r), abs_tol=1e-9) for r in ratios)
                    and max(ratios) > 1, 'grid_info must describe nested integer lattices')
    return meta


class Lattice:
    """Grid coordinates shared by stored layers and their implicit ancestors."""
    def __init__(self, spec):
        self.spec = spec
        self.w, self.h, self.x0, self.y0, self.nx, self.ny, self.level = spec[:7]
        self.layout = spec[7] if len(spec) == 8 else (None,None)

    def bounds(self, x, y, origin):
        x0,x1 = _axis_bounds(x,self.w,self.layout[0])
        y0,y1 = _axis_bounds(y,self.h,self.layout[1])
        return [origin[0]+x0,origin[1]+y0,origin[0]+x1,origin[1]+y1]

    def locate(self,x,y,origin):
        return (_axis_index(x-origin[0],self.w,self.layout[0]),
                _axis_index(y-origin[1],self.h,self.layout[1]))


class Layer(Lattice):
    """Sparse tile directory over one growable memory-mapped file per layer."""
    def __init__(self, directory, number, spec, mode='r', tiles=(), dtype=NODE):
        super().__init__(spec)
        self.path, self.mode, self.dtype = directory / f'layer-{number}.bin', mode, np.dtype(dtype)
        self.tiles = {(x,y):slot for x,y,slot in tiles}
        self.mapping = None
        self.tile_bytes = TILE*TILE*self.dtype.itemsize
        size = self.path.stat().st_size if self.path.exists() else 0
        self.capacity = size//self.tile_bytes
        if mode == 'r' and size:
            self.mapping = np.memmap(self.path, dtype='u1', mode='r')

    def tile(self, tx, ty, create=False):
        key = (int(tx),int(ty))
        if key not in self.tiles:
            if not create:
                return None
            require(self.mode != 'r', 'Cannot extend a read-only index')
            self.tiles[key] = len(self.tiles)
        if len(self.tiles) > self.capacity:
            require(self.mode != 'r', 'Truncated read-only display layer')
            self.close()
            self.capacity = 1 << (len(self.tiles)-1).bit_length()
            with self.path.open('r+b' if self.path.exists() else 'w+b') as output:
                output.truncate(self.capacity*self.tile_bytes)
        if self.mapping is None:
            self.mapping = np.memmap(self.path,dtype='u1',mode='r' if self.mode == 'r' else 'r+')
        return np.ndarray((TILE,TILE),dtype=self.dtype,buffer=self.mapping,
                          offset=self.tiles[key]*self.tile_bytes)

    def get(self, x, y):
        if self.x0 <= x < self.x0 + self.nx and self.y0 <= y < self.y0 + self.ny:
            tile = self.tile(x//TILE,y//TILE)
            # A copied scalar survives growth of a writable layer mapping.
            return None if tile is None else tile[y%TILE,x%TILE].copy()
        return None

    def put(self,x,y,value):
        self.tile(x//TILE,y//TILE,True)[y%TILE,x%TILE] = value

    def close(self):
        if self.mapping is not None:
            self.mapping._mmap.close()
            self.mapping = None


def _axis_bounds(index,size,layout):
    if layout is None:
        return index*size,(index+1)*size
    period,count = layout
    group,local = np.divmod(index,count)
    return group*period+local*size,group*period+np.minimum((local+1)*size,period)


def _axis_index(value,size,layout):
    if layout is None:
        return np.floor(_lattice_integer(np.asarray(value)/size)).astype(np.int64)
    period,count = layout
    group = np.floor(_lattice_integer(np.asarray(value)/period)).astype(np.int64)
    local = np.floor(_lattice_integer((value-group*period)/size)).astype(np.int64)
    return group*count+np.minimum(local,count-1)


def _lattice_integer(value):
    """Match client lattice-line roundoff; original half-open bounds stay exact."""
    below = np.floor(value)
    nearest = below+(value-below >= .5)  # JavaScript Math.round, including half ties.
    return np.where(np.abs(value-nearest) <= 4*np.finfo(float).eps*np.maximum(1,np.abs(value)),
                    nearest,value)


def _axis_end(value,size,layout):
    if layout is None:
        return int(np.ceil(_lattice_integer(value/size)))
    period,count = layout
    group = int(np.floor(_lattice_integer(value/period)))
    return group*count+min(count,int(np.ceil(_lattice_integer((value-group*period)/size))))


def _groups(child,parent,tx,ty,occupied):
    iy,ix = np.nonzero(occupied)
    if not any(child.layout) and not any(parent.layout):
        px,py = (ix+tx*TILE)//round(parent.w/child.w), (iy+ty*TILE)//round(parent.h/child.h)
    else:
        b = child.bounds(ix+tx*TILE,iy+ty*TILE,(0,0))
        px,py = parent.locate((b[0]+b[2])/2,(b[1]+b[3])/2,(0,0))
    # A child tile touches only a bounded number of parent tiles.
    for ux in np.unique(px//TILE):
        for uy in np.unique(py//TILE):
            mask = (px//TILE == ux) & (py//TILE == uy)
            if np.any(mask):
                yield int(ux),int(uy),py[mask]%TILE,px[mask]%TILE,iy[mask],ix[mask]


def _rollup(child,parent):
    for tx,ty in sorted(child.tiles):
        source = child.tile(tx,ty)
        for ux,uy,dy,dx,sy,sx in _groups(child,parent,tx,ty,source['area'] > 0):
            target = parent.tile(ux,uy,True)
            require(not np.any(target['id'][dy,dx]), 'Overlapping coarse/fine cells')
            keys = dy*TILE+dx
            order = np.argsort(keys, kind='stable')
            starts = np.r_[0, np.flatnonzero(np.diff(keys[order]))+1]
            dy, dx = np.divmod(keys[order][starts], TILE)
            for field in ('area','z'):
                target[field][dy,dx] += np.add.reduceat(source[field][sy,sx][order], starts)
            target['min'][dy,dx] = np.minimum(
                np.where(target['min'][dy,dx] > 0,target['min'][dy,dx],np.inf),
                np.minimum.reduceat(source['min'][sy,sx][order], starts))
            target['level'][dy,dx] = np.maximum(target['level'][dy,dx],
                np.maximum.reduceat(source['level'][sy,sx][order], starts))
            b = parent.bounds(dx+ux*TILE,dy+uy*TILE,(0,0))
            width = np.asarray(b[2], dtype='<f8')-np.asarray(b[0], dtype='<f8')
            height = np.asarray(b[3], dtype='<f8')-np.asarray(b[1], dtype='<f8')
            require(np.all(target['area'][dy,dx] <= width*height+1e-7), 'Overlapping cells')


def _histograms(directory, layers):
    """Persist sparse, exact class weights in finest-lattice area units.

    Native schema ratios are validated integers. Each original contributes an
    integer number of finest cells, so equal class areas tie exactly even when
    the schema sizes (such as 0.3 and 0.1) are not exact binary floats. Counts
    use Python integers and hexadecimal persistence without a numeric cap.
    """
    native = sorted((layer for layer in layers if layer.level > 0),
                    key=lambda layer: layer.level, reverse=True)
    units = {native[0].level: 1}
    for child, parent in pairwise(native):
        units[parent.level] = (units[child.level]
                               * round(parent.w/child.w) * round(parent.h/child.h))
    unit_area = native[0].w * native[0].h
    tile_indexes = [[] for _ in layers]
    for i, (child, parent) in enumerate(pairwise(layers), 1):
        sources = defaultdict(set)
        for tx, ty in child.tiles:
            occupied = child.tile(tx, ty)['area'] > 0
            for ux, uy, *_ in _groups(child, parent, tx, ty, occupied):
                sources[(ux, uy)].add((tx, ty))
        previous = {(tx, ty): (offset, length)
                    for tx, ty, offset, length in tile_indexes[i-1]}
        previous_path = directory / f'hist-{i-1}.bin'
        cursor = 0
        with ExitStack() as files:
            previous_file = files.enter_context(previous_path.open('rb')) if previous else None
            output = files.enter_context((directory / f'hist-{i}.bin').open('wb'))
            for (ux, uy), child_tiles in sorted(sources.items()):
                node = parent.tile(ux, uy)
                areas = {}

                for tx, ty in sorted(child_tiles):
                    child_node = child.tile(tx, ty)
                    if child.level > 0:
                        for gx, gy, dy, dx, sy, sx in _groups(
                                child, parent, tx, ty, child_node['id'] > 0):
                            if (gx, gy) == (ux, uy):
                                keys = (dy*TILE+dx)*256+child_node['land'][sy, sx]
                                keys, counts = np.unique(keys, return_counts=True)
                                for key, count in zip(keys.tolist(), counts.tolist()):
                                    areas[key] = areas.get(key, 0)+count*units[child.level]
                    if (tx, ty) not in previous:
                        continue
                    start, length = previous[(tx, ty)]
                    previous_file.seek(start)
                    entries = json.loads(previous_file.read(length))
                    x = np.array([entry[0] for entry in entries], dtype=np.int64)+tx*TILE
                    y = np.array([entry[1] for entry in entries], dtype=np.int64)+ty*TILE
                    bounds = child.bounds(x, y, (0, 0))
                    px, py = parent.locate((bounds[0]+bounds[2])/2,
                                           (bounds[1]+bounds[3])/2, (0, 0))
                    keys = ((py%TILE)*TILE+px%TILE)*256
                    for entry, xx, yy, key in zip(entries, px, py, keys.tolist()):
                        if xx//TILE == ux and yy//TILE == uy:
                            key += entry[2]
                            areas[key] = areas.get(key, 0)+int(entry[3], 16)

                summary = ((node['area'] > 0) & (node['id'] == 0)).ravel()
                keys = np.fromiter(areas, dtype=np.int64)
                # Object reductions retain Python integers of arbitrary size.
                # Never convert class weights to floating point or fixed-width
                # integers to choose winners, even for a one-unit difference.
                weights = np.fromiter(areas.values(), dtype=object)
                order = np.argsort(keys)
                order = order[summary[keys[order]//256]]
                keys, weights = keys[order], weights[order]
                slots = keys//256
                starts = np.r_[0, np.flatnonzero(np.diff(slots))+1] if len(slots) else np.array([], dtype=np.intp)
                occupied = slots[starts]
                require(np.array_equal(occupied, np.flatnonzero(summary)),
                        'Display histogram differs from occupied area')
                records = []
                if len(slots):
                    totals = np.add.reduceat(weights, starts)
                    maxima = np.maximum.reduceat(weights, starts)
                    repeats = np.diff(np.r_[starts, len(slots)])
                    candidates = np.where(weights == np.repeat(maxima, repeats), keys%256, 256)
                    winners = np.minimum.reduceat(candidates, starts)
                    physical = np.fromiter((total*unit_area for total in totals), dtype=np.float64)
                    expected = node.reshape(-1)['area'][occupied]
                    require(np.all(np.abs(physical-expected) <= np.maximum(
                        1e-7, 1e-12*np.maximum(np.abs(physical),np.abs(expected)))),
                        'Display histogram differs from occupied area')
                    node.reshape(-1)['land'][occupied] = winners
                    records = [[key//256%TILE, key//256//TILE, key%256, format(count,'x')]
                               for key,count in zip(keys.tolist(),weights.tolist())]
                if records:
                    payload = json.dumps(records, separators=(',', ':')).encode()
                    output.write(payload)
                    tile_indexes[i].append([ux, uy, cursor, len(payload)])
                    cursor += len(payload)
        previous_path.unlink(missing_ok=True)
    roots = []
    root_path = directory / f'hist-{len(layers)-1}.bin'
    with root_path.open('rb') as source:
        for tx, ty, offset, length in tile_indexes[-1]:
            source.seek(offset)
            roots.extend([tx*TILE+x, ty*TILE+y, category, count]
                         for x, y, category, count in json.loads(source.read(length)))
    root_path.unlink()
    return roots


def _coordinate_ranges(lo, hi):
    """Encode a float64 half-open interval as at most three integer boxes.

    IEEE bits, sign-adjusted, sort in numeric order. Splitting that 64-bit
    interval at its two end high words gives exact Cartesian ranges in two
    signed int32 coordinates, even across zero or very distant clusters.
    Subtracting one from the exclusive upper key preserves touching edges.
    Neither magnitude nor the finest schema unit limits the precision.
    """
    def key(value):
        # Give both representations of zero the same boundary ownership.
        bits = struct.unpack('<Q', struct.pack('<d', value if value else 0.0))[0]
        return bits ^ (0xffffffffffffffff if bits >> 63 else 0x8000000000000000)

    first, last = key(lo), key(hi)-1
    first_hi, first_lo = divmod(first, 1 << 32)
    last_hi, last_lo = divmod(last, 1 << 32)
    if first_hi == last_hi:
        ranges = [(first_hi, last_hi, first_lo, last_lo)]
    else:
        ranges = []
        # Full low-word ranges also include the endpoint's high word. Merge
        # those exact adjacent boxes instead of indexing nine fragments for
        # a rectangle whose four float64 low words are all zero.
        if first_lo:
            ranges.append((first_hi, first_hi, first_lo, 0xffffffff))
            first_hi += 1
        if last_lo != 0xffffffff:
            ranges.append((last_hi, last_hi, 0, last_lo))
            last_hi -= 1
        if first_hi <= last_hi:
            ranges.append((first_hi, last_hi, 0, 0xffffffff))
    return [tuple(word-(1 << 31) for word in interval) for interval in ranges]


def _rectangle_ranges(bounds):
    return [x+y for x in _coordinate_ranges(bounds[0], bounds[2])
            for y in _coordinate_ranges(bounds[1], bounds[3])]


def _directory_query(db, name, columns, ranges, first_layer, last_layer):
    # The outer, bounded search table drives integer-Rtree probes; coordinates
    # are fetched by primary key only after the exact spatial/level match.
    # One statement per directory, at most nine probes, with no native-level
    # loop. A rectangle can match several fragments; callers deduplicate IDs.
    values = ','.join('(?,?,?,?,?,?,?,?)' for _ in ranges)
    return json.loads(db.execute(f'''
        WITH search(xh0,xh1,xl0,xl1,yh0,yh1,yl0,yl1) AS (VALUES {values})
        SELECT json_group_array(json_array({columns}))
        FROM search AS s
        CROSS JOIN {name}_bounds AS b
        CROSS JOIN {name}_coords AS c ON c.id=b.entry_id
        WHERE b.max_xhi >= s.xh0 AND b.min_xhi <= s.xh1
          AND b.max_xlo >= s.xl0 AND b.min_xlo <= s.xl1
          AND b.max_yhi >= s.yh0 AND b.min_yhi <= s.yh1
          AND b.max_ylo >= s.yl0 AND b.min_ylo <= s.yl1
          AND b.max_layer >= ? AND b.min_layer <= ?
    ''', (*[value for interval in ranges for value in interval], first_layer, last_layer)).fetchone()[0])


def _tile_rtree(directory, layers, origin, source):
    path = directory / 'tile-rtree.sqlite'
    with closing(sqlite3.connect(path)) as db:
        for name in ('tile', 'original'):
            db.execute(f'''CREATE VIRTUAL TABLE {name}_bounds USING rtree_i32(
                id, min_xhi, max_xhi, min_xlo, max_xlo,
                min_yhi, max_yhi, min_ylo, max_ylo,
                min_layer, max_layer, +entry_id)''')
        db.execute('CREATE TABLE tile_coords (id INTEGER PRIMARY KEY, layer INTEGER, tx INTEGER, ty INTEGER)')
        db.execute('CREATE TABLE original_coords (id INTEGER PRIMARY KEY, layer INTEGER, x INTEGER, y INTEGER)')
        fragments = {'tile': 0, 'original': 0}

        def insert(name, entry_id, number, bounds):
            for interval in _rectangle_ranges(bounds):
                fragments[name] += 1
                db.execute(f'INSERT INTO {name}_bounds VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                           (fragments[name], *interval, number, number, entry_id))

        rows = ((number, tx, ty) for number, layer in enumerate(layers) for tx, ty in sorted(layer.tiles))
        for tile_id, (number, tx, ty) in enumerate(rows, 1):
            layer = layers[number]
            sx, sy = max(tx*TILE, layer.x0), max(ty*TILE, layer.y0)
            ex = min((tx+1)*TILE, layer.x0+layer.nx)-1
            ey = min((ty+1)*TILE, layer.y0+layer.ny)-1
            first, last = layer.bounds(sx, sy, origin), layer.bounds(ex, ey, origin)
            insert('tile', tile_id, number, (first[0], first[1], last[2], last[3]))
            db.execute('INSERT INTO tile_coords VALUES (?, ?, ?, ?)', (tile_id, number, tx, ty))
        # Only native levels coarser than the finest can be requested as
        # standalone originals. Index their exact validated binary geometry,
        # so sparse holes cannot make coarse-tile searches scale with the
        # length of a block boundary.
        offsets = np.memmap(directory/'offsets.bin', dtype='<u8', mode='r')
        try:
            with (source/'cell_topo.bin').open('rb') as cell_file:
                cells = mmap.mmap(cell_file.fileno(), 0, access=mmap.ACCESS_READ)
                try:
                    for number, layer in enumerate(layers[1:], 1):
                        if layer.level <= 0:
                            continue
                        for tx, ty in sorted(layer.tiles):
                            tile = layer.tile(tx, ty)
                            sy, sx = np.nonzero(tile['id'])
                            ids = tile['id'][sy, sx].astype(np.int64)
                            originals = _at(cells, CELL_HEADER, np.asarray(offsets[ids-1], dtype=np.intp))
                            for local_y, local_x, cid, bounds in zip(sy, sx, ids.tolist(), originals['bounds']):
                                x0,y0,x1,y1 = bounds
                                insert('original', cid, number, (x0, y0, x1, y1))
                                db.execute('INSERT INTO original_coords VALUES (?, ?, ?, ?)',
                                           (cid, number, int(local_x)+tx*TILE, int(local_y)+ty*TILE))
                finally:
                    cells.close()
        finally:
            offsets._mmap.close()
        db.commit()


def layer_specs(meta):
    b,o = meta['bounds'],meta['alignment_origin']
    sizes = []
    for i in range(len(meta['grid_info'])-1,-1,-1):
        w,h = meta['grid_info'][i]
        if sizes:
            cw,ch = sizes[-1][:2]
            rx,ry = round(w/cw),round(h/ch)
            kx,ky = 1,1
            while (min(kx*2,rx),min(ky*2,ry)) != (rx,ry):
                kx,ky = min(kx*2,rx),min(ky*2,ry)
                # Dyadic summaries reset inside each native parent. The last
                # strip is clipped when an integer ratio is not a power of 2.
                # Native lattices and their original geometry stay unchanged.
                layout = [None if rx%kx == 0 else [w,math.ceil(rx/kx)],
                          None if ry%ky == 0 else [h,math.ceil(ry/ky)]]
                sizes.append((cw*kx,ch*ky,-65536-len(sizes),layout))
        sizes.append((w,h,i+1,[None,None]))
    w,h,level,_ = sizes[-1]
    while True:
        w,h,level = w*2,h*2,level-1
        sizes.append((w,h,level,[None,None]))
        if (_axis_end(b[2]-o[0],w,None)-int(_axis_index(b[0]-o[0],w,None)) <= 2
                and _axis_end(b[3]-o[1],h,None)-int(_axis_index(b[1]-o[1],h,None)) <= 2):
            break
    specs = []
    for w,h,level,layout in sizes:
        x0,y0 = int(_axis_index(b[0]-o[0],w,layout[0])),int(_axis_index(b[1]-o[1],h,layout[1]))
        # Exclusive endpoints also work at zero, where nextafter/size could
        # underflow back to zero and invent an extra root across the origin.
        ex,ey = _axis_end(b[2]-o[0],w,layout[0]),_axis_end(b[3]-o[1],h,layout[1])
        spec = [w,h,x0,y0,ex-x0,ey-y0,level]
        if any(layout):
            spec.append(layout)
        specs.append(spec)
    return specs


def edge_at(data, eid):
    return EDGE.unpack_from(data, (eid - 1) * EDGE.size)


CELL_HEADER = np.dtype([('length','>u4'),('id','>u8'),('bounds','>f8',(4,)),
                        ('z','>f8'),('land','u1'),('counts','u1',(4,))])
EDGE_RECORD = np.dtype([('length','>u4'),('id','>u8'),('direction','u1'),
                        ('bounds','>f8',(4,)),('a','>u8'),('b','>u8'),
                        ('z','>f8'),('land','>i4')])


def _at(data, dtype, offsets):
    """Gather unaligned variable records without unpacking them in Python."""
    dtype = np.dtype(dtype)
    return np.ndarray((len(data)-dtype.itemsize+1,), dtype=dtype,
                      buffer=data, strides=(1,))[offsets]


def _text_chunks(source):
    """Finish records within bounded reads, with universal newline handling."""
    tail = b''
    while True:
        chunk = source.read(4*1024*1024)
        if not chunk:
            if tail:
                yield tail
            return
        data = tail+chunk
        # Keep a final CR until the next read so a split CRLF remains one
        # delimiter. CR-only files otherwise finish records just like LF files.
        end = len(data)-int(data.endswith(b'\r'))
        stop = max(data.rfind(b'\n',0,end), data.rfind(b'\r',0,end))+1
        if stop:
            yield data[:stop]
            tail = data[stop:]
        else:
            tail = data


def _text_batches(path, trailing_floats):
    """Read variable-length ne rows in bounded batches.

    Flatten only within bounded IO batches. Row delimiters retain the exact
    column counts; Arrow's C tokenizer rejects incomplete/malformed numbers.
    Topology and class tokens must still have integer syntax, independently
    of their exactly representable, subsequently checked numeric values.
    """
    import pyarrow as pa
    import pyarrow.csv as csv

    with path.open('rb') as source:
        for data in _text_chunks(source):
            data = data.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
            raw = np.frombuffer(data, dtype='u1')
            delimiters = np.flatnonzero((raw == 44) | (raw == 10))
            rows = np.flatnonzero(raw[delimiters] == 10)
            if not data.endswith(b'\n'):
                rows = np.r_[rows, len(delimiters)]
                delimiters = np.r_[delimiters, len(data)]
            starts = np.r_[0, rows[:-1]+1]
            widths = rows-starts+1
            require(np.all(widths >= trailing_floats+2), f'{path.name}: wrong column count')
            # One numeric column gives both files the same C parser, even
            # when hanging sides change the number of fields in each row.
            # Quote handling stays disabled, as in the assembled text format.
            table = csv.read_csv(pa.py_buffer(data.replace(b',', b'\n')),
                read_options=csv.ReadOptions(column_names=['value'], use_threads=True),
                parse_options=csv.ParseOptions(quote_char=False, ignore_empty_lines=False),
                convert_options=csv.ConvertOptions(column_types={'value':pa.float64()}))
            column = table.column(0)
            require(column.null_count == 0, f'Invalid {path.name} attributes/columns')
            values = column.combine_chunks().to_numpy(zero_copy_only=True)
            require(values.size == len(delimiters) and np.all(np.isfinite(values)),
                    f'Invalid {path.name} attributes/columns')
            # Decimal points and exponents are legal only in floating fields.
            # Alternating spans cover integer and floating fields. A linear
            # C reduction checks integer syntax without a binary search for
            # every decimal point in these multi-gigabyte text sources.
            spans = np.empty(2*len(rows)+1, dtype=np.intp)
            spans[0] = 0
            spans[1::2] = delimiters[rows-trailing_floats-1]+1
            spans[2::2] = delimiters[rows-1]
            decimal = (raw == 46) | (raw == 101) | (raw == 69)
            require(not np.logical_or.reduceat(decimal, spans)[::2].any(),
                    f'{path.name}: invalid integer token')
            # Float decoding must never round a uint64 topology identifier
            # into a different valid ID. Recover large integer tokens exactly;
            # floating geometry/attributes keep their float64 interpretation.
            if values.max() >= 1 << 53 or values.min() <= -(1 << 53):
                large = np.flatnonzero((values >= 1 << 53) | (values <= -(1 << 53)))
                row = np.searchsorted(rows, large)
                exact = large[(large <= rows[row]-trailing_floats-1) | (large == rows[row])]
                if len(exact):
                    values = values.astype(object)
                    for index in exact:
                        start = delimiters[index-1]+1 if index else 0
                        values[index] = int(data[start:delimiters[index]])
            yield values, starts, widths


def _validate_cell_edges(edges, headers, ids, owners, sides, seen):
    require(np.all((ids >= 1) & (ids <= len(edges))), 'Cell: invalid edge ID')
    indices = ids-1
    vertical = sides < 2
    # Global edge IDs are checked once by _read_edges before publication.
    require(np.all(np.where((sides == 0) | (sides == 3), edges['b'][indices], edges['a'][indices])
                       == headers['id'][owners]), 'Cell: nonreciprocal edge')
    require(np.all(edges['direction'][indices] == np.where(vertical, 0, 1)),
            'Cell: wrong edge direction')
    coord = headers['bounds'][owners, np.asarray([0,2,1,3])[sides]]
    require(np.all(np.abs(edges['bounds'][indices, np.where(vertical,0,1)]-coord) <= 1e-7),
            'Cell: edge outside side')
    lo = edges['bounds'][indices, np.where(vertical,1,0)]
    hi = edges['bounds'][indices, np.where(vertical,3,2)]
    group = owners*4+sides
    # Most sides have one segment. Only hanging sides need sorting; preserve
    # the file's group order and validate every segment, including duplicates.
    multiple = np.repeat(headers['counts'].ravel() > 1, headers['counts'].ravel())
    if np.any(multiple):
        order = np.lexsort((hi[multiple], lo[multiple], group[multiple]))
        lo[multiple], hi[multiple] = lo[multiple][order], hi[multiple][order]
    first = np.r_[True, group[1:] != group[:-1]]
    last = np.r_[group[1:] != group[:-1], True]
    expected_lo = headers['bounds'][owners[first], np.where(vertical[first],1,0)]
    expected_hi = headers['bounds'][owners[last], np.where(vertical[last],3,2)]
    require(np.all(hi > lo)
            and np.all(np.abs(lo[first]-expected_lo) <= 1e-7)
            and np.all(np.abs(lo[1:][~first[1:]]-hi[:-1][~first[1:]]) <= 1e-7),
            'Cell: gap/overlap in hanging side')
    require(np.all(np.abs(hi[last]-expected_hi) <= 1e-7), 'Cell: incomplete side')
    np.add.at(seen, ids-1, 1)


def _put_originals(layer, x, y, values):
    tx, ty = x//TILE, y//TILE
    order = np.lexsort((tx, ty))
    breaks = np.r_[0, np.flatnonzero((tx[order][1:] != tx[order][:-1])
                                    | (ty[order][1:] != ty[order][:-1]))+1, len(order)]
    for start, end in pairwise(breaks):
        indices = order[start:end]
        target = layer.tile(int(tx[indices[0]]), int(ty[indices[0]]), True).reshape(-1)
        slots = y[indices]%TILE*TILE+x[indices]%TILE
        require(len(np.unique(slots)) == len(slots) and not np.any(target['id'][slots]),
                'Duplicate cell geometry')
        target[slots] = values[indices]


def _read_cells(source, directory, meta, native, edges, seen):
    count, offset, zmin, zmax, categories = 0, 0, math.inf, -math.inf, set()
    with (source/'cell_topo.bin').open('rb') as cell_file, (directory/'offsets.bin').open('wb') as output:
        with mmap.mmap(cell_file.fileno(), 0, access=mmap.ACCESS_READ) as cells:
            for values, starts, widths in _text_batches(source/'ne.txt', 3):
                lengths = CELL_HEADER.itemsize+8*(widths-9)
                offsets = offset+np.r_[0, np.cumsum(lengths[:-1])]
                require(np.all(widths >= 13) and np.all(offsets+CELL_HEADER.itemsize <= len(cells))
                        and offsets[-1]+lengths[-1] <= len(cells), 'Truncated cell header/record')
                headers = _at(cells, CELL_HEADER, offsets)
                counts = headers['counts'].astype(np.int64)
                totals = counts.sum(axis=1)
                require(np.all(headers['length']+4 == lengths)
                        and np.all(totals == widths-9), 'Invalid cell record length')
                require(np.all(counts > 0), 'Cell: missing side topology')
                ids = np.arange(count+1, count+len(starts)+1, dtype=np.uint64)
                require(ids[-1] <= (1 << 53)-1, 'Cell ID exceeds JavaScript safe integer range')
                require(np.array_equal(headers['id'], ids), 'Cell IDs must be sequential and 1-based')
                require(np.array_equal(values[starts], ids)
                        and np.array_equal(values[starts[:,None]+np.arange(1,5)], counts),
                        'ne.txt: topology mismatch')
                owners = np.repeat(np.arange(len(starts)), totals)
                sides = np.repeat(np.tile(np.arange(4), len(starts)), counts.ravel())
                local = np.arange(len(owners))-np.repeat(np.r_[0,np.cumsum(totals[:-1])], totals)
                refs = _at(cells, '>u8', offsets[owners]+CELL_HEADER.itemsize+local*8)
                require(np.array_equal(values[starts[owners]+5+local], refs), 'ne.txt: topology mismatch')
                b = headers['bounds'].astype(np.float64)
                require(np.all(np.isfinite(b)) and np.all(np.isfinite(headers['z'])),
                        'Nonfinite cell geometry/attribute')
                attrs = values[starts[:,None]+widths[:,None]-np.arange(4,0,-1)]
                require(np.all((attrs[:,3] >= 0) & (attrs[:,3] <= 255)), 'Invalid ne.txt attributes')
                require(np.all(np.abs(attrs[:,:2]-(b[:,:2]+b[:,2:])/2) <= 1e-6), 'ne.txt centre mismatch')
                level = np.zeros(len(starts), dtype=np.uint16)
                matches = np.zeros(len(starts), dtype=np.uint32)
                for number, layer in native.items():
                    selected = (np.abs(b[:,2]-b[:,0]-layer.w) <= 1e-7) & (np.abs(b[:,3]-b[:,1]-layer.h) <= 1e-7)
                    level[selected] = number
                    matches += selected
                require(np.all(matches == 1), 'Cell: bounds do not match grid_info')
                require(np.all(b[:,:2] >= np.asarray(meta['bounds'][:2])-1e-7)
                        and np.all(b[:,2:] <= np.asarray(meta['bounds'][2:])+1e-7), 'Cell outside metadata bounds')
                _validate_cell_edges(edges, headers, refs, owners, sides, seen)
                for number, layer in native.items():
                    selected = level == number
                    if not np.any(selected):
                        continue
                    position = (b[selected,:2]-meta['alignment_origin'])/[layer.w,layer.h]
                    rounded = np.rint(position)
                    require(np.all(np.abs(position-rounded) < 1e-7), 'Cell: off schema lattice')
                    x, y = rounded.astype(np.int64).T
                    require(np.all((x >= layer.x0) & (x < layer.x0+layer.nx)
                                   & (y >= layer.y0) & (y < layer.y0+layer.ny)), 'Cell outside display lattice')
                    nodes = np.empty(np.count_nonzero(selected), dtype=NODE)
                    area = layer.w*layer.h
                    nodes['id'], nodes['area'], nodes['z'] = ids[selected], area, attrs[selected,2]*area
                    nodes['min'], nodes['level'], nodes['land'] = min(layer.w,layer.h), number, attrs[selected,3]
                    _put_originals(layer, x, y, nodes)
                np.asarray(offsets, dtype='<u8').tofile(output)
                count += len(starts)
                end = int(offsets[-1]+lengths[-1])
                offset = end
                zmin, zmax = min(zmin, float(attrs[:,2].min())), max(zmax, float(attrs[:,2].max()))
                categories.update(map(int, np.unique(attrs[:,3])))
            require(offset == len(cells) and count > 0, 'ne.txt: missing cell records')
    return count, zmin, zmax, categories


def _read_edges(edges):
    greatest_cell = 0
    for start in range(0, len(edges), 65536):
        e = edges[start:start+65536]
        ids = np.arange(start+1, start+len(e)+1, dtype=np.uint64)
        direction, a, b = e['direction'], e['a'], e['b']
        require(np.all(e['length'] == EDGE.size-4) and np.array_equal(e['id'], ids)
                and np.all(direction <= 1), 'Invalid edge record')
        require(np.all(((a > 0) | (b > 0)) & (a != b)), 'Invalid edge adjacency')
        greatest_cell = max(greatest_cell, int(a.max()), int(b.max()))
        box = e['bounds']
        require(np.all(np.isfinite(box)) and np.all(np.isfinite(e['z']))
                and np.all((e['land'] >= 0) & (e['land'] <= 255)), 'Invalid edge attributes')
        require(np.all(np.where(direction == 0,
                    (box[:,0] == box[:,2]) & (box[:,3] > box[:,1]),
                    (box[:,1] == box[:,3]) & (box[:,2] > box[:,0]))), 'Invalid edge geometry')
    return greatest_cell


def _check_edge_references(edges, seen, count, greatest_cell):
    require(greatest_cell <= count, 'Invalid edge adjacency')
    for start in range(0, len(edges), 65536):
        e = edges[start:start+65536]
        require(np.array_equal(seen[start:start+len(e)],
                               (e['a'] > 0).astype(np.uint8)+(e['b'] > 0)),
                'Edge: missing reciprocal cell reference')



def _build(source, directory, initial_fingerprint):
    with ExitStack() as resources:
        return _build_into(source,directory,initial_fingerprint,resources)


def _build_into(source, directory, initial_fingerprint, resources):
    meta = checked_meta(source)
    specs = layer_specs(meta)
    layers = [Layer(directory, i, spec, 'w+') for i, spec in enumerate(specs)]
    for layer in layers:
        resources.callback(layer.close)
    native = {layer.level: layer for layer in layers if layer.level > 0}
    edges_size = next(size for name, size, _ in initial_fingerprint if name == 'edge_topo.bin')
    require(edges_size and edges_size % EDGE.size == 0, 'Truncated edge_topo.bin')
    edge_count = edges_size // EDGE.size
    seen = np.memmap(directory / 'edge-seen.tmp', mode='w+', dtype='<u4', shape=(edge_count,))
    resources.callback(seen._mmap.close)
    edges = np.memmap(source/'edge_topo.bin', dtype=EDGE_RECORD, mode='r')
    resources.callback(edges._mmap.close)
    # Cell text and immutable binary edges are independent inputs.
    # One background reader overlaps C tokenization with batch validation;
    # only the cell reader writes layers and reference counts. Join before
    # checking all reciprocal counts or publishing any derived artifact.
    with ThreadPoolExecutor(max_workers=1) as readers:
        edge_validation = readers.submit(_read_edges, edges)
        count, zmin, zmax, categories = _read_cells(source, directory, meta, native, edges, seen)
        greatest_cell = edge_validation.result()
    _check_edge_references(edges, seen, count, greatest_cell)
    edges._mmap.close()
    seen._mmap.close()
    (directory / 'edge-seen.tmp').unlink()
    for child,parent in pairwise(layers):
        _rollup(child,parent)
    root_histograms = _histograms(directory,layers)
    _tile_rtree(directory,layers,meta['alignment_origin'],source)
    layer_tiles = [[[x,y,slot] for (x,y),slot in sorted(layer.tiles.items())] for layer in layers]
    meta.update(cellCount=count, landClasses=sorted(categories), elevationRange=[zmin,zmax])
    manifest = {'meta':meta, 'layers':specs, 'layerTiles':layer_tiles,
                'rootHistograms':root_histograms, 'source':str(source)}
    for layer in layers:
        layer.close()
    require(fingerprint(source) == initial_fingerprint, 'Grid changed during display index construction')
    (directory / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
    return manifest


class GridDisplayIndex:
    def __init__(self, source: Path, cache: Path, revision=None):
        self.source = Path(source).resolve()
        cache = Path(cache).resolve()
        self.fingerprint = fingerprint(self.source) if revision is None else revision
        identity = [VERSION,str(self.source),self.fingerprint]
        self.revision = hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:24]
        directory = cache / self.revision
        if not directory.exists():
            cache.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='building-', dir=cache) as temp:
                staging = Path(temp)
                _build(self.source, staging, self.fingerprint)
                try:
                    staging.rename(directory)
                except OSError as exc:
                    if exc.errno not in (errno.EEXIST, errno.ENOTEMPTY):
                        raise
        self.manifest = json.loads((directory/'manifest.json').read_text())
        self.directory = directory
        self.meta = {key:self.manifest['meta'][key] for key in (
            'epsg', 'bounds', 'alignment_origin', 'grid_info', 'elevationRange', 'landClasses')}
        self.meta['revision'] = self.revision
        self.origin = self.meta['alignment_origin']
        self.layers = []
        self.offsets = self.cells = self.edges = None
        self._cell_file = self._edge_file = None
        self._directory_db = None
        self._closed = False
        display_cache.register(self)
        try:
            for i, (spec, tiles) in enumerate(zip(self.manifest['layers'],self.manifest['layerTiles'])):
                self.layers.append(Layer(directory,i,spec,tiles=tiles))
            self.offsets = np.memmap(directory / 'offsets.bin',dtype='<u8',mode='r')
            self._cell_file = (self.source / 'cell_topo.bin').open('rb')
            self._edge_file = (self.source / 'edge_topo.bin').open('rb')
            self.cells = mmap.mmap(self._cell_file.fileno(),0,access=mmap.ACCESS_READ)
            self.edges = mmap.mmap(self._edge_file.fileno(),0,access=mmap.ACCESS_READ)
            # Keep every immutable file open for the generation's lifetime.
            # Independent cursors need independent statements when threads
            # overlap; Python's connection statement cache is not shared here.
            self._directory_db = sqlite3.connect(
                f'file:{directory}/tile-rtree.sqlite?mode=ro&immutable=1', uri=True,
                check_same_thread=False, cached_statements=0)
            self._roots = self._root_summaries()
            display_cache.prune(self.source, cache, directory)
        except BaseException:
            self.close()
            raise

    def close(self):
        if self._closed:
            return
        if self._directory_db is not None:
            self._directory_db.close()
        for mapping in (self.cells,self.edges):
            if mapping is not None:
                mapping.close()
        for file in (self._cell_file,self._edge_file):
            if file is not None:
                file.close()
        for layer in self.layers:
            layer.close()
        if self.offsets is not None:
            self.offsets._mmap.close()
        self._closed = True
        display_cache.closed(self)

    def _cell(self, cid):
        offset = int(self.offsets[cid-1]) + 4
        header = CELL.unpack_from(self.cells, offset)
        bounds = list(header[1:5])
        # The boundary validator established a unique native lattice level.
        for layer in self.layers:
            if layer.level > 0 and math.isclose(layer.w,bounds[2]-bounds[0],rel_tol=0,abs_tol=1e-7) and math.isclose(layer.h,bounds[3]-bounds[1],rel_tol=0,abs_tol=1e-7):
                ix = round((bounds[0]-self.origin[0])/layer.w)
                iy = round((bounds[1]-self.origin[1])/layer.h)
                node = layer.get(ix,iy)
                return self._display_cell(node,bounds), header, offset
        raise RuntimeError('Validated native cell missing from index')

    @staticmethod
    def _display_cell(node,bounds):
        return {'id':int(node['id']), 'bounds':bounds, 'level':int(node['level']),
                'elevation':float(node['z']/node['area']), 'landClass':int(node['land'])}

    def inspect(self,x,y):
        require(math.isfinite(x) and math.isfinite(y), 'Inspection coordinates must be finite')
        selected = None
        for layer in reversed(self.layers):
            if layer.level <= 0:
                continue
            ix,iy = math.floor((x-self.origin[0])/layer.w),math.floor((y-self.origin[1])/layer.h)
            # Division can place an exact decimal grid line one lattice index
            # away. Candidates only select a cell after original half-open
            # binary bounds confirm containment, including beside real holes.
            for dx,dy in ((0,0),(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)):
                node = layer.get(ix+dx,iy+dy)
                if node is not None and node['id']:
                    candidate = self._cell(int(node['id']))
                    b = candidate[0]['bounds']
                    if b[0] <= x < b[2] and b[1] <= y < b[3]:
                        selected = candidate
                        break
            if selected is not None:
                break
        if selected is None:
            return {'cell':None,'neighbors':[]}
        cell, header, offset = selected
        cursor, neighbors = 0, {}
        for side,n in zip(('west','east','south','north'),header[7:]):
            ids = struct.unpack_from(f'!{n}Q',self.cells,offset+CELL.size+cursor*8)
            for eid in ids:
                edge = edge_at(self.edges,eid)
                a,b = edge[7:9]
                other = b if a == cell['id'] else a
                if other:
                    key = (side,other)
                    if key not in neighbors:
                        neighbors[key] = {'side':side,'cell':self._cell(other)[0],'edgeIds':[]}
                    neighbors[key]['edgeIds'].append(eid)
            cursor += n
        return {'cell':cell,'neighbors':list(neighbors.values())}

    def _layer(self, number):
        if number < len(self.layers):
            return self.layers[number]
        root = self.layers[-1]
        depth = number-len(self.layers)+1
        try:
            w,h = math.ldexp(root.w,depth),math.ldexp(root.h,depth)
        except (OverflowError, TypeError):
            raise ValueError('Display ancestor exceeds finite grid coordinates') from None
        require(math.isfinite(w) and math.isfinite(h),
                'Display ancestor exceeds finite grid coordinates')
        factor = 1 << depth
        x0,y0 = root.x0//factor,root.y0//factor
        ex,ey = -(-(root.x0+root.nx)//factor),-(-(root.y0+root.ny)//factor)
        return Lattice([w,h,x0,y0,ex-x0,ey-y0,0])

    def _root_summaries(self):
        """At most four storage roots, retaining every class's exact weight."""
        root = self.layers[-1]
        histograms = defaultdict(dict)
        for x,y,category,count in self.manifest['rootHistograms']:
            histograms[(x,y)][category] = int(count,16)
        roots = []
        for y in range(root.y0,root.y0+root.ny):
            for x in range(root.x0,root.x0+root.nx):
                node = root.get(x,y)
                if node is not None and node['area'] > 0:
                    require(bool(histograms[(x,y)]), 'Missing display root histogram')
                    roots.append((x,y,node,histograms[(x,y)]))
        return roots

    def validate_nodes(self, block_layer, x, y, display_layer):
        require(all(type(v) is int for v in (block_layer, x, y, display_layer)),
                'Display block coordinates must be integers')
        require(0 <= display_layer <= block_layer,
                'Invalid display layer selection')
        block = self._layer(block_layer)
        require(block.x0 <= x < block.x0+block.nx and block.y0 <= y < block.y0+block.ny,
                'Display block outside grid')

    def nodes(self, block_layer, x, y, display_layer):
        """Return one camera-independent block in the GDN5 wire format."""
        self.validate_nodes(block_layer, x, y, display_layer)
        return self._nodes(block_layer, x, y, display_layer)

    @contextmanager
    def _directory(self):
        yield self._directory_db

    def _records(self, nodes, bounds, box):
        """Pack selected nodes together, retaining original binary geometry."""
        records = np.empty(len(nodes), dtype=DISPLAY_DTYPE)
        for field in ('id', 'area', 'z', 'min', 'level', 'land'):
            records[field] = nodes[field]
        records['bounds'] = bounds
        originals = nodes['id'] != 0
        ids = nodes['id'][originals]
        if len(ids):
            offsets = np.asarray(self.offsets[ids-1], dtype=np.intp)
            records['bounds'][originals] = _at(self.cells, CELL_HEADER, offsets)['bounds']
        exact = records['bounds']
        intersects = ((exact[:,0] < box[2]) & (exact[:,2] > box[0])
                      & (exact[:,1] < box[3]) & (exact[:,3] > box[1]))
        # Only originals need this exact half-open test. Summary ownership was
        # already selected by the clipped lattice's midpoint rule.
        return records[~originals | intersects].tobytes()

    def _nodes(self, block_layer, x, y, display_layer):
        block = self._layer(block_layer)
        box = block.bounds(x, y, self.origin)
        if display_layer >= len(self.layers):
            return self._ancestor_nodes(block_layer,x,y,display_layer)
        records = []
        search = _rectangle_ranges(box)
        max_native = max(i for i, layer in enumerate(self.layers) if layer.level > 0)
        with self._directory() as db:
            tiles = _directory_query(db, 'tile', 'c.tx, c.ty', search,
                                     display_layer, display_layer)
            layer = self.layers[display_layer]
            seen_tiles = set()
            for tx, ty in tiles:
                if (tx, ty) in seen_tiles:
                    continue
                seen_tiles.add((tx, ty))
                tile = layer.tile(tx, ty)
                sy, sx = np.nonzero(tile['area'] > 0)
                if not len(sx):
                    continue
                gx, gy = sx+tx*TILE, sy+ty*TILE
                valid = ((gx >= layer.x0) & (gx < layer.x0+layer.nx)
                         & (gy >= layer.y0) & (gy < layer.y0+layer.ny))
                sy, sx, gx, gy = sy[valid], sx[valid], gx[valid], gy[valid]
                bounds = layer.bounds(gx, gy, self.origin)
                # Midpoint ownership follows the clipped-dyadic hierarchy.
                bx, by = block.locate((bounds[0]+bounds[2])/2,
                                       (bounds[1]+bounds[3])/2, self.origin)
                selected = (bx == x) & (by == y)
                if np.any(selected):
                    records.append(self._records(tile[sy[selected], sx[selected]],
                                                 np.column_stack(bounds)[selected], box))

            if display_layer < max_native:
                originals = _directory_query(db, 'original', 'c.id, c.layer, c.x, c.y',
                                             search, display_layer+1, max_native)
                if originals:
                    # Rtree fragments can repeat a cell; emit each ID once.
                    unique, groups, seen = [], defaultdict(list), set()
                    for cid, i, gx, gy in originals:
                        if cid not in seen:
                            seen.add(cid)
                            groups[(i, gx//TILE, gy//TILE)].append(len(unique))
                            unique.append((gx, gy))
                    entries = np.array(unique, dtype=np.int64)
                    nodes = np.empty(len(entries), dtype=NODE)
                    for (i, tx, ty), positions in groups.items():
                        selected = np.asarray(positions, dtype=np.intp)
                        tile = self.layers[i].tile(tx, ty)
                        nodes[selected] = tile[entries[selected,1]%TILE, entries[selected,0]%TILE]
                    records.append(self._records(nodes, np.zeros((len(nodes),4)), box))
        return b'GDN5' + b''.join(records)

    def _ancestor_nodes(self, block_layer, x, y, display_layer):
        layer = self._layer(display_layer)
        root_number = len(self.layers)-1
        display_factor = 1 << (display_layer-root_number)
        block_factor = 1 << (block_layer-root_number)
        groups = defaultdict(list)
        for rx,ry,node,histogram in self._roots:
            if (rx//block_factor,ry//block_factor) == (x,y):
                groups[(rx//display_factor,ry//display_factor)].append((node,histogram))
        records = []
        for (gx,gy),children in sorted(groups.items()):
            weights = defaultdict(int)
            for _,histogram in children:
                for category,count in histogram.items():
                    weights[category] += count
            winner = min(weights,key=lambda category:(-weights[category],category))
            records.append(DISPLAY_RECORD.pack(
                0,*layer.bounds(gx,gy,self.origin),
                sum(float(node['area']) for node,_ in children),
                sum(float(node['z']) for node,_ in children),
                min(float(node['min']) for node,_ in children),
                max(int(node['level']) for node,_ in children),winner))
        return b'GDN5' + b''.join(records)
