import json
from pathlib import Path
from fastapi import APIRouter, HTTPException

# 修改相对导入为绝对导入
from nh_grid_server.core.config import settings
from nh_grid_server.schemas.base import BaseResponse
from nh_grid_server.schemas.project import ProjectMeta
from nh_grid_server.schemas.schema import GridSchema, ResponseWithGridSchema
from icrms.ischema import ISchema

# 导入pynoodle相关模块
import sys
import os
py_noodle_path = os.path.join(settings.ROOT_DIR, '..', 'py-noodle', 'src')
if py_noodle_path not in sys.path:
    sys.path.insert(0, py_noodle_path)

# 现在可以导入pynoodle模块了
from pynoodle import noodle, NOODLE_INIT, NOODLE_TERMINATE

import logging
logger = logging.getLogger(__name__)

# APIs for single grid schema ##################################################

router = APIRouter(prefix='/schema', tags=['schema-related apis'])

@router.get('/{name}', response_model=ResponseWithGridSchema)
def get_schema(name: str):
    """
    Description
    --
    Get a grid schema by name.
    """
    
    # Check if the schema file exists
    grid_schema_path = Path(settings.GRID_SCHEMA_DIR, name, 'schema.json')
    if not grid_schema_path.exists():
        raise HTTPException(status_code=404, detail='Grid schema not found')

    # Read the schema from the file
    try:
        with open(grid_schema_path, 'r') as f:
            data = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to read schema: {str(e)}')
    
    # 通过pynoodle连接到Schema CRM获取proj4_defs
    try:
        node_key = f'root.topo.schemas.{name}'
        with noodle.connect(ISchema, node_key, 'lr') as schema:
            # 调用CRM的get_epsg方法获取转换参数
            logger.info(f"Getting proj4_defs from CRM for schema {name}")
            proj4_defs = schema.get_epsg()
            # 将proj4_defs添加到返回数据中
            data['proj4_defs'] = proj4_defs
    except Exception as e:
        logger.warning(f"Failed to get proj4_defs from CRM: {str(e)}")
        # 如果无法从CRM获取，则使用空值
        data['proj4_defs'] = ""  # 改为使用空字符串而不是None
    
    return ResponseWithGridSchema(
        grid_schema=GridSchema(**data)
    )

@router.post('/', response_model=BaseResponse)
def register_schema(data: GridSchema):
    """
    Description
    --
    Register a grid schema.
    """

    # Find if grid schema is existed
    grid_schema_path = Path(settings.GRID_SCHEMA_DIR, data.name, 'schema.json')
    if grid_schema_path.exists():
        return BaseResponse(
            success=False,
            message='Grid schema already exists. Please use a different name.'
        )
        
    # Write the schema to a file
    try:
        grid_schema_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(grid_schema_path, 'w') as f:
            f.write(data.model_dump_json(indent=4))
            
        # Create resoruce folder for patches and grids
        patches_path = grid_schema_path.parent / 'patches'
        grids_path = grid_schema_path.parent / 'grids'
        patches_path.mkdir(exist_ok=True)
        grids_path.mkdir(exist_ok=True)
        
        # Mount scene nodes using pynoodle directly
        # 确保父节点存在
        try:
            noodle.mount('root.topo.schemas', 'schema')
        except Exception:
            pass  # 父节点可能已经存在
            
        # 挂载schema节点
        noodle.mount(f'root.topo.schemas.{data.name}', 'schema')
        noodle.mount(f'root.topo.schemas.{data.name}.patches', 'patches')
        noodle.mount(f'root.topo.schemas.{data.name}.grids', 'grids')
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to save grid schema: {str(e)}')
    return BaseResponse(
        success=True,
        message='Grid schema registered successfully'
    )

@router.put('/{name}', response_model=BaseResponse)
def update_schema(name: str, data: GridSchema):
    """
    Description
    --
    Update a grid schema by name.
    """
    
    # Check if the schema file exists
    grid_schema_path = Path(settings.GRID_SCHEMA_DIR, name, 'schema.json')
    if not grid_schema_path.exists():
        raise HTTPException(status_code=404, detail='Grid schema not found')

    # Write the updated schema to the file
    try:
        with open(grid_schema_path, 'w') as f:
            f.write(data.model_dump_json(indent=4))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to update schema: {str(e)}')
    
    return BaseResponse(
        success=True,
        message='Project schema updated successfully'
    )

@router.delete('/{name}', response_model=BaseResponse)
def delete_schema(name: str):
    """
    Description
    --
    Delete a grid schema by name.
    """
    # Get Schema node key
    node_key = f'root.topo.schemas.{name}'
    
    # Check if the schema file exists
    grid_schema_path = Path(settings.GRID_SCHEMA_DIR, name, 'schema.json')
    if not grid_schema_path.exists():
        raise HTTPException(status_code=404, detail='Grid schema not found')
    
    try:
        # TODO: Delete all patches and grids under this schema and unmount them
        patches_path = grid_schema_path.parent / 'patches'
        grids_path = grid_schema_path.parent / 'grids'
        if patches_path.exists():
            for patch in patches_path.glob('*'):
                if patch.is_dir():
                    patch.rmdir()
                    noodle.unmount(f'root.topo.schemas.{name}.patches.{patch.name}')
                    
            patches_path.rmdir()
            noodle.unmount(f'root.topo.schemas.{name}.patches')

        if grids_path.exists():
            for grid in grids_path.glob('*'):
                if grid.is_dir():
                    grid.rmdir()
                    noodle.unmount(f'root.topo.schemas.{name}.grids.{grid.name}')
                    
            grids_path.rmdir()
            noodle.unmount(f'root.topo.schemas.{name}.grids')
                    
        grid_schema_path.unlink()
        grid_schema_path.parent.rmdir()
        noodle.unmount(node_key)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to delete schema: {str(e)}')
    
    return BaseResponse(
        success=True,
        message='Grid schema deleted successfully'
    )