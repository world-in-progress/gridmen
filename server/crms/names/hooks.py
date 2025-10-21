from pathlib import Path

def MOUNT(node_key: str, params: dict | None) -> dict | None:
    name = node_key.split('.')[-1]
    # 修复路径以匹配项目结构
    resource_space = Path.cwd() / 'resource' / 'topo' / 'schemas' / name / 'names.json'
    if not resource_space.exists():
        resource_space.parent.mkdir(parents=True, exist_ok=True)
        with open(resource_space, 'w') as f:
            f.write('{"names": []}')
    
    return {
        'resource_space': str(resource_space)
    }

def UNMOUNT(node_key: str) -> None:
    name = node_key.split('.')[-1]
    # 修复路径以匹配项目结构
    resource_space = Path.cwd() / 'resource' / 'topo' / 'schemas' / name / 'names.json'
    if resource_space.exists():
        resource_space.unlink()
        
    # Remove the directory if empty
    parent_dir = resource_space.parent
    if parent_dir.exists() and not any(parent_dir.iterdir()):
        parent_dir.rmdir()