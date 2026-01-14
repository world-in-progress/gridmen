import logging
import uvicorn
from src.gridmen_backend.core.config import settings

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)

# TODO (Dsssyc): Optimization
# Inject necessary environment variables for c-two
# This mechanism maybe better optimized in the future
settings.inject_env([
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'SQLITE_PATH',
    'MEMORY_TEMP_PATH',
    'NOODLE_CONFIG_PATH',
])

print(settings.MEMORY_TEMP_PATH)

if __name__ == '__main__':
    import os
    import sys
    if sys.platform.startswith('win') or sys.platform.startswith('linux'):
        venv_path = sys.prefix
        os.environ['PROJ_LIB'] = os.path.join(venv_path, 'Lib', 'site-packages', 'osgeo', 'data', 'proj')

    uvicorn.run('src.gridmen_backend.main:app', host='0.0.0.0', port=settings.SERVER_PORT, reload=True)