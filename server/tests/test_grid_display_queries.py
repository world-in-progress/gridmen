"""Compare block queries with a geometric scan of every original cell."""
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
import math
import sqlite3

import pytest

import gridmen_backend.grid_display as display
from test_grid_display import decode_nodes, query_work, write_grid


def brute_nodes(meta, specs, cells, selection):
    """No tile, node, histogram, Rtree, or production query reads."""
    block_number, bx, by, selected = selection
    origin, sizes = meta['alignment_origin'], meta['grid_info']

    def spec(number):
        if number < len(specs):
            return specs[number]
        last = specs[-1]
        factor = 2**(number-len(specs)+1)
        return [last[0]*factor, last[1]*factor, 0, 0, 0, 0, 0]

    def axis(index, size, layout):
        if layout is None:
            return index*size, (index+1)*size
        period, count = layout
        group, local = divmod(index, count)
        return group*period+local*size, group*period+min((local+1)*size, period)

    def position(value, size, layout):
        if layout is None:
            return math.floor(value/size)
        period, count = layout
        group = math.floor(value/period)
        return group*count+min(math.floor((value-group*period)/size), count-1)

    def box(number, x, y):
        entry = spec(number)
        layout = entry[7] if len(entry) == 8 else [None, None]
        x0, x1 = axis(x, entry[0], layout[0])
        y0, y1 = axis(y, entry[1], layout[1])
        return (origin[0]+x0, origin[1]+y0, origin[0]+x1, origin[1]+y1)

    def locate(number, bounds):
        entry = spec(number)
        layout = entry[7] if len(entry) == 8 else [None, None]
        return tuple(position((bounds[i]+bounds[i+2])/2-origin[i], entry[i], layout[i])
                     for i in (0,1))

    block_box = box(block_number, bx, by)
    native_numbers = {entry[6]: i for i, entry in enumerate(specs) if entry[6] > 0}
    units = [1]*len(sizes)
    for i in range(len(sizes)-2,-1,-1):
        units[i] = units[i+1]*round(sizes[i][0]/sizes[i+1][0])*round(sizes[i][1]/sizes[i+1][1])
    originals, groups = [], defaultdict(list)
    for cid, (bounds, z, land) in enumerate(cells, 1):
        native = next(i for i, (w,h) in enumerate(sizes)
                      if math.isclose(w,bounds[2]-bounds[0],rel_tol=0,abs_tol=1e-7)
                      and math.isclose(h,bounds[3]-bounds[1],rel_tol=0,abs_tol=1e-7))
        w,h = sizes[native]
        record = (cid, *bounds, w*h, z*w*h, min(w,h), native+1, land)
        if native_numbers[native+1] >= selected:
            # A native sample owns one block by its midpoint. Larger originals
            # can span blocks and retain exact half-open binary intersections.
            owned = (native_numbers[native+1] > selected
                     or locate(block_number, bounds) == (bx,by))
            if (owned and bounds[0] < block_box[2] and bounds[2] > block_box[0]
                    and bounds[1] < block_box[3] and bounds[3] > block_box[1]):
                originals.append(record)
        else:
            groups[locate(selected, bounds)].append((record,units[native]))
    for (x,y), children in groups.items():
        bounds = box(selected, x,y)
        if locate(block_number, bounds) != (bx,by):
            continue
        weights = defaultdict(int)
        for record, weight in children:
            weights[record[9]] += weight
        originals.append((0, *bounds,
            math.fsum(r[5] for r,_ in children), math.fsum(r[6] for r,_ in children),
            min(r[7] for r,_ in children), max(r[8] for r,_ in children),
            min(weights, key=lambda category: (-weights[category],category))))
    return originals


def assert_records(actual, expected, context=None):
    def keyed(records):
        result = {(r[0], *r[1:5]): r for r in records}
        assert len(result) == len(records), 'duplicate geometry/ID'
        return result
    actual, expected = keyed(actual), keyed(expected)
    assert actual.keys() == expected.keys(), context
    for key, record in actual.items():
        assert record[5:8] == pytest.approx(expected[key][5:8])
        assert record[8:] == expected[key][8:]


