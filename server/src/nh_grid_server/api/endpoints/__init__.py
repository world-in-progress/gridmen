from fastapi import APIRouter
from . import schema

router = APIRouter(prefix='/api', tags=['api'])

router.include_router(schema.router)
