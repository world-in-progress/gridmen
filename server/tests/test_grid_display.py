import json
import math
import struct
from itertools import pairwise

import pytest
from gridmen_backend.grid_display import GridDisplayIndex


def write_grid(root, cells, *, origin=(0,0), sizes=((8,8),(4,4)), bounds=(0,0,16,8)):
    """Independent topology writer: derive segmented boundaries from rectangles."""
    root.mkdir(parents=True)
    edges, per_cell = [], [[[],[],[],[]] for _ in cells]
    for direction in (0,1):
        coords = sorted({b[k] for b,_,_ in cells for k in ((0,2) if direction == 0 else (1,3))})
        for coord in coords:
            spans = []
            for cid,(b,_,_) in enumerate(cells,1):
                for side in ((0,1) if direction == 0 else (2,3)):
                    if b[(0,2,1,3)[side]] == coord:
                        spans.append((b[1] if direction == 0 else b[0], b[3] if direction == 0 else b[2],cid,side))
            breaks = sorted({v for lo,hi,_,_ in spans for v in (lo,hi)})
            for lo,hi in pairwise(breaks):
                owners = [(cid,side) for a,b,cid,side in spans if a <= lo and b >= hi]
                if not owners:
                    continue
                a = next((cid for cid,side in owners if side in (1,2)),0)
                b = next((cid for cid,side in owners if side in (0,3)),0)
                eb = (coord,lo,coord,hi) if direction == 0 else (lo,coord,hi,coord)
                eid = len(edges)+1
                edges.append((direction,eb,a,b))
                for cid,side in owners:
                    per_cell[cid-1][side].append(eid)
    with (root/'cell_topo.bin').open('wb') as f, (root/'ne.txt').open('w') as ne:
        for cid,((b,z,land),sides) in enumerate(zip(cells,per_cell),1):
            counts = list(map(len,sides))
            ids = [eid for side in sides for eid in side]
            record = struct.pack('!QdddddBBBBB'+'Q'*len(ids),cid,*b,-999,0,*counts,*ids)
            f.write(struct.pack('!I',len(record))+record)
            ne.write(', '.join(map(str,[cid,*counts,*ids,(b[0]+b[2])/2,(b[1]+b[3])/2,z,land]))+'\n')
    with (root/'edge_topo.bin').open('wb') as f, (root/'ns.txt').open('w') as ns:
        for eid,(direction,b,a,c) in enumerate(edges,1):
            record = struct.pack('!QBddddQQdi',eid,direction,*b,a,c,-999,0)
            f.write(struct.pack('!I',len(record))+record)
            row = [eid,1 if direction else 2,0 if direction else a,0 if direction else c,c if direction else 0,a if direction else 0,b[2]-b[0] if direction else b[3]-b[1],(b[0]+b[2])/2,(b[1]+b[3])/2,11,7]
            ns.write(', '.join(map(str,row))+'\n')
    meta = {'epsg':2326,'bounds':bounds,'alignment_origin':origin,'grid_info':sizes,
            'level_info':[{'width':1,'height':1}]+[{'width':4*2**i,'height':2*2**i} for i in range(len(sizes))],
            'subdivide_rules':[[4,2]]+[[round(sizes[i-1][0]/sizes[i][0]),round(sizes[i-1][1]/sizes[i][1])] for i in range(1,len(sizes))]+[[1,1]]}
    (root/'grid.meta.json').write_text(json.dumps(meta))
    return root


@pytest.fixture
def mixed(tmp_path):
    cells = [((0,0,8,8),100,9),((8,0,12,4),2,4),((8,4,12,8),6,3),((12,0,16,4),10,3)]
    source = write_grid(tmp_path/'source',cells)
    index = GridDisplayIndex(source,tmp_path/'cache')
    yield index
    index.close()


def test_metadata_and_intervention_attributes(mixed):
    assert mixed.meta['cellCount'] == 4
    assert mixed.meta['landClasses'] == [3,4,9]
    assert mixed.meta['elevationRange'] == [2,100]
    assert mixed.inspect(1,1)['cell'] == {'id':1,'bounds':[0,0,8,8],'level':1,'elevation':100,'landClass':9}


