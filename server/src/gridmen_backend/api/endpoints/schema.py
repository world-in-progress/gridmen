import json
import logging
from pathlib import Path
from pynoodle import noodle
from fastapi import APIRouter, HTTPException

from ...core import settings
from ...schemas.base import BaseResponse
from ...schemas.schema import GridSchema, ResponseWithGridSchema


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
    
    return ResponseWithGridSchema(
        grid_schema=GridSchema(**data)
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