import logging
import uvicorn
from src.gridmen_backend.core.config import settings

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)

if __name__ == '__main__':
    import os
    import sys
    if sys.platform.startswith('win') or sys.platform.startswith('linux'):
        venv_path = sys.prefix
        os.environ['PROJ_LIB'] = os.path.join(venv_path, 'Lib', 'site-packages', 'osgeo', 'data', 'proj')

    uvicorn.run('src.gridmen_backend.main:app', host='0.0.0.0', port=settings.SERVER_PORT, reload=True)