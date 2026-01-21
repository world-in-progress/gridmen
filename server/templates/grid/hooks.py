import gc
import os
import re
import time
import math
import json
import copy
import struct
import shutil
import tarfile
import logging
import rasterio
import numpy as np
import multiprocessing as mp

from typing import List
from pathlib import Path
from enum import IntEnum
from typing import Callable
from pynoodle import noodle
from crms.patch import Patch
from functools import partial
from pyproj import Transformer
from dataclasses import dataclass
from rasterio.warp import transform
from crms.grid import HydroElements, HydroSides

logger = logging.getLogger(__name__)

# --- Lifecycle Hooks ---

def MOUNT(node_key: str, params: dict | None = None):
    """
    Mounts a Grid resource.
    
    If 'assembly' params are provided, it performs the grid assembly (compilation).

        If 'vector' params are provided, it handles vector data processing.
    Both can be present simultaneously.
    Otherwise, it treats it as mounting an existing grid resource.
    """
    rel_path = node_key.strip('.').replace('.', os.sep)
    # Correctly align with where resources should be mounted.
    # Assuming standard pynoodle structure: <project_root>/resource/<rel_path>
    resource_dir = Path.cwd() / 'resource' / rel_path
    resource_dir.mkdir(parents=True, exist_ok=True)
    
    if not params:
        _create_default_meta_if_not_exists(resource_dir)
        return
    
    # Handle assembly if present
    if 'assembly' in params:
        _handle_assembly(params['assembly'], node_key, resource_dir)
    
    # Handle vector if present
    if 'vector' in params:
        _handle_vector_modification(params['vector'], resource_dir)
    
    # Update the meta file to include vector parameters if they exist
    if 'vector' in params:
        _update_meta_with_vector_params(params['vector'], resource_dir)

# ===== Grid Mount Handlers =====
def _handle_assembly(assembly_params: dict, node_key: str, resource_dir: Path):
    """处理网格装配逻辑"""
    schema_node_key = assembly_params.get('schema_node_key')
    patch_node_keys = assembly_params.get('patch_node_keys')
    grading_threshold = -1
    dem_path = assembly_params.get('dem_path')
    lum_path = assembly_params.get('lum_path')
    meta_path = resource_dir / 'grid.meta.json'

    if not schema_node_key or not patch_node_keys:
        raise ValueError("Assembly requires 'schema_node_key' and 'patch_node_keys'.")

    print(f"Starting assembly for grid: {node_key}")
    try:
        meta_info = assembly(resource_dir, schema_node_key, patch_node_keys, grading_threshold, dem_path, lum_path)
        ne = HydroElements(str(resource_dir / 'cell_topo.bin'))
        ns = HydroSides(str(resource_dir / 'edge_topo.bin'))
        ne.export_ne(str(resource_dir / 'ne.txt'))
        ns.export_ns(str(resource_dir / 'ns.txt'))

        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(meta_info, f, indent=4)
    except Exception as e:
        logger.error(f"Error during assembly for {node_key}: {e}")
        raise

def _handle_vector_modification(vector_params: dict, resource_dir: Path):
    """处理矢量数据修改逻辑"""
    # Load existing NE and NS files
    ne_path = resource_dir / 'ne.txt'
    ns_path = resource_dir / 'ns.txt'
    
    print(f"[DEBUG] Checking vector modification paths: ne_path={ne_path}, ns_path={ns_path}")
    print(f"[DEBUG] ne_path exists: {ne_path.exists()}, ns_path exists: {ns_path.exists()}")
    
    if not (ne_path.exists() and ns_path.exists()):
        logger.warning(f"NE or NS files not found at {resource_dir}. Skipping vector modification.")
        return
    
    try:
        print(f"[DEBUG] Loading existing NE and NS files for vector modification: {ne_path}, {ns_path}")
        logger.info(f"Loading existing NE and NS files for vector modification: {ne_path}, {ns_path}")
        
        # Load the existing data
        print(f"[DEBUG] Calling get_ne({ne_path})")
        ne_data = get_ne(ne_path)
        print(f"[DEBUG] get_ne() completed successfully")
        
        print(f"[DEBUG] Calling get_ns({ns_path})")
        ns_data = get_ns(ns_path)
        print(f"[DEBUG] get_ns() completed successfully")
        
        # Prepare model data dictionary
        model_data = {
            'ne': ne_data,
            'ns': ns_data
        }
        
        # Apply vector modifications
        modified_model_data = apply_vector_modification(vector_params, model_data)
        
        # Extract modified data
        modified_ne_data = modified_model_data['ne']
        modified_ns_data = modified_model_data['ns']
        
        # Write the modified data back to files
        write_ne(ne_path, modified_ne_data)
        write_ns(ns_path, modified_ns_data)
        
        logger.info(f"Successfully applied vector modifications and updated NE and NS files.")
    except Exception as e:
        logger.error(f"Error during vector modification: {e}")
        raise

def _update_meta_with_vector_params(vector_params: dict, resource_dir: Path):
    """更新元数据文件以包含矢量参数"""
    meta_path = resource_dir / 'grid.meta.json'
    if not meta_path.exists():
        return
        
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta_info = json.load(f)
        
        # Merge vector params into existing meta info
        if 'vector' not in meta_info:
            meta_info['vector'] = {}
        meta_info['vector'].update(vector_params)
        
        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(meta_info, f, indent=4)
            logger.info(f"Updated grid.meta.json with vector parameters.")
    except Exception as e:
        logger.error(f"Error updating meta file with vector params: {e}")
        raise

def _create_default_meta_if_not_exists(resource_dir: Path):
    """如果不存在则创建默认元数据文件"""
    meta_path = resource_dir / 'grid.meta.json'
    if not meta_path.exists():
        default_meta = {
            'epsg': 4326,
            'bounds': [0.0, 0.0, 0.0, 0.0],
            'grid_info': [],
            'level_info': [],
            'subdivide_rules': [],
            'alignment_origin': [0.0, 0.0],
            'description': 'Initialized empty grid resource'
        }
        try:
            with open(meta_path, 'w', encoding='utf-8') as f:
                json.dump(default_meta, f, indent=4)
            print(f"Created default grid.meta.json at {meta_path}")
        except Exception as e:
            print(f"Warning: Failed to create default grid.meta.json: {e}")
            raise

def UNMOUNT(node_key: str):
    """
    Unmounts a Grid resource by removing its directory.
    """
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_dir = Path.cwd() / 'resource' / rel_path
    
    if resource_dir.exists():
        try:
            shutil.rmtree(resource_dir)
            print(f"Grid resource at {resource_dir} unmounted and removed.")
        except Exception as e:
            print(f"Error unmounting grid {node_key}: {e}")

def PRIVATIZATION(node_key: str, mount_params: dict | None = None) -> dict:
    """
    Generates launch parameters for the Grid resource.
    """
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_dir = Path.cwd() / 'resource' / rel_path
    
    # Ensure parent structure exists, though MOUNT handles specific dir creation
    resource_dir.parent.mkdir(parents=True, exist_ok=True)
    
    return {
        'resource_space': str(resource_dir)
    }

def PACK(node_key: str, output_path: str) -> tuple[str, int]:
    """
    Packs the Grid resource directory into a .tar.gz file.
    """
    try:
        # Load node record to get resource path
        node_record = noodle._load_node_record(node_key, is_cascade=False)
        launch_params = json.loads(node_record.launch_params)
        resource_space = launch_params.get('resource_space')
        
        if not resource_space:
             # Fallback if launch params missing
            rel_path = node_key.strip('.').replace('.', os.sep)
            resource_space = str(Path.cwd() / 'resource' / rel_path)

        resource_path = Path(resource_space)
        if not resource_path.exists():
             raise FileNotFoundError(f"Resource path {resource_path} does not exist for packing.")

        with tarfile.open(output_path, 'w:gz') as tar:
             tar.add(resource_path, arcname='.')
        
        file_size = os.path.getsize(output_path)
        return output_path, file_size
        
    except Exception as e:
        raise Exception(f"Error packing Grid node {node_key}: {e}")

def UNPACK(target_node_key: str, tar_path: str):
    """
    Unpacks a Grid resource from a .tar.gz file into its workspace.
    """
    try:
        node_record = noodle._load_node_record(target_node_key, is_cascade=False)
        launch_params = json.loads(node_record.launch_params)
        resource_space = launch_params.get('resource_space')
        
        if not resource_space:
            rel_path = target_node_key.strip('.').replace('.', os.sep)
            resource_space = str(Path.cwd() / 'resource' / rel_path)
            
        dest_path = Path(resource_space)
        dest_path.mkdir(parents=True, exist_ok=True)
        
        with tarfile.open(tar_path, 'r:gz') as tar:
            tar.extractall(path=dest_path)
            
    except Exception as e:
        raise Exception(f"Error unpacking Grid node {target_node_key}: {e}")

# --- Define Constants and Enums locally or import if shared ---
EDGE_CODE_INVALID = -1
class EdgeCode(IntEnum):
    NORTH = 0b00  # 0
    WEST  = 0b01  # 1
    SOUTH = 0b10  # 2
    EAST  = 0b11  # 3
    
TOGGLE_EDGE_CODE_MAP = {
    EdgeCode.NORTH: EdgeCode.SOUTH,
    EdgeCode.WEST: EdgeCode.EAST,
    EdgeCode.SOUTH: EdgeCode.NORTH,
    EdgeCode.EAST: EdgeCode.WEST
}

ADJACENT_CHECK_NORTH = lambda local_id, sub_width, sub_height: local_id < sub_width
ADJACENT_CHECK_EAST = lambda local_id, sub_width, sub_height: local_id % sub_width == 0
ADJACENT_CHECK_WEST = lambda local_id, sub_width, sub_height: local_id % sub_width == sub_width - 1
ADJACENT_CHECK_SOUTH = lambda local_id, sub_width, sub_height: local_id >= sub_width * (sub_height - 1)

class GridCache:
    class _ArrayView:
        def __init__(self, parent: 'GridCache'):
            self._parent = parent
        
        def __getitem__(self, index: int) -> tuple[int, int]:
            if index < 0 or index >= len(self):
                raise IndexError('Index out of bounds')
            return self._parent._decode_at_index(index)

        def __len__(self) -> int:
            return self._parent._len
            
        def __iter__(self):
            for i in range(len(self)):
                yield self[i]

    def __init__(self, data: bytes):
        if len(data) % 9 != 0:
            raise ValueError('Data must be a multiple of 9 bytes long')
        self.data = data
        self._len = len(self.data) // 9
        
        self.array = self._ArrayView(self)
        self.map = {index : i for i, index in enumerate(self.array)}

        self.fract_coords: list[tuple[list[int], list[int], list[int], list[int]]] = []

        self.edges: list[list[set[int]]] = [[set() for _ in range(4)] for _ in range(self._len)]
        self.neighbours: list[list[set[int]]] = [[set() for _ in range(4)] for _ in range(self._len)]

    def __len__(self) -> int:
        return self._len
    
    def __repr__(self) -> str:
        return f'<GridBytes with {self._len} items>'
    
    def _decode_at_index(self, index: int) -> tuple[int, int]:
        start = index * 9
        subdata = self.data[start : start + 9]
        return struct.unpack('!BQ', subdata)

    def has_cell(self, level: int, global_id: int) -> bool:
        return (level, global_id) in self.map

    def slice_cells(self, start_index: int, length: int) -> bytes:
        if start_index < 0 or start_index > self._len:
            raise IndexError('Index out of bounds')
        start = start_index * 9
        end = min(start + length * 9, self._len * 9)
        return self.data[start:end]
    
    def slice_edges(self, start_index: int, length: int) -> bytes:
        if start_index < 0 or start_index > self._len:
            raise IndexError('Index out of bounds')
        end_index = min(start_index + length, self._len)
        return self.edges[start_index : end_index]

def _encode_cell_key(level: int, global_id: int) -> bytes:
    return struct.pack('!BQ', level, global_id)

def _decode_cell_key(key: bytes) -> tuple[int, int]:
    return struct.unpack('!BQ', key)

