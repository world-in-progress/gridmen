"""Read-only, schema-aligned display index. No assembly or sampling occurs here.

Native lattice layers contain original IDs. Coarser layers contain sufficient
statistics, never majority-of-majorities. Files are sparse, memory mapped and
built once per source revision; viewport queries only visit intersecting nodes.
"""
from __future__ import annotations

import errno
import hashlib
import json
import math
import mmap
import os
import sqlite3
import struct
import sys
import tempfile
import threading
import time
from collections import defaultdict
from contextlib import ExitStack, closing
from itertools import pairwise
from pathlib import Path

import numpy as np

FILES = ('grid.meta.json', 'cell_topo.bin', 'edge_topo.bin', 'ne.txt', 'ns.txt')
VERSION = 7
TILE = 64
CELL = struct.Struct('!QdddddBBBBB')
EDGE = struct.Struct('!IQBddddQQdi')
DISPLAY_RECORD = struct.Struct('<Q7dII')
NODE = np.dtype([('id', '<u8'), ('area', '<f8'), ('z', '<f8'),
                 ('min', '<f8'), ('level', '<u2'), ('land', 'u1')])
_LOCK = threading.Lock()


def require(ok, message):
    if not ok:
        raise ValueError(message)


def fingerprint(source: Path):
    return [(name, (source / name).stat().st_size, (source / name).stat().st_mtime_ns)
            for name in FILES]


