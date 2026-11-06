"""Compare batched navigation against the frozen scalar display algorithm."""
import json
import math
import random

import pytest

from gridmen_backend.grid_display import GridDisplayIndex, require
from test_grid_display import write_grid, mixed


def scalar_view(self,bounds,meters_per_pixel):
    require(len(bounds) == 4 and all(math.isfinite(v) for v in bounds)
            and bounds[2] > bounds[0] and bounds[3] > bounds[1], 'Invalid viewport bounds')
    require(math.isfinite(meters_per_pixel) and meters_per_pixel > 0, 'Invalid metersPerPixel')
    s = meters_per_pixel
    chunks, visited = {}, 0
    # A chunk always contains complete base-schema cells. Above that scale,
    # it is a dyadic schema node, about 128 CSS pixels across.
    base = next(i for i,l in enumerate(self.layers) if l.level == 1)
    chunk_level = base
    while chunk_level+1 < len(self.layers) and max(self.layers[chunk_level].w,self.layers[chunk_level].h) < 128*s:
        chunk_level += 1

    def intersects(b):
        return b[0] < bounds[2] and b[2] > bounds[0] and b[1] < bounds[3] and b[3] > bounds[1]

    def get_chunk(b):
        layer = self.layers[chunk_level]
        x,y = math.floor(((b[0]+b[2])/2-self.origin[0])/layer.w), math.floor(((b[1]+b[3])/2-self.origin[1])/layer.h)
        key = f'{layer.level}:{x}:{y}'
        if key not in chunks:
            chunks[key] = {'key':key,'bounds':layer.bounds(x,y,self.origin),'cells':[],'fields':[]}
        return chunks[key]

    def field(b,node,occupied=1.0):
        if not intersects(b):
            return
        if max(b[2]-b[0],b[3]-b[1]) > s:
            xs = [b[0],(b[0]+b[2])/2,b[2]] if b[2]-b[0] > s else [b[0],b[2]]
            ys = [b[1],(b[1]+b[3])/2,b[3]] if b[3]-b[1] > s else [b[1],b[3]]
            for x0,x1 in zip(xs,xs[1:]):
                for y0,y1 in zip(ys,ys[1:]):
                    field([x0,y0,x1,y1],node,occupied)
            return
        get_chunk(b)['fields'].append({'bounds':b,'occupiedFraction':occupied,'minCellSize':float(node['min']),
            'level':int(node['level']),'elevation':float(node['z']/node['area']),
            'landClass':int(node['land'])})

    def visit(i,x,y):
        nonlocal visited
        layer = self.layers[i]
        b = layer.bounds(x,y,self.origin)
        if not intersects(b):
            return
        visited += 1
        node = layer.get(x,y)
        if node is None or node['area'] == 0:
            return
        if node['id']:
            if node['min'] >= 4*s:
                get_chunk(b)['cells'].append(self._cell(int(node['id']))[0])
            else:
                field(b,node)
            return
        if i <= chunk_level and max(layer.w,layer.h) <= s:
            field(b,node,min(1.0,float(node['area'])/(layer.w*layer.h)))
            return
        child = self.layers[i-1]
        rx,ry = round(layer.w/child.w),round(layer.h/child.h)
        for cy in range(y*ry,(y+1)*ry):
            for cx in range(x*rx,(x+1)*rx):
                visit(i-1,cx,cy)

    top = self.layers[-1]
    for y in range(top.y0,top.y0+top.ny):
        for x in range(top.x0,top.x0+top.nx):
            visit(len(self.layers)-1,x,y)
    # Diagnostics stay on the server and do not alter the frozen JSON API.
    self.last_query_nodes = visited
    return {'chunks':list(chunks.values()),'cellCount':self.meta['cellCount']}


@pytest.fixture(params=[((8,4),(4,2),(1,1)),((8,8),(1,1)),((.8,.4),(.4,.2),(.1,.1))])
def varied(request,tmp_path):
    sizes = request.param
    w,h = sizes[0]
    ox,oy = -.3,2.7
    rng = random.Random(728)
    cells = []
    for y in range(3):
        for x in range(5):
            if rng.random() < .2:
                continue
            level = rng.randrange(len(sizes))
            cw,ch = sizes[level]
            for dy in range(round(h/ch)):
                for dx in range(round(w/cw)):
                    if rng.random() < .15:
                        continue
                    x0,y0 = ox+x*w+dx*cw,oy+y*h+dy*ch
                    cells.append((tuple(round(v,12) for v in (x0,y0,x0+cw,y0+ch)),rng.randrange(-20,21),rng.choice([1,3,9])))
    source = write_grid(tmp_path/'source',cells,origin=(ox,oy),sizes=sizes,bounds=(ox,oy,ox+5*w,oy+3*h))
    index = GridDisplayIndex(source,tmp_path/'cache')
    yield index
    index.close()