def _get_bounds(patch_paths: list[str]) -> list[float]:
    inf, neg_inf = float('inf'), float('-inf')
    bounds = [inf, inf, neg_inf, neg_inf]   #min_x, min_y, max_x, max_y
    
    found_any = False
    for patch_path in patch_paths:
        path = Path(patch_path)
        # Handle cases where input is either the folder or the meta file itself
        if path.is_file() and path.name == 'patch.meta.json':
            meta_path = path
        else:
            meta_path = path / 'patch.meta.json'
            
        if meta_path.exists():
            try:
                patch_meta = json.load(open(meta_path, 'r', encoding='utf-8'))
                patch_bounds = patch_meta.get('bounds')
                if patch_bounds:
                    bounds[0] = min(bounds[0], patch_bounds[0])
                    bounds[1] = min(bounds[1], patch_bounds[1])
                    bounds[2] = max(bounds[2], patch_bounds[2])
                    bounds[3] = max(bounds[3], patch_bounds[3])
                    found_any = True
            except Exception as e:
                print(f"Warning: Failed to read patch meta from {meta_path}: {e}")

    if not found_any or any(math.isinf(x) for x in bounds):
        raise ValueError(f"Could not determine valid bounds from patches: {patch_paths}. Checked path example: {meta_path if 'meta_path' in locals() else 'N/A'}")
        
    return bounds

def _get_all_ancestor_keys(key: bytes, level_info: list[dict[str, int]], subdivide_rules: list[list[int]]) -> list[bytes]:
    ancestors: list[bytes] = []
    start_child_level, child_global_id = _decode_cell_key(key)
    for parent_level in range(start_child_level - 1, 0, -1):   # skip virtual root level 0
        rule = subdivide_rules[parent_level]
        parent_level_cols = level_info[parent_level]['width']
        child_level_cols = level_info[parent_level + 1]['width']
        
        child_gid_u = child_global_id % child_level_cols
        child_gid_v = child_global_id // child_level_cols
        parent_gid_u = child_gid_u // rule[0]
        parent_gid_v = child_gid_v // rule[1]
        parent_global_id = parent_gid_v * parent_level_cols + parent_gid_u
        
        ancestors.append(_encode_cell_key(parent_level, parent_global_id))
        child_global_id = parent_global_id
    return ancestors

def _update_cells_by_patch(
    keys: set[bytes],
    schema_file_path: str, patch_workspace: str,
    meta_bounds: list[float], meta_level_info: list[dict[str, int]]
):
    print('Updating meta grid cells by patch:', patch_workspace)
    
    # Create patch crm - Assuming Patch(resource_space) constructor or similar
    # The user code had Patch(schema_file_path, patch_workspace), adjust if Patch definition changed
    # Based on previous context, Patch might just need workspace path now if it self-loads schema
    # But let's keep the user's signature style or adapt based on recent Patch changes
    # Recent Patch.__init__ signature: def __init__(self, resource_space: str):
    
    # ADAPTATION: Use the new Patch signature
    patch = Patch(patch_workspace) # Assuming it can load schema/meta internally
    
    # Calculate bottom-left fraction in meta grid
    patch_bounds = patch.bounds
    bl_col_meta_f = (patch_bounds[0] - meta_bounds[0]) / (meta_bounds[2] - meta_bounds[0])
    bl_row_meta_f = (patch_bounds[1] - meta_bounds[1]) / (meta_bounds[3] - meta_bounds[1])
    
    # Get active grid infos from patch and update keys
    # Assuming patch.get_active_grid_infos() returns (levels, global_ids) arrays
    levels, global_ids = patch.get_activated_cell_infos()
    for level, global_id in zip(levels, global_ids):
        # Meta level info
        meta_level_cols = meta_level_info[level]['width']
        meta_level_rows = meta_level_info[level]['height']
        
        # Patch level info
        patch_level_cols = patch.level_info[level]['width']
        
        # Adjust patch global id to meta grid global id
        patch_gid_u = global_id % patch_level_cols
        patch_gid_v = global_id // patch_level_cols

        meta_gid_u = int(bl_col_meta_f * meta_level_cols + 0.5) + patch_gid_u
        meta_gid_v = int(bl_row_meta_f * meta_level_rows + 0.5) + patch_gid_v
        meta_global_id = meta_gid_v * meta_level_cols + meta_gid_u
        
        # Encode and add to keys
        cell_key = _encode_cell_key(level, meta_global_id)
        keys.add(cell_key)
     
def _get_cell_from_uv(level: int, level_cols, level_rows, u: int, v: int, meta_level_info: list[dict[str, int]]) -> tuple[int, int] | None:
    if level >= len(meta_level_info) or level < 0:
        return None
    
    if u < 0 or u >= level_cols or v < 0 or v >= level_rows:
        return None
    
    global_id = v * level_cols + u
    return level, global_id
    
def _get_toggle_edge_code(code: int) -> int:
    return TOGGLE_EDGE_CODE_MAP.get(code, EDGE_CODE_INVALID)
    
def _update_cell_neighbour(
    grid_cache: GridCache, 
    cell_level: int, cell_global_id: int, 
    neighbour_level: int, neighbour_global_id: int,
    edge_code: EdgeCode
):
    if edge_code == EDGE_CODE_INVALID:
        return
    
    grid_idx = grid_cache.map[(cell_level, cell_global_id)]
    neighbour_idx = grid_cache.map[(neighbour_level, neighbour_global_id)]
    oppo_code = _get_toggle_edge_code(edge_code)
    grid_cache.neighbours[grid_idx][edge_code].add(neighbour_idx)
    grid_cache.neighbours[neighbour_idx][oppo_code].add(grid_idx)

def _get_children_global_ids(
        level: int,
        global_id: int,
        meta_level_info: list[dict[str, int]],
        subdivide_rules: list[list[int]]
) -> list[int]:
    if (level < 0) or (level >= len(meta_level_info)):
        return []

    cols = meta_level_info[level]['width']
    global_u = global_id % cols
    global_v = global_id // cols
    sub_width = subdivide_rules[level][0]
    sub_height = subdivide_rules[level][1]
    sub_count = sub_width * sub_height
    
    sub_total_cols = cols * sub_width
    child_global_ids = [0] * sub_count
    for local_id in range(sub_count):
        local_u = local_id % sub_width
        local_v = local_id // sub_width
        
        sub_global_u = global_u * sub_width + local_u
        sub_global_v = global_v * sub_height + local_v
        child_global_ids[local_id] = sub_global_v * sub_total_cols + sub_global_u
    
    return child_global_ids

def _check_risk_along_edge(
    risk_threshold: int,
    cell_keys: set[bytes],
    subdivide_rules: list[list[int]],
    meta_level_info: list[dict[str, int]],
    cell_level: int,
    neighbour_level: int, neighbour_global_id: int,
    adjacent_check_func: Callable
) -> bool:
    """
    Check if the cell is risk along the edge with neighbour cells
    Risk cells are those cells that has lower level than a specific neighbour cell, while the level difference is greater than risk_threshold
    """
    # Check if neighbour cell is activated (whether if this cell is a leaf node)
    neighbour_key = _encode_cell_key(neighbour_level, neighbour_global_id)
    if neighbour_key in cell_keys:
        return False    # not risk because neighbour cell share a same level
    else:
        cell_stack: list[tuple[int, int]] = [(neighbour_level, neighbour_global_id)]
        
        while cell_stack:
            _level, _global_id = cell_stack.pop()
            if _level >= len(subdivide_rules):
                continue
            
            sub_width, sub_height = subdivide_rules[_level]
            children_global_ids = _get_children_global_ids(_level, _global_id, meta_level_info, subdivide_rules)
            if children_global_ids is None:
                continue
            
            for child_local_id, child_global_id in enumerate(children_global_ids):
                is_adjacent = adjacent_check_func(child_local_id, sub_width, sub_height)
                if not is_adjacent:
                    continue
                
                child_level = _level + 1
                child_key = _encode_cell_key(child_level, child_global_id)
                if child_key in cell_keys:
                    if child_level - cell_level > risk_threshold:
                        return True # risk found
                else:
                    cell_stack.append((child_level, child_global_id))
    return False
        
def _find_risk_cells(
    risk_threshold: int, cell_keys: set[bytes],
    subdivide_rules: list[list[int]], meta_level_info: list[dict[str, int]]
) -> set[bytes]:
    risk_cells: set[bytes] = set()
    
    for cell_key in cell_keys:
        level, global_id = _decode_cell_key(cell_key)
        cols = meta_level_info[level]['width']
        rows = meta_level_info[level]['height']
        
        global_u = global_id % cols
        global_v = global_id // cols
        
        # Check top edge with tCell
        t_cell = _get_cell_from_uv(level, cols, rows, global_u, global_v + 1, meta_level_info)
        if t_cell:
            if _check_risk_along_edge(risk_threshold, cell_keys, subdivide_rules, meta_level_info, level, t_cell[0], t_cell[1], ADJACENT_CHECK_NORTH):
                risk_cells.add(cell_key)
                continue
        # Check left edge with lCell
        l_cell = _get_cell_from_uv(level, cols, rows, global_u - 1, global_v, meta_level_info)
        if l_cell:
            if _check_risk_along_edge(risk_threshold, cell_keys, subdivide_rules, meta_level_info, level, l_cell[0], l_cell[1], ADJACENT_CHECK_WEST):
                risk_cells.add(cell_key)
                continue
        # Check bottom edge with bCell
        b_cell = _get_cell_from_uv(level, cols, rows, global_u, global_v - 1, meta_level_info)
        if b_cell:
            if _check_risk_along_edge(risk_threshold, cell_keys, subdivide_rules, meta_level_info, level, b_cell[0], b_cell[1], ADJACENT_CHECK_SOUTH):
                risk_cells.add(cell_key)
                continue
        # Check right edge with rCell
        r_cell = _get_cell_from_uv(level, cols, rows, global_u + 1, global_v, meta_level_info)
        if r_cell:
            if _check_risk_along_edge(risk_threshold, cell_keys, subdivide_rules, meta_level_info, level, r_cell[0], r_cell[1], ADJACENT_CHECK_EAST):
                risk_cells.add(cell_key)
                continue
    return risk_cells

def _refine_risk_cells(risk_cells: set[bytes], subdivide_rules: list[list[int]], meta_level_info: list[dict[str, int]]) -> set[bytes]:
    """
    Refine risk cells to their children cells by one level deeper
    """
    refined_cells: set[bytes] = set()
    for cell_key in risk_cells:
        level, global_id = _decode_cell_key(cell_key)
        children_global_ids = _get_children_global_ids(level, global_id, meta_level_info, subdivide_rules)
        child_level = level + 1
        for child_global_id in children_global_ids:
            child_key = _encode_cell_key(child_level, child_global_id)
            refined_cells.add(child_key)
    return refined_cells

def _find_neighbours_along_edge(
    grid_cache: GridCache,
    subdivide_rules: list[list[int]],
    meta_level_info: list[dict[str, int]],
    cell_level: int, cell_global_id: int,
    neighbour_level: int, neighbour_global_id: int,
    edge_code: EdgeCode, adjacent_check_func: Callable
):
    # Check if neighbour cell is activated (whether if this cell is a leaf node)
    if grid_cache.has_cell(neighbour_level, neighbour_global_id):
        _update_cell_neighbour(grid_cache, cell_level, cell_global_id, neighbour_level, neighbour_global_id, edge_code)
    else:
        adj_children: list[tuple[int, int]] = []
        cell_stack: list[tuple[int, int]] = [(neighbour_level, neighbour_global_id)]
        
        while cell_stack:
            _level, _global_id = cell_stack.pop()
            if _level >= len(subdivide_rules):
                continue
            
            sub_width, sub_height = subdivide_rules[_level]
            children_global_ids = _get_children_global_ids(_level, _global_id, meta_level_info, subdivide_rules)
            if children_global_ids is None:
                continue
            
            for child_local_id, child_global_id in enumerate(children_global_ids):
                is_adjacent = adjacent_check_func(child_local_id, sub_width, sub_height)
                if not is_adjacent:
                    continue
                
                child_level = _level + 1
                if grid_cache.has_cell(child_level, child_global_id):
                    adj_children.append((child_level, child_global_id))
                else:
                    cell_stack.append((child_level, child_global_id))
        
        for child_level, child_global_id in adj_children:
            _update_cell_neighbour(grid_cache, cell_level, cell_global_id, child_level, child_global_id, edge_code)
        
