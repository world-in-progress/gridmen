"""Cache contents and sparse spatial work must survive adversarial coordinates."""
from contextlib import closing
import hashlib
import json
import sqlite3
import struct
from types import SimpleNamespace

import pytest

import gridmen_backend.grid_display as display
from test_grid_display import decode_nodes, write_grid


def snapshot(directory):
    return {str(path.relative_to(directory)): (
        path.stat().st_size, path.stat().st_mtime_ns,
        hashlib.sha256(path.read_bytes()).hexdigest())
        for path in directory.rglob('*') if path.is_file()}


@pytest.mark.parametrize('damage', [
    'duplicate-id', 'zero-summary', 'histogram', 'sqlite', 'sqlite-coords', 'sqlite-header'
])
def test_same_size_stat_changes_rebuild_and_preserve_source(tmp_path, damage):
    source = write_grid(tmp_path/'source', [
        ((0, 0, 8, 8), 1, 3), ((8, 0, 16, 8), 2, 4)
    ], sizes=((8, 8),), bounds=(0, 0, 16, 8))
    original_source = snapshot(source)
    cache = tmp_path/'cache'
    index = display.GridDisplayIndex(source, cache)
    directory = index.directory
    index.close()
    if damage in ('sqlite', 'sqlite-coords'):
        path = directory/'tile-rtree.sqlite'
        size = path.stat().st_size
        with closing(sqlite3.connect(path)) as db, db:
            db.execute('UPDATE tile_bounds SET max_layer=max_layer+1 WHERE id=1'
                       if damage == 'sqlite' else 'UPDATE tile_coords SET tx=tx+1 WHERE id=1')
        assert path.stat().st_size == size
    elif damage == 'sqlite-header':
        path = directory/'tile-rtree.sqlite'
        data = bytearray(path.read_bytes())
        data[0] ^= 1
        path.write_bytes(data)
    else:
        path = (directory/'layer-0.bin' if damage == 'duplicate-id' else
                directory/'layer-1.bin' if damage == 'zero-summary' else
                next(p for p in directory.glob('hist-*.bin') if p.stat().st_size))
        data = bytearray(path.read_bytes())
        if damage == 'duplicate-id':
            struct.pack_into('<Q', data, 0, 2)
        elif damage == 'zero-summary':
            data[:] = bytes(len(data))
        else:
            data[0] ^= 1
        path.write_bytes(data)
    rebuilt = display.GridDisplayIndex(source, cache)
    try:
        assert rebuilt.inspect(1,1)['cell']['id'] == 1
        assert rebuilt.inspect(9,1)['cell']['id'] == 2
        assert decode_nodes(rebuilt.nodes(len(rebuilt.layers)-1,0,0,len(rebuilt.layers)-1))[0][5] == 128
    finally:
        rebuilt.close()
    assert snapshot(source) == original_source


def measured_nodes(index, selection, monkeypatch):
    """Observe real source unpacking, mapped tile access, and SQLite VM work."""
    counts = dict(cells=0, tiles=0, sql_steps=0)
    original_cell, original_tile, original_connect = display.CELL, display.Layer.tile, sqlite3.connect

    def unpack(*args):
        counts['cells'] += 1
        return original_cell.unpack_from(*args)

    def tile(*args, **kwargs):
        counts['tiles'] += 1
        return original_tile(*args, **kwargs)

    def step():
        counts['sql_steps'] += 1
        return 0

    def connect(*args, **kwargs):
        db = original_connect(*args, **kwargs)
        db.set_progress_handler(step, 1)
        return db

    with monkeypatch.context() as patch:
        patch.setattr(display, 'CELL', SimpleNamespace(unpack_from=unpack))
        patch.setattr(display.Layer, 'tile', tile)
        patch.setattr(sqlite3, 'connect', connect)
        records = decode_nodes(index.nodes(*selection))
    return records, counts


def test_far_fine_empty_block_does_not_read_unrelated_coarse_cells(tmp_path, monkeypatch):
    unit, far = 1/1024, 1_000_000
    measurements = []
    for side in (4, 8, 16, 32):
        cells = [((far+x*unit, far+y*unit, far+(x+1)*unit, far+(y+1)*unit),
                  x+y, (x+y)%5) for y in range(side) for x in range(side)]
        source = write_grid(tmp_path/f'source-{side}', cells,
                            sizes=((unit, unit), (unit/2, unit/2)),
                            bounds=(0, 0, far+64*unit, far+64*unit))
        index = display.GridDisplayIndex(source, tmp_path/'cache')
        try:
            records, counts = measured_nodes(index, (0, 2048000080, 2048000080, 0), monkeypatch)
            assert records == []
            assert counts['cells'] == counts['tiles'] == 0
            assert index.last_query_nodes == index.last_query_tiles == 0
            assert index.last_query_directory_queries == 2
            measurements.append(counts)
        finally:
            index.close()
    (tmp_path/'measurements.json').write_text(json.dumps(measurements))
    assert measurements[-1]['sql_steps'] <= measurements[0]['sql_steps']+100


