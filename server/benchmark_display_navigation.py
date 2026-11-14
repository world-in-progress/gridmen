"""Benchmark cold display-index construction and GDN5 loopback HTTP blocks."""
import argparse
import hashlib
import json
import socket
import subprocess
import threading
import time
import sys
from contextlib import nullcontext
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI
from gridmen_backend.api.endpoints import grid
from gridmen_backend.grid_display import GridDisplayIndex, fingerprint


def emit(**values):
    print(json.dumps(values, sort_keys=True), flush=True)


def snapshot(path):
    return [(str(file.relative_to(path)), file.stat().st_size, file.stat().st_mtime_ns)
            for file in sorted(path.rglob('*')) if file.is_file()]


def select_blocks(index, bounds, scale):
    """Delegate benchmark camera selection to the actual client implementation."""
    adapter = Path(__file__).resolve().parent.parent/'client/src/test/selectDisplayBlocks.mjs'
    result = subprocess.run(['node',str(adapter)],input=json.dumps({
        'layers':[dict(width=layer.w,height=layer.h,x0=layer.x0,y0=layer.y0,
                       nx=layer.nx,ny=layer.ny,nativeLevel=layer.level if layer.level > 0 else None,
                       xLayout=layer.layout[0],yLayout=layer.layout[1]) for layer in index.layers],
        'origin':index.origin,
        'viewport':bounds,'metersPerPixel':scale,
    }),text=True,capture_output=True,check=True)
    return json.loads(result.stdout)


def record_count(payload):
    assert payload[:4] == b'GDN5' and (len(payload)-4)%72 == 0
    return (len(payload)-4)//72


