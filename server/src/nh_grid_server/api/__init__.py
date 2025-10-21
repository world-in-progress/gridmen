from fastapi import APIRouter
from .endpoints import schema

api_router = APIRouter(prefix='/api')

api_router.include_router(schema.router)