def test_moving_and_zooming_viewports_equal_scalar_including_order(varied):
    index = varied
    x0,y0,x1,y1 = index.meta['bounds']
    w,h = index.meta['grid_info'][0]
    # Cross source, tile, cell and chunk boundaries, and exact sampling cutoffs.
    for scale in [w/32,w/8,w/4,math.nextafter(w/4,math.inf),w/2,w,2*w]:
        for dx,dy in [(-w,-h),(0,0),(w*.37,h*.61),(w*2,h)]:
            bounds = [x0+dx,y0+dy,x1+dx,y1+dy]
            expected = scalar_view(index,bounds,scale)
            visited = index.last_query_nodes
            actual = index.query(bounds,scale)
            assert actual == expected
            assert index.last_query_nodes == visited
            assert json.loads(index.query_json(bounds,scale)) == expected


def test_field_splits_at_floating_point_viewport_boundaries(tmp_path):
    cells = [((x*.1,0,(x+1)*.1,.1),x,3) for x in range(10)]
    source = write_grid(tmp_path/'source',cells,sizes=((.1,.1),),bounds=(0,0,1,.1))
    index = GridDisplayIndex(source,tmp_path/'cache')
    try:
        for scale in [.1,math.nextafter(.1,0),.05,math.nextafter(.05,0)]:
            for offset in [0,.037,.1]:
                bounds = [offset,0,offset+.6,.1]
                assert index.query(bounds,scale) == scalar_view(index,bounds,scale)
    finally:
        index.close()


@pytest.mark.parametrize('encoding,compressed',[
    ('identity',False),('gzip',True),('gzip;q=0',False),('*',True),
    ('*;q=1, gzip;q=0',False),('br, GZIP; q=0.5',True),('gzip;q=bad',False),
])
def test_http_query_encoding_preserves_exact_view(mixed,monkeypatch,encoding,compressed):
    from contextlib import nullcontext
    import gzip
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from gridmen_backend.api.endpoints import grid
    monkeypatch.setattr(grid,'_display',lambda key:nullcontext(mixed))
    app = FastAPI()
    app.include_router(grid.router,prefix='/api')
    bounds,scale = [0,0,16,8],1.01
    expected = mixed.query(bounds,scale)
    with TestClient(app) as client:
        response = client.post('/api/grid/test/display/query',json={'bounds':bounds,'metersPerPixel':scale},headers={'Accept-Encoding':encoding})
        assert response.status_code == 200
        assert response.json() == expected
        assert response.headers['content-type'] == 'application/json'
        assert response.headers['vary'] == 'Accept-Encoding'
        assert (response.headers.get('content-encoding') == 'gzip') == compressed
        # Read raw wire bytes as well as the client's decompressed representation.
        with client.stream('POST','/api/grid/test/display/query',json={'bounds':bounds,'metersPerPixel':scale},headers={'Accept-Encoding':encoding}) as wire:
            payload = b''.join(wire.iter_raw())
            assert len(payload) == int(wire.headers['content-length'])
            assert json.loads(gzip.decompress(payload) if compressed else payload) == expected


def test_tile_and_negative_chunk_boundaries_equal_scalar(tmp_path):
    cells = [((x*4,y*4,(x+1)*4,(y+1)*4),x+y,3)
             for x in [-65,-64,-63,-1,0,1,63,64,65] for y in [0,1]]
    index = GridDisplayIndex(write_grid(tmp_path/'source',cells,bounds=(-260,0,264,8)),tmp_path/'cache')
    try:
        for x in [-256,0,256]:
            for shift in [-.001,0,.001]:
                for scale in [.5,1.001,4,16]:
                    bounds = [x-4+shift,-1,x+4+shift,9]
                    expected = scalar_view(index,bounds,scale)
                    assert index.query(bounds,scale) == expected
                    assert json.loads(index.query_json(bounds,scale)) == expected
    finally:
        index.close()


