"""Measure moving display viewports over real loopback HTTP and published indexes.

Supply PYTHONPATH=server/src:server and a task-local TMPDIR/settings/cache before
running. This probe never builds an index or writes to source/cache directories.
"""
import argparse
import cProfile
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import pstats
import socket
import threading
import time

import httpx
from fastapi import FastAPI
from pydantic_core import to_json
import uvicorn

from gridmen_backend import grid_display
from gridmen_backend.api.endpoints import grid


def snapshot(root):
    return [(str(p.relative_to(root)),p.stat().st_size,p.stat().st_mtime_ns)
            for p in sorted(root.rglob('*')) if p.is_file()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path)
    parser.add_argument('cache',type=Path)
    parser.add_argument('--reference-module',type=Path)
    parser.add_argument('--profile-dir',type=Path)
    parser.add_argument('--trials',type=int,default=3)
    parser.add_argument('--scales',type=float,nargs='+',default=[32,4,.5])
    args = parser.parse_args()
    source,cache = args.source.resolve(),args.cache.resolve()
    module = grid_display
    if args.reference_module:
        spec = importlib.util.spec_from_file_location('reference_display',args.reference_module)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    revision = module.fingerprint(source)
    identity = [module.VERSION,str(source),revision]
    if any(len(spec) == 8 for spec in grid_display.layer_specs(grid_display.checked_meta(source))):
        identity.append('clipped-dyadic-1')
    key = hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:24]
    directory = cache/key
    if not (directory/'manifest.json').is_file():
        raise RuntimeError('A published matching manifest is required; this probe cannot build an index')
    before = snapshot(directory)
    started = time.perf_counter()
    index = module.GridDisplayIndex(source,cache)
    print(json.dumps(dict(stage='index',module=module.__file__,source=str(source),cache=str(directory),
                          openMs=(time.perf_counter()-started)*1000)),flush=True)

    # Profiles run without a server thread, independently of timed HTTP trials.
    if args.profile_dir:
        args.profile_dir.mkdir(parents=True,exist_ok=True)
        for scale in args.scales:
            bounds = [820965.5-512*scale,835829.5-384*scale,820965.5+512*scale,835829.5+384*scale]
            profile = cProfile.Profile()
            action = index.query if args.reference_module else index.query_json
            payload = profile.runcall(action,bounds,scale)
            del payload
            with (args.profile_dir/f'{source.name}-{scale}.txt').open('w') as output:
                pstats.Stats(profile,stream=output).strip_dirs().sort_stats('cumtime').print_stats(35)

    grid._display_source = lambda key:source
    grid._DISPLAY_CACHE[(source,tuple(revision))] = index
    app = FastAPI()
    if args.reference_module:
        # The original endpoint returns dictionaries to FastAPI's encoder.
        def reference_endpoint(req:grid.GridDisplayQuery):
            with grid._display('benchmark') as active:
                return active.query(req.bounds,req.metersPerPixel)
        app.post('/api/grid/benchmark/display/query')(reference_endpoint)
    else:
        app.include_router(grid.router,prefix='/api')
    sock = socket.socket()
    sock.bind(('127.0.0.1',0))
    server = uvicorn.Server(uvicorn.Config(app,log_level='error',lifespan='off'))
    thread = threading.Thread(target=server.run,kwargs={'sockets':[sock]},daemon=True)
    thread.start()
    while not server.started:
        time.sleep(.01)
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{sock.getsockname()[1]}',trust_env=False,timeout=120) as client:
            for scale in args.scales:
                for trial in range(args.trials):
                    x,y = 820965.5+64*scale*trial,835829.5+24*scale*trial
                    bounds = [x-512*scale,y-384*scale,x+512*scale,y+384*scale]
                    started = time.perf_counter()
                    view = index.query(bounds,scale)
                    query_ms = (time.perf_counter()-started)*1000
                    stats = dict(cells=sum(len(c['cells']) for c in view['chunks']),
                                 fields=sum(len(c['fields']) for c in view['chunks']),nodes=index.last_query_nodes)
                    expected = hashlib.sha256(to_json(view)).hexdigest()
                    del view
                    for encoding in ['identity'] if args.reference_module else ['identity','gzip']:
                        started = time.perf_counter()
                        response = client.post('/api/grid/benchmark/display/query',
                            json=dict(bounds=bounds,metersPerPixel=scale),headers={'Accept-Encoding':encoding})
                        elapsed = (time.perf_counter()-started)*1000
                        response.raise_for_status()
                        # Parsing is outside the request-to-full-bytes timing.
                        # Re-encoding also normalizes the stdlib float spelling.
                        actual = hashlib.sha256(to_json(response.json())).hexdigest()
                        assert actual == expected,'HTTP changed query semantics or order'
                        print(json.dumps(dict(stage='navigation',scale=scale,trial=trial,bounds=bounds,
                            encoding=encoding,queryMs=query_ms,httpMs=elapsed,bytes=len(response.content),
                            wireBytes=int(response.headers['content-length']),semanticSha256=actual,**stats)),flush=True)
    finally:
        server.should_exit = True
        thread.join(10)
        sock.close()
        grid._close_display_cache()
    assert module.fingerprint(source) == revision,'Source files changed'
    assert snapshot(directory) == before,'Published index files changed'
    print(json.dumps(dict(stage='verifiedReadOnly',source=str(source),cache=str(directory))),flush=True)


if __name__ == '__main__':
    main()
