import numpy as np
from pydantic import BaseModel, field_validator

from .node import NodeToken
from .base import BaseResponse

class PatchMeta(BaseModel):
    """Information about the patch of a specific project"""
    name: str
    epsg: int
    starred: bool = False # whether the patch is starred
    description: str = '' # description of the patch
    alignment_origin: tuple[float, float] # [lon, lat], base point of the patch
    subdivide_rules: list[tuple[int, int]] # rules for subdividing the patch
    bounds: tuple[float, float, float, float] # [ min_lon, min_lat, max_lon, max_lat ]
    schema_node_key: str # The schema node key

class MultiCellInfo(BaseModel):
    levels: list[int]
    global_ids: list[int]
    
    def combine_bytes(self):
        """
        Combine the grid information into a single bytes object
        
        Format: [4 bytes for length, followed by level bytes, followed by global id bytes]
        """
        
        level_bytes = np.array(self.levels, dtype=np.uint8).tobytes()
        global_id_bytes = np.array(self.global_ids, dtype=np.uint32).tobytes()
        
        level_length = len(level_bytes).to_bytes(4, byteorder='little')
        padding_size = (4 - (len(level_length) + len(level_bytes)) % 4) % 4
        padding = b'\x00' * padding_size
        
        return level_length + level_bytes + padding + global_id_bytes
    
    @staticmethod
    def from_bytes(data: bytes):
        """
        Create a MultiGridInfo instance from bytes data
        
        The data format is:
        - First 4 bytes: length of the level bytes
        - Next N bytes: level bytes
        - Padding to make the total length a multiple of 4
        - Remaining bytes: global id bytes
        """
        
        if len(data) < 8:
            raise ValueError('Data is too short to contain valid MultiGridInfo')
        
        level_length = int.from_bytes(data[:4], byteorder='little')
        level_bytes = data[4:4 + level_length]
        global_id_bytes = data[4 + level_length + (4 - (level_length % 4)) % 4:]
        
        levels = list(np.frombuffer(level_bytes, dtype=np.uint8))
        global_ids = list(np.frombuffer(global_id_bytes, dtype=np.uint32))
        
        return MultiCellInfo(levels=levels, global_ids=global_ids)

class MultiCellInfoResponse(BaseResponse):
    """Standard response schema for grid operations"""
    infos: dict[str, str | int] # bytes representation of MultiCellInfo, { 'grid_num': num, 'levels': b'...', 'global_ids': b'...' }
    
    @field_validator('infos')
    def check_infos(cls, v):
        if not isinstance(v, dict):
            raise ValueError('Infos must be a dictionary')
        return v

class PickByFeatureRequest(BaseModel):
    patch_token: NodeToken
    file_or_feature_token: NodeToken | str  # if str, it is treated as feature file path related to Shp or GeoJSON


    