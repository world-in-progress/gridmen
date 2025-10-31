from pydantic import BaseModel

class BaseResponse(BaseModel):
    """Base response schema"""
    success: bool
    message: str