def _find_cell_neighbours(grid_cache: GridCache, subdivide_rules: list[list[int]], meta_level_info: list[dict[str, int]]) -> set[bytes]:
    for level, global_id in grid_cache.array:
        cols = meta_level_info[level]['width']
        rows = meta_level_info[level]['height']
        
        global_u = global_id % cols
        global_v = global_id // cols
        
        # Check top edge with tCell
        t_cell = _get_cell_from_uv(level, cols, rows, global_u, global_v + 1, meta_level_info)
        if t_cell:
            _find_neighbours_along_edge(grid_cache, subdivide_rules, meta_level_info, level, global_id, t_cell[0], t_cell[1], EdgeCode.NORTH, ADJACENT_CHECK_NORTH)
        # Check left edge with lCell
        l_cell = _get_cell_from_uv(level, cols, rows, global_u - 1, global_v, meta_level_info)
        if l_cell:
            _find_neighbours_along_edge(grid_cache, subdivide_rules, meta_level_info, level, global_id, l_cell[0], l_cell[1], EdgeCode.WEST, ADJACENT_CHECK_WEST)
        # Check bottom edge with bCell
        b_cell = _get_cell_from_uv(level, cols, rows, global_u, global_v - 1, meta_level_info)
        if b_cell:
            _find_neighbours_along_edge(grid_cache, subdivide_rules, meta_level_info, level, global_id, b_cell[0], b_cell[1], EdgeCode.SOUTH, ADJACENT_CHECK_SOUTH)
        # Check right edge with rCell
        r_cell = _get_cell_from_uv(level, cols, rows, global_u + 1, global_v, meta_level_info)
        if r_cell:
            _find_neighbours_along_edge(grid_cache, subdivide_rules, meta_level_info, level, global_id, r_cell[0], r_cell[1], EdgeCode.EAST, ADJACENT_CHECK_EAST)

def _simplify_fraction(n: int, m: int) -> list[int]:
    """Find the greatest common divisor of two numbers"""
    a, b = n, m
    while b != 0:
        a, b = b, a % b
    return [n // a, m // a]

def _get_fractional_coords(level: int, global_id: int, meta_level_info: list[dict[str, int]]) -> tuple[list[int], list[int], list[int], list[int]]:
    width = meta_level_info[level]['width']
    height = meta_level_info[level]['height']
    
    u = global_id % width
    v = global_id // width
    
    x_min_frac = _simplify_fraction(u, width)
    x_max_frac = _simplify_fraction(u + 1, width)
    y_min_frac = _simplify_fraction(v, height)
    y_max_frac = _simplify_fraction(v + 1, height)
    
    return x_min_frac, x_max_frac, y_min_frac, y_max_frac

def _get_edge_index(
    cell_key_a: int, cell_key_b: int | None, 
    direction: int, edge_range_info: list[list[int]], code_from_a: EdgeCode,
    edge_index_cache: list[bytes],
    edge_index_dict: dict[int, bytes],
    edge_adj_cell_indices: list[list[int | None]]
) -> bytes:
    if direction not in (0, 1):
        raise ValueError('Direction must be either 0 (vertical) or 1 (horizontal)')
    if not isinstance(edge_range_info, list) or len(edge_range_info) != 3:
        raise ValueError('edge_range_info must be a list of three [numerator, denominator] pairs')
    
    # Unpack the range components
    # Each is expected to be a UINT32
    min_num, min_den = edge_range_info[0]
    max_num, max_den = edge_range_info[1]
    shared_num, shared_den = edge_range_info[2]
    
    # Ensure canonical ordering for the varying range (min <= max)
    if float(min_num) / float(min_den) > float(max_num) / float(max_den):
        min_num, max_num = max_num, min_num
        min_den, max_den = max_den, min_den
    
    # Construct the edge key (25 bytes total, !BIIIIII)
    # Bit allocation:
    # aligned: 7 bit (highest)
    # direction: 1 bit
    # min_num: 32 bits
    # min_den: 32 bits
    # max_num: 32 bits
    # max_den: 32 bits
    # shared_num: 32 bits
    # shared_den: 32 bits
    # Total bits = 1 + 7 + 32 * 6 = 200 bits (25 bytes)
    edge_key = struct.pack(
        '!BIIIIII',
        1 if direction else 0,
        min_num, min_den,
        max_num, max_den,
        shared_num, shared_den
    )
    
    # Try get edge_index
    if edge_key not in edge_index_dict:
        edge_index = len(edge_index_cache)
        edge_index_dict[edge_key] = edge_index
        edge_index_cache.append(edge_key)

        cells = [cell_key_b, cell_key_a] if code_from_a == EdgeCode.NORTH or code_from_a == EdgeCode.WEST else [cell_key_a, cell_key_b]
        edge_adj_cell_indices.append(cells)
        return edge_index
    else:
        return edge_index_dict[edge_key]
   
def _add_edge_to_cell(
    grid_cache: GridCache, cell_key: int,
    edge_code: EdgeCode, edge_index: int
):
    grid_cache.edges[cell_key][edge_code].add(edge_index)

def _calc_horizontal_edges(
    grid_cache: GridCache,
    cell_index: int, level: int,
    neighbour_indices: list[int],
    edge_code: EdgeCode, op_edge_code: EdgeCode,
    shared_y_f: list[int],
    edge_index_cache: list[bytes],
    edge_index_dict: dict[int, bytes],
    edge_adj_cell_indices: list[list[int | None]]
):
    cell_x_min_f, cell_x_max_f, _, _ = grid_cache.fract_coords[cell_index]
    cell_x_min, cell_x_max = cell_x_min_f[0] / cell_x_min_f[1], cell_x_max_f[0] / cell_x_max_f[1]
    
    # Case when no neighbour ############################################################################
    if not neighbour_indices:
        edge_index = _get_edge_index(cell_index, None, 1, [cell_x_min_f, cell_x_max_f, shared_y_f], edge_code, edge_index_cache, edge_index_dict, edge_adj_cell_indices)
        _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)
        return
    
    # Case when neighbour has lower level ###############################################################
    if len(neighbour_indices) == 1 and grid_cache.array[neighbour_indices[0]][0] < level:
        edge_index = _get_edge_index(cell_index, neighbour_indices[0], 1, [cell_x_min_f, cell_x_max_f, shared_y_f], edge_code, edge_index_cache, edge_index_dict, edge_adj_cell_indices)
        _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)
        _add_edge_to_cell(grid_cache, neighbour_indices[0], op_edge_code, edge_index)
        return
    
    # Case when neighbours have equal or higher levels ##################################################
    processed_neighbours = []
    for neighbour_index in neighbour_indices:
        n_x_min_f, n_x_max_f, _, _ = grid_cache.fract_coords[neighbour_index]
        processed_neighbours.append({
            'index': neighbour_index,
            'x_min_f': n_x_min_f,
            'x_max_f': n_x_max_f,
            'x_min': n_x_min_f[0] / n_x_min_f[1],
            'x_max': n_x_max_f[0] / n_x_max_f[1],
        })
        
    # Sort neighbours by their x_min
    processed_neighbours.sort(key=lambda n: n['x_min'])

    # Calculate edge between grid xMin and first neighbour if existed
    if cell_x_min != processed_neighbours[0]['x_min']:
        edge_index = _get_edge_index(
            cell_index, None, 1,
            [cell_x_min_f, processed_neighbours[0]['x_min_f'], shared_y_f], edge_code,
            edge_index_cache, edge_index_dict, edge_adj_cell_indices
        )
        _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)
    
    # Calculate edges between neighbours
    for i in range(len(processed_neighbours) - 1):
        neighbour_from = processed_neighbours[i]
        neighbour_to = processed_neighbours[i + 1]
        
        # Calculate edge of neighbour_from
        edge_index = _get_edge_index(
            cell_index, neighbour_from['index'], 1,
            [neighbour_from['x_min_f'], neighbour_from['x_max_f'], shared_y_f], edge_code,
            edge_index_cache, edge_index_dict, edge_adj_cell_indices
        )
        _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)
        _add_edge_to_cell(grid_cache, neighbour_from['index'], op_edge_code, edge_index)
        
        # Calculate edge between neighbourFrom and neighbourTo if existed
        if neighbour_from['x_max'] != neighbour_to['x_min']:
            edge_index = _get_edge_index(
                cell_index, None, 1,
                [neighbour_from['x_max_f'], neighbour_to['x_min_f'], shared_y_f], edge_code,
                edge_index_cache, edge_index_dict, edge_adj_cell_indices
            )
            _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)
            
    # Calculate edge of last neighbour
    neighbour_last = processed_neighbours[-1]
    edge_index = _get_edge_index(
        cell_index, neighbour_last['index'], 1,
        [neighbour_last['x_min_f'], neighbour_last['x_max_f'], shared_y_f], edge_code,
        edge_index_cache, edge_index_dict, edge_adj_cell_indices
    )
    _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)
    _add_edge_to_cell(grid_cache, neighbour_last['index'], op_edge_code, edge_index)

    # Calculate edge between last neighbour and grid xMax if existed
    if cell_x_max != neighbour_last['x_max']:
        edge_index = _get_edge_index(
            cell_index, None, 1,
            [neighbour_last['x_max_f'], cell_x_max_f, shared_y_f], edge_code,
            edge_index_cache, edge_index_dict, edge_adj_cell_indices
        )
        _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)

def _calc_vertical_edges(
    grid_cache: GridCache,
    cell_index: int, level: int,
    neighbour_indices: list[int],
    edge_code: EdgeCode, op_edge_code: EdgeCode,
    shared_x_f: list[int],
    edge_index_cache: list[bytes],
    edge_index_dict: dict[int, bytes],
    edge_adj_cell_indices: list[list[int | None]]
):
    _, _, cell_y_min_f, cell_y_max_f = grid_cache.fract_coords[cell_index]
    cell_y_min, cell_y_max = cell_y_min_f[0] / cell_y_min_f[1], cell_y_max_f[0] / cell_y_max_f[1]
    
    # Case when no neighbour ############################################################################
    if not neighbour_indices:
        edge_index = _get_edge_index(cell_index, None, 0, [cell_y_min_f, cell_y_max_f, shared_x_f], edge_code, edge_index_cache, edge_index_dict, edge_adj_cell_indices)
        _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)
        return
    
    # Case when neighbour has lower level ###############################################################
    if len(neighbour_indices) == 1 and grid_cache.array[neighbour_indices[0]][0] < level:
        edge_index = _get_edge_index(cell_index, neighbour_indices[0], 0, [cell_y_min_f, cell_y_max_f, shared_x_f], edge_code, edge_index_cache, edge_index_dict, edge_adj_cell_indices)
        _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)
        _add_edge_to_cell(grid_cache, neighbour_indices[0], op_edge_code, edge_index)
        return
    
    # Case when neighbours have equal or higher levels ##################################################
    processed_neighbours = []
    for neighbour_index in neighbour_indices:
        _, _, n_y_min_f, n_y_max_f = grid_cache.fract_coords[neighbour_index]
        processed_neighbours.append({
            'index': neighbour_index,
            'y_min_f': n_y_min_f,
            'y_max_f': n_y_max_f,
            'y_min': n_y_min_f[0] / n_y_min_f[1],
            'y_max': n_y_max_f[0] / n_y_max_f[1],
        })

    # Sort neighbours by their y_min
    processed_neighbours.sort(key=lambda n: n['y_min'])

    # Calculate edge between grid yMin and first neighbour if existed
    if cell_y_min != processed_neighbours[0]['y_min']:
        edge_index = _get_edge_index(
            cell_index, None, 0,
            [cell_y_min_f, processed_neighbours[0]['y_min_f'], shared_x_f], edge_code,
            edge_index_cache, edge_index_dict, edge_adj_cell_indices
        )
        _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)
    
    # Calculate edges between neighbours
    for i in range(len(processed_neighbours) - 1):
        neighbour_from = processed_neighbours[i]
        neighbour_to = processed_neighbours[i + 1]
        
        # Calculate edge of neighbour_from
        edge_index = _get_edge_index(
            cell_index, neighbour_from['index'], 0,
            [neighbour_from['y_min_f'], neighbour_from['y_max_f'], shared_x_f], edge_code,
            edge_index_cache, edge_index_dict, edge_adj_cell_indices
        )
        _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)
        _add_edge_to_cell(grid_cache, neighbour_from['index'], op_edge_code, edge_index)
        
        # Calculate edge between neighbourFrom and neighbourTo if existed
        if neighbour_from['y_max'] != neighbour_to['y_min']:
            edge_index = _get_edge_index(
                cell_index, None, 0,
                [neighbour_from['y_max_f'], neighbour_to['y_min_f'], shared_x_f], edge_code,
                edge_index_cache, edge_index_dict, edge_adj_cell_indices
            )
            _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)
            
    # Calculate edge of last neighbour
    neighbour_last = processed_neighbours[-1]
    edge_index = _get_edge_index(
        cell_index, neighbour_last['index'], 0,
        [neighbour_last['y_min_f'], neighbour_last['y_max_f'], shared_x_f], edge_code,
        edge_index_cache, edge_index_dict, edge_adj_cell_indices
    )
    _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)
    _add_edge_to_cell(grid_cache, neighbour_last['index'], op_edge_code, edge_index)

    # Calculate edge between last neighbour and grid yMax if existed
    if cell_y_max != neighbour_last['y_max']:
        edge_index = _get_edge_index(
            cell_index, None, 0,
            [neighbour_last['y_max_f'], cell_y_max_f, shared_x_f], edge_code,
            edge_index_cache, edge_index_dict, edge_adj_cell_indices
        )
        _add_edge_to_cell(grid_cache, cell_index, edge_code, edge_index)
            
