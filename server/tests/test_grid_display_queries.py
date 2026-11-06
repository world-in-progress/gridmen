"""Batched reads must preserve the fixed v10 scalar wire contract."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
import sqlite3
import threading

import pytest

import gridmen_backend.grid_display as display
from test_grid_display import write_grid
from v10_query_reference import v10_nodes


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
])
def test_all_small_blocks_match_frozen_v10_bytes(tmp_path,cells,origin,sizes,bounds):
    source = write_grid(tmp_path/'source',cells,origin=origin,sizes=sizes,bounds=bounds)
    index = display.GridDisplayIndex(source,tmp_path/'cache')
    try:
        # All native and clipped-dyadic blocks, then implicit ancestor layers.
        for block_number in range(len(index.layers)+3):
            block = index._layer(block_number)
            for y in range(block.y0,block.y0+block.ny):
                for x in range(block.x0,block.x0+block.nx):
                    for selected in range(block_number+1):
                        assert index.nodes(block_number,x,y,selected) == v10_nodes(
                            index,block_number,x,y,selected)
    finally:
        index.close()


def test_readonly_directory_connection_is_lazy_reused_and_closed(tmp_path,monkeypatch):
    source = write_grid(tmp_path/'source',[((0,0,8,8),1,3)])
    index = display.GridDisplayIndex(source,tmp_path/'cache')
    calls = []
    connect = sqlite3.connect

    def tracked_connect(*args,**kwargs):
        calls.append((args,kwargs))
        return connect(*args,**kwargs)

    monkeypatch.setattr(sqlite3,'connect',tracked_connect)
    assert index._directory_db is None
    try:
        expected = v10_nodes(index,0,0,0,0)
        calls.clear()
        with ThreadPoolExecutor(max_workers=4) as workers:
            payloads = list(workers.map(lambda _:index.nodes(0,0,0,0),range(16)))
        assert payloads == [expected]*16
        assert len(calls) == 1
        connection = index._directory_db
        assert calls[0][1] == {'uri':True,'check_same_thread':False}
        assert '?mode=ro' in calls[0][0][0]
        with pytest.raises(sqlite3.OperationalError,match='readonly'):
            connection.execute('CREATE TABLE forbidden(value)')
    finally:
        index.close()
    with pytest.raises(sqlite3.ProgrammingError,match='closed'):
        connection.execute('SELECT 1')


def test_coarse_reads_count_actual_tile_gathers(tmp_path,monkeypatch):
    cells = [((x*8,0,(x+1)*8,8),x,x%3) for x in range(64)]
    source = write_grid(tmp_path/'source',cells,sizes=((8,8),(4,4)),bounds=(0,0,512,8))
    index = display.GridDisplayIndex(source,tmp_path/'cache')
    try:
        block = len(index.layers)
        assert index._layer(block).w == 512
        expected = v10_nodes(index,block,0,0,0)
        calls = []
        tile = display.Layer.tile

        def tracked_tile(layer,tx,ty,*args,**kwargs):
            calls.append((layer.level,tx,ty))
            return tile(layer,tx,ty,*args,**kwargs)

        monkeypatch.setattr(display.Layer,'tile',tracked_tile)
        assert index.nodes(block,0,0,0) == expected
        assert len(calls) == index.last_query_tiles == 1
        assert index.last_query_nodes == len(cells)
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


def test_source_resolution_overlaps_a_live_index_lease(tmp_path,monkeypatch):
    from gridmen_backend.api.endpoints import grid

    source = write_grid(tmp_path/'source',[((0,0,8,8),1,3)])
    resolved = threading.Event()

    def resolve(key):
        if key == 'second':
            resolved.set()
        return source

    monkeypatch.setattr(grid,'_display_source',resolve)
    monkeypatch.setattr(grid.settings,'ROOT_DIR',tmp_path)
    grid._close_display_cache()

    def request():
        with grid._display('second') as index:
            return index.nodes(0,0,0,0)

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with grid._display('first') as index:
                expected = index.nodes(0,0,0,0)
                future = pool.submit(request)
                assert resolved.wait(3)
                assert not future.done()
                assert not index.cells.closed
            assert future.result(timeout=5) == expected
    finally:
        grid._close_display_cache()
