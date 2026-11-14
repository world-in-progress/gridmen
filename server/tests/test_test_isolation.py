"""Backend tests must preserve resources in the directory pytest starts from."""
import os
from pathlib import Path
import subprocess
import sys


def test_real_router_startup_preserves_pytest_launch_directory(tmp_path):
    server = Path(__file__).resolve().parents[1]
    launch = tmp_path / 'launch'
    sentinel = launch / 'resource' / '.display' / 'building-sentinel' / 'keep.txt'
    sentinel.parent.mkdir(parents=True)
    sentinel.write_text('startup data must survive tests\n')
    environment = dict(os.environ)
    environment['PYTHONPATH'] = os.pathsep.join((str(server / 'src'), str(server)))
    environment['PYTHONDONTWRITEBYTECODE'] = '1'
    environment['NOODLE_CONFIG_PATH'] = str(server / 'noodle.config.yaml')
    environment['SQLITE_PATH'] = str(tmp_path / 'noodle.db')
    environment['MEMORY_TEMP_PATH'] = str(tmp_path / 'temp')

    result = subprocess.run(
        [sys.executable, '-m', 'pytest', '-q',
         str(server / 'tests' / 'test_grid_display.py')
         + '::test_http_nodes_revision_cache_and_removed_query',
         '--basetemp', str(tmp_path / 'child-tests'),
         '-o', f'cache_dir={tmp_path / "child-cache"}'],
        cwd=launch, env=environment, capture_output=True, text=True, timeout=60,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert sentinel.is_file(), result.stdout + result.stderr
    assert sentinel.read_text() == 'startup data must survive tests\n'
