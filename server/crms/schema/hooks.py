import os
import sys
import json
import tarfile
from pathlib import Path
from datetime import datetime

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', 'py-noodle', 'src'))
from pynoodle.noodle import noodle

def MOUNT(node_key: str, mount_params: dict | None) -> dict | None:
        resource_path = '/'.join(node_key.split('.'))
        grid_schema_path = Path(Path.cwd(),'resource', resource_path, 'schema.json')
        if not grid_schema_path.exists():
            grid_schema_path.parent.mkdir(parents=True, exist_ok=True)
            with open(grid_schema_path, 'w') as f:
                f.write(json.dumps(mount_params, indent=4))
        return {
            'resource_space': str(grid_schema_path)
        }      
def UNMOUNT(node_key: str, params: dict | None) -> None:
    "Unmount hook for schema resource"
    resource_path = '/'.join(node_key.split('.'))
    resource_space = Path(Path.cwd(),'resource', resource_path, 'schema.json')
    if resource_space.exists():
        resource_space.unlink()
    
    #Remove the directory if it's empty
    parent_dir = resource_space.parent
    if parent_dir.exists() and not any(parent_dir.iterdir()):
        parent_dir.rmdir()

def PRIVATIZATION(node_key: str, mount_params: dict | None) -> dict | None:
    try:
        # Extract node name from node_key (last part after splitting by '.')
        node_name = '/'.join(node_key.split('.'))
        resource_space = Path(Path.cwd(),'resource', node_name, 'schema.json')
        
        # Ensure the directory exists
        resource_space.parent.mkdir(parents=True, exist_ok=True)
        
        # Create default launch parameters
        launch_params = {
            'resource_space': str(resource_space)
        }
                
        return launch_params
        
    except Exception as e:
        # In a real implementation, you might want to log this error
        raise Exception(f"Error generating privatized parameters for node {node_key}: {e}")

def PACK(node_key: str, tar_path: str) -> tuple[str, int]:
    try:
        node_record = noodle._load_node_record(node_key, is_cascade=False)
        launch_params_str = node_record.launch_params
        launch_params = json.loads(launch_params_str)
        target_resource_path = launch_params.get('resource_space')
        resource_path = Path(target_resource_path)
        
        with tarfile.open(tar_path, 'w:gz') as tarf:
            if resource_path.is_file():
                # If it's a single file, add it directly
                tarf.add(resource_path, arcname=resource_path.name)
            elif resource_path.is_dir():
                # If it's a directory, add all files recursively
                for file_path in resource_path.rglob('*'):
                    if file_path.is_file():
                        arcname = file_path.relative_to(resource_path.parent)
                        tarf.add(file_path, arcname=arcname)
        
        file_size = Path(tar_path).stat().st_size

        return str(tar_path), file_size
        
    except Exception as e:
        raise Exception(f"Error packing node {node_key}: {e}")
def UNPACK(target_node_key: str, tar_path: str, template_name: str, mount_params: dict) -> None:
    try:
        node_record = noodle._load_node_record(target_node_key, False)
        if node_record is None:
            raise Exception(f"Node {target_node_key} not found in local resource tree")
        
        launch_params_str = node_record.launch_params
        launch_params = json.loads(launch_params_str) if launch_params_str else {}
        target_node_path = launch_params.get('resource_space')
    
        Path(target_node_path).mkdir(parents=True, exist_ok=True)

        with tarfile.open(tar_path, 'r:gz') as tarf:
            target_path = Path(target_node_path)
            if target_path.exists() and target_path.is_dir():
                for item in target_path.iterdir():
                    if item.is_file():
                        item.unlink()
                    elif item.is_dir():
                        import shutil
                        shutil.rmtree(item)
            
            tarf.extractall(target_node_path)
        
        noodle.mount(target_node_key, node_template_name=template_name, mount_params=mount_params)
    except Exception as e:
        raise Exception(f"Error unpacking node {target_node_key}: {e}")