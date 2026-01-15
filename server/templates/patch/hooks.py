import os
import json
import tarfile
from pathlib import Path
from pynoodle import noodle

def MOUNT(node_key: str, params: dict | None):
    # Use the full node path structure relative to 'resource'
    # e.g. '.123.patch1' -> 'resource/123/patch1'
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_dir = Path.cwd() / 'resource' / rel_path
    resource_dir.mkdir(parents=True, exist_ok=True)
    
    meta_file = resource_dir / 'patch.meta.json'
    schema_node_key = params.get('schema_node_key') if params else None
    schema_data = None

    if schema_node_key:
        schema_rel_path = schema_node_key.strip('.').replace('.', os.sep)
        schema_file = Path.cwd() / 'resource' / schema_rel_path / 'schema.json'
        if schema_file.exists():
            with open(schema_file) as f:
                schema_data = json.load(f)
        else:
            raise FileNotFoundError(f'Schema file not found at {schema_file}')
    else:
        raise ValueError(f'Schema node key is required for Patch ({node_key}) mounting.')

    if not meta_file.exists():
        patch_name = node_key.split('.')[-1]
        patch_bounds = params.get('bounds') if params else None

        patch_meta = {
            'name': patch_name,
            'bounds': patch_bounds,  # default bounds
            'schema': schema_data
        }

        with open(meta_file, 'w') as f:
            json.dump(patch_meta, f, indent=4)

def UNMOUNT(node_key: str) -> None:
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_space = Path.cwd() / 'resource' / rel_path
    if resource_space.exists():
        resource_space.unlink()
        
    # Remove the directory if empty
    parent_dir = resource_space.parent
    if parent_dir.exists() and not any(parent_dir.iterdir()):
        parent_dir.rmdir()

def PRIVATIZATION(node_key: str, mount_params: dict | None) -> dict | None:
    try:
        rel_path = node_key.strip('.').replace('.', os.sep)
        resource_dir = Path.cwd() / 'resource' / rel_path
        
        launch_params = {
            'resource_space': str(resource_dir),
        }
        
        return launch_params
        
    except Exception as e:
        raise Exception(f"Error generating privatized parameters for node {node_key}: {e}")

def PACK(node_key: str, tar_path: str) -> tuple[str, int]:
    try:
        node_record = noodle._load_node_record(node_key, is_cascade=False)
        launch_params = json.loads(node_record.launch_params)
        resource_space = launch_params.get('resource_space')
        resource_path = Path(resource_space)
        
        with tarfile.open(tar_path, 'w:gz') as tarf:
            if resource_path.is_dir():
                for file_path in resource_path.rglob('*'):
                    if file_path.is_file():
                        arcname = file_path.relative_to(resource_path)
                        tarf.add(file_path, arcname=arcname)
            elif resource_path.is_file():
                tarf.add(resource_path, arcname=resource_path.name)
        
        file_size = Path(tar_path).stat().st_size
        return str(tar_path), file_size
    except Exception as e:
        raise Exception(f"Error packing node {node_key}: {e}")

def UNPACK(target_node_key: str, tar_path: str, template_name: str) -> None:
    try:
        node_record = noodle._load_node_record(target_node_key, is_cascade=False)
        launch_params = json.loads(node_record.launch_params)
        resource_space = launch_params.get('resource_space')
        dest_path = Path(resource_space)
        dest_path.mkdir(parents=True, exist_ok=True)
        
        with tarfile.open(tar_path, 'r:gz') as tarf:
            tarf.extractall(path=dest_path)
    except Exception as e:
        raise Exception(f"Error unpacking node {target_node_key}: {e}")
