"""Own display indexes while requests borrow their immutable mappings."""
from collections import OrderedDict
from contextlib import contextmanager
import json
from pathlib import Path
import shutil
import threading


_OWNERS = threading.Condition()
_CACHE = OrderedDict()
_BUILDING = set()
_REMOVING = set()
_OPEN = set()
_PENDING = {}
_COLLECTING = set()


def cache_root():
    return Path.cwd() / 'resource' / '.display'


def cleanup_building():
    """Recover abandoned staging directories before the sole service starts."""
    for directory in cache_root().glob('building-*'):
        if directory.is_dir():
            shutil.rmtree(directory)


def register(index):
    index._users = 0
    index._retired = False
    with _OWNERS:
        _OPEN.add(index)


def _collect(key):
    with _OWNERS:
        _OWNERS.wait_for(lambda: key not in _COLLECTING)
        _COLLECTING.add(key)
        pending = _PENDING.pop(key, set())
        ready = pending - {index.directory for index in _OPEN}
        if pending - ready:
            _PENDING[key] = pending - ready
    deleted = set()
    try:
        for directory in ready:
            try:
                shutil.rmtree(directory)
            except FileNotFoundError:
                pass
            # Remove the pointer belonging to a pre-deterministic generation.
            for pointer in directory.parent.glob('*.current.json'):
                try:
                    if json.loads(pointer.read_text())['directory'] == directory.name:
                        pointer.unlink(missing_ok=True)
                except FileNotFoundError:
                    pass
            deleted.add(directory)
    finally:
        with _OWNERS:
            if ready - deleted:
                _PENDING.setdefault(key, set()).update(ready - deleted)
            _COLLECTING.remove(key)
            _OWNERS.notify_all()


def closed(index):
    key = index.source, index.directory.parent
    with _OWNERS:
        _OPEN.discard(index)
        collect = index.directory in _PENDING.get(key, ())
        _OWNERS.notify_all()
    if collect:
        _collect(key)


def prune(source, cache, keep=None):
    directories = []
    for manifest in cache.glob('*/manifest.json'):
        directory = manifest.parent
        if directory != keep and not directory.name.startswith('building-'):
            try:
                if json.loads(manifest.read_text()).get('source') == str(source):
                    directories.append(directory)
            except FileNotFoundError:
                pass  # Another publisher has already removed this generation.
    with _OWNERS:
        pending = _PENDING.setdefault((source,cache), set())
        pending.update(directories)
        pending.discard(keep)
    _collect((source,cache))


def _retire(index):
    index._retired = True
    return index if index._users == 0 else None


def close_cache():
    with _OWNERS:
        _OWNERS.wait_for(lambda: not _BUILDING)
        closing = [old for index in _CACHE.values() if (old := _retire(index)) is not None]
        _CACHE.clear()
    for index in closing:
        index.close()


@contextmanager
def borrow(source, cache):
    from .grid_display import GridDisplayIndex, fingerprint

    source, cache = Path(source).resolve(), Path(cache).resolve()
    key = source, cache
    with _OWNERS:
        _OWNERS.wait_for(lambda: key not in _BUILDING and key not in _REMOVING)
        _BUILDING.add(key)
    closing = []
    try:
        revision = fingerprint(source)
        with _OWNERS:
            index = _CACHE.get(key)
            if index is not None and index.fingerprint != revision:
                _CACHE.pop(key)
                old = _retire(index)
                if old is not None:
                    closing.append(old)
                index = None
        for old in closing:
            old.close()
        closing.clear()
        if index is None:
            index = GridDisplayIndex(source, cache, revision)
        with _OWNERS:
            _CACHE[key] = index
            _CACHE.move_to_end(key)
            index._users += 1
            if len(_CACHE) > 4:
                _, evicted = _CACHE.popitem(last=False)
                old = _retire(evicted)
                if old is not None:
                    closing.append(old)
    finally:
        with _OWNERS:
            _BUILDING.remove(key)
            _OWNERS.notify_all()
    try:
        for old in closing:
            old.close()
        yield index
    finally:
        with _OWNERS:
            index._users -= 1
            close = index._retired and index._users == 0
        if close:
            index.close()


@contextmanager
def removing(source, cache):
    """Drain local readers and builders before a resource's files are deleted."""
    source, cache = Path(source).resolve(), Path(cache).resolve()
    key = source, cache
    with _OWNERS:
        _OWNERS.wait_for(lambda: key not in _REMOVING)
        _REMOVING.add(key)
    try:
        with _OWNERS:
            _OWNERS.wait_for(lambda: key not in _BUILDING)
            index = _CACHE.pop(key, None)
            close = _retire(index) if index is not None else None
        if close is not None:
            close.close()
        with _OWNERS:
            _OWNERS.wait_for(lambda: key not in _COLLECTING and not any(
                index.source == source and index.directory.parent == cache for index in _OPEN))
        prune(source, cache)
        yield
    finally:
        with _OWNERS:
            _REMOVING.remove(key)
            _OWNERS.notify_all()
