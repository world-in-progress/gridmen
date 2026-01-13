from pydantic import BaseModel, field_validator

class PatchMeta(BaseModel):
    """Information about the patch of a specific project"""
    name: str
    epsg: int
    starred: bool = False # whether the patch is starred
    description: str = '' # description of the patch
    alignment_origin: tuple[float, float] # [lon, lat], base point of the patch
    subdivide_rules: list[tuple[int, int]] # rules for subdividing the patch
    bounds: tuple[float, float, float, float] # [ min_lon, min_lat, max_lon, max_lat ]