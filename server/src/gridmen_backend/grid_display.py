"""Read-only, schema-aligned display index. No assembly or sampling occurs here.

Native lattice layers contain original IDs. Coarser layers contain sufficient
statistics, never majority-of-majorities. Files are sparse, memory mapped and
built once per source revision; viewport queries only visit intersecting nodes.
"""
from __future__ import annotations

from collections import OrderedDict
from contextlib import ExitStack, closing
import errno
import hashlib
import json
import math
import mmap
import os
from pathlib import Path
import sqlite3
import struct
import sys
import tempfile
import threading
import time

import numpy as np
from pydantic_core import to_json

FILES = ('grid.meta.json', 'cell_topo.bin', 'edge_topo.bin', 'ne.txt', 'ns.txt')
VERSION = 3
TILE = 64
CELL = struct.Struct('!QdddddBBBBB')
EDGE = struct.Struct('!IQBddddQQdi')
NODE = np.dtype([('id', '<u8'), ('area', '<f8'), ('z', '<f8'),
                 ('min', '<f8'), ('max', '<f8'), ('level', '<u2'), ('land', 'u1')])
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


class Layer:
    """Sparse tile directory over one growable memory-mapped file per layer."""
    def __init__(self, directory, number, spec, mode='r', tiles=(), dtype=NODE):
        self.path, self.mode, self.dtype = directory / f'layer-{number}.bin', mode, np.dtype(dtype)
        self.spec = spec
        self.w, self.h, self.x0, self.y0, self.nx, self.ny, self.level = spec[:7]
        self.layout = spec[7] if len(spec) == 8 else (None,None)
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

    def bounds(self, x, y, origin):
        x0,x1 = _axis_bounds(x,self.w,self.layout[0])
        y0,y1 = _axis_bounds(y,self.h,self.layout[1])
        return [origin[0]+x0,origin[1]+y0,origin[0]+x1,origin[1]+y1]

    def locate(self,x,y,origin):
        return (_axis_index(x-origin[0],self.w,self.layout[0]),
                _axis_index(y-origin[1],self.h,self.layout[1]))

    def get(self, x, y):
        if self.x0 <= x < self.x0 + self.nx and self.y0 <= y < self.y0 + self.ny:
            tile = self.tile(x//TILE,y//TILE)
            # A copied scalar survives growth of a writable layer mapping.
            return None if tile is None else tile[y%TILE,x%TILE].copy()
        return None

    def gather(self,x,y):
        """Read a query frontier with one mapped-array operation per tile."""
        result = np.zeros(len(x),dtype=self.dtype)
        tx,ty = x//TILE,y//TILE
        order = np.lexsort((tx,ty))
        breaks = np.r_[0,np.flatnonzero((np.diff(tx[order]) != 0) | (np.diff(ty[order]) != 0))+1,len(order)]
        for start,end in zip(breaks[:-1],breaks[1:]):
            ids = order[start:end]
            if not len(ids):
                continue
            tile = self.tile(tx[ids[0]],ty[ids[0]])
            if tile is not None:
                valid = ((x[ids] >= self.x0) & (x[ids] < self.x0+self.nx)
                         & (y[ids] >= self.y0) & (y[ids] < self.y0+self.ny))
                ids = ids[valid]
                result[ids] = tile[y[ids]%TILE,x[ids]%TILE]
        return result

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
        return np.floor(np.asarray(value)/size).astype(np.int64)
    period,count = layout
    group = np.floor(np.asarray(value)/period).astype(np.int64)
    local = np.floor((value-group*period)/size).astype(np.int64)
    return group*count+np.minimum(local,count-1)


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
            for field in ('max','level'):
                np.maximum.at(target[field],(dy,dx),source[field][sy,sx])
            b = parent.bounds(dx+ux*TILE,dy+uy*TILE,(0,0))
            require(np.all(target['area'][dy,dx] <= (b[2]-b[0])*(b[3]-b[1])+1e-7), 'Overlapping cells')


def _categories(directory,layers,categories):
    # Preserve full per-category areas through each reduction; winners alone
    # are not sufficient statistics for categorical area aggregation.
    hist = [Layer(directory,f'hist-{i}',l.spec,'w+',dtype='<f8') for i,l in enumerate(layers)]
    best = [Layer(directory,f'best-{i}',l.spec,'w+',dtype='<f8') for i,l in enumerate(layers)]
    try:
        for category in sorted(categories):
            for layer,values in zip(layers,hist):
                for tx,ty in sorted(layer.tiles):
                    node = layer.tile(tx,ty)
                    values.tile(tx,ty,True)[:] = np.where((node['id'] > 0) & (node['land'] == category),node['area'],0)
            for i,(child,parent) in enumerate(zip(layers,layers[1:])):
                for tx,ty in sorted(hist[i].tiles):
                    source = hist[i].tile(tx,ty)
                    for ux,uy,dy,dx,sy,sx in _groups(child,parent,tx,ty,source > 0):
                        np.add.at(hist[i+1].tile(ux,uy,True),(dy,dx),source[sy,sx])
            for layer,values,winners in zip(layers,hist,best):
                for tx,ty in sorted(layer.tiles):
                    node,areas,maximum = layer.tile(tx,ty),values.tile(tx,ty),winners.tile(tx,ty,True)
                    better = (areas > maximum) & (node['id'] == 0)
                    node['land'][better] = category
                    maximum[better] = areas[better]
    finally:
        for layer in hist+best:
            layer.close()
        for path in directory.glob('layer-hist-*.bin'):
            path.unlink()
        for path in directory.glob('layer-best-*.bin'):
            path.unlink()


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
        if math.ceil((b[2]-o[0])/w)-math.floor((b[0]-o[0])/w) <= 2 and math.ceil((b[3]-o[1])/h)-math.floor((b[1]-o[1])/h) <= 2:
            break
    specs = []
    for w,h,level,layout in sizes:
        x0,y0 = int(_axis_index(b[0]-o[0],w,layout[0])),int(_axis_index(b[1]-o[1],h,layout[1]))
        # An upper boundary belongs to the next node only if it has positive
        # intersection. nextafter also handles a clipped final strip.
        ex,ey = int(_axis_index(np.nextafter(b[2]-o[0],-np.inf),w,layout[0]))+1,int(_axis_index(np.nextafter(b[3]-o[1],-np.inf),h,layout[1]))+1
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
                layer.put(ix,iy,(cid, area, z*area, min(layer.w,layer.h), min(layer.w,layer.h), level, land))
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
    for child,parent in zip(layers,layers[1:]):
        _rollup(child,parent)
    _categories(directory,layers,categories)
    layer_tiles = [[[x,y,slot] for (x,y),slot in sorted(layer.tiles.items())] for layer in layers]
    for layer in layers:
        layer.close()
    require(fingerprint(source) == initial_fingerprint, 'Grid changed during display index construction')
    meta.update(cellCount=count, landClasses=sorted(categories), attributes=['level','elevation','landClass'], elevationRange=[zmin,zmax])
    manifest = {'version':VERSION,'meta':meta,'layers':specs,'layerTiles':layer_tiles,'source':str(source),
                'fingerprint':initial_fingerprint, 'edgeCount':edge_count,
                'buildSeconds':time.perf_counter()-started,
                'peakRssBytes':_peak_rss()}
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
        self.meta = self.manifest['meta']
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

    def query(self,bounds,meters_per_pixel):
        return self._query(bounds,meters_per_pixel,materialize=True)

    def query_json(self,bounds,meters_per_pixel):
        # Consume fields as they are generated instead of retaining hundreds of
        # thousands of pixel dictionaries until a second serialization pass.
        return to_json(self._query(bounds,meters_per_pixel,materialize=False))

    def _query(self,bounds,meters_per_pixel,*,materialize):
        require(len(bounds) == 4 and all(math.isfinite(v) for v in bounds)
                and bounds[2] > bounds[0] and bounds[3] > bounds[1], 'Invalid viewport bounds')
        require(math.isfinite(meters_per_pixel) and meters_per_pixel > 0, 'Invalid metersPerPixel')
        s = meters_per_pixel
        # Clip only search coordinates, before integer lattice conversion.
        # Valid finite viewports may extend far beyond int64 lattice indices.
        domain = self.meta['bounds']
        search = [min(max(value,domain[axis%2]),domain[axis%2+2]) for axis,value in enumerate(bounds)]
        base = next(i for i,l in enumerate(self.layers) if l.level == 1)
        chunk_level = base
        while chunk_level+1 < len(self.layers) and max(self.layers[chunk_level].w,self.layers[chunk_level].h) < 128*s:
            chunk_level += 1

        def visible(b):
            return ((b[:,0] < bounds[2]) & (b[:,2] > bounds[0])
                    & (b[:,1] < bounds[3]) & (b[:,3] > bounds[1]))

        # Keep the original depth-first order while evaluating each frontier in
        # bulk. Big-endian path digits sort lexically, without a depth/bit limit.
        top = self.layers[-1]
        y,x = np.mgrid[top.y0:top.y0+top.ny,top.x0:top.x0+top.nx]
        x,y = x.ravel(),y.ravel()
        paths = np.zeros((len(x),len(self.layers)),dtype='>u4')
        paths[:,0] = np.arange(len(x))
        terminals, visited = [], 0
        for i in range(len(self.layers)-1,-1,-1):
            if not len(x):
                break
            layer = self.layers[i]
            b = np.column_stack(layer.bounds(x,y,self.origin))
            keep = visible(b)
            x,y,b,paths = x[keep],y[keep],b[keep],paths[keep]
            visited += len(x)
            nodes = layer.gather(x,y)
            keep = nodes['area'] > 0
            x,y,b,paths,nodes = x[keep],y[keep],b[keep],paths[keep],nodes[keep]
            native = nodes['id'] != 0
            summary = (~native) & (i <= chunk_level) & (max(layer.w,layer.h) <= s)
            stop = native | summary
            if np.any(stop):
                selected = nodes[stop]
                sample_area = ((b[stop,2]-b[stop,0])*(b[stop,3]-b[stop,1])) if any(layer.layout) else layer.w*layer.h
                occupied = np.where(selected['id'] != 0,1.,np.minimum(1.,selected['area']/sample_area))
                cells = (selected['id'] != 0) & (selected['min'] >= 4*s)
                terminals.append((b[stop],selected,occupied,cells,paths[stop]))
            if i == 0:
                break
            child = self.layers[i-1]
            keep = ~stop
            x,y,b,paths = x[keep],y[keep],b[keep],paths[keep]
            if not any(layer.layout) and not any(child.layout):
                rx,ry = round(layer.w/child.w),round(layer.h/child.h)
                # Clip the integer child ranges before allocating coordinates.
                # Boundary neighbors are filtered by exact intersection above.
                vx0,vy0 = child.locate(search[0],search[1],self.origin)
                vx1,vy1 = child.locate(search[2],search[3],self.origin)
                lx,ly = np.maximum(x*rx,vx0-1),np.maximum(y*ry,vy0-1)
                hx,hy = np.minimum((x+1)*rx-1,vx1+1),np.minimum((y+1)*ry-1,vy1+1)
            else:
                lx,ly = child.locate(np.maximum(b[:,0],bounds[0]),np.maximum(b[:,1],bounds[1]),self.origin)
                hx,hy = child.locate(np.minimum(b[:,2],bounds[2]),np.minimum(b[:,3],bounds[3]),self.origin)
                lx,ly,hx,hy = lx-1,ly-1,hx+1,hy+1
            nx,ny = np.maximum(0,hx-lx+1),np.maximum(0,hy-ly+1)
            count = nx*ny
            parent = np.repeat(np.arange(len(x)),count)
            offset = np.arange(int(count.sum()))-np.repeat(np.cumsum(count)-count,count)
            cx,cy = lx[parent]+offset%nx[parent],ly[parent]+offset//nx[parent]
            paths = paths[parent]
            paths[:,len(self.layers)-i] = offset
            if any(layer.layout) or any(child.layout):
                cb = child.bounds(cx,cy,self.origin)
                px,py = layer.locate((cb[0]+cb[2])/2,(cb[1]+cb[3])/2,self.origin)
                belongs = (px == x[parent]) & (py == y[parent])
                cx,cy,paths = cx[belongs],cy[belongs],paths[belongs]
            x,y = cx,cy

        self.last_query_nodes = visited
        if not terminals:
            return {'chunks':[],'cellCount':self.meta['cellCount']}
        if len(terminals) == 1:
            ranks = np.arange(len(terminals[0][0]))
        else:
            path = np.concatenate([t[4] for t in terminals])
            order = path.view(f'V{path.shape[1]*4}').ravel().argsort(kind='stable')
            ranks = np.empty(len(order),dtype=np.intp)
            ranks[order] = np.arange(len(order))
            del path,order
        field_batches, cell_batches, cursor = [], [], 0
        for b,nodes,occupied,cells,_ in terminals:
            rank = ranks[cursor:cursor+len(b)]
            cursor += len(b)
            if np.any(cells):
                cell_batches.append((b[cells],nodes[cells],rank[cells]))
            keep = ~cells
            b,nodes,occupied,rank = b[keep],nodes[keep],occupied[keep],rank[keep]
            # Midpoint splitting must use each actual floating point extent:
            # nominally equal lattice widths can straddle s after rounding.
            if not len(b):
                continue
            if np.all((b[:,2]-b[:,0] <= s) & (b[:,3]-b[:,1] <= s)):
                field_batches.append((b,nodes,occupied,rank))
                continue
            depth = 1+max(0,math.ceil(math.log2(max(np.max(b[:,2]-b[:,0]),np.max(b[:,3]-b[:,1]))/s)))
            path = np.zeros((len(b),depth+1),dtype='>u4')
            path[:,0] = np.arange(len(b))
            finished = []
            for step in range(depth+1):
                split_x,split_y = b[:,2]-b[:,0] > s,b[:,3]-b[:,1] > s
                done = ~(split_x | split_y)
                if np.any(done):
                    finished.append((b[done],nodes[done],occupied[done],rank[done],path[done]))
                if np.all(done):
                    break
                keep = ~done
                b,nodes,occupied,rank,path = (v[keep] for v in (b,nodes,occupied,rank,path))
                split_x,split_y = split_x[keep],split_y[keep]
                children,masks = [],[]
                mx,my = (b[:,0]+b[:,2])/2,(b[:,1]+b[:,3])/2
                for right in range(2 if np.any(split_x) else 1):
                    for upper in range(2 if np.any(split_y) else 1):
                        children.append(np.column_stack((
                            mx if right else b[:,0],my if upper else b[:,1],
                            np.where(split_x,mx,b[:,2]) if not right else b[:,2],
                            np.where(split_y,my,b[:,3]) if not upper else b[:,3])))
                        masks.append((split_x if right else np.ones(len(b),dtype=bool))
                                     & (split_y if upper else np.ones(len(b),dtype=bool)))
                count = len(children)
                b = np.stack(children,axis=1).reshape(-1,4)
                nodes,occupied,rank,path = (np.repeat(v,count,axis=0) for v in (nodes,occupied,rank,path))
                path[:,step+1] = np.tile(np.arange(count),len(b)//count)
                keep = np.stack(masks,axis=1).ravel() & visible(b)
                b,nodes,occupied,rank,path = (v[keep] for v in (b,nodes,occupied,rank,path))
            if finished:
                values = [np.concatenate([v[k] for v in finished]) for k in range(5)]
                path = values[-1]
                order = path.view(f'V{path.shape[1]*4}').ravel().argsort(kind='stable')
                field_batches.append(tuple(v[order] for v in values[:4]))

        # Group once per chunk, rather than formatting a key and looking up a
        # dictionary for every pixel. Only the final JSON objects use Python.
        chunk_layer = self.layers[chunk_level]
        chunks = {}
        def groups(b,rank):
            cx = np.floor(((b[:,0]+b[:,2])/2-self.origin[0])/chunk_layer.w).astype(np.int64)
            cy = np.floor(((b[:,1]+b[:,3])/2-self.origin[1])/chunk_layer.h).astype(np.int64)
            order = np.lexsort((rank,cx,cy))
            breaks = np.r_[0,np.flatnonzero((np.diff(cx[order]) != 0) | (np.diff(cy[order]) != 0))+1,len(order)]
            for start,end in zip(breaks[:-1],breaks[1:]):
                ids = order[start:end]
                x,y = int(cx[ids[0]]),int(cy[ids[0]])
                key = f'{chunk_layer.level}:{x}:{y}'
                if key not in chunks:
                    chunks[key] = (int(rank[ids].min()),{'key':key,'bounds':chunk_layer.bounds(x,y,self.origin),'cells':[],'fields':[]})
                else:
                    first,chunk = chunks[key]
                    chunks[key] = (min(first,int(rank[ids].min())),chunk)
                yield chunks[key][1],ids

        if field_batches:
            b = np.concatenate([v[0] for v in field_batches])
            nodes = np.concatenate([v[1] for v in field_batches])
            occupied = np.concatenate([v[2] for v in field_batches])
            rank = np.concatenate([v[3] for v in field_batches])
            z = nodes['z']/nodes['area']
            for chunk,ids in groups(b,rank):
                fields = (dict(bounds=box,occupiedFraction=area,minCellSize=size,
                    level=level,elevation=elevation,landClass=land)
                    for box,area,size,level,elevation,land in zip(b[ids].tolist(),occupied[ids].tolist(),
                        nodes['min'][ids].tolist(),nodes['level'][ids].tolist(),z[ids].tolist(),nodes['land'][ids].tolist()))
                chunk['fields'] = list(fields) if materialize else fields
        if cell_batches:
            b = np.concatenate([v[0] for v in cell_batches])
            nodes = np.concatenate([v[1] for v in cell_batches])
            rank = np.concatenate([v[2] for v in cell_batches])
            z = nodes['z']/nodes['area']
            for chunk,ids in groups(b,rank):
                # Original binary bounds retain their exact floating point
                # values; lattice reconstruction is only for spatial lookup.
                chunk['cells'] = [dict(id=cid,bounds=list(CELL.unpack_from(self.cells,int(self.offsets[cid-1])+4)[1:5]),
                    level=level,elevation=elevation,landClass=land)
                    for cid,level,elevation,land in zip(nodes['id'][ids].tolist(),nodes['level'][ids].tolist(),z[ids].tolist(),nodes['land'][ids].tolist())]
        return {'chunks':[chunk for _,chunk in sorted(chunks.values(),key=lambda pair:pair[0])],
                'cellCount':self.meta['cellCount']}