@pytest.mark.parametrize('cells,origin,sizes,bounds', [
    ([((0,0,8,8),100,9), ((8,0,12,4),2,4), ((8,4,12,8),6,3),
      ((12,0,16,4),10,3)], (0,0), ((8,8),(4,4)), (0,0,16,8)),
    ([((.3,0,.4,.1),-0.0,2), ((.5,0,.6,.1),8,3)],
     (0,0), ((.1,.1),), (.3,0,.6,.1)),
    ([((-4,-2,4,2),11,9), ((4,-2,12,2),7,3), ((12,2,14,3),-3,6)],
     (-4,-2), ((8,4),(2,1)), (-4,-2,16,6)),
    ([((-30,-15,-20,-10),-5,9), ((-20,-15,-18,-14),1,2),
      ((0,0,10,5),7,4)], (0,0), ((30,15),(10,5),(2,1)), (-30,-15,30,15)),
    ([((2**40,0,2**40+2**-10,2**-10),7,3),
      ((2**40+2**-10,0,2**40+2**-9,2**-10),-2,4)],
     (0,0), ((2**-10,2**-10),(2**-11,2**-11)),
     (2**40,0,2**40+2**-8,2**-10)),
    ([((-2**40,0,-2**40+2**-10,2**-10),7,3),
      ((-2**40+2**-10,0,-2**40+2**-9,2**-10),-2,4)],
     (0,0), ((2**-10,2**-10),(2**-11,2**-11)),
     (-2**40,0,-2**40+2**-8,2**-10)),
    ([((0,0,.3,.3),1,9), ((.3,0,.4,.1),2,3), ((.4,0,.5,.1),2,3),
      ((.5,0,.6,.1),2,3)], (0,0), ((.3,.3),(.1,.1)), (0,0,.6,.3)),
], ids=['mixed','decimal-holes','cross-origin','nonbinary','far-positive','far-negative','decimal-mixed'])
def test_all_small_blocks_match_original_cell_scan(tmp_path,cells,origin,sizes,bounds):
    source = write_grid(tmp_path/'source',cells,origin=origin,sizes=sizes,bounds=bounds)
    index = display.GridDisplayIndex(source,tmp_path/'cache')
    meta = json.loads((source/'grid.meta.json').read_text())
    try:
        for block_number in range(len(index.layers)+3):
            block = index._layer(block_number)
            for y in range(block.y0,block.y0+block.ny):
                for x in range(block.x0,block.x0+block.nx):
                    for selected in range(block_number+1):
                        selection = (block_number,x,y,selected)
                        assert_records(decode_nodes(index.nodes(*selection)),
                                       brute_nodes(meta,index.manifest['layers'],cells,selection),selection)
    finally:
        index.close()


def test_query_cursors_overlap_on_readonly_generation(tmp_path):
    source = write_grid(tmp_path/'source',[((0,0,8,8),1,3)])
    index = display.GridDisplayIndex(source,tmp_path/'cache')
    connection = index._directory_db
    try:
        with pytest.raises(sqlite3.OperationalError,match='readonly'):
            connection.execute('CREATE TABLE forbidden(value)')
        expected = index.nodes(0,0,0,0)
        with ThreadPoolExecutor(max_workers=8) as workers:
            payloads = list(workers.map(lambda _:index.nodes(0,0,0,0),range(256)))
        assert payloads == [expected]*256
    finally:
        index.close()
    with pytest.raises(sqlite3.ProgrammingError,match='closed'):
        connection.execute('SELECT 1')


def test_coarse_reads_gather_one_tile_for_all_originals(tmp_path,monkeypatch):
    cells = [((x*8,0,(x+1)*8,8),x,x%3) for x in range(64)]
    source = write_grid(tmp_path/'source',cells,sizes=((8,8),(4,4)),bounds=(0,0,512,8))
    index = display.GridDisplayIndex(source,tmp_path/'cache')
    try:
        block = len(index.layers)
        assert index._layer(block).w == 512
        payload, work = query_work(index,(block,0,0,0),monkeypatch)
        assert work == dict(tiles=1,queries=2)
        assert_records(decode_nodes(payload),brute_nodes(json.loads((source/'grid.meta.json').read_text()),
                       index.manifest['layers'],cells,(block,0,0,0)))
    finally:
        index.close()


@pytest.mark.parametrize('exists',[True,False])
def test_display_source_uses_one_registered_node_read(tmp_path,monkeypatch,exists):
    from fastapi import HTTPException
    from gridmen_backend.api.endpoints import grid

    path = tmp_path/'nodes.sqlite'
    source = tmp_path/'source'
    source.mkdir()
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE node(node_key TEXT PRIMARY KEY, template_name TEXT, '
                   'launch_params TEXT, mount_params TEXT, parent_key TEXT, access_info TEXT)')
        if exists:
            db.execute('INSERT INTO node VALUES (?,NULL,?,NULL,NULL,NULL)',
                       ('test',json.dumps({'resource_space':str(source)})))
    connections, statements = [], []

    @contextmanager
    def connect():
        connection = sqlite3.connect(path)
        connection.row_factory = sqlite3.Row
        connection.set_trace_callback(statements.append)
        connections.append(connection)
        try:
            yield connection
        finally:
            connection.close()

    monkeypatch.setattr(grid.noodle,'_connect_db',connect)
    if exists:
        assert grid._display_source('test') == source.resolve()
    else:
        with pytest.raises(HTTPException) as error:
            grid._display_source('test')
        assert error.value.status_code == 404
        assert error.value.detail == 'Grid node test not found'
    assert len(connections) == len(statements) == 1
