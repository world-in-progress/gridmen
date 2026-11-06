"""Frozen scalar query oracle from 1d25e86 (v10); do not optimize this helper.

Kept independent of the batched gather/packer to check complete wire bytes and
ordering on adversarial geometry. Construction and directory format are shared.
"""
from collections import defaultdict
from contextlib import closing
import sqlite3
import struct

import numpy as np

from gridmen_backend.grid_display import (
    CELL, DISPLAY_RECORD, TILE, _directory_query, _rectangle_ranges, require,
)


def v10_nodes(self, block_layer, x, y, display_layer):
        block = self._layer(block_layer)
        box = block.bounds(x, y, self.origin)
        if display_layer >= len(self.layers):
            return v10_ancestor_nodes(self,block_layer,x,y,display_layer)
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

def v10_ancestor_nodes(self, block_layer, x, y, display_layer):
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
