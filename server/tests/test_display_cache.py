"""Exercise request overlap and the lifetime of published display generations."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import threading

import pytest

from gridmen_backend import display_cache as cache
import gridmen_backend.grid_display as display
from test_grid_display import decode_nodes, write_grid


@pytest.fixture
def sources(tmp_path, monkeypatch):
    from gridmen_backend.api.endpoints import grid
    paths = {key:write_grid(tmp_path/key,[((0,0,8,8),1,3)]) for key in ('a','b')}
    monkeypatch.setattr(grid, '_display_source', paths.__getitem__)
    monkeypatch.setattr(grid.settings, 'ROOT_DIR', tmp_path)
    cache.close_cache()
    yield grid, paths, tmp_path/'resource'/'.display'
    cache.close_cache()


@pytest.mark.parametrize('keys', [('a','b'), ('a','a')])
def test_queries_run_at_the_same_time(sources, monkeypatch, keys):
    grid, _, _ = sources
    for key in set(keys):
        with grid._display(key):
            pass
    barrier = threading.Barrier(2)
    query = display._directory_query

    def overlap(db, table, *args):
        if table == 'tile':
            barrier.wait(timeout=5)
        return query(db, table, *args)

    monkeypatch.setattr(display, '_directory_query', overlap)

    def request(key):
        with grid._display(key) as index:
            return decode_nodes(index.nodes(0,0,0,0))

    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(request, keys))
    assert all(result[0][0] == 1 for result in results)


def test_a_cold_build_does_not_block_b(sources, monkeypatch):
    grid, paths, _ = sources
    entered, release = threading.Event(), threading.Event()
    build = display._build

    def blocked(source, *args):
        if source == paths['a']:
            entered.set()
            assert release.wait(5)
        return build(source, *args)

    monkeypatch.setattr(display, '_build', blocked)

    def request(key):
        with grid._display(key) as index:
            return index.inspect(1,1)['cell']['id']

    with ThreadPoolExecutor(max_workers=2) as workers:
        a = workers.submit(request,'a')
        try:
            assert entered.wait(5)
            assert workers.submit(request,'b').result(timeout=5) == 1
            assert not a.done()
        finally:
            release.set()
        assert a.result(timeout=5) == 1


def test_same_source_cold_requests_build_once(sources, monkeypatch):
    grid, _, directory = sources
    entered, release, waiting = threading.Event(), threading.Event(), threading.Event()
    calls = []
    build = display._build

    def blocked(*args):
        calls.append(args[0])
        entered.set()
        assert release.wait(5)
        return build(*args)

    monkeypatch.setattr(display, '_build', blocked)

    def request(mark=False):
        if mark:
            waiting.set()
        with grid._display('a') as index:
            return index

    with ThreadPoolExecutor(max_workers=2) as workers:
        first = workers.submit(request)
        try:
            assert entered.wait(5)
            second = workers.submit(request,True)
            assert waiting.wait(5)
            assert not second.done() and len(calls) == 1
        finally:
            release.set()
        assert first.result(timeout=5) is second.result(timeout=5)
    assert len(calls) == len(list(directory.iterdir())) == 1


def test_replacement_waits_for_borrower_before_windows_style_delete(sources, monkeypatch):
    grid, paths, _ = sources
    deleted = []
    rmtree = shutil.rmtree
    with grid._display('a') as old:
        directory = old.directory
        mappings = [old.cells,old.edges,old.offsets._mmap,
                    *(layer.mapping._mmap for layer in old.layers if layer.mapping is not None)]

        def windows_delete(path, *args, **kwargs):
            if Path(path) == directory:
                assert all(mapping.closed for mapping in mappings)
                assert old._cell_file.closed and old._edge_file.closed
                with pytest.raises(sqlite3.ProgrammingError,match='closed'):
                    old._directory_db.execute('SELECT 1')
                deleted.append(Path(path))
            return rmtree(path, *args, **kwargs)

        monkeypatch.setattr(shutil, 'rmtree', windows_delete)
        path = paths['a']/'ne.txt'
        path.write_text(path.read_text().replace(', 1, 3', ', 2, 3'))
        with grid._display('a') as current:
            assert current.revision != old.revision
            assert current.inspect(1,1)['cell']['elevation'] == 2
            assert old.inspect(1,1)['cell']['elevation'] == 1
            assert old.nodes(0,0,0,0).startswith(b'GDN5')
            assert directory.exists() and not old.cells.closed
        assert not deleted
    assert deleted == [directory] and not directory.exists()
    assert current.directory.exists() and not current.cells.closed


def test_all_direct_readers_keep_a_retired_generation(tmp_path):
    source = write_grid(tmp_path/'source',[((0,0,8,8),1,3)])
    first = display.GridDisplayIndex(source,tmp_path/'cache')
    second = display.GridDisplayIndex(source,tmp_path/'cache')
    path = source/'ne.txt'
    stat = path.stat()
    os.utime(path,ns=(stat.st_atime_ns,stat.st_mtime_ns+1))
    current = display.GridDisplayIndex(source,tmp_path/'cache')
    try:
        first.close()
        assert second.directory.exists()
        assert second.inspect(1,1)['cell']['id'] == 1
        second.close()
        assert not second.directory.exists()
    finally:
        first.close()
        second.close()
        current.close()


def test_new_generation_cleans_legacy_versions_only_for_its_source(tmp_path):
    source = write_grid(tmp_path/'source',[((0,0,8,8),1,3)])
    directory = tmp_path/'cache'
    for name, owner in [('old-version',source),('other-source',tmp_path/'other')]:
        old = directory/name
        old.mkdir(parents=True)
        (old/'manifest.json').write_text(json.dumps({'version':display.VERSION-1,'source':str(owner)}))
        (old/'identity.json').write_text('{}')
    pointer = directory/'old-key.current.json'
    pointer.write_text(json.dumps({'version':display.VERSION-1,'directory':'old-version'}))
    index = display.GridDisplayIndex(source,directory)
    try:
        assert not (directory/'old-version').exists() and not pointer.exists()
        assert (directory/'other-source').exists()
    finally:
        index.close()


@pytest.mark.parametrize('error', [RuntimeError, KeyboardInterrupt])
def test_failed_or_interrupted_build_closes_maps_before_cleanup(sources, monkeypatch, error):
    grid, _, directory = sources
    read_cells, rmtree = display._read_cells, shutil.rmtree
    mappings, cleaned = [], []

    def interrupted(source, staging, meta, native, edges, seen):
        result = read_cells(source,staging,meta,native,edges,seen)
        mappings.extend([edges._mmap,seen._mmap,
                         *(layer.mapping._mmap for layer in native.values() if layer.mapping is not None)])
        raise error('interrupted build')

    def windows_delete(path, *args, **kwargs):
        if Path(path).name.startswith('building-'):
            assert mappings and all(mapping.closed for mapping in mappings)
            cleaned.append(Path(path))
        return rmtree(path, *args, **kwargs)

    monkeypatch.setattr(display,'_read_cells',interrupted)
    monkeypatch.setattr(shutil,'rmtree',windows_delete)
    with pytest.raises(error, match='interrupted build'):
        with grid._display('a'):
            pass
    assert cleaned and list(directory.iterdir()) == []
    assert not cache._BUILDING and not cache._CACHE


def test_failed_first_builder_releases_a_same_source_waiter(sources,monkeypatch):
    grid, _, _ = sources
    entered, release = threading.Event(), threading.Event()
    build = display._build
    calls = []

    def build_once_failing(*args):
        calls.append(1)
        if len(calls) == 1:
            entered.set()
            assert release.wait(5)
            raise ValueError('failed first build')
        return build(*args)

    monkeypatch.setattr(display,'_build',build_once_failing)

    def request():
        with grid._display('a') as index:
            return index.inspect(1,1)['cell']['id']

    with ThreadPoolExecutor(max_workers=2) as workers:
        first = workers.submit(request)
        try:
            assert entered.wait(5)
            second = workers.submit(request)
        finally:
            release.set()
        from fastapi import HTTPException
        with pytest.raises(HTTPException,match='failed first build'):
            first.result(timeout=5)
        assert second.result(timeout=5) == 1
    assert len(calls) == 2 and not cache._BUILDING


def test_warm_request_stats_each_source_once(sources,monkeypatch):
    grid, paths, _ = sources
    with grid._display('a'):
        pass
    calls = []
    stat = Path.stat

    def counted(path, *args, **kwargs):
        if path.parent == paths['a'] and path.name in display.FILES:
            calls.append(path.name)
        return stat(path, *args, **kwargs)

    monkeypatch.setattr(Path,'stat',counted)
    with grid._display('a') as index:
        assert index.inspect(1,1)['cell']['id'] == 1
    assert calls == list(display.FILES)


def test_cache_shutdown_defers_closing_an_active_request(sources):
    grid, _, _ = sources
    with grid._display('a') as index:
        cache.close_cache()
        assert not index.cells.closed
        assert index.inspect(1,1)['cell']['id'] == 1
    assert index.cells.closed


def test_cache_eviction_does_not_close_an_active_request(tmp_path):
    directory = tmp_path/'cache'
    paths = [write_grid(tmp_path/str(i), [((0,0,8,8),i,3)]) for i in range(5)]
    cache.close_cache()
    try:
        with cache.borrow(paths[0],directory) as active:
            for source in paths[1:]:
                with cache.borrow(source,directory):
                    pass
            assert not active.cells.closed and active.inspect(1,1)['cell']['elevation'] == 0
        assert active.cells.closed
    finally:
        cache.close_cache()


def test_failed_query_releases_its_borrowed_index(sources,monkeypatch):
    from fastapi import HTTPException
    grid, _, _ = sources

    def failed(*args):
        raise ValueError('failed query')

    with monkeypatch.context() as patch:
        patch.setattr(display, '_directory_query', failed)
        with pytest.raises(HTTPException,match='failed query'):
            with grid._display('a') as index:
                index.nodes(0,0,0,0)
    assert index._users == 0 and not index.cells.closed
    with grid._display('a') as same:
        assert same is index and same.inspect(1,1)['cell']['id'] == 1


def test_two_processes_publish_the_same_deterministic_key(tmp_path):
    source = write_grid(tmp_path/'source',[((0,0,8,8),1,3)])
    directory = tmp_path/'cache'
    legacy = directory/'previous-version'
    legacy.mkdir(parents=True)
    (legacy/'manifest.json').write_text(json.dumps({'source':str(source),'version':display.VERSION-1}))
    (directory/'previous-key.current.json').write_text(json.dumps({'directory':legacy.name}))
    script = '''
from pathlib import Path
import os,sys,time
import gridmen_backend.grid_display as display
build = display._build
def race(*args):
    ready = Path(sys.argv[3])
    (ready/str(os.getpid())).touch()
    end = time.monotonic()+10
    while len(list(ready.iterdir())) < 2:
        if time.monotonic() > end:
            raise RuntimeError('second publisher did not arrive')
        time.sleep(.01)
    return build(*args)
display._build = race
index = display.GridDisplayIndex(Path(sys.argv[1]),Path(sys.argv[2]))
assert index.inspect(1,1)['cell']['id'] == 1
print(index.revision,flush=True)
index.close()
'''
    ready = tmp_path/'ready'
    ready.mkdir()
    processes = [subprocess.Popen([sys.executable,'-c',script,str(source),str(directory),str(ready)],
                  cwd=tmp_path,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                 for _ in range(2)]
    try:
        results = [process.communicate(timeout=30) for process in processes]
        assert all(process.returncode == 0 for process in processes), results
        assert results[0][0] == results[1][0]
        assert len(list(ready.iterdir())) == 2
        assert [path.name for path in directory.iterdir()] == [results[0][0].strip()]
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.communicate()
