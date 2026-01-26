import json
import logging
from functools import lru_cache
from pathlib import Path
from pynoodle import noodle
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from ...core import settings
from ...schemas.base import BaseResponse

logger = logging.getLogger(__name__)

# APIs for grid resource ##################################################

router = APIRouter(prefix='/grid', tags=['grid-related apis'])


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


@router.get('/{node_key}/blocks/meta')
def get_blocks_metadata(node_key: str):
    """
    Get block spatial index metadata (block_meta.json).
    The frontend determines which blocks are contained in the frustum based on this file.
    """
    try:
        if not noodle._has_node(node_key):
            raise HTTPException(status_code=404, detail=f'Grid node {node_key} not found')
            
        node_record = noodle._load_node_record(node_key, is_cascade=False)
        launch_params = json.loads(node_record.launch_params) if node_record.launch_params else {}

        resource_dir_str = launch_params.get('resource_space')
        if not resource_dir_str:
            raise HTTPException(status_code=500, detail="Resource directory not found in node configuration")
        resource_dir = Path(resource_dir_str)
        
        meta_path = resource_dir / "blocks" / "block_meta.json"
        
        if not meta_path.exists():
            raise HTTPException(status_code=404, detail='Block metadata not found. Please ensure blocks are generated.')
            
        with open(meta_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to get block metadata: {str(e)}')


@router.get('/{node_key}/blocks/{block_name}')
def get_block_data(node_key: str, block_name: str):
    """
    Download the specific Block binary data (.bin).
    block_name should contain the extension, for example 'my_grid_1.bin'
    """
    try:
        if not noodle._has_node(node_key):
            raise HTTPException(status_code=404, detail=f'Grid node {node_key} not found')
            
        node_record = noodle._load_node_record(node_key, is_cascade=False)
        launch_params = json.loads(node_record.launch_params) if node_record.launch_params else {}
        resource_dir = Path(launch_params.get('resource_space'))

        if not block_name.endswith('.bin'):
            block_name += '.bin'
        
        blocks_dir = (resource_dir / "blocks").resolve()
        block_path = (blocks_dir / block_name).resolve()
        
        if not str(block_path).startswith(str(blocks_dir)):
             raise HTTPException(status_code=403, detail='Access denied: Invalid block path')

        if not block_path.exists():
            raise HTTPException(status_code=404, detail=f'Block {block_name} not found, {block_path}')
        
        return FileResponse(path=block_path, media_type='application/octet-stream', filename=block_name)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to get block data: {str(e)}')