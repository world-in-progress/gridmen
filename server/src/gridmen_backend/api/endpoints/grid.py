import json
import logging
from pathlib import Path
from pynoodle import noodle
from fastapi import APIRouter, HTTPException, Query

from ...core import settings
from ...schemas.base import BaseResponse

logger = logging.getLogger(__name__)

# APIs for grid resource ##################################################

router = APIRouter(prefix='/grid', tags=['grid-related apis'])

@router.post('/mount', response_model=BaseResponse)
def mount_grid(
    node_key: str,
    schema_node_key: str = Query(..., description="Node key of the schema resource"),
    patch_node_keys: list[str] = Query(..., description="List of patch node keys"),
    dem_path: str = Query(None, description="Path to DEM file"),
    lum_path: str = Query(None, description="Path to LUM file"),
    grading_threshold: int = Query(-1, description="Grading threshold")
):
    """
    Mount a grid resource with assembly.
    
    This endpoint creates a grid resource by assembling schema, patches, 
    and optional DEM and LUM data.
    """
    try:
        # Prepare mount parameters for the grid assembly
        mount_params = {
            'assembly': {
                'schema_node_key': schema_node_key,
                'patch_node_keys': patch_node_keys,
                'dem_path': dem_path,
                'lum_path': lum_path,
                'grading_threshold': grading_threshold
            }
        }
        
        # Mount the grid node using the noodle framework
        mount_params_string = json.dumps(mount_params)
        success, error = noodle.mount(node_key, 'grid', mount_params_string)
        
        if not success:
            raise HTTPException(status_code=500, detail=f'Failed to mount grid: {error}')
        
        return BaseResponse(
            success=True,
            message=f'Grid {node_key} mounted successfully'
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to mount grid: {str(e)}')


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