def checked_meta(source):
    raw = json.loads((source / 'grid.meta.json').read_text())
    meta = {key: raw[key] for key in ('epsg', 'bounds', 'grid_info', 'level_info',
                                    'subdivide_rules', 'alignment_origin')}
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
    require(len(meta['level_info']) == len(sizes) + 1
            and len(meta['subdivide_rules']) == len(sizes) + 1, 'Invalid schema level metadata')
    for i, info in enumerate(meta['level_info']):
        require(all(isinstance(info[k], int) and info[k] > 0 for k in ('width', 'height')),
                'Invalid level_info')
        rule = meta['subdivide_rules'][i]
        require(len(rule) == 2 and all(isinstance(v, int) and v > 0 for v in rule),
                'Invalid subdivide_rules')
        if i and i < len(sizes):
            require(all(math.isclose(sizes[i-1][j] / sizes[i][j], rule[j]) for j in (0, 1)),
                    'subdivide_rules disagree with grid_info')
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
        if mode == 'r':
            require(all(type(value) is int for tile in tiles for value in tile), 'Invalid display tile coordinates/slots')
            require(len(self.tiles) == len(tiles) and sorted(self.tiles.values()) == list(range(len(tiles))),
                    'Invalid display tile slots')
            require(size % self.tile_bytes == 0 and self.capacity >= len(self.tiles),
                    'Truncated display layer')
            require(all(self.x0//TILE <= x <= (self.x0+self.nx-1)//TILE
                        and self.y0//TILE <= y <= (self.y0+self.ny-1)//TILE for x,y in self.tiles),
                    'Display tile outside layer bounds')

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
            for field in ('area','z'):
                np.add.at(target[field],(dy,dx),source[field][sy,sx])
            target['min'][dy,dx] = np.where(target['min'][dy,dx] > 0,target['min'][dy,dx],np.inf)
            np.minimum.at(target['min'],(dy,dx),source['min'][sy,sx])
            np.maximum.at(target['level'],(dy,dx),source['level'][sy,sx])
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
        previous_data = previous_path.read_bytes() if previous else b''
        cursor = 0
        with (directory / f'hist-{i}.bin').open('wb') as output:
            for (ux, uy), child_tiles in sorted(sources.items()):
                node = parent.tile(ux, uy)
                areas = {}

                def add(land, y, x, count, areas=areas):
                    key = int(y), int(x), int(land)
                    areas[key] = areas.get(key, 0) + int(count)

                for tx, ty in sorted(child_tiles):
                    child_node = child.tile(tx, ty)
                    if child.level > 0:
                        for gx, gy, dy, dx, sy, sx in _groups(
                                child, parent, tx, ty, child_node['id'] > 0):
                            if (gx, gy) == (ux, uy):
                                for yy, xx, land in zip(
                                        dy, dx, child_node['land'][sy, sx]):
                                    add(land, yy, xx, units[child.level])
                    if (tx, ty) not in previous:
                        continue
                    start, length = previous[(tx, ty)]
                    entries = json.loads(previous_data[start:start+length])
                    x = np.array([entry[0] for entry in entries], dtype=np.int64)+tx*TILE
                    y = np.array([entry[1] for entry in entries], dtype=np.int64)+ty*TILE
                    bounds = child.bounds(x, y, (0, 0))
                    px, py = parent.locate((bounds[0]+bounds[2])/2,
                                           (bounds[1]+bounds[3])/2, (0, 0))
                    for entry, xx, yy in zip(entries, px, py):
                        if xx//TILE == ux and yy//TILE == uy:
                            add(entry[2], yy%TILE, xx%TILE, int(entry[3], 16))

                summary = (node['area'] > 0) & (node['id'] == 0)
                totals, winners = {}, {}
                records = []
                for (y, x, category), count in sorted(areas.items()):
                    if not summary[y, x]:
                        continue
                    key = y, x
                    totals[key] = totals.get(key, 0) + count
                    current = winners.get(key)
                    if current is None or count > current[0] or (
                            count == current[0] and category < current[1]):
                        winners[key] = count, category
                    records.append([x, y, category, format(count, 'x')])
                ys, xs = np.nonzero(summary)
                for y, x in zip(ys, xs):
                    key = int(y), int(x)
                    require(key in totals and math.isclose(
                        totals[key]*unit_area, float(node['area'][y, x]),
                        rel_tol=1e-12, abs_tol=1e-7),
                        'Display histogram differs from occupied area')
                    node['land'][y, x] = winners[key][1]
                if records:
                    payload = json.dumps(records, separators=(',', ':')).encode()
                    output.write(payload)
                    tile_indexes[i].append([ux, uy, cursor, len(payload)])
                    cursor += len(payload)
    return tile_indexes


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
        ranges = [(first_hi, first_hi, first_lo, 0xffffffff),
                  (last_hi, last_hi, 0, last_lo)]
        if first_hi+1 < last_hi:
            ranges.append((first_hi+1, last_hi-1, 0, 0xffffffff))
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
    return db.execute(f'''
        WITH search(xh0,xh1,xl0,xl1,yh0,yh1,yl0,yl1) AS (VALUES {values})
        SELECT {columns}
        FROM search AS s
        CROSS JOIN {name}_bounds AS b
        CROSS JOIN {name}_coords AS c ON c.id=b.entry_id
        WHERE b.max_xhi >= s.xh0 AND b.min_xhi <= s.xh1
          AND b.max_xlo >= s.xl0 AND b.min_xlo <= s.xl1
          AND b.max_yhi >= s.yh0 AND b.min_yhi <= s.yh1
          AND b.max_ylo >= s.yl0 AND b.min_ylo <= s.yl1
          AND b.max_layer >= ? AND b.min_layer <= ?
    ''', (*[value for interval in ranges for value in interval], first_layer, last_layer))


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
        count = 0
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
                            for local_y, local_x in zip(sy, sx):
                                cid = int(tile['id'][local_y, local_x])
                                original = CELL.unpack_from(cells, int(offsets[cid-1])+4)
                                x0,y0,x1,y1 = original[1:5]
                                insert('original', cid, number, (x0, y0, x1, y1))
                                db.execute('INSERT INTO original_coords VALUES (?, ?, ?, ?)',
                                           (cid, number, int(local_x)+tx*TILE, int(local_y)+ty*TILE))
                                count += 1
                finally:
                    cells.close()
        finally:
            offsets._mmap.close()
        db.commit()
    return count, fragments


def _checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _content_files(layers):
    return ['offsets.bin', 'tile-rtree.sqlite'] + [
        layer.path.name for layer in layers if layer.tiles
    ] + [f'hist-{i}.bin' for i in range(1, len(layers))]


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


def validate_cell_edges(data, cid, bounds, counts, ids, edge_count, seen):
    x0, y0, x1, y1 = bounds
    cursor = 0
    for side, n in enumerate(counts):
        require(n > 0, f'Cell {cid}: missing side topology')
        segments = []
        for eid in ids[cursor:cursor+n]:
            require(1 <= eid <= edge_count, f'Cell {cid}: invalid edge ID')
            _, idx, direction, ex0, ey0, ex1, ey1, a, b, _, _ = edge_at(data, eid)
            require(idx == eid and (b if side in (0, 3) else a) == cid,
                    f'Cell {cid}: nonreciprocal edge {eid}')
            require(direction == (0 if side < 2 else 1), f'Cell {cid}: wrong edge direction')
            coord = (x0, x1, y0, y1)[side]
            require(math.isclose(ex0 if side < 2 else ey0, coord, rel_tol=0, abs_tol=1e-7),
                    f'Cell {cid}: edge outside side')
            segments.append((ey0, ey1) if side < 2 else (ex0, ex1))
            seen[eid - 1] += 1
        segments.sort()
        start, end = (y0, y1) if side < 2 else (x0, x1)
        for lo, hi in segments:
            require(math.isclose(lo, start, rel_tol=0, abs_tol=1e-7) and hi > lo,
                    f'Cell {cid}: gap/overlap in hanging side')
            start = hi
        require(math.isclose(start, end, rel_tol=0, abs_tol=1e-7), f'Cell {cid}: incomplete side')
        cursor += n



def _build(source, directory, initial_fingerprint):
    with ExitStack() as resources:
        return _build_into(source,directory,initial_fingerprint,resources)


def _build_into(source, directory, initial_fingerprint, resources):
    started = time.perf_counter()
    meta = checked_meta(source)
    specs = layer_specs(meta)
    layers = [Layer(directory, i, spec, 'w+') for i, spec in enumerate(specs)]
    for layer in layers:
        resources.callback(layer.close)
    native = {layer.level: layer for layer in layers if layer.level > 0}
    edges_size = (source / 'edge_topo.bin').stat().st_size
    require(edges_size and edges_size % EDGE.size == 0, 'Truncated edge_topo.bin')
    edge_count = edges_size // EDGE.size
    seen = np.memmap(directory / 'edge-seen.tmp', mode='w+', dtype='u1', shape=(edge_count,))
    resources.callback(seen._mmap.close)
    count, offset, zmin, zmax, categories = 0, 0, math.inf, -math.inf, set()
    with (source / 'cell_topo.bin').open('rb') as cf, (source / 'edge_topo.bin').open('rb') as ef, (source / 'ne.txt').open() as ne, (directory / 'offsets.bin').open('wb') as offsets:
        require(os.fstat(cf.fileno()).st_size > 0, 'Empty cell_topo.bin')
        with mmap.mmap(cf.fileno(), 0, access=mmap.ACCESS_READ) as cells, mmap.mmap(ef.fileno(), 0, access=mmap.ACCESS_READ) as edges:
            while offset < len(cells):
                require(offset + 4 + CELL.size <= len(cells), 'Truncated cell header')
                length = struct.unpack_from('!I', cells, offset)[0]
                header = CELL.unpack_from(cells, offset + 4)
                cid, x0, y0, x1, y1, base_z, _, *counts = header
                count += 1
                require(count <= (1 << 53) - 1, 'Cell ID exceeds JavaScript safe integer range')
                require(cid == count, 'Cell IDs must be sequential and 1-based')
                require(length == CELL.size + 8 * sum(counts) and offset + 4 + length <= len(cells), 'Invalid cell record length')
                require(all(math.isfinite(v) for v in (x0, y0, x1, y1, base_z)), 'Nonfinite cell geometry/attribute')
                ids = struct.unpack_from(f'!{sum(counts)}Q', cells, offset + 4 + CELL.size)
                line = ne.readline().strip().split(',')
                require(len(line) == 9 + sum(counts), f'ne.txt: wrong column count at cell {cid}')
                ints = list(map(int, line[:5+sum(counts)]))
                require(ints == [cid, *counts, *ids], f'ne.txt: topology mismatch at cell {cid}')
                cx, cy, z = map(float, line[-4:-1])
                land = int(line[-1])
                require(all(math.isfinite(v) for v in (cx, cy, z)) and 0 <= land <= 255, 'Invalid ne.txt attributes')
                require(math.isclose(cx, (x0+x1)/2, rel_tol=0, abs_tol=1e-6) and math.isclose(cy, (y0+y1)/2, rel_tol=0, abs_tol=1e-6), 'ne.txt centre mismatch')
                matches = [i+1 for i, (w, h) in enumerate(meta['grid_info']) if math.isclose(x1-x0, w, rel_tol=0, abs_tol=1e-7) and math.isclose(y1-y0, h, rel_tol=0, abs_tol=1e-7)]
                require(len(matches) == 1, f'Cell {cid}: bounds do not match grid_info')
                level = matches[0]
                layer = native[level]
                ix, iy = (x0-meta['alignment_origin'][0])/layer.w, (y0-meta['alignment_origin'][1])/layer.h
                require(abs(ix-round(ix)) < 1e-7 and abs(iy-round(iy)) < 1e-7, f'Cell {cid}: off schema lattice')
                ix, iy = round(ix), round(iy)
                require(x0 >= meta['bounds'][0]-1e-7 and y0 >= meta['bounds'][1]-1e-7 and x1 <= meta['bounds'][2]+1e-7 and y1 <= meta['bounds'][3]+1e-7, 'Cell outside metadata bounds')
                node = layer.get(ix, iy)
                require(node is None or node['id'] == 0, 'Duplicate cell geometry')
                validate_cell_edges(edges, cid, (x0, y0, x1, y1), counts, ids, edge_count, seen)
                area = layer.w * layer.h
                layer.put(ix,iy,(cid, area, z*area, min(layer.w,layer.h), level, land))
                offsets.write(struct.pack('<Q', offset))
                zmin, zmax = min(zmin, z), max(zmax, z)
                categories.add(land)
                offset += length + 4
            require(ne.read() == '', 'Extra ne.txt records')
            with (source / 'ns.txt').open() as ns:
                for eid in range(1, edge_count + 1):
                    length, idx, direction, x0, y0, x1, y1, a, b, z, land = edge_at(edges, eid)
                    require(length == EDGE.size-4 and idx == eid and direction in (0,1), 'Invalid edge record')
                    require(0 <= a <= count and 0 <= b <= count and a != b, 'Invalid edge adjacency')
                    require(all(math.isfinite(v) for v in (x0,y0,x1,y1,z)) and 0 <= land <= 255, 'Invalid edge attributes')
                    require((x0 == x1 and y1 > y0) if direction == 0 else (y0 == y1 and x1 > x0), 'Invalid edge geometry')
                    require(seen[eid-1] == int(a > 0)+int(b > 0), f'Edge {eid}: missing reciprocal cell reference')
                    row = ns.readline().strip().split(',')
                    require(len(row) == 11, f'ns.txt: wrong column count at edge {eid}')
                    expected = [eid, 1 if direction else 2, 0 if direction else a, 0 if direction else b, b if direction else 0, a if direction else 0]
                    require(list(map(int, row[:6])) == expected, f'ns.txt: topology mismatch at edge {eid}')
                    values = list(map(float, row[6:10]))
                    require(all(math.isfinite(v) for v in values) and 0 <= int(row[10]) <= 255, 'Invalid ns.txt attributes')
                    require(all(math.isclose(v, target, rel_tol=0, abs_tol=1e-6) for v,target in zip(values[:3], [x1-x0 if direction else y1-y0,(x0+x1)/2,(y0+y1)/2])), 'ns.txt geometry mismatch')
                require(ns.read() == '', 'Extra ns.txt records')
    seen._mmap.close()
    (directory / 'edge-seen.tmp').unlink()
    for child,parent in pairwise(layers):
        _rollup(child,parent)
    histogram_tiles = _histograms(directory,layers)
    original_count, fragments = _tile_rtree(directory,layers,meta['alignment_origin'],source)
    layer_tiles = [[[x,y,slot] for (x,y),slot in sorted(layer.tiles.items())] for layer in layers]
    for layer in layers:
        layer.close()
    checksums = {name:_checksum(directory/name) for name in _content_files(layers)}
    require(fingerprint(source) == initial_fingerprint, 'Grid changed during display index construction')
    meta.update(cellCount=count, landClasses=sorted(categories), attributes=['level','elevation','landClass'], elevationRange=[zmin,zmax])
    manifest = {'version':VERSION,'meta':meta,'layers':specs,'layerTiles':layer_tiles,
                'tileDirectory':'float64-i32-v1','originalDirectoryCount':original_count,
                'directoryFragments':fragments,
                'histogramFormat':'exact-unit-json-v1',
                'histogramTiles':histogram_tiles,'source':str(source),
                'fingerprint':initial_fingerprint, 'edgeCount':edge_count,
                'buildSeconds':time.perf_counter()-started,
                'peakRssBytes':_peak_rss(), 'checksums':checksums}
    (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    return manifest


def _peak_rss():
    if sys.platform == 'win32':
        import ctypes
        from ctypes import wintypes
        class MemoryCounters(ctypes.Structure):
            _fields_ = [('cb',wintypes.DWORD),('faults',wintypes.DWORD)] + [
                (name,ctypes.c_size_t) for name in (
                    'peakWorkingSet','workingSet','peakPaged','paged',
                    'peakNonpaged','nonpaged','pagefile','peakPagefile')]
        counters = MemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        kernel,psapi = ctypes.WinDLL('kernel32'),ctypes.WinDLL('psapi')
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE,ctypes.POINTER(MemoryCounters),wintypes.DWORD]
        if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(),ctypes.byref(counters),counters.cb):
            raise ctypes.WinError()
        return counters.peakWorkingSet
    import resource
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == 'darwin' else 1024)


