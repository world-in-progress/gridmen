import json
from pathlib import Path

def MOUNT(node_key: str, params: dict | None) -> dict | None:
    "Mount hook for schema resource"
    name = node_key.split('.')[-1]
    # 修复路径，使其指向正确的目录
    resource_space = Path.cwd() / 'resource' / 'topo' / 'schemas' / name / 'schema.json'
    if not resource_space.exists():
        resource_space.parent.mkdir(parents=True, exist_ok=True)
        #创建默认的schema文件
        default_schema = {
            "name": name,
            "epsg": 4326,
            "alignment_origin": [0, 0],
            "grid_info": []
        }
        with resource_space.open('w') as f:
            json.dump(default_schema, f)
    return {
        'resource_space': str(resource_space),
    }

def UNMOUNT(node_key: str, params: dict | None) -> None:
    "Unmount hook for schema resource"
    name = node_key.split('.')[-1]
    # 修复路径，使其指向正确的目录
    resource_space = Path.cwd() / 'resource' / 'topo' / 'schemas' / name / 'schema.json'
    if resource_space.exists():
        resource_space.unlink()
    
    #Remove the directory if it's empty
    parent_dir = resource_space.parent
    if parent_dir.exists() and not any(parent_dir.iterdir()): #判断目录是否为空
        parent_dir.rmdir()