def peak_rss():
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('cache', type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    cache = args.cache.resolve()
    before_source = fingerprint(source)
    started = time.perf_counter()
    index = GridDisplayIndex(source, cache)
    cell_count = len(index.offsets)
    emit(stage='index', source=str(source), cells=cell_count,
         revision=index.revision, buildOrOpenSeconds=round(time.perf_counter()-started, 3),
         peakRssBytes=peak_rss(),
         cacheBytes=sum(file.stat().st_size for file in index.directory.rglob('*') if file.is_file()))
    if source.name == 'b4i':
        bounds = index._cell(8)[0]['bounds']
        inspected = index.inspect((bounds[0]+bounds[2])/2, (bounds[1]+bounds[3])/2)
        east = [(entry['cell']['id'], entry['edgeIds']) for entry in inspected['neighbors']
                if entry['side'] == 'east']
        assert east == [(42475,[24]),(42479,[25])], east
        emit(stage='topology', cell=8, east=east)
    before_cache = snapshot(index.directory)
    block_layer = next(i for i, layer in enumerate(index.layers) if layer.w >= 256 and layer.h >= 256)
    choices = []
    for cid in (1, max(2, cell_count//2), cell_count):
        bounds = index._cell(cid)[0]['bounds']
        x, y = index.layers[block_layer].locate((bounds[0]+bounds[2])/2,
                                                 (bounds[1]+bounds[3])/2, index.origin)
        point = (int(x), int(y))
        if point not in choices:
            choices.append(point)
        if len(choices) == 2:
            break
    assert len(choices) == 2, 'Need two distinct occupied block positions'
    display_layers = sorted({0, next(i for i,layer in enumerate(index.layers) if layer.level == 1),
                             block_layer})

    original_display = grid._display
    grid._display = lambda _: nullcontext(index)
    app = FastAPI()
    from starlette.middleware.gzip import GZipMiddleware
    app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=1)
    app.include_router(grid.router, prefix='/api')
    sock = socket.socket()
    sock.bind(('127.0.0.1',0))
    server = uvicorn.Server(uvicorn.Config(app, log_level='error', lifespan='off'))
    thread = threading.Thread(target=server.run, kwargs={'sockets':[sock]}, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(.01)
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{sock.getsockname()[1]}',
                          trust_env=False, timeout=120) as client:
            meta = client.get('/api/grid/probe/display/meta')
            meta.raise_for_status()
            assert meta.json()['revision'] == index.revision
            emit(stage='meta',data=meta.json())
            for position, (x,y) in enumerate(choices):
                for display_layer in display_layers:
                    path = f'/api/grid/probe/display/nodes/{index.revision}/{block_layer}/{x}/{y}/{display_layer}'
                    started = time.perf_counter()
                    expected = index.nodes(block_layer,x,y,display_layer)
                    direct_ms = (time.perf_counter()-started)*1000
                    started = time.perf_counter()
                    response = client.get(path, headers={'Accept-Encoding':'identity'})
                    http_ms = (time.perf_counter()-started)*1000
                    response.raise_for_status()
                    assert response.content == expected
                    count = record_count(response.content)
                    assert client.get(path,headers={'If-None-Match':response.headers['etag']}).status_code == 304
                    emit(stage='http', position=position, block=[block_layer,x,y],
                         displayLayer=display_layer, records=count,
                         directMs=round(direct_ms,3), httpMs=round(http_ms,3),
                         bytes=len(response.content),
                         sha256=hashlib.sha256(response.content).hexdigest())

            # A pan asks for a new spatial block after the index is warm.
            anchor_x,anchor_y = choices[-1]
            for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
                px,py = anchor_x+dx,anchor_y+dy
                layer = index.layers[block_layer]
                if (px,py) in choices or not (layer.x0 <= px < layer.x0+layer.nx
                        and layer.y0 <= py < layer.y0+layer.ny):
                    continue
                pan_expected = index.nodes(block_layer,px,py,0)
                if record_count(pan_expected):
                    break
            else:
                raise AssertionError('No occupied adjacent block for warm pan')
            pan_path = f'/api/grid/probe/display/nodes/{index.revision}/{block_layer}/{px}/{py}/0'
            started = time.perf_counter()
            pan = client.get(pan_path,headers={'Accept-Encoding':'identity'})
            pan_ms = (time.perf_counter()-started)*1000
            pan.raise_for_status()
            assert pan.content == pan_expected
            emit(stage='warmPan',fromBlock=[block_layer,anchor_x,anchor_y],
                 toBlock=[block_layer,px,py],displayLayer=0,
                 records=record_count(pan.content),bytes=len(pan.content),
                 httpMs=round(pan_ms,3))

            # Issue every block for two 1024x768 views at physically distinct
            # positions. Block and selected levels follow the display lattice.
            for position,(center_x,center_y) in enumerate(choices):
                center_box = index.layers[block_layer].bounds(center_x,center_y,index.origin)
                cx,cy = (center_box[0]+center_box[2])/2,(center_box[1]+center_box[3])/2
                for scale in (4.0,0.5,index.layers[-1].h*8):
                    bounds = (cx-512*scale,cy-384*scale,cx+512*scale,cy+384*scale)
                    selections = select_blocks(index,bounds,scale)
                    started = time.perf_counter()
                    blocks=nonempty=records=total_bytes=0
                    for selection in selections:
                        view_path = (f'/api/grid/probe/display/nodes/{index.revision}/'
                                     f'{selection["blockLayer"]}/{selection["x"]}/'
                                     f'{selection["y"]}/{selection["displayLayer"]}')
                        view = client.get(view_path,headers={'Accept-Encoding':'identity'})
                        view.raise_for_status()
                        n = record_count(view.content)
                        blocks += 1
                        nonempty += n > 0
                        records += n
                        total_bytes += len(view.content)
                    emit(stage='fullViewport',position=position,scale=scale,
                         requestedBlocks=selections,
                         blocks=blocks,nonemptyBlocks=nonempty,records=records,
                         bytes=total_bytes,
                         httpMs=round((time.perf_counter()-started)*1000,3))
            stale = client.get(path.replace(index.revision,'stale'),headers={'Accept-Encoding':'identity'})
            assert stale.status_code == 409
            zipped_path = (f'/api/grid/probe/display/nodes/{index.revision}/'
                           f'{block_layer}/{anchor_x}/{anchor_y}/0')
            zipped_expected = index.nodes(block_layer,anchor_x,anchor_y,0)
            gzip_response = client.get(zipped_path,headers={'Accept-Encoding':'gzip'})
            gzip_response.raise_for_status()
            assert gzip_response.content == zipped_expected
            emit(stage='cache', staleStatus=stale.status_code,
                 gzipEncoding=gzip_response.headers.get('content-encoding'),
                 etag=gzip_response.headers['etag'])
    finally:
        server.should_exit = True
        thread.join(10)
        sock.close()
        grid._display = original_display
        index.close()
    assert fingerprint(source) == before_source
    assert snapshot(index.directory) == before_cache
    emit(stage='verifiedReadOnly',source=str(source),cache=str(index.directory))


if __name__ == '__main__':
    main()
