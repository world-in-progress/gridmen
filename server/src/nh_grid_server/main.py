import os
import sys
import uvicorn
import logging
from fastapi import FastAPI
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), 'api', 'endpoints')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'py-noodle', 'src')))


from icrms.ischema import ISchema
from nh_grid_server.api import api_router as schema_router
from pynoodle import noodle, NOODLE_INIT, NOODLE_TERMINATE

logging.basicConfig(level=logging.INFO)

@asynccontextmanager
async def lifespan(app: FastAPI):
    NOODLE_INIT(app)

    try:
        # Mount schemaSet node (for test)
        logging.info('Mounting schemaSet node...')
        noodle.mount('schemaSet', 'schema')
        logging.info('schemaSet node mounted successfully')

    except Exception as e:
        logging.error(f'Failed to mount or initialize schemaSet node: {e}')
        raise

    yield
    
    try:
        noodle.unmount('schemaSet')
        logging.info('schemaSet node unmounted successfully')
    except Exception as e:
        logging.error(f'Failed to unmount schemaSet node: {e}')

    NOODLE_TERMINATE()

def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title='Noodle_Schema_Test',
        version='0.1.0',
        lifespan=lifespan,
    )
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_credentials=True,
        allow_methods=['*'],
        allow_headers=['*'],
    )
    
    app.include_router(schema_router)
    
    return app

app = create_app()

if __name__ == '__main__':
    uvicorn.run('src.nh_grid_server.main:app', host='0.0.0.0', port=8001)