@pytest.mark.parametrize('ratio',[999,1009])
def test_non_power_of_two_schema_has_clipped_pixel_summaries(tmp_path,ratio):
    # Large odd and prime ratios remain legal. A sparse fixture isolates query
    # enumeration from input construction, including a native coarse neighbor.
    cells = [((-ratio,0,0,ratio),10,9),((0,0,1,1),2,3),
             ((ratio-1,ratio-1,ratio,ratio),4,3),((511,511,512,512),6,2)]
    source = write_grid(tmp_path/'source',cells,sizes=((ratio,ratio),(1,1)),bounds=(-ratio,0,ratio,ratio))
    index = GridDisplayIndex(source,tmp_path/'cache')
    try:
        local = index.query([0,0,8,8],.2)
        assert index.last_query_nodes < 100
        assert [cell['id'] for chunk in local['chunks'] for cell in chunk['cells']] == [2]
        overview = index.query([-ratio,0,ratio,ratio],128)
        assert index.last_query_nodes < 250
        fields = [field for chunk in overview['chunks'] for field in chunk['fields']]
        assert len(fields) == 3
        assert all(max(f['bounds'][2]-f['bounds'][0],f['bounds'][3]-f['bounds'][1]) <= 128 for f in fields)
        assert all(f['minCellSize'] == 1 and f['level'] == 2 for f in fields)
        assert sum((f['bounds'][2]-f['bounds'][0])*(f['bounds'][3]-f['bounds'][1])*f['occupiedFraction'] for f in fields) == 3
        assert sorted(f['elevation'] for f in fields) == [2,4,6]
        assert index.inspect(ratio-1,ratio-1)['cell']['id'] == 3
        assert index.inspect(1,1)['cell'] is None
        assert json.loads(index.query_json([-ratio,0,ratio,ratio],128)) == overview
    finally:
        index.close()
    reopened = GridDisplayIndex(source,tmp_path/'cache')
    reopened.close()


@pytest.mark.parametrize('damage',['truncate-layer','truncate-offsets','bad-slot','fractional-tile','bad-offset'])
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


@pytest.mark.parametrize('sizes',[((15,21),(1,3)),((30,15),(10,5),(2,1))])
def test_odd_rectangular_summary_attributes_match_original_intersections(tmp_path,sizes):
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
    bounds = (ox-w,oy-h,ox+2*w,oy+2*h)
    index = GridDisplayIndex(write_grid(tmp_path/'source',cells,origin=(ox,oy),sizes=sizes,bounds=bounds),tmp_path/'cache')
    try:
        for scale in [2,8,17,64]:
            view = index.query(bounds,scale)
            occupied_total = 0
            for chunk in view['chunks']:
                for cell in chunk['cells']:
                    b = cell['bounds']
                    occupied_total += (b[2]-b[0])*(b[3]-b[1])
                for field in chunk['fields']:
                    b = field['bounds']
                    area,z,minimum,level,categories = 0,0,math.inf,0,{}
                    for c,elevation,land in cells:
                        overlap = max(0,min(b[2],c[2])-max(b[0],c[0]))*max(0,min(b[3],c[3])-max(b[1],c[1]))
                        if not overlap:
                            continue
                        area += overlap
                        z += elevation*overlap
                        minimum = min(minimum,c[2]-c[0],c[3]-c[1])
                        native = next(i+1 for i,size in enumerate(sizes) if size == (c[2]-c[0],c[3]-c[1]))
                        level = max(level,native)
                        categories[land] = categories.get(land,0)+overlap
                    sample_area = (b[2]-b[0])*(b[3]-b[1])
                    assert field['occupiedFraction'] == pytest.approx(area/sample_area)
                    assert field['elevation'] == pytest.approx(z/area)
                    assert field['minCellSize'] == minimum
                    assert field['level'] == level
                    assert field['landClass'] == min(categories,key=lambda land:(-categories[land],land))
                    occupied_total += area
            assert occupied_total == sum((b[2]-b[0])*(b[3]-b[1]) for b,_,_ in cells)
    finally:
        index.close()


@pytest.mark.parametrize('bounds',[
    [-1e300,-1e300,1e300,1e300],[-1e300,-1e300,.5,.5],[-.5,-.5,1e300,1e300],
])
def test_finite_viewport_far_beyond_lattice_integer_range(mixed,bounds):
    for scale in [1,4,16,1e300]:
        expected = scalar_view(mixed,bounds,scale)
        assert mixed.query(bounds,scale) == expected
        assert json.loads(mixed.query_json(bounds,scale)) == expected