def _calc_cell_edges(
    grid_cache: GridCache,
    meta_level_info: list[dict[str, int]],
    edge_index_cache: list[bytes],
    edge_index_dict: dict[int, bytes],
    edge_adj_cell_indices: list[list[int | None]]
):
    # Pre-calculate fractional coordinates for each cell
    for level, global_id in grid_cache.array:
        grid_cache.fract_coords.append(_get_fractional_coords(level, global_id, meta_level_info))

    for grid_index, (level, global_id) in enumerate(grid_cache.array):
        neighbours = grid_cache.neighbours[grid_index]
        grid_x_min_frac, grid_x_max_frac, grid_y_min_frac, grid_y_max_frac = grid_cache.fract_coords[grid_index]
        
        north_neighbours = list(neighbours[EdgeCode.NORTH])
        _calc_horizontal_edges(grid_cache, grid_index, level, north_neighbours, EdgeCode.NORTH, EdgeCode.SOUTH, grid_y_max_frac, edge_index_cache, edge_index_dict, edge_adj_cell_indices)
        
        west_neighbours = list(neighbours[EdgeCode.WEST])
        _calc_vertical_edges(grid_cache, grid_index, level, west_neighbours, EdgeCode.WEST, EdgeCode.EAST, grid_x_min_frac, edge_index_cache, edge_index_dict, edge_adj_cell_indices)
        
        south_neighbours = list(neighbours[EdgeCode.SOUTH])
        _calc_horizontal_edges(grid_cache, grid_index, level, south_neighbours, EdgeCode.SOUTH, EdgeCode.NORTH, grid_y_min_frac, edge_index_cache, edge_index_dict, edge_adj_cell_indices)
        
        east_neighbours = list(neighbours[EdgeCode.EAST])
        _calc_vertical_edges(grid_cache, grid_index, level, east_neighbours, EdgeCode.EAST, EdgeCode.WEST, grid_x_max_frac, edge_index_cache, edge_index_dict, edge_adj_cell_indices)

def _get_cell_coordinates(level: int, global_id: int, bbox: list[float], meta_level_info: list[dict[str, int]], grid_info: list[list[float]]) -> tuple[float, float, float, float]:
    width = meta_level_info[level]['width']
    
    u = global_id % width
    v = global_id // width
    grid_width, grid_height = grid_info[level-1]
    
    min_xs = bbox[0] + u * grid_width
    min_ys = bbox[1] + v * grid_height
    max_xs = min_xs + grid_width
    max_ys = min_ys + grid_height
    return min_xs, min_ys, max_xs, max_ys

def _generate_cell_record(
    index: int, key: bytes, edges: list[set[int]], bbox: list[float],
    meta_level_info: list[dict[str, int]], grid_info: list[list[float]],
    altitude: float = -9999.0, lum_type: int = 0
) -> bytearray:
    level, global_id = struct.unpack('>BQ', key)
    min_xs, min_ys, max_xs, max_ys = _get_cell_coordinates(level, global_id, bbox, meta_level_info, grid_info)

    unpacked_info = [
        index + 1,                                                              # index (1-based)
        min_xs, min_ys, max_xs, max_ys,                                         # grid coordinates
        altitude,                                                               # altitude
        lum_type,                                                               # type
        len(edges[EdgeCode.WEST]),                                              # west edge count
        len(edges[EdgeCode.EAST]),                                              # east edge count
        len(edges[EdgeCode.SOUTH]),                                             # south edge count
        len(edges[EdgeCode.NORTH]),                                             # north edge count
        *[edge_index + 1 for edge_index in sorted(edges[EdgeCode.WEST])],       # west edge indices (1-based)
        *[edge_index + 1 for edge_index in sorted(edges[EdgeCode.EAST])],       # east edge indices (1-based)
        *[edge_index + 1 for edge_index in sorted(edges[EdgeCode.SOUTH])],      # south edge indices (1-based)
        *[edge_index + 1 for edge_index in sorted(edges[EdgeCode.NORTH])],      # north edge indices (1-based)
    ]
    
    unpacked_info_type = [
        'Q',                                    # index (uint64)
        'd', 'd', 'd', 'd',                     # cell coordinates (double)
        'd',                                    # altitude (double)
        'B',                                    # type (uint8)
        'B',                                    # west edge count (uint8)
        'B',                                    # east edge count (uint8)
        'B',                                    # south edge count (uint8)
        'B',                                    # north edge count (uint8)
        *['Q'] * len(edges[EdgeCode.WEST]),     # west edge indices (list of uint64)
        *['Q'] * len(edges[EdgeCode.EAST]),     # east edge indices (list of uint64)
        *['Q'] * len(edges[EdgeCode.SOUTH]),    # south edge indices (list of uint64)
        *['Q'] * len(edges[EdgeCode.NORTH]),    # north edge indices (list of uint64)
    ]
    
    packed_record = bytearray()
    for value, value_type in zip(unpacked_info, unpacked_info_type):
        if value_type == 'Q':  # uint64
            packed_record.extend(struct.pack('!Q', value))
        elif value_type == 'B':  # uint8
            packed_record.extend(struct.pack('!B', value))
        elif value_type == 'd':  # double
            packed_record.extend(struct.pack('!d', value))

    return packed_record

def _get_raster_value(src, x: float, y: float, src_crs: str = "EPSG:4326") -> float | None:
    try:
        # Determine if we need to transform
        target_x, target_y = x, y
        transformed = False
        
        if src_crs is not None and src.crs is not None:
             # Use rasterio CRS equality check which is robust
             try:
                 input_crs_obj = rasterio.crs.CRS.from_string(src_crs)
                 if input_crs_obj != src.crs:
                     # Calculate transform
                     # Use src.crs directly as destination
                     tx, ty = transform(input_crs_obj, src.crs, [x], [y])
                     target_x, target_y = tx[0], ty[0]
                     transformed = True
             except Exception as e:
                 print(f"[Sample Error] CRS transform failed: {e}")
                 return None
        
        # Check bounds using transformed coordinates (safety check before index)
        # Using rasterio's bounds check
        if (target_x < src.bounds.left or target_x > src.bounds.right or 
            target_y < src.bounds.bottom or target_y > src.bounds.top):
            return None

        # Get pixel coords using dataset's index method
        row, col = src.index(target_x, target_y)
        
        # specific window read
        # rasterio Window(col_off, row_off, width, height)
        window = rasterio.windows.Window(col, row, 1, 1)
        data = src.read(1, window=window)
        
        if data.size == 0:
            return None
            
        val = data[0, 0]
        
        # --- KEY FIX: Rely on np.isclose for float comparison ---
        if src.nodata is not None:
             if np.isclose(val, src.nodata):
                  return None
             if val == src.nodata:
                  return None
            
        return float(val)

    except Exception as e:
        print(f"[Sample Exception] {e}")
        return None

def _batch_cell_records_worker(
    args: tuple[bytes, list[list[set[int]]]], bbox: list[float],
    meta_level_info: list[dict[str, int]], grid_info: list[list[float]],
    dem_path: str = None, lum_path: str = None, src_crs: str = "EPSG:4326"
) -> bytearray:
    cell_data, cell_edges, offset = args

    # Open rasters
    dem_src = rasterio.open(dem_path) if dem_path and os.path.exists(dem_path) else None
    lum_src = rasterio.open(lum_path) if lum_path and os.path.exists(lum_path) else None

    records = bytearray()
    try:
        cell_count = len(cell_data) // 9 # each cell has 9 bytes (level: uint8 + global_id: uint64)
        for i in range(cell_count):
            start = i * 9
            end = start + 9
            key = cell_data[start:end]
            
            # Get edges for this cell
            edges = cell_edges[i]

            # Sample properties
            level, global_id = struct.unpack('>BQ', key)
            min_xs, min_ys, max_xs, max_ys = _get_cell_coordinates(level, global_id, bbox, meta_level_info, grid_info)
            center_x = (min_xs + max_xs) / 2.0
            center_y = (min_ys + max_ys) / 2.0
            
            altitude = -9999.0
            if dem_src:
                val = _get_raster_value(dem_src, center_x, center_y, src_crs=src_crs)
                if val is not None:
                    altitude = float(val)
            
            lum_type = 0
            if lum_src:
                val = _get_raster_value(lum_src, center_x, center_y, src_crs=src_crs)
                if val is not None:
                    lum_type = int(val)
            
            # Generate cell record
            record =  _generate_cell_record(offset + i, key, edges, bbox, meta_level_info, grid_info, altitude, lum_type)
            length_prefix = struct.pack('!I', len(record)) 
            
            records += length_prefix
            records += record
    finally:
        if dem_src: dem_src.close()
        if lum_src: lum_src.close()

    return records

def _record_cell_topology(
    grid_cache: GridCache,
    meta_bounds: list[float],
    meta_level_info: list[dict[str, int]],
    grid_info: list[list[float]],
    grid_record_path: str,
    dem_path: str = None, lum_path: str = None, src_crs: str = "EPSG:4326"
):
    batch_size = 10000
    batch_args = [
        (grid_cache.slice_cells(i, batch_size), grid_cache.slice_edges(i, batch_size), i)
        for i in range(0, len(grid_cache), batch_size)
    ]
    batch_func = partial(
        _batch_cell_records_worker,
        bbox=meta_bounds,
        meta_level_info=meta_level_info,
        grid_info=grid_info,
        dem_path=dem_path,
        lum_path=lum_path,
        src_crs=src_crs
    )
    
    num_processes = min(os.cpu_count(), len(batch_args))
    with mp.Pool(processes=num_processes) as pool:
        cell_records_list = pool.map(batch_func, batch_args)
    cell_records = bytearray()
    for cell_records_chunk in cell_records_list:
        cell_records += cell_records_chunk
    
    with open(grid_record_path, 'wb') as f:
        f.write(cell_records)

def _slice_edge_info(
    start_index: int, length: int,
    edge_index_cache: list[bytes],
    edge_adj_cell_indices: list[list[int | None]]
) -> tuple[list[bytes], list[list[int | None]]]:
    if start_index < 0 or start_index >= len(edge_index_cache):
        raise IndexError('Start index out of range')
    end_index = min(start_index + length, len(edge_index_cache))
    edge_indices = edge_index_cache[start_index:end_index]
    edge_adj_cell_indices = edge_adj_cell_indices[start_index:end_index]
    return edge_indices, edge_adj_cell_indices

def _generate_edge_record(index: int, edge_data: bytes, edge_grids: list[int | None], bbox: list[float], altitude: float = -9999.0, lum_type: int = 0) -> bytearray:
    direction, min_num, min_den, max_num, max_den, shared_num, shared_den = struct.unpack('!BIIIIII', edge_data)
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    
    if direction == 0:      # vertical edge
        x_min = bbox[0] + (shared_num / shared_den) * (bbox[2] - bbox[0])
        x_max = x_min
        y_min = bbox[1] + (min_num / min_den) * (bbox[3] - bbox[1])
        y_max = bbox[1] + (max_num / max_den) * (bbox[3] - bbox[1])
    elif direction == 1:    # horizontal edge
        x_min = bbox[0] + (min_num / min_den) * (bbox[2] - bbox[0])
        x_max = bbox[0] + (max_num / max_den) * (bbox[2] - bbox[0])
        y_min = bbox[1] + (shared_num / shared_den) * (bbox[3] - bbox[1])
        y_max = y_min
    
    return struct.pack(
        '!QBddddQQdi',  # Added di for altitude and type
        index + 1,  # index (1-based)
        direction,
        x_min, y_min, x_max, y_max,
        edge_grids[0] + 1 if edge_grids[0] is not None else 0, # cell_index_a (1-based)
        edge_grids[1] + 1 if edge_grids[1] is not None else 0,  # cell_index_b (1-based)
        altitude,
        lum_type
    )

