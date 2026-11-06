import json
import struct
from pathlib import Path

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
            for lo,hi in zip(breaks,breaks[1:]):
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
            ids = sum(sides,[])
            record = struct.pack('!QdddddBBBBB'+'Q'*len(ids),cid,*b,-999,0,*counts,*ids)
            f.write(struct.pack('!I',len(record))+record)
            ne.write(', '.join(map(str,[cid,*counts,*ids,(b[0]+b[2])/2,(b[1]+b[3])/2,z,land]))+'\n')
    with (root/'edge_topo.bin').open('wb') as f, (root/'ns.txt').open('w') as ns:
        for eid,(direction,b,a,c) in enumerate(edges,1):
            record = struct.pack('!QBddddQQdi',eid,direction,*b,a,c,-999,0)
            f.write(struct.pack('!I',len(record))+record)
            row = [eid,1 if direction else 2,0 if direction else a,0 if direction else c,c if direction else 0,a if direction else 0,b[2]-b[0] if direction else b[3]-b[1],(b[0]+b[2])/2,(b[1]+b[3])/2,11,7]
            ns.write(', '.join(map(str,row))+'\n')
    meta = dict(epsg=2326,bounds=bounds,alignment_origin=origin,grid_info=sizes,
                level_info=[{'width':1,'height':1}]+[{'width':4*2**i,'height':2*2**i} for i in range(len(sizes))],
                subdivide_rules=[[4,2]]+[[round(sizes[i-1][0]/sizes[i][0]),round(sizes[i-1][1]/sizes[i][1])] for i in range(1,len(sizes))]+[[1,1]])
    (root/'grid.meta.json').write_text(json.dumps(meta))
    return root


@pytest.fixture
def mixed(tmp_path):
    cells = [((0,0,8,8),100,9),((8,0,12,4),2,4),((8,4,12,8),6,3),((12,0,16,4),10,3)]
    source = write_grid(tmp_path/'source',cells)
    index = GridDisplayIndex(source,tmp_path/'cache')
    yield index
    index.close()


def samples(view,key):
    return [v for c in view['chunks'] for v in c[key]]


def test_metadata_and_intervention_attributes(mixed):
    assert mixed.meta['cellCount'] == 4
    assert mixed.meta['landClasses'] == [3,4,9]
    assert mixed.meta['elevationRange'] == [2,100]
    assert mixed.inspect(1,1)['cell'] == dict(id=1,bounds=[0,0,8,8],level=1,elevation=100,landClass=9)


def test_hanging_neighbors_and_hole(mixed):
    result = mixed.inspect(1,1)
    assert [(n['side'],n['cell']['id']) for n in result['neighbors']] == [('east',2),('east',3)]
    assert all(len(n['edgeIds']) == 1 for n in result['neighbors'])
    assert mixed.inspect(14,6) == {'cell':None,'neighbors':[]}
    assert mixed.inspect(16,0)['cell'] is None
    assert mixed.inspect(8,1)['cell']['id'] == 2


def test_threshold_and_same_frame_mixed_modes(mixed):
    before = mixed.query([0,0,16,8],1)
    assert len(samples(before,'cells')) == 4 and not samples(before,'fields')
    after = mixed.query([0,0,16,8],1.001)
    assert [c['id'] for c in samples(after,'cells')] == [1]
    fields = samples(after,'fields')
    assert fields and all(f['minCellSize'] == 4 and max(f['bounds'][2]-f['bounds'][0],f['bounds'][3]-f['bounds'][1]) <= 1.001 for f in fields)
    assert min(1,2*1.001/fields[0]['minCellSize']) == pytest.approx(.5005)


def test_aggregation_preserves_holes_and_finest_size(mixed):
    fields = samples(mixed.query([0,0,16,8],16),'fields')
    assert sum((f['bounds'][2]-f['bounds'][0])*(f['bounds'][3]-f['bounds'][1]) *f['occupiedFraction'] for f in fields) == 112
    assert fields[0]['occupiedFraction'] == 112/256
    fields = samples(mixed.query([0,0,16,8],4),'fields')
    assert not any(f['bounds'][0] <= 14 < f['bounds'][2] and f['bounds'][1] <= 6 < f['bounds'][3] for f in fields)
    assert mixed.last_query_nodes < 30


