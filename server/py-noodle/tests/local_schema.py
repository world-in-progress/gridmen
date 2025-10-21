import sys
import logging
from pathlib import Path

test_module_path = Path.cwd()
sys.path.insert(0, str(test_module_path))

from tests.icrms.ischema import ISchema
from pynoodle import noodle, NOODLE_INIT, NOODLE_TERMINATE

logging.basicConfig(level=logging.INFO)

# 使用本地节点而不是远程节点
# NODE_KEY = 'root.schema'
NODE_KEY = 'http://127.0.0.1:8002::schemaSet'

if __name__ == '__main__':
    NOODLE_INIT()
    
    print('\n----- Mount nodes ------\n')
    
    # Mount local node: root
    noodle.mount('root')
    
    # Mount node: root.schema
    if NODE_KEY == 'root.schema':
        noodle.mount(NODE_KEY, 'schema')
    
    print('\n----- Access node ------\n')
    
    # Connect to local node root.schema
    with noodle.connect(ISchema, NODE_KEY, 'pw') as schema:
        # 更新schema信息
        schema.update_info({
            "name": "test_schema",
            "epsg": 3857,
            "starred": True,
            "description": "A test schema for grid system",
            "base_point": [116.3975, 39.9085],  # 北京的经纬度
            "grid_info": [[100.0, 100.0], [50.0, 50.0], [25.0, 25.0]]
        })
        print("Schema info updated")

    with noodle.connect(ISchema, NODE_KEY, 'lr') as schema:
        # 获取schema信息
        print("EPSG:", schema.get_epsg())
        print("Alignment point:", schema.get_alignment_point())
        print("Level resolutions:", schema.get_level_resolutions())

    print('\n----- Adjust rules ------\n')
    
    with noodle.connect(ISchema, NODE_KEY, 'pw') as schema:
        # 调整网格规则
        result = schema.adjust_rules({
            "grid_info": [[200.0, 200.0], [100.0, 100.0], [50.0, 50.0]]
        })
        print("Adjust rules result:", result)
        
    with noodle.connect(ISchema, NODE_KEY, 'lr') as schema:
        print("Updated level resolutions:", schema.get_level_resolutions())
    
    print('\n----- Link to node and access ------\n')
    
    lock_id = noodle.link(ISchema, NODE_KEY, 'w')
    schema = noodle.access(ISchema, NODE_KEY, lock_id)
    
    print("EPSG:", schema.get_epsg())
    print("Alignment point:", schema.get_alignment_point())
    schema.update_info({"description": "Updated description"})
    print("Description updated")
    
    noodle.unlink(NODE_KEY, lock_id)
    
    print('\n----- Link to node and use context manager ------\n')
    
    lock_id = noodle.link(ISchema, NODE_KEY, 'w')
    
    with noodle.connect(ISchema, NODE_KEY, 'lw', lock_id=lock_id) as schema:
        print("EPSG:", schema.get_epsg())
        result = schema.adjust_rules({
            "grid_info": [[150.0, 150.0], [75.0, 75.0], [37.5, 37.5]]
        })
        print("Adjust rules result:", result)
        print("Updated level resolutions:", schema.get_level_resolutions())
    
    noodle.unlink(NODE_KEY, lock_id)

    if NODE_KEY == 'root.schema':
        print('\n----- Unmount nodes ------\n')
        
        noodle.unmount('root.schema')
        noodle.unmount('root')
    
    NOODLE_TERMINATE()