def _batch_edge_records_worker(args: tuple[list[bytes], list[list[int | None]]], bbox: list[float], dem_path: str = None, lum_path: str = None, src_crs: str = "EPSG:4326") -> bytes:
    edge_data, edge_cells, offset = args

    # Open rasters
    dem_src = rasterio.open(dem_path) if dem_path and os.path.exists(dem_path) else None
    lum_src = rasterio.open(lum_path) if lum_path and os.path.exists(lum_path) else None

    records = bytearray()
    
    try:
        edge_count = len(edge_data)
        for i in range(edge_count):
            edge = edge_data[i]
            
            # Unpack to get coords for sampling
            direction, min_num, min_den, max_num, max_den, shared_num, shared_den = struct.unpack('!BIIIIII', edge)
            x_min, x_max, y_min, y_max = 0.0, 0.0, 0.0, 0.0
            
            if direction == 0: # vertical
                x_min = bbox[0] + (shared_num / shared_den) * (bbox[2] - bbox[0])
                x_max = x_min
                y_min = bbox[1] + (min_num / min_den) * (bbox[3] - bbox[1])
                y_max = bbox[1] + (max_num / max_den) * (bbox[3] - bbox[1])
            elif direction == 1: # horizontal
                x_min = bbox[0] + (min_num / min_den) * (bbox[2] - bbox[0])
                x_max = bbox[0] + (max_num / max_den) * (bbox[2] - bbox[0])
                y_min = bbox[1] + (shared_num / shared_den) * (bbox[3] - bbox[1])
                y_max = y_min
            
            center_x = (x_min + x_max) / 2.0
            center_y = (y_min + y_max) / 2.0

            altitude = -9999.0
            if dem_src:
                val = _get_raster_value(dem_src, center_x, center_y, src_crs=src_crs)
                if val is not None:
                    altitude = float(val)
            
            lum_type = 0
            if lum_src:
                val = _get_raster_value(lum_src, center_x, center_y, src_crs=src_crs)
                if val is not None:
                    lum_type = int(val)

            record = _generate_edge_record(offset + i, edge, edge_cells[i], bbox, altitude, lum_type)
            length_prefix = struct.pack('!I', len(record))
            
            records += length_prefix
            records += record
    finally:
        if dem_src: dem_src.close()
        if lum_src: lum_src.close()

    return records

def _record_edge_topology(
    edge_index_cache: list[bytes],
    edge_adj_cell_indices: list[list[int | None]],
    meta_bounds: list[float],
    edge_record_path: str,
    dem_path: str = None, lum_path: str = None, src_crs: str = "EPSG:4326"
):
    batch_size = 10000
    batch_args = [
        (*_slice_edge_info(i, batch_size, edge_index_cache, edge_adj_cell_indices), i)
        for i in range(0, len(edge_index_cache), batch_size)
    ]
    batch_func = partial(
        _batch_edge_records_worker,
        bbox=meta_bounds,
        dem_path=dem_path,
        lum_path=lum_path,
        src_crs=src_crs
    )
    num_processes = min(os.cpu_count(), len(batch_args))
    with mp.Pool(processes=num_processes) as pool:
        edge_records_list = pool.map(batch_func, batch_args)
    edge_records = bytearray()
    for edge_records_chunk in edge_records_list:
        edge_records += edge_records_chunk
    
    with open(edge_record_path, 'wb') as f:
        f.write(edge_records)

def assembly(resource_dir: str, schema_node_key: str, patch_node_keys: list[str], grading_threshold: int = -1, dem_path: str = None, lum_path: str = None):
    # Create workspace directory (already done by resource_dir, but for consistency with original arg)
        workspace = resource_dir

        schema_rel_path = schema_node_key.strip('.').replace('.', os.sep)
        schema_file_path = Path.cwd() / 'resource' / schema_rel_path / 'schema.json'

        patch_paths = []
        for patch_node_key in patch_node_keys:
            patch_rel_path = patch_node_key.strip('.').replace('.', os.sep)
            patch_path = Path.cwd() / 'resource' / patch_rel_path
            patch_paths.append(str(patch_path))
        
        # Init schema info
        schema_path = Path(schema_file_path)
        schema = json.load(open(schema_path, 'r', encoding='utf-8'))
        epsg: int = schema['epsg']
        grid_info: list[list[float]] = schema['grid_info']
        first_level_resolution: list[float] = grid_info[0]
        alignment_origin: list[float] = schema['alignment_origin']
        
        # Init bounds from all patches
        meta_bounds = _get_bounds(patch_paths)
        
        # Init subdivide rules
        subdivide_rules: list[list[int]] = [
            [
                int(math.ceil((meta_bounds[2] - meta_bounds[0]) / first_level_resolution[0])),
                int(math.ceil((meta_bounds[3] - meta_bounds[1]) / first_level_resolution[1]))
            ]
        ]
        for i in range(len(grid_info) - 1):
            from_resolution = grid_info[i]
            to_resolution = grid_info[i + 1]
            subdivide_rules.append([
                int(from_resolution[0] / to_resolution[0]),
                int(from_resolution[1] / to_resolution[1])
            ])
        subdivide_rules.append([1, 1])  # last level (no subdivision)
        
        # Init meta level info and first level cols/rows
        meta_level_info: list[dict[str, int]] = [{'width': 1, 'height': 1}]
        for level, rule in enumerate(subdivide_rules[:-1]):
            from_cols, from_rows = meta_level_info[level]['width'], meta_level_info[level]['height']
            meta_level_info.append({
                'width': from_cols * rule[0],
                'height': from_rows * rule[1]
            })
        
        # Find activated cells in all patches #################################################
        
        current_time = time.time()
        
        # Set activated cell key container
        # Key: uin8 level + uint64 global id
        activated_cell_keys: set[bytes] = set()
        
        # Update activated cells by each patch
        for patch_path in patch_paths:
            _update_cells_by_patch(
                activated_cell_keys,
                schema_file_path, patch_path,
                meta_bounds, meta_level_info
            )
        
        # Filter activated cells to remove conflicts
        # Conflict: if a cell is activated, all its ancestors must be deactivated
        for level in range(len(meta_level_info), 1, -1):    # from highest level to level 2 (level 1 has no parent)
            keys_at_level = [k for k in activated_cell_keys if k[0] == level]
            ancestor_keys_to_remove: set[bytes] = set()
            for key in keys_at_level:
                ancestor_keys = _get_all_ancestor_keys(key, meta_level_info, subdivide_rules)
                ancestor_keys_to_remove.update(ancestor_keys)
            # Batch remove ancestor keys from activated cells in the level
            activated_cell_keys.difference_update(ancestor_keys_to_remove)
        print(f'Activated cell calculation took {time.time() - current_time:.2f} seconds')
        
        # Grading cells by risk level #########################################################
        
        # Remove low-risk cells if grading_threshold >= 0
        if grading_threshold >= 0:
            current_time = time.time()
            while True:
                risk_cells = _find_risk_cells(grading_threshold, activated_cell_keys, subdivide_rules, meta_level_info)
                if not risk_cells:
                    break
                activated_cell_keys = _refine_risk_cells(risk_cells, meta_level_info, subdivide_rules).union(activated_cell_keys.difference(risk_cells))
            print(f'Risk cell refinement took {time.time() - current_time:.2f} seconds')
        
        # Topology construction for the grid ##################################################
        
        # Sort and concatenate activated cell keys
        keys_data = b''.join(sorted(activated_cell_keys))
        
        # Free memory
        activated_cell_keys = None
        gc.collect()
        
        # Init GridCache
        grid_cache = GridCache(keys_data)
        
        # Init edge topology containers
        edge_index_cache: list[bytes] = []
        edge_index_dict: dict[int, bytes] = {}
        edge_adj_cell_indices: list[list[int | None]] = [] # for each edge, the list of adjacent grid indices, among [grid_a, grid_b], grid_a must be the north or west grid

        # Step 1: Calculate all cell neighbours
        current_time = time.time()
        _find_cell_neighbours(grid_cache, subdivide_rules, meta_level_info)
        print(f'Cell neighbour calculation took {time.time() - current_time:.2f} seconds')

        # Step 2: Calculate all cell edges
        current_time = time.time()
        _calc_cell_edges(grid_cache, meta_level_info, edge_index_cache, edge_index_dict, edge_adj_cell_indices)
        print(f'Cell edge calculation took {time.time() - current_time:.2f} seconds')
        
        print(f'Find cells: {len(grid_cache)}')
        print(f'Find cell edges: {len(edge_index_cache)}')
        
        # Step 3: Record grid topology ########################################################
        
        # Create cell topology records
        cell_record_path = workspace / 'cell_topo.bin'
        _record_cell_topology(
            grid_cache,
            meta_bounds,
            meta_level_info,
            grid_info,
            str(cell_record_path),
            dem_path=dem_path,
            lum_path=lum_path,
            src_crs=f"EPSG:{epsg}"
        )
        
        # Create edge topology records
        edge_record_path = workspace / 'edge_topo.bin'
        _record_edge_topology(
            edge_index_cache,
            edge_adj_cell_indices,
            meta_bounds,
            str(edge_record_path),
            dem_path=dem_path,
            lum_path=lum_path,
            src_crs=f"EPSG:{epsg}"
        )
        
        # Create meta json
        meta_info = {
            'epsg': epsg,
            'bounds': meta_bounds,
            'grid_info': grid_info,
            'level_info': meta_level_info,
            'subdivide_rules': subdivide_rules,
            'alignment_origin': alignment_origin,
        }

        return meta_info

# --- 针对vector的处理算法 ---

# 全局缓存的坐标转换器
_transformer_4326_to_2326 = None

@dataclass
class NeData:
    grid_id_list: list[int]
    nsl1_list: list[int]
    nsl2_list: list[int]
    nsl3_list: list[int]
    nsl4_list: list[int]
    isl1_list: list[list[int]]
    isl2_list: list[list[int]]
    isl3_list: list[list[int]]
    isl4_list: list[list[int]]
    xe_list: list[float]
    ye_list: list[float]
    ze_list: list[float]
    under_suf_list: list[int]

@dataclass
class NsData:
    edge_id_list: list[int]
    ise_list: list[list[int]]
    dis_list: list[float]
    x_side_list: list[float]
    y_side_list: list[float]
    z_side_list: list[float]
    s_type_list: list[int]

def write_ne(ne_path: str, ne_data: NeData) -> None:
    """
    将NeData对象写入NE文件
    
    Args:
        ne_path: 输出NE文件路径
        ne_data: NeData对象
    """
    with open(ne_path, 'w', encoding='utf-8', newline='') as f:
        # 从1开始遍历，跳过初始占位元素
        for i in range(1, len(ne_data.grid_id_list)):
            # 写入网格ID
            row_parts = [str(ne_data.grid_id_list[i])]
            
            # 写入邻接信息
            row_parts.append(str(ne_data.nsl1_list[i]))
            row_parts.append(str(ne_data.nsl2_list[i]))
            row_parts.append(str(ne_data.nsl3_list[i]))
            row_parts.append(str(ne_data.nsl4_list[i]))
            
            # 写入邻接网格ID
            for j in range(ne_data.nsl1_list[i]):
                row_parts.append(str(ne_data.isl1_list[i][j+1]))
            for j in range(ne_data.nsl2_list[i]):
                row_parts.append(str(ne_data.isl2_list[i][j+1]))
            for j in range(ne_data.nsl3_list[i]):
                row_parts.append(str(ne_data.isl3_list[i][j+1]))
            for j in range(ne_data.nsl4_list[i]):
                row_parts.append(str(ne_data.isl4_list[i][j+1]))
            
            # 写入坐标和高程信息
            row_parts.append(f"{ne_data.xe_list[i]:.14g}")
            row_parts.append(f"{ne_data.ye_list[i]:.14g}")
            row_parts.append(f"{ne_data.ze_list[i]:.14g}")
            row_parts.append(f"{ne_data.under_suf_list[i]}")
            
            f.write(' '.join(row_parts) + '\n')

def write_ns(ns_path: str, ns_data: NsData) -> None:
    """
    将NsData对象写入NS文件
    
    Args:
        ns_path: 输出NS文件路径
        ns_data: NsData对象
    """
    with open(ns_path, 'w', encoding='utf-8', newline='') as f:
        # 从1开始遍历，跳过初始占位元素
        for i in range(1, len(ns_data.edge_id_list)):
            # 写入边ID
            row_parts = [str(ns_data.edge_id_list[i])]
            
            # 写入边的方向和邻接网格ID
            for j in range(len(ns_data.ise_list[i])):
                row_parts.append(str(ns_data.ise_list[i][j]))
            
            # 写入距离和坐标信息
            row_parts.append(f"{ns_data.dis_list[i]:.14g}")
            row_parts.append(f"{ns_data.x_side_list[i]:.14g}")
            row_parts.append(f"{ns_data.y_side_list[i]:.14g}")
            row_parts.append(f"{ns_data.z_side_list[i]:.14g}")
            row_parts.append(f"{ns_data.s_type_list[i]}")
            
            f.write(' '.join(row_parts) + '\n')

