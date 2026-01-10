from fastapi import APIRouter
from .endpoints import schema, proj, patch

api_router = APIRouter(prefix='/api')
api_router.include_router(schema.router)
api_router.include_router(proj.router)
api_router.include_router(patch.router)