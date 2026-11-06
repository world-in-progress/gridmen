import os
import json
import shutil
import logging
import gzip
from collections import OrderedDict
from contextlib import asynccontextmanager, contextmanager
import threading
from pathlib import Path
from pynoodle import noodle
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute

from ...core import settings
from ...schemas.base import BaseResponse
from ...schemas.grid import GridExportRequest
from ...grid_display import GridDisplayIndex, fingerprint

logger = logging.getLogger(__name__)

# APIs for grid resource ##################################################

router = APIRouter(prefix='/grid', tags=['grid-related apis'])

@router.post('/export', response_model=BaseResponse)
def export_grid_topo(req: GridExportRequest):
    node_key = req.node_key
    target_path = Path(req.target_path)
    
    if not target_path.exists():
        raise HTTPException(status_code=400, detail=f'Target path {target_path} does not exist')
    
    if not noodle.has_node(node_key):
        raise HTTPException(status_code=404, detail=f'Grid node {node_key} not found')
    
    try:
        rel_path = node_key.strip('.').replace('.', os.sep)
        grid_resource_dir = Path.cwd() / 'resource' / rel_path
        ne_src_path = grid_resource_dir / 'ne.txt'
        ns_src_path = grid_resource_dir / 'ns.txt'
        ne_path = target_path / 'ne.txt'
        ns_path = target_path / 'ns.txt'
        
        if not ne_src_path.exists() or not ns_src_path.exists():
            raise FileNotFoundError('Grid topology files not found in the resource directory')
        
        # Copy files to target path
        shutil.copy2(ne_src_path, ne_path)
        shutil.copy2(ns_src_path, ns_path)
        return BaseResponse(
            success=True,
            message=f'Grid topology exported successfully to {target_path}'
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to export grid topology: {str(e)}')

@router.get('/info', response_model=BaseResponse)
def get_grid_info(node_key: str):
    """
    Get information about a mounted grid resource.
    """
    try:
        # Check if the node exists
        if not noodle._has_node(node_key):
            raise HTTPException(status_code=404, detail=f'Grid node {node_key} not found')
        
        # Load node record to get the resource path
        node_record = noodle._load_node_record(node_key, is_cascade=False)
        if not node_record:
            raise HTTPException(status_code=404, detail=f'Grid node {node_key} not found')
        
        # Parse launch params to get resource directory
        launch_params = json.loads(node_record.launch_params) if node_record.launch_params else {}
        resource_dir = launch_params.get('resource_dir', 'Unknown')
        bin_file_path = launch_params.get('bin_file_path', 'Unknown')
        ne_file_path = launch_params.get('ne_file_path', 'Unknown')
        
        return BaseResponse(
            success=True,
            message=f'Grid info for {node_key}',
            data={
                'resource_dir': resource_dir,
                'bin_file_path': bin_file_path,
                'ne_file_path': ne_file_path
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to get grid info: {str(e)}')


@router.get('/{node_key}/exists')
def check_grid_exists(node_key: str):
    """
    Check if a grid node exists in the resource tree.
    """
    try:
        exists = noodle._has_node(node_key)
        return {
            'node_key': node_key,
            'exists': exists
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to check grid existence: {str(e)}')


@router.post('/create-empty', response_model=BaseResponse)
def create_empty_grid(node_key: str):
    """
    Create an empty grid resource without assembly.
    """
    try:
        # Mount the grid node without assembly parameters
        success, error = noodle.mount(node_key, 'grid', '')
        
        if not success:
            raise HTTPException(status_code=500, detail=f'Failed to create empty grid: {error}')
        
        return BaseResponse(
            success=True,
            message=f'Empty grid {node_key} created successfully'
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to create empty grid: {str(e)}')


def _display_source(node_key: str) -> Path:
    if not noodle._has_node(node_key):
        raise HTTPException(status_code=404, detail=f'Grid node {node_key} not found')
    record = noodle._load_node_record(node_key, is_cascade=False)
    params = json.loads(record.launch_params)
    return Path(params['resource_space']).resolve()


_DISPLAY_CACHE = OrderedDict()
_DISPLAY_LOCK = threading.RLock()


def _close_display_cache():
    with _DISPLAY_LOCK:
        for index in _DISPLAY_CACHE.values():
            index.close()
        _DISPLAY_CACHE.clear()


@asynccontextmanager
async def _display_lifespan(app):
    yield
    _close_display_cache()


@contextmanager
def _display(node_key: str):
    # Hold ownership through the request so invalidation/eviction cannot unmap
    # an index being queried by another thread. Each worker has its own cache.
    with _DISPLAY_LOCK:
        try:
            source = _display_source(node_key)
            key = (source,tuple(fingerprint(source)))
            for old in list(_DISPLAY_CACHE):
                if old[0] == source and old != key:
                    _DISPLAY_CACHE.pop(old).close()
            if key not in _DISPLAY_CACHE:
                index = GridDisplayIndex(source,settings.ROOT_DIR / 'resource' / '.display')
                _DISPLAY_CACHE[key] = index
                if len(_DISPLAY_CACHE) > 4:
                    _,evicted = _DISPLAY_CACHE.popitem(last=False)
                    evicted.close()
            _DISPLAY_CACHE.move_to_end(key)
        except (OSError,ValueError,KeyError) as exc:
            raise HTTPException(status_code=500,detail=f'Invalid grid display resource: {exc}') from exc
        yield _DISPLAY_CACHE[key]


class DisplayRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def checked(request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                # FastAPI's default error echoes nonfinite JSON inputs, which
                # JSONResponse cannot serialize. Keep explicit, JSON-safe errors.
                return JSONResponse(status_code=422, content={'detail':[
                    {key:error[key] for key in ('loc','msg','type')}
                    for error in exc.errors()
                ]})
        return checked


display_router = APIRouter(route_class=DisplayRoute,lifespan=_display_lifespan)


@display_router.get('/{node_key}/display/meta')
def display_meta(node_key: str):
    with _display(node_key) as index:
        return index.meta


def _accepts_gzip(value):
    # An explicit gzip refusal overrides a wildcard, including q=0.
    qualities = {}
    for entry in value.lower().split(','):
        coding,*parameters = entry.strip().split(';')
        quality = 1.0
        for parameter in parameters:
            name,separator,number = parameter.strip().partition('=')
            if name == 'q' and separator:
                try:
                    quality = float(number)
                except ValueError:
                    quality = 0.0
        qualities[coding] = quality
    return 0 < qualities.get('gzip',qualities.get('*',0)) <= 1


@display_router.get('/{node_key}/display/nodes/{revision}/{block_layer}/{x}/{y}/{display_layer}')
def display_nodes(node_key: str, revision: str, block_layer: int, x: int, y: int,
                  display_layer: int, request: Request):
    with _display(node_key) as index:
        if revision != index.revision:
            raise HTTPException(status_code=409, detail='Grid display revision changed')
        try:
            index.validate_nodes(block_layer, x, y, display_layer)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        etag = f'W/"{revision}:{block_layer}:{x}:{y}:{display_layer}"'
        headers = {'ETag':etag, 'Cache-Control':'public, max-age=31536000, immutable',
                   'Vary':'Accept-Encoding'}
        validators = {value.strip() for value in request.headers.get('if-none-match','').split(',')}
        if '*' in validators or etag in validators:
            return Response(status_code=304, headers=headers)
        payload = index._nodes(block_layer, x, y, display_layer)
    if len(payload) >= 1000 and _accepts_gzip(request.headers.get('accept-encoding','')):
        payload = gzip.compress(payload,compresslevel=1,mtime=0)
        headers['Content-Encoding'] = 'gzip'
    return Response(payload,media_type='application/octet-stream',headers=headers)


@display_router.get('/{node_key}/display/inspect')
def display_inspect(node_key: str, x: float = Query(allow_inf_nan=False),
                    y: float = Query(allow_inf_nan=False)):
    with _display(node_key) as index:
        return index.inspect(x, y)


router.include_router(display_router)