def get_ne(ne_path: str) -> "NeData":
    # 初始化列表（含占位符 0）
    grid_id_list: List[int] = [0]
    nsl1_list: List[int] = [0]
    nsl2_list: List[int] = [0]
    nsl3_list: List[int] = [0]
    nsl4_list: List[int] = [0]
    isl1_list: List[List[int]] = [[0]*10]
    isl2_list: List[List[int]] = [[0]*10]
    isl3_list: List[List[int]] = [[0]*10]
    isl4_list: List[List[int]] = [[0]*10]
    xe_list: List[float] = [0.0]
    ye_list: List[float] = [0.0]
    ze_list: List[float] = [0.0]
    under_suf_list: List[int] = [0]

    ne_path = str(ne_path)
    logger.info(f"Loading NE file: {ne_path}")

    try:
        with open(ne_path, 'r', encoding='utf-8-sig') as f:
            for line_idx, raw_line in enumerate(f):
                original_line = raw_line
                try:
                    stripped_line = raw_line.strip()
                    if not stripped_line:
                        continue  # 跳过空行

                    # === 关键修复：强制使用空白符分割，不再检测逗号 ===
                    # 使用 \s+ 分割任意空白（空格、制表符等），并过滤空字符串
                    row_data = [item for item in re.split(r'\s+', stripped_line) if item]
                    
                    logger.debug(f"[NE Line {line_idx+1}] Parsed {len(row_data)} fields: {row_data[:5]}{'...' if len(row_data) > 5 else ''}")

                    if len(row_data) < 5:
                        logger.warning(f"Skipping line {line_idx+1} in {ne_path}: fewer than 5 fields. Raw: {original_line.strip()}")
                        continue

                    # 解析前5个整数
                    try:
                        grid_id = int(row_data[0])
                        nsl1 = int(row_data[1])
                        nsl2 = int(row_data[2])
                        nsl3 = int(row_data[3])
                        nsl4 = int(row_data[4])
                    except ValueError as ve:
                        logger.error(f"Failed to parse integer at line {line_idx+1}. Data: {row_data[:5]}")
                        raise ValueError(f"Invalid integer in first 5 fields at line {line_idx+1}") from ve

                    # 计算所需最小字段数：5 (header) + nsl1+nsl2+nsl3+nsl4 (neighbors) + 4 (coords)
                    min_required = 5 + nsl1 + nsl2 + nsl3 + nsl4 + 4
                    if len(row_data) < min_required:
                        logger.error(f"Line {line_idx+1}: expected at least {min_required} fields, got {len(row_data)}. Data: {row_data}")
                        raise ValueError(f"Insufficient data at line {line_idx+1}")

                    # 构建邻居列表（长度至少为10，按需扩展）
                    def build_isl(nsl_val: int, start_idx: int) -> List[int]:
                        isl = [0] * max(10, nsl_val + 1)
                        for i in range(nsl_val):
                            isl[i + 1] = int(row_data[start_idx + i])
                        return isl

                    isl1 = build_isl(nsl1, 5)
                    isl2 = build_isl(nsl2, 5 + nsl1)
                    isl3 = build_isl(nsl3, 5 + nsl1 + nsl2)
                    isl4 = build_isl(nsl4, 5 + nsl1 + nsl2 + nsl3)

                    # 提取最后4个字段（坐标 + under_suf）
                    xe = float(row_data[-4])
                    ye = float(row_data[-3])
                    ze = float(row_data[-2])
                    under_suf = int(float(row_data[-1]))  # 兼容 "3.0" -> 3

                    # 添加到主列表
                    grid_id_list.append(grid_id)
                    nsl1_list.append(nsl1)
                    nsl2_list.append(nsl2)
                    nsl3_list.append(nsl3)
                    nsl4_list.append(nsl4)
                    isl1_list.append(isl1)
                    isl2_list.append(isl2)
                    isl3_list.append(isl3)
                    isl4_list.append(isl4)
                    xe_list.append(xe)
                    ye_list.append(ye)
                    ze_list.append(ze)
                    under_suf_list.append(under_suf)

                except (ValueError, IndexError) as e:
                    logger.error(f"Parsing error in NE file {ne_path} at line {line_idx+1}: {e}. Original line: {original_line.strip()}")
                    raise RuntimeError(f"Failed to parse NE file at line {line_idx+1}") from e

        ne_data = NeData(
            grid_id_list, nsl1_list, nsl2_list, nsl3_list, nsl4_list,
            isl1_list, isl2_list, isl3_list, isl4_list,
            xe_list, ye_list, ze_list, under_suf_list
        )
        return ne_data

    except Exception as e:
        logger.error(f"Failed to load NE file '{ne_path}': {e}")
        raise

def get_ns(ns_path: str) -> NsData:
    edge_id_list = [0]
    ise_list = [[0,0,0,0,0]]
    dis_list = [0.0]
    x_side_list = [0.0]
    y_side_list = [0.0]
    z_side_list = [0.0]
    s_type_list = [0]
    
    # Convert Path to string if needed
    ns_path = str(ns_path)
    logger.info(f"Loading NS file: {ns_path}")
    
    try:
        with open(ns_path,'r',encoding='utf-8') as f:
            for line_num, rowdata in enumerate(f, 1):
                rowdata = rowdata.strip()
                if not rowdata:  # Skip empty lines
                    continue
                # 使用正则分割处理多个空格，与get_ne保持一致
                rowdata = re.split(r'\s+', rowdata)
                # 清理空字符串
                rowdata = [item.strip() for item in rowdata if item.strip()]
                
                try:
                    edge_id_list.append(int(float(rowdata[0])))
                    ise_row = [
                        int(rowdata[1]),
                        int(rowdata[2]),
                        int(rowdata[3]),
                        int(rowdata[4]),
                        int(rowdata[5])
                    ]
                except (ValueError, IndexError) as e:
                    raise ValueError(f"Error parsing edge data at line {line_num}: {rowdata}. Expected at least 6 numeric values. Error: {e}")
                    
                ise_list.append(ise_row)
                try:
                    dis_list.append(float(rowdata[6]))
                    x_side_list.append(float(rowdata[7]))
                    y_side_list.append(float(rowdata[8]))
                    z_side_list.append(float(rowdata[9]))
                    s_type_list.append(float(rowdata[10]))
                except (ValueError, IndexError) as e:
                    raise ValueError(f"Error parsing side data at line {line_num}: {rowdata}. Error: {e}")
        
        ns_data = NsData(
            edge_id_list,
            ise_list,
            dis_list,
            x_side_list,
            y_side_list,
            z_side_list,
            s_type_list
        )
        return ns_data
    except Exception as e:
        logger.error(f"Failed to load NS file: {e}")
        raise e

# ==================== 几何计算类函数 ====================

def is_point_in_polygon(x: float, y: float, polygon_coords: list) -> bool:
    """
    使用射线法判断点是否在多边形内部
    
    Args:
        x: 点的x坐标
        y: 点的y坐标
        polygon_coords: 多边形坐标列表，格式为 [[x1, y1], [x2, y2], ...]
        
    Returns:
        bool: True表示点在多边形内部，False表示在外部
    """
    if len(polygon_coords) < 3:
        return False
    
    n = len(polygon_coords)
    inside = False
    
    p1x, p1y = polygon_coords[0]
    for i in range(1, n + 1):
        p2x, p2y = polygon_coords[i % n]
        
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    
    return inside

def is_point_intersects_with_feature(x: float, y: float, feature_json: dict, ne_data: NeData = None) -> bool:
    """
    判断点是否与GeoJSON feature或FeatureCollection相交
    
    Args:
        x: 点的x坐标
        y: 点的y坐标
        feature_json: GeoJSON格式的地理要素（Feature或FeatureCollection）
        ne_data: 网格数据，用于动态计算缓冲区距离
        
    Returns:
        bool: True表示相交，False表示不相交
    """
    if not feature_json:
        return False
    
    # 检查是否是FeatureCollection
    if feature_json.get('type') == 'FeatureCollection':
        features = feature_json.get('features', [])
        # 只要与任何一个feature相交就返回True
        for feature in features:
            if is_point_intersects_with_feature(x, y, feature, ne_data):
                return True
        return False
    
    # 处理单个Feature
    if 'geometry' not in feature_json:
        return False
    
    
    geometry = feature_json['geometry']
    geom_type = geometry.get('type', '').lower()
    coordinates = geometry.get('coordinates', [])
    
    if geom_type == 'polygon':
        # 对于Polygon，coordinates是 [外环, 内环1, 内环2, ...]
        if not coordinates:
            return False
        
        # 检查是否在外环内
        exterior_ring = coordinates[0]
        if not is_point_in_polygon(x, y, exterior_ring):
            return False
        
        # 检查是否在任何内环（洞）内，如果在洞内则不相交
        for i in range(1, len(coordinates)):
            interior_ring = coordinates[i]
            if is_point_in_polygon(x, y, interior_ring):
                return False
        
        return True
    
    elif geom_type == 'multipolygon':
        # 对于MultiPolygon，coordinates是 [polygon1, polygon2, ...]
        for polygon_coords in coordinates:
            if not polygon_coords:
                continue
            
            # 检查是否在外环内
            exterior_ring = polygon_coords[0]
            if not is_point_in_polygon(x, y, exterior_ring):
                continue
            
            # 检查是否在任何内环（洞）内
            in_hole = False
            for i in range(1, len(polygon_coords)):
                interior_ring = polygon_coords[i]
                if is_point_in_polygon(x, y, interior_ring):
                    in_hole = True
                    break
            
            if not in_hole:
                return True
        
        return False
    
    elif geom_type == 'point':
        # 对于Point，检查是否是同一个点（考虑浮点数精度）
        if len(coordinates) >= 2:
            return abs(coordinates[0] - x) < 1e-9 and abs(coordinates[1] - y) < 1e-9
        return False
    
    elif geom_type == 'linestring':
        # 对于LineString，动态计算缓冲区距离
        if len(coordinates) < 2:
            return False
        
        # 动态计算缓冲区距离
        buffer_distance = calculate_dynamic_buffer_distance(x, y, ne_data)
        
        for i in range(len(coordinates) - 1):
            x1, y1 = coordinates[i]
            x2, y2 = coordinates[i + 1]
            
            # 计算点到线段的最短距离
            distance = point_to_line_segment_distance(x, y, x1, y1, x2, y2)
            
            # 如果距离小于动态计算的缓冲区距离，认为相交
            if distance <= buffer_distance:
                return True
        
        return False
    
    # 其他几何类型暂不支持
    return False

def calculate_dynamic_buffer_distance(x: float, y: float, ne_data: NeData) -> float:
    """
    动态计算缓冲区距离，基于当前点与最近邻网格点的距离
    
    Args:
        x: 当前点的x坐标
        y: 当前点的y坐标
        ne_data: 网格数据
        
    Returns:
        float: 动态计算的缓冲区距离
    """
    if not ne_data or len(ne_data.xe_list) < 2:
        return 50.0  # 默认值
    
    min_distance = float('inf')
    
    # 找到最近的邻居网格点
    for i in range(len(ne_data.xe_list)):
        grid_x = ne_data.xe_list[i]
        grid_y = ne_data.ye_list[i]
        
        # 跳过当前点本身
        if abs(grid_x - x) < 1e-6 and abs(grid_y - y) < 1e-6:
            continue
            
        distance = math.sqrt((x - grid_x)**2 + (y - grid_y)**2)
        if distance < min_distance:
            min_distance = distance
    
    # 使用最近邻距离的一半作为缓冲区距离
    # 这样可以确保不会过度扩大影响范围
    return min_distance / 2.0 if min_distance != float('inf') else 50.0

def point_to_line_segment_distance(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
    """
    计算点到线段的最短距离
    
    Args:
        px, py: 点坐标
        x1, y1: 线段起点
        x2, y2: 线段终点
        
    Returns:
        float: 点到线段的最短距离
    """
    # 线段向量
    dx = x2 - x1
    dy = y2 - y1
    
    # 如果线段退化为点
    if dx == 0 and dy == 0:
        return math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
    
    # 计算点在线段上的投影参数t (0 <= t <= 1表示投影在线段上)
    t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    
    # 计算投影点坐标
    proj_x = x1 + t * dx
    proj_y = y1 + t * dy
    
    # 计算点到投影点的距离
    return math.sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)