def test_far_fine_empty_block_does_not_map_unrelated_tiles(tmp_path, monkeypatch):
    unit, far = 2**-18, 1_000_000
    measurements = []
    for side in (2, 4, 8):
        cells = [((far+x*64*unit, far+y*64*unit,
                   far+(x*64+1)*unit, far+(y*64+1)*unit), 5, 7)
                 for y in range(side) for x in range(side)]
        source = write_grid(tmp_path/f'source-{side}', cells, sizes=((unit, unit),),
                            bounds=(0, 0, far+128*64*unit, far+128*64*unit))
        index = display.GridDisplayIndex(source, tmp_path/'cache')
        try:
            q = int(far/unit)+80*64
            records, counts = measured_nodes(index, (0, q, q, 0), monkeypatch)
            assert records == []
            assert counts['cells'] == counts['tiles'] == 0
            assert index.last_query_nodes == index.last_query_tiles == 0
            assert index.last_query_directory_queries == 1
            measurements.append(counts)
        finally:
            index.close()
    (tmp_path/'measurements.json').write_text(json.dumps(measurements))
    assert measurements[-1]['sql_steps'] <= measurements[0]['sql_steps']+100


@pytest.mark.parametrize('far,unit', [
    (1_000_000, 2**-10), (-1_000_000, 2**-10),
    (2**40, 2**-10), (-2**40, 2**-10),
    (2**53-64, 2), (-2**53+64, 2),
])
def test_precise_coarse_originals_and_half_open_edges(tmp_path, monkeypatch, far, unit):
    source = write_grid(tmp_path/'source', [
        ((far, far, far+unit, far+unit), 7, 3),
        ((far+unit, far, far+2*unit, far+unit), -2, 4),
    ], sizes=((unit, unit), (unit/2, unit/2)),
       bounds=(far, far, far+4*unit, far+4*unit))
    before = snapshot(source)
    index = display.GridDisplayIndex(source, tmp_path/'cache')
    try:
        x = round(far/(unit/2))
        for dx, cid, z, land in ((0, 1, 7, 3), (1, 1, 7, 3), (2, 2, -2, 4)):
            records, counts = measured_nodes(index, (0, x+dx, x, 0), monkeypatch)
            expected = (far+(cid-1)*unit, far, far+cid*unit, far+unit)
            assert records == [(cid, *expected, unit*unit, z*unit*unit, unit, 1, land)]
            assert counts['cells'] == counts['tiles'] == index.last_query_nodes == 1
        records, counts = measured_nodes(index, (0, x+4, x, 0), monkeypatch)
        assert records == [] and counts['cells'] == counts['tiles'] == 0
    finally:
        index.close()
    assert snapshot(source) == before


def test_cross_origin_rectangles_deduplicate_fragments_and_filter_layers(tmp_path, monkeypatch):
    source = write_grid(tmp_path/'source', [
        ((-4, -2, 4, 2), 11, 9), ((4, -2, 12, 2), 7, 3),
        ((12, 2, 14, 3), -3, 6)
    ], origin=(-4, -2), sizes=((8, 4), (2, 1)), bounds=(-4, -2, 16, 6))
    before = snapshot(source)
    index = display.GridDisplayIndex(source, tmp_path/'cache')
    try:
        with closing(sqlite3.connect(f'file:{index.directory}/tile-rtree.sqlite?mode=ro', uri=True)) as db:
            assert db.execute('SELECT count(*) FROM original_bounds WHERE entry_id=1').fetchone()[0] > 1
        coarse = next(i for i, layer in enumerate(index.layers) if layer.level == 1)
        for selected in (0, coarse):
            records, counts = measured_nodes(index, (coarse, 0, 0, selected), monkeypatch)
            assert records == [(1, -4, -2, 4, 2, 32, 352, 4, 1, 9)]
            assert counts['cells'] == 1
        assert decode_nodes(index.nodes(0, 4, 0, 0)) == [(2, 4, -2, 12, 2, 32, 224, 4, 1, 3)]
        assert decode_nodes(index.nodes(0, 8, 4, 0)) == [(3, 12, 2, 14, 3, 2, -6, 1, 2, 6)]
    finally:
        index.close()
    assert snapshot(source) == before


