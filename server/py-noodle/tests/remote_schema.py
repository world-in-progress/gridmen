import os
import sys
import uvicorn
import logging
from fastapi import FastAPI
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))

from pynoodle import noodle, NOODLE_INIT, NOODLE_TERMINATE
from tests.icrms.ischema import ISchema

logging.basicConfig(level=logging.INFO)

@asynccontextmanager
async def lifespan(app: FastAPI):
    NOODLE_INIT(app)

    noodle.mount('schemaSet', 'schema')
    with noodle.connect(ISchema, 'schemaSet', 'lw') as schema:
        # 初始化schema数据
        schema.update_info({
            "name": "remote_test_schema",
            "epsg": 4326,
            "alignment_origin": [-74.0060, 40.7128],
            "grid_info": [[500.0, 500.0], [250.0, 250.0], [125.0, 125.0]]
        })

    yield
    
    noodle.unmount('schemaSet')
    NOODLE_TERMINATE()

def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title='Noodle_Schema_Test',
        version='0.1.0',
        lifespan=lifespan,
    )
    
    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_credentials=True,
        allow_methods=['*'],
        allow_headers=['*'],
    )
    return app

app = create_app()

if __name__ == '__main__':
    uvicorn.run('tests.remote_schema:app', host='0.0.0.0', port=8002)