@pytest.mark.parametrize('start,expected',[
    (1_000_000_000_000_000.5,1_000_000_000_000_001),
    (-1_000_000_000_000_000.5,-1_000_000_000_000_000),
    (4_503_599_627_370_497,4_503_599_627_370_497),
])
def test_layer_bounds_use_the_client_rounding_convention_at_large_lattice_indices(start,expected):
    from gridmen_backend.grid_display import layer_specs
    specs = layer_specs({'bounds':(start,0,start+8,1),'alignment_origin':(0,0),'grid_info':((1,1),)})
    assert specs[0][2] == expected


def test_hanging_neighbors_and_hole(mixed):
    result = mixed.inspect(1,1)
    assert [(n['side'],n['cell']['id']) for n in result['neighbors']] == [('east',2),('east',3)]
    assert all(len(n['edgeIds']) == 1 for n in result['neighbors'])
    assert mixed.inspect(14,6) == {'cell':None,'neighbors':[]}
    assert mixed.inspect(16,0)['cell'] is None
    assert mixed.inspect(8,1)['cell']['id'] == 2


def test_cache_reuse_and_invalidation(mixed):
    other = GridDisplayIndex(mixed.source,mixed.directory.parent)
    assert other.directory == mixed.directory
    other.close()
    path = mixed.source/'ne.txt'
    path.write_text(path.read_text().replace('100, 9','101, 9'))
    changed = GridDisplayIndex(mixed.source,mixed.directory.parent)
    assert changed.directory != mixed.directory and changed.inspect(1,1)['cell']['elevation'] == 101
    changed.close()


@pytest.mark.parametrize('file,change',[
    ('cell_topo.bin',lambda b:b[:-1]),('edge_topo.bin',lambda b:b[:-1]),
    ('ne.txt',lambda b:b.replace(b'100, 9',b'nan, 9')),
    ('ns.txt',lambda b:b.replace(b', 11, 7',b', nan, 7')),
])
def test_bad_files_fail(tmp_path,file,change):
    source = write_grid(tmp_path/'source',[((0,0,8,8),100,9)])
    path = source/file
    path.write_bytes(change(path.read_bytes()))
    with pytest.raises(ValueError):
        GridDisplayIndex(source,tmp_path/'cache')