def test_distant_positive_and_negative_clusters_keep_holes_empty(tmp_path, monkeypatch):
    far, unit = 2**40, 2**-10
    cells = [((x, y, x+unit, y+unit), cid, cid+2)
             for cid, (x, y) in enumerate(((-far, far), (far, -far), (far, far)), 1)]
    source = write_grid(tmp_path/'source', cells,
                        sizes=((unit, unit), (unit/2, unit/2)),
                        bounds=(-far-64*unit, -far-64*unit, far+64*unit, far+64*unit))
    index = display.GridDisplayIndex(source, tmp_path/'cache')
    try:
        for x, y in ((0, 0), (far/2, -far/2), (-far, -far)):
            query = (0, round(x/(unit/2)), round(y/(unit/2)), 0)
            records, counts = measured_nodes(index, query, monkeypatch)
            assert records == [] and counts['cells'] == counts['tiles'] == 0
        for cid, (bounds, z, land) in enumerate(cells, 1):
            query = (0, round(bounds[0]/(unit/2)), round(bounds[1]/(unit/2)), 0)
            records, counts = measured_nodes(index, query, monkeypatch)
            assert records == [(cid, *bounds, unit*unit, z*unit*unit, unit, 1, land)]
            assert counts['cells'] == 1
    finally:
        index.close()


def test_cached_open_and_queries_do_not_hash_or_scan(tmp_path, monkeypatch):
    source = write_grid(tmp_path/'source', [((0, 0, 8, 8), 1, 3)])
    before = snapshot(source)
    cache = tmp_path/'cache'
    index = display.GridDisplayIndex(source, cache)
    index.close()

    def no_scan(*args, **kwargs):
        raise AssertionError('Cached open/query scanned validated files')

    monkeypatch.setattr(display, '_checksum', no_scan)
    monkeypatch.setattr(display, '_at', no_scan)
    monkeypatch.setattr(display, 'checked_meta', no_scan)
    monkeypatch.setattr(display, '_validate_spatial_directory', no_scan)
    with monkeypatch.context() as context:
        context.setattr(sqlite3, 'connect', no_scan)
        reopened = display.GridDisplayIndex(source, cache)
    try:
        for _ in range(3):
            assert decode_nodes(reopened.nodes(0, 0, 0, 0))[0][0] == 1
            assert reopened.inspect(1, 1)['cell']['id'] == 1
    finally:
        reopened.close()
    assert snapshot(source) == before


def test_verified_cache_http_revision_gzip_and_304_preserve_source(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from gridmen_backend.api.endpoints import grid

    cells = [((0, 0, 32, 32), 19, 9)] + [
        ((32+x*4, y*4, 36+x*4, (y+1)*4), x-y, (x+y)%5)
        for y in range(4) for x in range(4)]
    source = write_grid(tmp_path/'source', cells, sizes=((32, 32), (4, 4)),
                        bounds=(0, 0, 48, 32))
    before = snapshot(source)
    cache = tmp_path/'resource'/'.display'
    index = display.GridDisplayIndex(source, cache)
    top, revision = len(index.layers)-1, index.revision
    index.close()
    cached_files = snapshot(cache)
    monkeypatch.setattr(grid, '_display_source', lambda _: source)
    monkeypatch.setattr(grid.settings, 'ROOT_DIR', tmp_path)
    grid._close_display_cache()
    app = FastAPI()
    app.include_router(grid.router, prefix='/api')
    path = f'/api/grid/test/display/nodes/{revision}/{top}/0/0/0'
    with TestClient(app) as client:
        assert client.get('/api/grid/test/display/meta').json()['revision'] == revision
        plain = client.get(path, headers={'Accept-Encoding': 'identity'})
        zipped = client.get(path, headers={'Accept-Encoding': 'gzip'})
        assert plain.status_code == zipped.status_code == 200
        assert zipped.headers['content-encoding'] == 'gzip'
        assert zipped.headers['vary'] == 'Accept-Encoding'
        assert 'immutable' in plain.headers['cache-control']
        assert zipped.content == plain.content
        records = {r[0]: r for r in decode_nodes(plain.content)}
        assert set(records) == set(range(1, len(cells)+1))
        for cid, (bounds, z, land) in enumerate(cells, 1):
            area = (bounds[2]-bounds[0])*(bounds[3]-bounds[1])
            assert records[cid][1:7] == (*bounds, area, z*area)
            assert records[cid][9] == land
        cached = client.get(path, headers={'If-None-Match': plain.headers['etag']})
        assert cached.status_code == 304 and not cached.content
        assert client.get(path.replace(revision, 'stale')).status_code == 409
    assert snapshot(source) == before
    assert snapshot(cache) == cached_files
