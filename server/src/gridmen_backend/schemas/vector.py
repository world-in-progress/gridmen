from typing import Any
from pydantic import BaseModel

class FeatureSaveBody(BaseModel):
    feature_json: dict[str, Any]

class GetFeatureResponse(BaseModel):
    success: bool
    message: str
    data: dict[str, Any] | None = None

class GetFeatureJsonResponse(BaseModel):
    success: bool
    message: str
    feature_json: dict[str, Any] | None = None

class UploadFeatureSaveBody(BaseModel):
    node_key: str
    file_path: str
    file_type: str

class UploadFeatureFromFile(BaseModel):
    file_path: str