def do_line_segments_intersect(x1: float, y1: float, x2: float, y2: float, 
                              x3: float, y3: float, x4: float, y4: float) -> bool:
    """
    检查两条线段是否相交
    
    Args:
        x1, y1: 第一条线段的起点
        x2, y2: 第一条线段的终点
        x3, y3: 第二条线段的起点
        x4, y4: 第二条线段的终点
        
    Returns:
        bool: True表示线段相交，False表示不相交
    """
    # 计算方向
    def direction(x1, y1, x2, y2, x3, y3):
        return (x3 - x1) * (y2 - y1) - (x2 - x1) * (y3 - y1)
    
    # 检查点是否在线段上
    def on_segment(x1, y1, x2, y2, x3, y3):
        return (min(x1, x2) <= x3 <= max(x1, x2) and 
                min(y1, y2) <= y3 <= max(y1, y2))
    
    # 计算方向值
    d1 = direction(x3, y3, x4, y4, x1, y1)
    d2 = direction(x3, y3, x4, y4, x2, y2)
    d3 = direction(x1, y1, x2, y2, x3, y3)
    d4 = direction(x1, y1, x2, y2, x4, y4)
    
    # 线段相交的一般情况
    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    
    # 处理共线或端点在另一条线段上的情况
    if d1 == 0 and on_segment(x3, y3, x4, y4, x1, y1):
        return True
    if d2 == 0 and on_segment(x3, y3, x4, y4, x2, y2):
        return True
    if d3 == 0 and on_segment(x1, y1, x2, y2, x3, y3):
        return True
    if d4 == 0 and on_segment(x1, y1, x2, y2, x4, y4):
        return True
    
    return False

# ==================== 坐标转换类函数 ====================
def get_transformer_4326_to_2326():
    """获取缓存的坐标转换器"""
    global _transformer_4326_to_2326
    if _transformer_4326_to_2326 is None:
        _transformer_4326_to_2326 = Transformer.from_crs("EPSG:4326", "EPSG:2326", always_xy=True)
    return _transformer_4326_to_2326

def transform_coordinates_4326_to_2326(lon: float, lat: float) -> tuple[float, float]:
    """
    快速坐标转换（使用缓存的转换器）
    
    Args:
        lon: 经度 (EPSG:4326)
        lat: 纬度 (EPSG:4326)
        
    Returns:
        tuple[float, float]: 转换后的坐标 (x, y) in EPSG:2326
    """
    transformer = get_transformer_4326_to_2326()
    x, y = transformer.transform(lon, lat)
    return x, y

def transform_point_list_4326_to_2326(point_list: list) -> list:
    """
    快速坐标点列表转换（使用缓存的转换器）
    
    Args:
        point_list: 坐标点列表 [lon, lat] in EPSG:4326
        
    Returns:
        list: 转换后的坐标点列表 [x, y] in EPSG:2326
    """
    if not isinstance(point_list, list) or len(point_list) < 2:
        return point_list
    
    lon, lat = point_list[0], point_list[1]
    x, y = transform_coordinates_4326_to_2326(lon, lat)
    
    return [x, y]

def transform_feature_4326_to_2326(feature: dict) -> dict:
    """
    将GeoJSON feature从EPSG:4326转换为EPSG:2326
    
    Args:
        feature: GeoJSON格式的地理要素（Feature或FeatureCollection）
        
    Returns:
        dict: 转换后的GeoJSON feature
    """
    if not feature:
        return feature
        
    def transform_coordinates(coords):
        if isinstance(coords[0], (int, float)):
            # 单个坐标点
            x, y = transform_coordinates_4326_to_2326(coords[0], coords[1])
            return [x, y]
        return [transform_coordinates(c) for c in coords]
    
    # 深拷贝以避免修改原始数据

    feature = copy.deepcopy(feature)
    
    # 处理FeatureCollection
    if feature.get('type') == 'FeatureCollection':
        for f in feature.get('features', []):
            if 'geometry' in f:
                f['geometry']['coordinates'] = transform_coordinates(f['geometry']['coordinates'])
        return feature
    
    # 处理单个Feature
    if 'geometry' in feature:
        feature['geometry']['coordinates'] = transform_coordinates(feature['geometry']['coordinates'])
    
    return feature

# ==================== 网格定位类函数 ====================

def find_grid_for_point(x: float, y: float, ne_data: NeData) -> int | None:
    """
    根据坐标点找到对应的网格ID（使用最近邻算法）
    
    Args:
        x: 点的x坐标
        y: 点的y坐标
        ne_data: 网格数据
        
    Returns:
        int | None: 对应的网格ID，如果没找到则返回None
    """
    
    min_distance = float('inf')
    nearest_grid_id = None
    
    # 遍历所有网格，找到距离最近的网格中心点
    for i in range(len(ne_data.xe_list)):
        grid_x = ne_data.xe_list[i]
        grid_y = ne_data.ye_list[i]
        
        # 计算欧几里得距离
        distance = math.sqrt((x - grid_x)**2 + (y - grid_y)**2)
        
        if distance < min_distance:
            min_distance = distance
            nearest_grid_id = ne_data.grid_id_list[i]
    
    return nearest_grid_id

def find_grid_for_feature_point(feature_json: dict, ne_data: NeData, grid_result: np.ndarray = None) -> list[int]:
    """
    根据GeoJSON格式的点要素找到对应的网格ID列表
    
    Args:
        feature_json: GeoJSON格式的地理要素（Feature或FeatureCollection）
        ne_data: 网格数据
        grid_result: 网格数据数组，每行包含 [网格ID, 中心x坐标, 中心y坐标, 半边长]
        
    Returns:
        list[int]: 与点要素对应的网格ID列表
    """
    if not feature_json:
        return []
    
    grid_ids = []
    
    # 检查是否是FeatureCollection
    if feature_json.get('type') == 'FeatureCollection':
        features = feature_json.get('features', [])
        
        # 处理FeatureCollection中的每个Feature
        for feature in features:
            grid_ids.extend(find_grid_for_feature_point(feature, ne_data, grid_result))
            
        # 去重
        return list(set(grid_ids))
    
    # 处理单个Feature
    if 'geometry' not in feature_json:
        return []
    
    geometry = feature_json['geometry']
    geom_type = geometry.get('type', '').lower()
    coordinates = geometry.get('coordinates', [])
    
    if geom_type == 'point':
        # 对于Point，找到对应的网格ID
        if len(coordinates) >= 2:
            x, y = coordinates[0], coordinates[1]
            if grid_result is not None:
                # 使用grid_result查找点所在的网格
                grid_id = find_grid_for_point_using_grid_result(x, y, grid_result)
                if grid_id is not None:
                    grid_ids.append(grid_id)
                    logger.info(f"点坐标 ({x}, {y}) 使用grid_result对应网格ID: {grid_id}")
                else:
                    # 如果使用grid_result找不到，回退到使用ne_data
                    grid_id = find_grid_for_point(x, y, ne_data)
                    if grid_id is not None:
                        grid_ids.append(grid_id)
                        logger.info(f"点坐标 ({x}, {y}) 回退使用ne_data对应网格ID: {grid_id}")
            else:
                # 如果没有提供grid_result，使用ne_data
                grid_id = find_grid_for_point(x, y, ne_data)
                if grid_id is not None:
                    grid_ids.append(grid_id)
                    logger.info(f"点坐标 ({x}, {y}) 对应网格ID: {grid_id}")
    
    elif geom_type == 'multipoint':
        # 对于MultiPoint，处理每个点
        for point_coords in coordinates:
            if len(point_coords) >= 2:
                x, y = point_coords[0], point_coords[1]
                if grid_result is not None:
                    # 使用grid_result查找点所在的网格
                    grid_id = find_grid_for_point_using_grid_result(x, y, grid_result)
                    if grid_id is not None:
                        grid_ids.append(grid_id)
                        logger.info(f"多点坐标 ({x}, {y}) 使用grid_result对应网格ID: {grid_id}")
                    else:
                        # 如果使用grid_result找不到，回退到使用ne_data
                        grid_id = find_grid_for_point(x, y, ne_data)
                        if grid_id is not None:
                            grid_ids.append(grid_id)
                            logger.info(f"多点坐标 ({x}, {y}) 回退使用ne_data对应网格ID: {grid_id}")
                else:
                    # 如果没有提供grid_result，使用ne_data
                    grid_id = find_grid_for_point(x, y, ne_data)
                    if grid_id is not None:
                        grid_ids.append(grid_id)
                        logger.info(f"多点坐标 ({x}, {y}) 对应网格ID: {grid_id}")
    
    return grid_ids

def find_grid_for_point_using_grid_result(x: float, y: float, grid_result: np.ndarray) -> int | None:
    """
    使用grid_result查找点所在的网格ID
    
    Args:
        x: 点的x坐标
        y: 点的y坐标
        grid_result: 网格数据数组，每行包含 [网格ID, 中心x坐标, 中心y坐标, 半边长]
        
    Returns:
        int | None: 对应的网格ID，如果没找到则返回None
    """
    if grid_result is None or len(grid_result) == 0:
        return None
    
    for grid_row in grid_result:
        if len(grid_row) < 4:
            continue
        
        grid_id = int(grid_row[0])
        grid_center_x = float(grid_row[1])
        grid_center_y = float(grid_row[2])
        half_size = float(grid_row[3])
        
        # 计算网格的边界
        min_x = grid_center_x - half_size
        max_x = grid_center_x + half_size
        min_y = grid_center_y - half_size
        max_y = grid_center_y + half_size
        
        # 检查点是否在网格内
        if min_x <= x <= max_x and min_y <= y <= max_y:
            return grid_id
    
    return None

# ==================== 辅助处理类函数 ====================

def get_grids_intersecting_with_line(feature_json: dict, grid_result: np.ndarray) -> list:
    """
    获取与线要素相交的网格ID列表
    
    Args:
        feature_json: GeoJSON格式的地理要素（已转换为EPSG:2326），可以是Feature或FeatureCollection
        grid_result: 网格数据数组，每行包含 [网格ID, 中心x坐标, 中心y坐标, 半边长]
        
    Returns:
        list: 与线要素相交的网格ID列表
    """
    if not feature_json:
        return []
    
    # 检查是否是FeatureCollection
    if feature_json.get('type') == 'FeatureCollection':
        print("处理FeatureCollection中的多个Feature")
        features = feature_json.get('features', [])
        all_intersecting_grid_ids = []
        
        # 处理FeatureCollection中的每个Feature
        for feature in features:
            intersecting_grid_ids = get_grids_intersecting_with_line(feature, grid_result)
            all_intersecting_grid_ids.extend(intersecting_grid_ids)
        
        # 去重
        return list(set(all_intersecting_grid_ids))
    
    # 处理单个Feature
    if 'geometry' not in feature_json:
        return []
    
    geometry = feature_json['geometry']
    geom_type = geometry.get('type', '').lower()
    coordinates = geometry.get('coordinates', [])
    
    # 只处理LineString或MultiLineString几何类型
    if geom_type != 'linestring' and geom_type != 'multilinestring':
        logger.warning(f"几何类型 {geom_type} 不是线要素，无法计算相交的网格")
        return []
    
    intersecting_grid_ids = []
    
    # 处理所有线段
    line_segments = []
    if geom_type == 'linestring':
        # 单线，将所有相邻点对构成线段
        print(len(coordinates)-1)
        for i in range(len(coordinates) - 1):
            line_segments.append((coordinates[i], coordinates[i + 1]))
    elif geom_type == 'multilinestring':
        # 多线，每条线都需要处理
        for line in coordinates:
            for i in range(len(line) - 1):
                line_segments.append((line[i], line[i + 1]))
    
    # 遍历所有网格，检查是否与任何线段相交
    for grid_row in grid_result:
        if len(grid_row) < 4:
            continue
        
        grid_id = int(grid_row[0])
        grid_center_x = float(grid_row[1])
        grid_center_y = float(grid_row[2])
        half_size = float(grid_row[3])
        
        # 计算网格的四个顶点
        min_x = grid_center_x - half_size
        max_x = grid_center_x + half_size
        min_y = grid_center_y - half_size
        max_y = grid_center_y + half_size
        
        # 网格的四条边
        grid_edges = [
            ((min_x, min_y), (max_x, min_y)),  # 下边
            ((max_x, min_y), (max_x, max_y)),  # 右边
            ((max_x, max_y), (min_x, max_y)),  # 上边
            ((min_x, max_y), (min_x, min_y))   # 左边
        ]
        
        # 检查线段是否与网格相交
        for line_segment in line_segments:
            line_p1, line_p2 = line_segment
            line_x1, line_y1 = line_p1
            line_x2, line_y2 = line_p2
            
            # 检查线段是否完全在网格外部
            if (max(line_x1, line_x2) < min_x or
                min(line_x1, line_x2) > max_x or
                max(line_y1, line_y2) < min_y or
                min(line_y1, line_y2) > max_y):
                continue
            
            # 检查线段端点是否在网格内部
            if (min_x <= line_x1 <= max_x and min_y <= line_y1 <= max_y) or \
               (min_x <= line_x2 <= max_x and min_y <= line_y2 <= max_y):
                intersecting_grid_ids.append(grid_id)
                break
            
            # 检查线段是否与网格边界相交
            for grid_edge in grid_edges:
                grid_p1, grid_p2 = grid_edge
                grid_x1, grid_y1 = grid_p1
                grid_x2, grid_y2 = grid_p2
                
                if do_line_segments_intersect(
                    line_x1, line_y1, line_x2, line_y2,
                    grid_x1, grid_y1, grid_x2, grid_y2
                ):
                    intersecting_grid_ids.append(grid_id)
                    break
            else:
                # 如果与网格的所有边都不相交，继续检查下一个线段
                continue
            
            # 如果已找到相交，跳出线段循环
            break
    
    return intersecting_grid_ids

