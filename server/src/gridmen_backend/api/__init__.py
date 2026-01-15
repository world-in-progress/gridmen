from fastapi import APIRouter
from .endpoints import schema, proj, patch, vector

api_router = APIRouter(prefix='/api')
api_router.include_router(schema.router)
api_router.include_router(proj.router)
api_router.include_router(patch.router)
api_router.include_router(vector.router)