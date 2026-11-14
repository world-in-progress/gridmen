"""Keep backend test resources separate from the pytest launch directory."""
import os
from pathlib import Path

import pytest


SERVER_ROOT = Path(__file__).resolve().parents[1]


@pytest.hookimpl(trylast=True)
def pytest_sessionstart(session):
    # Pynoodle loads settings while test modules are collected, before fixtures
    # run. Its import-time directories and database must also be temporary.
    state = session.config._tmp_path_factory.mktemp('backend-imports')
    patch = pytest.MonkeyPatch()
    session.config.add_cleanup(patch.undo)
    patch.setenv('NOODLE_CONFIG_PATH', str(SERVER_ROOT / 'noodle.config.yaml'))
    patch.setenv('SQLITE_PATH', str(state / 'noodle.db'))
    patch.setenv('MEMORY_TEMP_PATH', str(state / 'temp'))
    # Subprocesses do not inherit pytest's pythonpath setting. Always import
    # this checkout's packages, including templates, rather than an editable
    # installation belonging to the interpreter's environment.
    patch.setenv('PYTHONPATH', os.pathsep.join((str(SERVER_ROOT / 'src'), str(SERVER_ROOT))))


@pytest.fixture(autouse=True)
def isolated_working_directory(tmp_path, monkeypatch):
    # Real router lifespans and grid hooks resolve resources from Path.cwd().
    # Run this before other function fixtures and restore cwd after teardown.
    monkeypatch.chdir(tmp_path)