def _get_feature_from_node(node_key: str) -> dict:
    """
    根据node_key加载矢量节点的GeoJSON数据
    
    Args:
        node_key: 矢量节点的key
        
    Returns:
        dict: 加载的GeoJSON数据
    """
    if not node_key:
        return {}
    
    rel_path = node_key.strip('.').replace('.', os.sep)
    resource_dir = Path.cwd() / 'resource' / rel_path
    
    if not resource_dir.exists():
        logger.warning(f"Vector resource directory not found: {resource_dir} for key {node_key}")
        return {}
        
    # 查找目录下的.geojson文件
    geojson_files = list(resource_dir.glob('*.geojson'))
    
    if not geojson_files:
        logger.warning(f"No .geojson file found in {resource_dir}")
        return {}
        
    # 加载第一个找到的geojson文件
    geojson_path = geojson_files[0]
    try:
        with open(geojson_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        logger.info(f"Loaded feature from {geojson_path}")
        return data
    except Exception as e:
        logger.error(f"Failed to load geojson from {geojson_path}: {e}")
        return {}

# ==================== 操作应用类函数 ====================

def apply_vector_modification(vector_params: dict, model_data: dict) -> dict:
    """
    应用添加围堰操作到模型数据（基于vector参数）
    
    Args:
        vector_params: 矢量参数，包含DEM和LUM信息
        model_data: 模型数据字典，包含ne和ns数据
        
    Returns:
        dict: 更新后的模型数据
    """
    
    logger.info("开始应用基围（基于vector参数）")
    
    # 从vector参数中提取DEM和LUM信息
    dem_params = vector_params.get('dem', {})
    lum_params = vector_params.get('lum', {})
    
    dem_type = dem_params.get('type')
    dem_value = dem_params.get('value')

    lum_type = lum_params.get('type')
    lum_value = lum_params.get('value')

    node_key = vector_params.get('node_key')
    feature = _get_feature_from_node(node_key)

    feature_json = transform_feature_4326_to_2326(feature)

    ne_data: NeData = model_data.get('ne', {})
    ns_data: NsData = model_data.get('ns', {})
    
    if dem_type is not None and dem_value is not None:
        if dem_type == 'additive':  # 加法
            for index in range(len(ne_data.xe_list)):
                x = ne_data.xe_list[index]
                y = ne_data.ye_list[index]
                
                # 判断当前网格点是否与feature相交
                if is_point_intersects_with_feature(x, y, feature_json):
                    ne_data.ze_list[index] += dem_value
                    # logger.info(f"网格中心点 ({x}, {y}) 应用了加法DEM修改: +{dem_value}")
        
        elif dem_type == 'absolute':  # 设置指定高程
            for index in range(len(ne_data.xe_list)):
                x = ne_data.xe_list[index]
                y = ne_data.ye_list[index]
                
                if is_point_intersects_with_feature(x, y, feature_json):
                    ne_data.ze_list[index] = dem_value
                    # logger.info(f"网格中心点 ({x}, {y}) 应用了绝对值DEM修改: {dem_value}")
        
        elif dem_type == 'subtractive':  # 减法
            for index in range(len(ne_data.xe_list)):
                x = ne_data.xe_list[index]
                y = ne_data.ye_list[index]
                
                if is_point_intersects_with_feature(x, y, feature_json):
                    ne_data.ze_list[index] -= dem_value
                    # logger.info(f"网格中心点 ({x}, {y}) 应用了减法DEM修改: -{dem_value}")
        
        else:  # 默认情况 - 加法模式
            for index in range(len(ne_data.xe_list)):
                x = ne_data.xe_list[index]
                y = ne_data.ye_list[index]
                
                # 判断当前网格点是否与feature相交
                if is_point_intersects_with_feature(x, y, feature_json):
                    ne_data.ze_list[index] += dem_value if dem_value is not None else 0
                    # logger.info(f"网格中心点 ({x}, {y}) 应用了默认DEM修改: +{dem_value or 0}")
    
    # 根据LUM参数修改土地利用类型
    if lum_type is not None and lum_value is not None:
        for index in range(len(ne_data.xe_list)):
            x = ne_data.xe_list[index]
            y = ne_data.ye_list[index]
            
            # 判断当前网格点是否与feature相交
            if is_point_intersects_with_feature(x, y, feature_json):
                ne_data.under_suf_list[index] = lum_value
                # logger.info(f"网格中心点 ({x}, {y}) 应用了LUM修改: {lum_value}")
    
    # 对ns数据也做相应处理
    if dem_type is not None and dem_value is not None:
        for index in range(len(ns_data.x_side_list)):
            x = ns_data.x_side_list[index]
            y = ns_data.y_side_list[index]

            # 判断当前网格点是否与feature相交
            if is_point_intersects_with_feature(x, y, feature_json):
                ns_data.z_side_list[index] += dem_value if dem_value is not None else 0
                # logger.info(f"边中心点 ({x}, {y}) 应用了DEM修改: +{dem_value or 0}")

    if lum_type is not None and lum_value is not None:
        for index in range(len(ns_data.x_side_list)):
            x = ns_data.x_side_list[index]
            y = ns_data.y_side_list[index]

            # 判断当前网格点是否与feature相交
            if is_point_intersects_with_feature(x, y, feature_json):
                ns_data.s_type_list[index] = lum_value
                # logger.info(f"边中心点 ({x}, {y}) 应用了LUM修改: {lum_value}")

    model_data['ne'] = ne_data
    model_data['ns'] = ns_data
    
    return model_data

def apply_add_gate_action(vector_params: dict, model_data: dict, grid_result: np.ndarray) -> dict:
    """
    应用添加闸门操作到模型数据（基于vector参数）
    
    Args:
        vector_params: 矢量参数，包含DEM和LUM信息以及闸门相关信息
        model_data: 模型数据字典
        grid_result: 网格数据数组，用于网格ID查找
        
    Returns:
        dict: 更新后的模型数据
    """
    
    logger.info("开始应用闸门（基于vector参数）")
    
    # 从vector参数中提取DEM和LUM信息
    dem_params = vector_params.get('dem', {})
    lum_params = vector_params.get('lum', {})
    
    # 获取其他必要参数（假设通过vector_params传递）
    up_stream = vector_params.get('up_stream')
    down_stream = vector_params.get('down_stream')
    gate_height = vector_params.get('gate_height', 0)
    
    # 从vector参数中获取feature
    node_key = vector_params.get('node_key')
    feature = _get_feature_from_node(node_key)
    
    # 转换feature坐标系
    feature_json = transform_feature_4326_to_2326(feature)

    print(f"闸门信息: {model_data['gate']}")

    # 获取与闸门相交的网格号
    grid_ids = get_grids_intersecting_with_line(feature_json, grid_result)
    logger.info(f"与闸门相交的网格号: {grid_ids}")
    
    # 处理上游点
    up_stream_grid_id = up_stream
    transformed_up_stream = transform_point_list_4326_to_2326(up_stream)
    # 优先使用grid_result查找
    up_grid_id = find_grid_for_point_using_grid_result(transformed_up_stream[0], transformed_up_stream[1], grid_result)
    if up_grid_id is not None:
        up_stream_grid_id = up_grid_id
        logger.info(f"上游坐标点 {up_stream} (4326) -> {transformed_up_stream} (2326) 对应网格ID: {up_grid_id}")
    
    # 处理下游点
    down_stream_grid_id = down_stream
    transformed_down_stream = transform_point_list_4326_to_2326(down_stream)
    # 优先使用grid_result查找
    down_grid_id = find_grid_for_point_using_grid_result(transformed_down_stream[0], transformed_down_stream[1], grid_result)
    if down_grid_id is not None:
        down_stream_grid_id = down_grid_id
        logger.info(f"下游坐标点 {down_stream} (4326) -> {transformed_down_stream} (2326) 对应网格ID: {down_grid_id}")

    gate_data: Gate = model_data.get('gate')
    gate_data.ud_stream_list.append(up_stream_grid_id)
    gate_data.ud_stream_list.append(down_stream_grid_id)
    gate_data.gate_height_list.append(gate_height)
    gate_data.grid_id_list.append(grid_ids)

    model_data['gate'] = gate_data

def apply_transfer_water_action(vector_params: dict, model_data: dict, watergroups: list, grid_result: np.ndarray = None) -> list:
    """
    应用调水操作到模型数据（基于vector参数）
    
    Args:
        vector_params: 矢量参数，包含DEM和LUM信息以及调水相关信息
        model_data: 模型数据字典
        watergroups: 水流组列表，用于存储调水信息
        grid_result: 网格数据数组，可选参数，用于网格ID查找
        
    Returns:
        list: 更新后的水流组列表
    """
    
    logger.info("开始应用调水（基于vector参数）")
    ne_data: NeData = model_data.get('ne', {})
    
    # 从vector参数中提取DEM和LUM信息
    dem_params = vector_params.get('dem', {})
    lum_params = vector_params.get('lum', {})
    
    # 获取调水相关参数
    from_grid = vector_params.get('from_grid')
    to_grid = vector_params.get('to_grid')
    q = vector_params.get('q', 0)  # 流量参数
    
    # 处理调水源头
    if isinstance(from_grid, dict):  # 如果是GeoJSON Feature或FeatureCollection
        # 转换坐标系
        from_grid_feature = transform_feature_4326_to_2326(from_grid)
        # 查找对应的网格ID（优先使用grid_result）
        from_grid_ids = find_grid_for_feature_point(from_grid_feature, ne_data, grid_result)
        if from_grid_ids:
            from_grid = from_grid_ids[0]  # 取第一个匹配的网格ID
            logger.info(f"调水源头Feature点对应网格ID: {from_grid}")
    elif isinstance(from_grid, list) and len(from_grid) >= 2:  # 如果是坐标点 [lon, lat]
        transformed_from_grid = transform_point_list_4326_to_2326(from_grid)
        # 优先使用grid_result查找
        from_grid_id = None
        if grid_result is not None:
            from_grid_id = find_grid_for_point_using_grid_result(transformed_from_grid[0], transformed_from_grid[1], grid_result)
        if from_grid_id is None:  # 如果使用grid_result找不到，回退到使用ne_data
            from_grid_id = find_grid_for_point(transformed_from_grid[0], transformed_from_grid[1], ne_data)
        if from_grid_id is not None:
            from_grid = from_grid_id
            logger.info(f"调水源头坐标点 {from_grid} (4326) -> {transformed_from_grid} (2326) 对应网格ID: {from_grid}")
    
    # 处理调水终点
    if isinstance(to_grid, dict):  # 如果是GeoJSON Feature或FeatureCollection
        # 转换坐标系
        to_grid_feature = transform_feature_4326_to_2326(to_grid)
        # 查找对应的网格ID（优先使用grid_result）
        to_grid_ids = find_grid_for_feature_point(to_grid_feature, ne_data, grid_result)
        if to_grid_ids:
            to_grid = to_grid_ids[0]  # 取第一个匹配的网格ID
            logger.info(f"调水终点Feature点对应网格ID: {to_grid}")
    elif isinstance(to_grid, list) and len(to_grid) >= 2:  # 如果是坐标点 [lon, lat]
        transformed_to_grid = transform_point_list_4326_to_2326(to_grid)
        # 优先使用grid_result查找
        to_grid_id = None
        if grid_result is not None:
            to_grid_id = find_grid_for_point_using_grid_result(transformed_to_grid[0], transformed_to_grid[1], grid_result)
        if to_grid_id is None:  # 如果使用grid_result找不到，回退到使用ne_data
            to_grid_id = find_grid_for_point(transformed_to_grid[0], transformed_to_grid[1], ne_data)
        if to_grid_id is not None:
            to_grid = to_grid_id
            logger.info(f"调水终点坐标点 {to_grid} (4326) -> {transformed_to_grid} (2326) 对应网格ID: {to_grid}")
    
    watergroup = {
        'from_grid': from_grid,
        'to_grid': to_grid,
        'q': q
    }
    watergroups.append(watergroup)
    return watergroups
