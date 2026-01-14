import json
from pydantic import BaseModel, field_validator

class GridSchema(BaseModel):
    """Schema for project init configuration"""
    name: str # name of the grid schema
    epsg: int # EPSG code for the grid
    alignment_origin: tuple[float, float]   # [lon, lat], base point of the grid
    grid_info: list[tuple[float, float]]    # [(width_in_meter, height_in_meter), ...], grid size in each level

    @field_validator('alignment_origin')
    def validate_alignment_origin(cls, v):
        if len(v) != 2:
            raise ValueError('alignment_origin must have exactly 2 values [lon, lat]')
        return v
    
    @field_validator('grid_info')
    def validate_grid_info(cls, v):
        if not all(len(item) == 2 for item in v):
            raise ValueError('grid_info must contain tuples of exactly 2 values [width_in_meter, height_in_meter]')
        return v

    @staticmethod
    def parse_file(file_path: str) -> 'GridSchema':
        """Parse a grid schema from a JSON file"""
        with open(file_path, 'r') as f:
            data = json.load(f)
        return GridSchema(**data)
    
class ResponseWithGridSchema(BaseModel):
    """Response schema for grid operations with grid schema"""
    grid_schema: GridSchema | None

    @field_validator('grid_schema')
    def validate_schema(cls, v):
        if v is None:
            return v
        # Ensure that the schema is an instance of GridSchema
        if not isinstance(v, GridSchema):
            raise ValueError('schema must be an instance of GridSchema')
        return v