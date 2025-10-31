from pydantic import BaseModel
from typing import Optional

class ProjectMeta(BaseModel):
    """Project metadata schema"""
    name: str
    description: Optional[str] = ""
    created_at: Optional[str] = ""
    updated_at: Optional[str] = ""