def test_api_reports_corrupt_grid_and_closes_invalidated_cache(tmp_path,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from gridmen_backend.api.endpoints import grid
    source = write_grid(tmp_path/'source',[((0,0,8,8),100,9)])
    monkeypatch.setattr(grid,'_display_source',lambda key:source)
    monkeypatch.setattr(grid.settings,'ROOT_DIR',tmp_path)
    grid._close_display_cache()
    app = FastAPI()
    app.include_router(grid.router)
    with TestClient(app) as client:
        assert client.get('/grid/test/display/meta').status_code == 200
        old = next(iter(grid._DISPLAY_CACHE.values()))
        ne = source/'ne.txt'
        ne.write_text(ne.read_text().replace('100, 9','101, 9'))
        assert client.get('/grid/test/display/meta').json()['elevationRange'] == [101,101]
        assert old.cells.closed
        ne.write_text(ne.read_text().replace('101, 9','nan, 9'))
        response = client.get('/grid/test/display/meta')
        assert response.status_code == 500 and 'Invalid ne.txt attributes' in response.json()['detail']
    assert not grid._DISPLAY_CACHE


def test_two_processes_share_one_cold_index_build(tmp_path):
    import os
    import subprocess
    import sys
    source = write_grid(tmp_path/'source',[((0,0,8,8),100,9)])
    cache = tmp_path/'cache'
    script = '''
from pathlib import Path
import sys,time
import gridmen_backend.grid_display as display
original=display._build
def counted(*args):
    with (Path(sys.argv[2])/'builds.txt').open('a') as output:
        output.write('build\\n')
    time.sleep(.2)
    return original(*args)
display._build=counted
index=display.GridDisplayIndex(Path(sys.argv[1]),Path(sys.argv[2]))
assert index.inspect(1,1)['cell']['elevation'] == 100
print(index.directory.name)
index.close()
'''
    processes = [subprocess.Popen([sys.executable,'-c',script,str(source),str(cache)],
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,cwd=tmp_path,env=os.environ.copy()) for _ in range(2)]
    results = [p.communicate(timeout=30) for p in processes]
    assert all(p.returncode == 0 for p in processes),results
    assert results[0][0] == results[1][0]
    assert (cache/'builds.txt').read_text() == 'build\n'
    assert not list(cache.glob('building-*'))

@pytest.mark.parametrize('damage',['truncate-layer','truncate-offsets','truncate-hist',
                                   'missing-rtree','bad-slot','fractional-tile','bad-offset'])
def test_corrupt_derived_index_fails_without_writing(tmp_path,damage):
    import numpy as np
    cells = [((0,0,8,8),1,3),((8,0,16,8),2,4)]
    source = write_grid(tmp_path/'source',cells,sizes=((8,8),),bounds=(0,0,16,8))
    cache = tmp_path/'cache'
    index = GridDisplayIndex(source,cache)
    directory = index.directory
    index.close()
    if damage == 'truncate-layer':
        (directory/'layer-0.bin').write_bytes(b'')
    elif damage == 'truncate-offsets':
        (directory/'offsets.bin').write_bytes(b'')
    elif damage == 'truncate-hist':
        next(path for path in directory.glob('hist-*.bin') if path.stat().st_size).write_bytes(b'')
    elif damage == 'missing-rtree':
        (directory/'tile-rtree.sqlite').unlink()
    elif damage == 'bad-offset':
        offsets = np.fromfile(directory/'offsets.bin',dtype='<u8')
        offsets[1] += 1
        offsets.tofile(directory/'offsets.bin')
    else:
        path = directory/'manifest.json'
        manifest = json.loads(path.read_text())
        manifest['layerTiles'][0][0][0 if damage == 'fractional-tile' else 2] = .5 if damage == 'fractional-tile' else 9000
        path.write_text(json.dumps(manifest))
    before = {p.name:(p.stat().st_size,p.stat().st_mtime_ns,p.read_bytes()) for p in cache.rglob('*') if p.is_file()}
    with pytest.raises(ValueError,match='display|Display'):
        GridDisplayIndex(source,cache)
    after = {p.name:(p.stat().st_size,p.stat().st_mtime_ns,p.read_bytes()) for p in cache.rglob('*') if p.is_file()}
    assert before == after


def test_inspect_decimal_gridline_uses_original_half_open_bounds(tmp_path):
    cells = [((.3,0,.4,.1),7,2),((.5,0,.6,.1),8,3)]
    index = GridDisplayIndex(write_grid(tmp_path/'source',cells,sizes=((.1,.1),),bounds=(.3,0,.6,.1)),tmp_path/'cache')
    try:
        assert index.inspect(.3,.05)['cell']['id'] == 1
        assert index.inspect(math.nextafter(.3,0),.05)['cell'] is None
        assert index.inspect(.4,.05)['cell'] is None
        assert index.inspect(math.nextafter(.5,0),.05)['cell'] is None
        assert index.inspect(.5,.05)['cell']['id'] == 2
        assert index.inspect(.6,.05)['cell'] is None
    finally:
        index.close()



def decode_nodes(payload):
    from gridmen_backend.grid_display import DISPLAY_RECORD
    assert payload[:4] == b'GDN4'
    count = struct.unpack_from('<I', payload, 4)[0]
    assert len(payload) == 8 + count * DISPLAY_RECORD.size
    return [DISPLAY_RECORD.unpack_from(payload, 8 + i * DISPLAY_RECORD.size)
            for i in range(count)]


def test_node_blocks_preserve_originals_and_aggregate_summaries(mixed):
    assert mixed.meta['revision'] == mixed.directory.name
    assert [layer['nativeLevel'] for layer in mixed.meta['displayLayers']] == [2, 1, None]
    fine = decode_nodes(mixed.nodes(2, 0, 0, 0))
    assert {record[0] for record in fine} == {1, 2, 3, 4}
    assert next(r for r in fine if r[0] == 1)[1:5] == (0, 0, 8, 8)
    middle = decode_nodes(mixed.nodes(2, 0, 0, 1))
    summary = next(r for r in middle if r[0] == 0)
    assert summary[1:5] == (8, 0, 16, 8)
    assert summary[5:] == (48, 288, 4, 2, 3)
    assert {r[0] for r in middle if r[0]} == {1}
    top = decode_nodes(mixed.nodes(2, 0, 0, 2))
    assert top == [(0, 0, 0, 16, 16, 112, 6688, 4, 2, 9)]


def test_coarser_native_cell_is_repeated_with_exact_geometry_across_blocks(mixed):
    for x in (0, 1):
        for y in (0, 1):
            records = decode_nodes(mixed.nodes(0, x, y, 0))
            assert records == [(1, 0, 0, 8, 8, 64, 6400, 8, 1, 9)]
    assert decode_nodes(mixed.nodes(0, 3, 1, 0)) == []


def test_categorical_histogram_uses_all_class_areas_and_survives_reopen(tmp_path):
    cells = [((x,y,x+4,y+4),1,9 if (x//8+2*(y//8)) == 3 or x%8 == 4 else 2)
             for y in range(0,16,4) for x in range(0,16,4)]
    source = write_grid(tmp_path/'source', cells, bounds=(0,0,16,16))
    index = GridDisplayIndex(source, tmp_path/'cache')
    top = len(index.layers)-1
    record = decode_nodes(index.nodes(top, 0, 0, top))[0]
    assert record[0] == 0 and record[5] == 256 and record[9] == 9
    assert any((index.directory/f'hist-{i}.bin').stat().st_size
               for i in range(1,len(index.layers)))
    directory = index.directory
    index.close()
    reopened = GridDisplayIndex(source, tmp_path/'cache')
    assert reopened.directory == directory
    assert decode_nodes(reopened.nodes(top, 0, 0, top)) == [record]
    reopened.close()


@pytest.mark.parametrize('sizes',[((16,16),(1,1)),((15,21),(1,3))])
@pytest.mark.parametrize('start',[-2,-1,0])
def test_ancestors_use_complete_root_histograms_without_reading_fine_layers(tmp_path,monkeypatch,sizes,start):
    w,h = sizes[0]
    cw,ch = sizes[1]
    origin = (1.25,-2.5)
    cells = []
    for group,count in ((0,100),(1,30)):
        for i in range(count):
            x = origin[0]+(start+group)*2*w+(i%10)*cw
            y = origin[1]+(i//10)*ch
            land = 2 if group == 0 and i < 51 else 9
            cells.append(((x,y,x+cw,y+ch),3 if land == 2 else 7,land))
    bounds = (origin[0]+start*2*w,origin[1],origin[0]+(start+2)*2*w,origin[1]+2*h)
    source = write_grid(tmp_path/'source',cells,origin=origin,sizes=sizes,bounds=bounds)
    index = GridDisplayIndex(source,tmp_path/'cache')
    try:
        top = len(index.layers)-1
        root = index.layers[top]
        assert root.nx <= 2 and root.ny <= 2
        stored = [record for x in range(root.x0,root.x0+root.nx)
                  for record in decode_nodes(index.nodes(top,x,0,top))]
        before = {p.name:(p.stat().st_size,p.stat().st_mtime_ns) for p in index.directory.iterdir()}
        metadata = json.dumps(index.meta,sort_keys=True)
        # An ancestor block also addresses finer stored layers through the
        # existing directory. Each root is returned once with its own bounds.
        parent = index._layer(top+1)
        queried = [record for x in range(parent.x0,parent.x0+parent.nx)
                   for record in decode_nodes(index.nodes(top+1,x,0,top))]
        assert sorted(queried) == sorted(stored)

        def no_descent(*args,**kwargs):
            raise AssertionError('Ancestor query descended into stored cells/tiles')
        monkeypatch.setattr(index,'_cell',no_descent)
        for layer in index.layers:
            monkeypatch.setattr(layer,'get',no_descent)
            monkeypatch.setattr(layer,'tile',no_descent)
        seen = {}
        for depth in (1,4,80,4,1):
            number = top+depth
            layer = index._layer(number)
            records = []
            for x in range(layer.x0,layer.x0+layer.nx):
                payload = index.nodes(number,x,0,number)
                assert payload == index.nodes(number,x,0,number)
                records.extend(decode_nodes(payload))
                assert index.last_query_nodes <= 4
                assert index.last_query_tiles == index.last_query_directory_queries == 0
            if depth in seen:
                assert records == seen[depth]
            seen[depth] = records
            expected = {}
            for box,z,category in cells:
                rx,ry = root.locate((box[0]+box[2])/2,(box[1]+box[3])/2,origin)
                key = int(rx)//(1<<depth),int(ry)//(1<<depth)
                expected.setdefault(key,[]).append((box,z,category))
            assert len(records) == len(expected)
            for record in records:
                key = tuple(map(int,layer.locate((record[1]+record[3])/2,
                                                (record[2]+record[4])/2,origin)))
                children = expected[key]
                area = cw*ch*len(children)
                weights = {}
                for _,_,category in children:
                    weights[category] = weights.get(category,0)+cw*ch
                assert record[0] == 0
                assert record[1:5] == tuple(layer.bounds(*key,origin))
                assert record[5:9] == (area,sum(z*cw*ch for _,z,_ in children),min(cw,ch),2)
                assert record[9] == min(weights,key=lambda category:(-weights[category],category))
                assert record[5]/((record[3]-record[1])*(record[4]-record[2])) == pytest.approx(area/(layer.w*layer.h))
            if start != -1:
                assert records[0][9] == 9, 'combining root winners would incorrectly choose class 2'
        assert json.dumps(index.meta,sort_keys=True) == metadata
        assert {p.name:(p.stat().st_size,p.stat().st_mtime_ns) for p in index.directory.iterdir()} == before
    finally:
        index.close()


def test_clipped_dyadic_layout_and_original_float_bounds(tmp_path):
    source = write_grid(tmp_path/'source', [
        ((-5,0,0,5),10,9), ((4,4,5,5),2,3)
    ], sizes=((5,5),(1,1)), bounds=(-5,0,5,5))
    index = GridDisplayIndex(source,tmp_path/'cache')
    try:
        clipped = [i for i,layer in enumerate(index.meta['displayLayers'])
                   if layer['xLayout'] is not None]
        assert clipped
        native = next(i for i,layer in enumerate(index.meta['displayLayers'])
                      if layer['nativeLevel'] == 1)
        records = decode_nodes(index.nodes(native, 0, 0, clipped[-1]))
        assert any(r[0] == 0 and r[1:5] == (4,4,5,5) and r[5] == 1 for r in records)
        assert all(r[0] != 1 for r in records)
        left = decode_nodes(index.nodes(native, -1, 0, clipped[-1]))
        assert left == [(1,-5,0,0,5,25,250,5,1,9)]
    finally:
        index.close()
    decimal = write_grid(tmp_path/'decimal',[((.3,0,.4,.1),7,2)],
                         sizes=((.1,.1),),bounds=(.3,0,.4,.1))
    index = GridDisplayIndex(decimal,tmp_path/'decimal-cache')
    try:
        assert decode_nodes(index.nodes(0,3,0,0))[0][1:5] == (.3,0,.4,.1)
    finally:
        index.close()


def test_sparse_tile_directory_bounds_work_by_output(tmp_path):
    far = 1_000_000_000
    source = write_grid(tmp_path/'source',[
        ((0,0,8,8),1,3),((far-8,far-8,far,far),2,4)
    ],sizes=((8,8),),bounds=(0,0,far,far))
    index = GridDisplayIndex(source,tmp_path/'cache')
    try:
        assert sum(p.stat().st_size for p in index.directory.iterdir()) < 32*1024*1024
        assert [r[0] for r in decode_nodes(index.nodes(0,0,0,0))] == [1]
        assert index.last_query_tiles == 1
        assert [r[0] for r in decode_nodes(index.nodes(0,far//8-1,far//8-1,0))] == [2]
        assert index.last_query_tiles == 1
    finally:
        index.close()


def test_http_nodes_revision_cache_and_removed_query(mixed,monkeypatch):
    from contextlib import nullcontext

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from gridmen_backend.api.endpoints import grid
    monkeypatch.setattr(grid,'_display',lambda key:nullcontext(mixed))
    app = FastAPI()
    app.include_router(grid.router,prefix='/api')
    path = f'/api/grid/test/display/nodes/{mixed.revision}/2/0/0/0'
    with TestClient(app) as client:
        assert client.get('/api/grid/test/display/meta').json() == mixed.meta
        response = client.get(path,headers={'Accept-Encoding':'identity'})
        assert response.status_code == 200
        assert response.headers['content-type'] == 'application/octet-stream'
        assert 'immutable' in response.headers['cache-control']
        assert {r[0] for r in decode_nodes(response.content)} == {1,2,3,4}
        etag = response.headers['etag']
        cached = client.get(path,headers={'If-None-Match':etag})
        assert cached.status_code == 304 and not cached.content
        assert client.get(path.replace(mixed.revision,'stale')).status_code == 409
        assert client.get(path.replace('/2/0/0/0','/2/99/0/0')).status_code == 422
        ancestor_path = path.replace('/2/0/0/0','/82/0/0/82')
        ancestor = client.get(ancestor_path,headers={'Accept-Encoding':'identity'})
        assert ancestor.status_code == 200
        assert ancestor.content == mixed.nodes(82,0,0,82)
        assert client.get(ancestor_path).content == ancestor.content
        assert client.get(ancestor_path,headers={'If-None-Match':ancestor.headers['etag']}).status_code == 304
        assert client.post('/api/grid/test/display/query',json={}).status_code == 404
        assert client.get('/api/grid/test/display/inspect?x=1&y=1').json()['cell']['id'] == 1
        assert client.get('/api/grid/test/display/inspect?x=nan&y=1').status_code == 422


def test_http_nodes_gzip_has_same_records(tmp_path,monkeypatch):
    from contextlib import nullcontext

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from gridmen_backend.api.endpoints import grid
    cells = [((x*4,y*4,(x+1)*4,(y+1)*4),x+y,3)
             for y in range(4) for x in range(5)]
    index = GridDisplayIndex(write_grid(tmp_path/'source',cells,sizes=((4,4),),
                                        bounds=(0,0,20,16)),tmp_path/'cache')
    try:
        monkeypatch.setattr(grid,'_display',lambda key:nullcontext(index))
        app = FastAPI()
        app.include_router(grid.router,prefix='/api')
        top = len(index.layers)-1
        path = f'/api/grid/test/display/nodes/{index.revision}/{top}/0/0/0'
        with TestClient(app) as client:
            plain = client.get(path,headers={'Accept-Encoding':'identity'})
            zipped = client.get(path,headers={'Accept-Encoding':'gzip'})
            assert plain.status_code == zipped.status_code == 200
            assert zipped.headers['content-encoding'] == 'gzip'
            assert zipped.headers['vary'] == 'Accept-Encoding'
            assert len(decode_nodes(plain.content)) == 16
            assert zipped.content == plain.content
    finally:
        index.close()


@pytest.mark.parametrize('selection',[
    (-1,0,0,0),(0,0,0,-1),(0,0,0,1),(99,2,0,0),(0,99,0,0),
    (100_000,0,0,0),
])
def test_invalid_block_selection_fails(mixed,selection):
    with pytest.raises(ValueError,match='Display|display'):
        mixed.nodes(*selection)


@pytest.mark.parametrize('sizes',[((15,21),(1,3)),((30,15),(10,5),(2,1))])
def test_odd_rectangular_summary_matches_original_area(tmp_path,sizes):
    import random
    w,h = sizes[0]
    ox,oy = 1.25,-2.5
    rng = random.Random(749)
    cells = []
    for y in [-1,0,1]:
        for x in [-1,0,1]:
            level = 0 if (x,y) == (-1,-1) else rng.randrange(1,len(sizes))
            cw,ch = sizes[level]
            for dy in range(h//ch):
                for dx in range(w//cw):
                    if level and rng.random() < .25:
                        continue
                    a,b = ox+x*w+dx*cw,oy+y*h+dy*ch
                    cells.append(((a,b,a+cw,b+ch),rng.randrange(-3,4),rng.choice([2,3,9])))
    domain = (ox-w,oy-h,ox+2*w,oy+2*h)
    index = GridDisplayIndex(write_grid(tmp_path/'source',cells,origin=(ox,oy),
                                        sizes=sizes,bounds=domain),tmp_path/'cache')
    try:
        top = len(index.layers)-1
        root = index.layers[top]
        checked = 0
        for block_y in range(root.y0,root.y0+root.ny):
            for block_x in range(root.x0,root.x0+root.nx):
                for display_layer in range(top+1):
                    for record in decode_nodes(index.nodes(top,block_x,block_y,display_layer)):
                        if record[0]:
                            continue
                        box = record[1:5]
                        total,z_area,minimum,finest,categories = 0,0,math.inf,0,{}
                        for bounds,z,land in cells:
                            overlap = (max(0,min(box[2],bounds[2])-max(box[0],bounds[0]))
                                       *max(0,min(box[3],bounds[3])-max(box[1],bounds[1])))
                            if not overlap:
                                continue
                            total += overlap
                            z_area += z*overlap
                            minimum = min(minimum,bounds[2]-bounds[0],bounds[3]-bounds[1])
                            native = next(i+1 for i,size in enumerate(sizes)
                                          if size == (bounds[2]-bounds[0],bounds[3]-bounds[1]))
                            finest = max(finest,native)
                            categories[land] = categories.get(land,0)+overlap
                        assert record[5] == pytest.approx(total)
                        assert record[6] == pytest.approx(z_area)
                        assert record[7] == minimum
                        assert record[8] == finest
                        assert record[9] == min(categories,key=lambda land:(-categories[land],land))
                        checked += 1
        assert checked > 0
    finally:
        index.close()


def test_fixed_block_work_and_bytes_do_not_grow_with_total_leaf_count(tmp_path):
    measurements = []
    for n in (16,64):
        cells = [((x*4,y*4,(x+1)*4,(y+1)*4),1,3)
                 for y in range(n) for x in range(n)]
        source = write_grid(tmp_path/f'source-{n}',cells,sizes=((4,4),),
                            bounds=(0,0,n*4,n*4))
        index = GridDisplayIndex(source,tmp_path/'cache')
        try:
            block_layer = next(i for i,layer in enumerate(index.layers) if layer.w == 16)
            payload = index.nodes(block_layer,0,0,0)
            assert len(decode_nodes(payload)) == 16
            measurements.append((len(payload),index.last_query_tiles,index.last_query_nodes))
        finally:
            index.close()
    assert measurements == [(1160,1,4096),(1160,1,4096)]


def test_fixed_viewport_cost_does_not_grow_with_unresolved_fine_leaves(tmp_path):
    measurements = []
    ancestor_measurements = []
    for side in (8,16):
        pitch = 16/side
        cells = [((x*pitch,y*pitch,(x+1)*pitch,(y+1)*pitch),x+y,(x*7+y)%3)
                 for y in range(side) for x in range(side) if (x+y)%2 == 0]
        source = write_grid(tmp_path/f'fine-{side}',cells,
                            sizes=((16,16),(pitch,pitch)),bounds=(0,0,16,16))
        index = GridDisplayIndex(source,tmp_path/'cache')
        try:
            block = next(i for i,layer in enumerate(index.layers) if layer.w == 16)
            display = next(i for i,layer in enumerate(index.layers) if layer.w == 4)
            payload = index.nodes(block,0,0,display)
            records = decode_nodes(payload)
            assert len(records) == 16
            assert all(record[0] == 0 and record[7] == pitch for record in records)
            measurements.append((len(payload),index.last_query_tiles,index.last_query_nodes,
                                 index.last_query_directory_queries))
            ancestor = len(index.layers)+6
            payload = index.nodes(ancestor,0,0,ancestor)
            assert len(decode_nodes(payload)) == 1
            ancestor_measurements.append((len(payload),index.last_query_tiles,index.last_query_nodes,
                                          index.last_query_directory_queries))
        finally:
            index.close()
    assert measurements == [(1160,1,4096,2),(1160,1,4096,2)]
    assert ancestor_measurements == [(80,0,1,0),(80,0,1,0)]


def test_decimal_schema_class_tie_uses_exact_lattice_area(tmp_path):
    cells = [((0,0,.3,.3),10,2)]
    for y in range(3):
        for x in range(3):
            a,b = .3+x*.1,y*.1
            cells.append(((a,b,.3+(x+1)*.1,(y+1)*.1),20,9))
    source = write_grid(tmp_path/'source',cells,sizes=((.3,.3),(.1,.1)),
                        bounds=(0,0,.6,.3))
    index = GridDisplayIndex(source,tmp_path/'cache')
    try:
        top = len(index.layers)-1
        records = decode_nodes(index.nodes(top,0,0,top))
        assert len(records) == 1
        assert records[0][0] == 0
        assert records[0][9] == 2
    finally:
        index.close()


def test_large_class_counts_remain_exact_above_float_integer_precision(tmp_path):
    side = 1 << 30
    coarse = [((0,0,side,side),10,2),
              ((side,0,2*side,side),20,9)]
    fine = ((2*side,0,2*side+1,1),20,9)
    bounds = (0,0,4*side+1,side)
    assert float(2*side*side+1) == float(2*side*side)
    for label,cells,winner in (
            ('larger',coarse+[fine],9),('tie',coarse,2)):
        source = write_grid(tmp_path/label,cells,sizes=((side,side),(1,1)),
                            bounds=bounds)
        index = GridDisplayIndex(source,tmp_path/'cache')
        try:
            top = len(index.layers)-1
            records = decode_nodes(index.nodes(top,0,0,top))
            assert len(records) == 1 and records[0][0] == 0
            assert records[0][9] == winner
            for depth in (1,8,80):
                ancestor = decode_nodes(index.nodes(top+depth,0,0,top+depth))
                assert len(ancestor) == 1 and ancestor[0][9] == winner
                assert ancestor[0][5:9] == records[0][5:9]
            originals = decode_nodes(index.nodes(top,0,0,0))
            assert {record[0] for record in originals} == set(range(1,len(cells)+1))
            assert index.last_query_directory_queries == 2
        finally:
            index.close()


def test_corrupt_original_directory_fails_at_open_without_writing(tmp_path):
    import sqlite3
    source = write_grid(tmp_path/'source',[
        ((0,0,8,8),1,2),((8,0,12,4),2,9)
    ])
    cache = tmp_path/'cache'
    index = GridDisplayIndex(source,cache)
    directory = index.directory
    index.close()
    with sqlite3.connect(directory/'tile-rtree.sqlite') as db:
        db.execute('UPDATE original_coords SET x=x+1 WHERE id=1')
    before = {path.name:(path.stat().st_size,path.stat().st_mtime_ns,path.read_bytes())
              for path in directory.iterdir() if path.is_file()}
    with pytest.raises(ValueError,match='Invalid original display directory'):
        GridDisplayIndex(source,cache)
    after = {path.name:(path.stat().st_size,path.stat().st_mtime_ns,path.read_bytes())
             for path in directory.iterdir() if path.is_file()}
    assert before == after