class GridDisplayIndex:
    def __init__(self, source: Path, cache: Path):
        self.source = Path(source).resolve()
        cache = Path(cache).resolve()
        revision = fingerprint(self.source)
        meta = checked_meta(self.source)
        specs = layer_specs(meta)
        identity = [VERSION,str(self.source),revision]
        if any(len(spec) == 8 for spec in specs):
            identity.append('clipped-dyadic-1')
        key = hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:24]
        directory = cache / key
        with _LOCK:
            if not directory.exists():
                cache.mkdir(parents=True, exist_ok=True)
                # SQLite supplies a process-safe cold-build lock. No custom
                # polling or stale lock files; a crashed owner releases it.
                with closing(sqlite3.connect(cache / 'build-lock.sqlite',timeout=3600)) as connection, connection:
                    connection.execute('BEGIN IMMEDIATE')
                    if not directory.exists():
                        with tempfile.TemporaryDirectory(prefix='building-', dir=cache) as temp:
                            staging = Path(temp)
                            _build(self.source, staging, revision)
                            try:
                                staging.rename(directory)
                            except OSError as exc:
                                if exc.errno not in (errno.EEXIST,errno.ENOTEMPTY):
                                    raise
                                existing = json.loads((directory / 'manifest.json').read_text())
                                require(existing['fingerprint'] == json.loads(json.dumps(revision))
                                        and existing['version'] == VERSION, 'Conflicting display index')
            self.manifest = json.loads((directory / 'manifest.json').read_text())
        require(self.manifest['version'] == VERSION
                and self.manifest['source'] == str(self.source)
                and self.manifest['fingerprint'] == json.loads(json.dumps(revision)), 'Invalid display manifest')
        require(self.manifest['layers'] == specs
                and len(self.manifest['layerTiles']) == len(specs), 'Invalid display layer layout')
        require(all(self.manifest['meta'][key] == value for key,value in meta.items()), 'Display metadata mismatch')
        self.directory = directory
        self.revision = key
        self.meta = dict(self.manifest['meta'], revision=key, displayLayers=[{
            'width':spec[0], 'height':spec[1], 'x0':spec[2], 'y0':spec[3],
            'nx':spec[4], 'ny':spec[5], 'nativeLevel':spec[6] if spec[6] > 0 else None,
            'xLayout':spec[7][0] if len(spec) == 8 else None,
            'yLayout':spec[7][1] if len(spec) == 8 else None,
        } for spec in specs])
        self.origin = self.meta['alignment_origin']
        self.layers = [Layer(directory,i,spec,tiles=tiles) for i,(spec,tiles) in enumerate(zip(self.manifest['layers'],self.manifest['layerTiles']))]
        self.offsets = self.cells = self.edges = None
        self._cell_file = self._edge_file = None
        try:
            count = self.meta['cellCount']
            require(isinstance(count,int) and count > 0
                    and (directory/'offsets.bin').stat().st_size == count*8, 'Invalid display offsets length')
            self.offsets = np.memmap(directory / 'offsets.bin',dtype='<u8',mode='r')
            self._cell_file = (self.source / 'cell_topo.bin').open('rb')
            self._edge_file = (self.source / 'edge_topo.bin').open('rb')
            self.cells = mmap.mmap(self._cell_file.fileno(),0,access=mmap.ACCESS_READ)
            self.edges = mmap.mmap(self._edge_file.fileno(),0,access=mmap.ACCESS_READ)
            require(len(self.edges) == self.manifest['edgeCount']*EDGE.size, 'Invalid display edge count')
            self._check_offsets()
            self._check_directories()
            self._check_contents()
            self._roots = self._root_summaries()
        except sqlite3.DatabaseError as exc:
            self.close()
            raise ValueError('Invalid display tile directory') from exc
        except Exception:
            self.close()
            raise

    def _check_offsets(self):
        # Validate derived pointers once, at index opening. Queries and inspect
        # trust these invariants; they never rescan original cell records.
        require(self.offsets[0] == 0, 'Invalid first display offset')
        raw = np.frombuffer(self.cells,dtype='u1')
        try:
            for start in range(0,len(self.offsets),65536):
                offsets = np.asarray(self.offsets[start:start+65536])
                require(np.all(offsets <= len(self.cells)-4-CELL.size), 'Display offset outside cell file')
                indices = offsets.astype(np.intp)
                lengths = raw[indices[:,None]+np.arange(4)].copy().view('>u4').ravel()
                ends = offsets+4+lengths
                following = np.r_[self.offsets[start+1:start+len(offsets)],
                                  self.offsets[start+len(offsets)] if start+len(offsets) < len(self.offsets) else len(self.cells)]
                require(np.all(lengths >= CELL.size) and np.all(ends == following), 'Invalid display record offsets')
                ids = raw[indices[:,None]+4+np.arange(8)].copy().view('>u8').ravel()
                require(np.array_equal(ids,np.arange(start+1,start+len(offsets)+1)), 'Display offset cell ID mismatch')
        finally:
            del raw

    def _check_directories(self):
        require(self.manifest.get('tileDirectory') == 'float64-i32-v1',
                'Invalid display tile directory version')
        require(self.manifest.get('histogramFormat') == 'exact-unit-json-v1',
                'Invalid display histogram version')
        indexes = self.manifest['histogramTiles']
        require(len(indexes) == len(self.layers) and not indexes[0], 'Invalid display histogram layout')
        for i, tiles in enumerate(indexes[1:], 1):
            cursor = 0
            for tx, ty, offset, count in tiles:
                require(all(type(v) is int for v in (tx,ty,offset,count))
                        and count > 0 and offset == cursor and (tx,ty) in self.layers[i].tiles,
                        'Invalid display histogram tile')
                cursor += count
            require((self.directory/f'hist-{i}.bin').stat().st_size == cursor,
                    'Invalid display histogram length')
        path = self.directory/'tile-rtree.sqlite'
        require(path.is_file(), 'Missing display tile directory')
        with closing(sqlite3.connect(f'file:{path}?mode=ro', uri=True)) as db:
            count = db.execute('SELECT count(*) FROM tile_bounds').fetchone()[0]
            originals = db.execute('SELECT count(*) FROM original_bounds').fetchone()[0]
            require(count == self.manifest['directoryFragments']['tile']
                    and originals == self.manifest['directoryFragments']['original']
                    and db.execute('SELECT count(*) FROM tile_coords').fetchone()[0]
                        == sum(len(layer.tiles) for layer in self.layers)
                    and db.execute('SELECT count(*) FROM original_coords').fetchone()[0]
                        == self.manifest['originalDirectoryCount']
                    and db.execute('PRAGMA quick_check').fetchone()[0] == 'ok',
                    'Invalid display tile directory')
            for cid, i, x, y in db.execute('SELECT id, layer, x, y FROM original_coords'):
                require(1 <= cid <= self.meta['cellCount']
                        and 0 < i < len(self.layers) and self.layers[i].level > 0,
                        'Invalid original display directory')
                node = self.layers[i].get(x, y)
                require(node is not None and int(node['id']) == cid,
                        'Invalid original display directory')

    def _check_contents(self):
        # Check every persisted derived byte once at opening. Requests trust
        # this boundary and never hash or repair a damaged cache on demand.
        checksums = self.manifest.get('checksums')
        require(isinstance(checksums, dict) and set(checksums) == set(_content_files(self.layers)),
                'Invalid display content checksums')
        for name, expected in checksums.items():
            require(_checksum(self.directory/name) == expected,
                    f'Invalid display contents: {name} checksum mismatch')

    def close(self):
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
        with (self.directory/f'hist-{len(self.layers)-1}.bin').open('rb') as source:
            for tx,ty,offset,length in self.manifest['histogramTiles'][-1]:
                source.seek(offset)
                for x,y,category,count in json.loads(source.read(length)):
                    histograms[(tx*TILE+x,ty*TILE+y)][category] = int(count,16)
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
        """Return one camera-independent block in the GDN4 wire format."""
        self.validate_nodes(block_layer, x, y, display_layer)
        return self._nodes(block_layer, x, y, display_layer)

    def _nodes(self, block_layer, x, y, display_layer):
        block = self._layer(block_layer)
        box = block.bounds(x, y, self.origin)
        if display_layer >= len(self.layers):
            return self._ancestor_nodes(block_layer,x,y,display_layer)
        records = []
        visited = 0
        tile_scans = 0
        directory_queries = 0
        path = self.directory/'tile-rtree.sqlite'
        search = _rectangle_ranges(box)
        max_native = max(i for i, layer in enumerate(self.layers) if layer.level > 0)
        with closing(sqlite3.connect(f'file:{path}?mode=ro', uri=True)) as db:
            directory_queries += 1
            tiles = _directory_query(db, 'tile', 'c.tx, c.ty', search,
                                     display_layer, display_layer)
            layer = self.layers[display_layer]
            seen_tiles = set()
            for tx, ty in tiles:
                if (tx, ty) in seen_tiles:
                    continue
                seen_tiles.add((tx, ty))
                tile = layer.tile(tx, ty)
                tile_scans += 1
                visited += TILE*TILE
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
                for pos in np.flatnonzero((bx == x) & (by == y)):
                    node = tile[sy[pos], sx[pos]]
                    cid = int(node['id'])
                    if cid:
                        original = CELL.unpack_from(self.cells, int(self.offsets[cid-1])+4)
                        chosen = original[1:5]
                        if not (chosen[0] < box[2] and chosen[2] > box[0]
                                and chosen[1] < box[3] and chosen[3] > box[1]):
                            continue
                    else:
                        chosen = tuple(float(axis[pos]) for axis in bounds)
                    records.append(DISPLAY_RECORD.pack(
                        cid, *chosen, float(node['area']), float(node['z']),
                        float(node['min']), int(node['level']), int(node['land'])))

            if display_layer < max_native:
                directory_queries += 1
                originals = _directory_query(db, 'original', 'c.id, c.layer, c.x, c.y',
                                             search, display_layer+1, max_native)
                seen_originals = set()
                for cid, i, gx, gy in originals:
                    if cid in seen_originals:
                        continue
                    seen_originals.add(cid)
                    visited += 1
                    exact = CELL.unpack_from(self.cells, int(self.offsets[cid-1])+4)[1:5]
                    if not (exact[0] < box[2] and exact[2] > box[0]
                            and exact[1] < box[3] and exact[3] > box[1]):
                        continue
                    node = self.layers[i].get(gx, gy)
                    records.append(DISPLAY_RECORD.pack(
                        cid, *exact, float(node['area']), float(node['z']),
                        float(node['min']), int(node['level']), int(node['land'])))
        self.last_query_nodes = visited
        self.last_query_tiles = tile_scans
        self.last_query_directory_queries = directory_queries
        require(len(records) <= 0xffffffff, 'Display block has too many records')
        return b'GDN4' + struct.pack('<I', len(records)) + b''.join(records)

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
        self.last_query_nodes = len(self._roots)
        self.last_query_tiles = self.last_query_directory_queries = 0
        return b'GDN4' + struct.pack('<I',len(records)) + b''.join(records)