def test_exact_weighted_category_not_majority_of_majorities(tmp_path):
    cells = [((x,y,x+4,y+4),x+y, 9 if (x//4+y//4)%3 == 0 else 2) for y in range(0,16,4) for x in range(0,16,4)]
    index = GridDisplayIndex(write_grid(tmp_path/'source',cells,bounds=(0,0,16,16)),tmp_path/'cache')
    fields = samples(index.query([0,0,16,16],16),'fields')
    assert len(fields) == 1
    assert fields[0] == dict(bounds=[0,0,16,16],occupiedFraction=1.0,minCellSize=4,level=2,elevation=12,landClass=2)
    index.close()


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


@pytest.mark.parametrize('bounds,scale',[([0,0,0,4],1),([0,0,4,4],0),([0,0,float('inf'),4],1)])
def test_bad_queries_fail(mixed,bounds,scale):
    with pytest.raises(ValueError):
        mixed.query(bounds,scale)


def test_schema_aligned_chunks_and_bounded_viewport_work(tmp_path):
    # The same small viewport must perform the same work on a much larger grid,
    # apart from logarithmic ancestor traversal. No scan of native nodes occurs.
    measurements = []
    for n in (16,64):
        cells = [((x,y,x+4,y+4),1,3) for y in range(0,n*4,4) for x in range(0,n*4,4)]
        index = GridDisplayIndex(write_grid(tmp_path/f'source-{n}',cells,bounds=(0,0,n*4,n*4)),tmp_path/'cache')
        view = index.query([1,1,9,9],.5)
        assert len(samples(view,'cells')) == 9
        assert all(c['bounds'][0] % 64 == 0 and c['bounds'][1] % 64 == 0 for c in view['chunks'])
        measurements.append(index.last_query_nodes)
        overview = index.query([0,0,n*4,n*4],n)
        assert len(samples(overview,'fields')) == 16
        assert len(samples(overview,'cells')) == 0
        index.close()
    assert measurements[1] - measurements[0] <= 8


def test_negative_alignment_and_category_tie(tmp_path):
    cells = [((-8,-8,-4,-4),1,9),((-4,-8,0,-4),3,2),((-8,-4,-4,0),5,9),((-4,-4,0,0),7,2)]
    index = GridDisplayIndex(write_grid(tmp_path/'source',cells,bounds=(-8,-8,0,0)),tmp_path/'cache')
    fields = samples(index.query([-8,-8,0,0],8),'fields')
    assert fields == [dict(bounds=[-8,-8,0,0],occupiedFraction=1.0,minCellSize=4,level=2,elevation=4,landClass=2)]
    index.close()


def test_aggregation_mixed_native_levels_area_weighting(tmp_path):
    cells = [((0,0,8,8),10,9)]+[((x,y,x+4,y+4),2,2) for y in range(0,16,4) for x in range(0,16,4) if not (x < 8 and y < 8)]
    index = GridDisplayIndex(write_grid(tmp_path/'source',cells,bounds=(0,0,16,16)),tmp_path/'cache')
    assert samples(index.query([0,0,16,16],16),'fields') == [dict(bounds=[0,0,16,16],occupiedFraction=1.0,minCellSize=4,level=2,elevation=4,landClass=2)]
    index.close()


def test_frozen_api_paths_and_boundary_errors(mixed,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from gridmen_backend.api.endpoints import grid
    from contextlib import nullcontext
    monkeypatch.setattr(grid,'_display',lambda key:nullcontext(mixed))
    app = FastAPI()
    app.include_router(grid.router,prefix='/api')
    with TestClient(app) as client:
        assert client.get('/api/grid/test/display/meta').json() == mixed.meta
        assert client.post('/api/grid/test/display/query',json={'bounds':[0,0,16,8],'metersPerPixel':2}).json()['cellCount'] == 4
        assert client.get('/api/grid/test/display/inspect?x=1&y=1').json()['cell']['id'] == 1
        for body in ({'bounds':[0,0,0,8],'metersPerPixel':2},{'bounds':[0,0,16,8],'metersPerPixel':0},{'bounds':[0,0,16,8],'metersPerPixel':2,'patch':1}):
            assert client.post('/api/grid/test/display/query',json=body).status_code == 422
        assert client.post('/api/grid/test/display/query',content='{"bounds":[0,0,Infinity,8],"metersPerPixel":2}',headers={'Content-Type':'application/json'}).status_code == 422
        assert client.get('/api/grid/test/display/inspect?x=nan&y=1').status_code == 422
        assert client.get('/api/grid/test/blocks/meta').status_code == 404


@pytest.mark.parametrize('n',[8,32])
def test_subpixel_checkerboard_is_fractional_and_pixel_bounded(tmp_path,n):
    side = 64/n
    cells = [((x*side,y*side,(x+1)*side,(y+1)*side),2,3)
             for y in range(n) for x in range(n) if (x+y)%2 == 0]
    index = GridDisplayIndex(write_grid(tmp_path/'source',cells,sizes=((side,side),),bounds=(0,0,64,64)),tmp_path/'cache')
    fields = samples(index.query([0,0,64,64],64),'fields')
    assert len(fields) == index.last_query_nodes == 4
    assert all(f['occupiedFraction'] == .5 and f['minCellSize'] == side for f in fields)
    assert index.inspect(side*1.5,side*.5)['cell'] is None
    index.close()


def test_sparse_index_does_not_allocate_empty_bounding_rectangle(tmp_path):
    far = 1_000_000_000
    cells = [((0,0,8,8),1,3),((far-8,far-8,far,far),2,4)]
    index = GridDisplayIndex(write_grid(tmp_path/'source',cells,bounds=(0,0,far,far)),tmp_path/'cache')
    assert sum(p.stat().st_size for p in index.directory.iterdir()) < 32*1024*1024
    assert len(samples(index.query([0,0,8,8],.5),'cells')) == 1
    assert index.last_query_nodes < 40
    assert len(samples(index.query([0,0,far,far],far),'fields')) == 2
    index.close()


def test_partial_sample_preserves_fine_contributor_missing_sample_center(tmp_path):
    source = write_grid(tmp_path/'source',[((0,0,8,8),10,9),((12,12,16,16),2,2)],bounds=(0,0,16,16))
    index = GridDisplayIndex(source,tmp_path/'cache')
    assert samples(index.query([0,0,16,16],16),'fields') == [dict(
        bounds=[0,0,16,16],occupiedFraction=80/256,minCellSize=4,level=2,elevation=8.4,landClass=9)]
    assert index.inspect(8,8)['cell'] is None
    index.close()


def test_categorical_summary_cannot_reduce_child_winners(tmp_path):
    cells = [((x,y,x+4,y+4),1,9 if (x//8+2*(y//8)) == 3 or x%8 == 4 else 2)
             for y in range(0,16,4) for x in range(0,16,4)]
    index = GridDisplayIndex(write_grid(tmp_path/'source',cells,bounds=(0,0,16,16)),tmp_path/'cache')
    # Three children tie and select class 2, yet class 9 covers 10/16 globally.
    assert samples(index.query([0,0,16,16],16),'fields')[0]['landClass'] == 9
    index.close()


def test_inspection_and_visible_cells_keep_binary_float_bounds(tmp_path):
    source = write_grid(tmp_path/'source',[((.3,0,.4,.1),7,2)],sizes=((.1,.1),),bounds=(.3,0,.4,.1))
    index = GridDisplayIndex(source,tmp_path/'cache')
    assert index.inspect(.35,.05)['cell']['bounds'] == [.3,0,.4,.1]
    assert samples(index.query([.3,0,.4,.1],.01),'cells')[0]['bounds'] == [.3,0,.4,.1]
    index.close()


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


def test_skipped_schema_levels_still_have_pixel_bounded_summaries(tmp_path):
    cells = [((x,y,x+1,y+1),1,3) for y in range(64) for x in range(64)]
    source = write_grid(tmp_path/'source',cells,sizes=((64,64),(1,1)),bounds=(0,0,64,64))
    index = GridDisplayIndex(source,tmp_path/'cache')
    fields = samples(index.query([0,0,64,64],16),'fields')
    assert len(fields) == 16 and index.last_query_nodes < 32
    assert all(f['minCellSize'] == 1 and f['level'] == 2 for f in fields)
    index.close()


def test_rectangular_native_field_splits_only_needed_axes(tmp_path):
    source = write_grid(tmp_path/'source',[((0,0,64,4),1,3)],sizes=((64,4),),bounds=(0,0,64,4))
    index = GridDisplayIndex(source,tmp_path/'cache')
    fields = samples(index.query([0,0,64,4],2),'fields')
    assert len(fields) == 64 and all(f['minCellSize'] == 4 for f in fields)
    index.close()
