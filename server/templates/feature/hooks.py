import os
import json
import sys
import shutil
import tarfile
from pathlib import Path
from pynoodle import noodle

def PRIVATIZATION(node_key: str, mount_params: dict | None) -> dict | None:
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_dir = Path.cwd() / 'resource' / rel_path
    
    name: str = mount_params.get('name', None)
    type: str = mount_params.get('type', None)
    epsg: str = mount_params.get('epsg', None)
    color: str = mount_params.get('color', None)
    
    if name is None or type is None or epsg is None or color is None:
        raise ValueError(f'Missing required mount parameters for Feature ({node_key}).')
    
    return {
        'name': name,
        'type': type,
        'epsg': epsg,
        'color': color,
        'workspace': str(resource_dir)
    }

def MOUNT(node_key: str, params: dict | None):
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_dir = Path.cwd() / 'resource' / rel_path
    resource_dir.mkdir(parents=True, exist_ok=True)
    
def UNMOUNT(node_key: str) -> None:
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_dir = Path.cwd() / 'resource' / rel_path
    if resource_dir.exists():
        shutil.rmtree(resource_dir)

def PACK(node_key: str, dest_path: str) -> tuple[str, int]:
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_dir = Path.cwd() / 'resource' / rel_path
    
    with tarfile.open(dest_path, 'w:gz') as tar:
        tar.add(resource_dir, arcname='.')
    
    return dest_path, os.path.getsize(dest_path)

def UNPACK(target_node_key: str, tar_path: str, template_name: str) -> None:
    node_record = noodle._load_node_record(target_node_key, is_cascade=False)
    launch_params = json.loads(node_record.launch_params)
    resource_space = launch_params.get('workspace')
    dest_path = Path(resource_space)
    dest_path.mkdir(parents=True, exist_ok=True)
    
    with tarfile.open(tar_path, 'r:gz') as tar:
        tar.extractall(path=dest_path)