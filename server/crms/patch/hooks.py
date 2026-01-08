import os
import json
import sys
import tarfile
from pathlib import Path

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'py-noodle', 'src'))
from pynoodle.noodle import noodle

def MOUNT(node_key: str, params: dict | None) -> dict | None:
    """
    Mount a patch node.
    """
    # Use the full node path structure relative to 'resource'
    # e.g. ".123.patch1" -> "resource/123/patch1"
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_dir = Path.cwd() / 'resource' / rel_path
    resource_dir.mkdir(parents=True, exist_ok=True)
    
    meta_file = resource_dir / 'patch.meta.json'

    schema_node_key = params.get('schema_node_key') if params else None
    schema_file = None
    schema_data = None

    if schema_node_key:
        try:
            schema_rel_path = schema_node_key.strip('.').replace('.', os.sep)
            schema_file = Path.cwd() / 'resource' / schema_rel_path / 'schema.json'
            if schema_file.exists():
                with open(schema_file) as f:
                    schema_data = json.load(f)
            else:
                print(f"Warning: Schema file {schema_file} does not exist")
                schema_file = None
        except Exception as e:
            print(f"Warning: Could not load schema from {schema_node_key}: {e}")
            schema_file = None
    else:
        print("No schema node key provided, using default schema values.")

    if not meta_file.exists():
        patch_name = node_key.split('.')[-1]
        patch_bounds = params.get('bounds') if params else None

        patch_meta = {
            'name': patch_name,
            'bounds': patch_bounds,  # Default bounds
            'schema': schema_data
        }

        with open(meta_file, 'w') as f:
            json.dump(patch_meta, f, indent=4)
    
    if not schema_file:
        schema_file = str(Path.cwd() / 'resource' / 'default_schema' / 'schema.json')
    
    return {
        'resource_space': str(resource_dir),
        'schema_file': schema_file
    }

def UNMOUNT(node_key: str) -> None:
    """
    Unmount a patch node.
    """
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_dir = Path.cwd() / 'resource' / rel_path
    # In a real environment, we might want to keep the data or delete it
    # For consistency with other hooks shown, we'll skip aggressive deletion 
    # unless it's strictly required.
    pass

def PRIVATIZATION(node_key: str, mount_params: dict | None) -> dict | None:
    """
    Generate node-specific launch parameters for the patch resource node.
    """
    try:
        rel_path = node_key.strip('.').replace('.', os.sep)
        resource_dir = Path.cwd() / 'resource' / rel_path
        resource_dir.mkdir(parents=True, exist_ok=True)
        
        launch_params = {
            'resource_space': str(resource_dir),
        }
        
        if mount_params and isinstance(mount_params, dict):
            launch_params.update(mount_params)
        
        return launch_params
        
    except Exception as e:
        raise Exception(f"Error generating privatized parameters for node {node_key}: {e}")

def PACK(node_key: str, tar_path: str) -> tuple[str, int]:
    """
    Pack patch node data into a tar.gz file.
    """
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
    """
    Unpack patch node data from a tar.gz file.
    """
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
