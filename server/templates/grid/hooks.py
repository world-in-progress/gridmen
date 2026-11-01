import os
import json
import shutil
import tarfile
import logging
from pathlib import Path
from pynoodle import noodle

from .assembly import assembly
from .vector import apply_interventions, load_base_grid, load_interventions, write_ne, write_ns
from ._timing import collect_timings, timed

logger = logging.getLogger(__name__)

# Base grid binaries are written once by assembly and never modified afterwards,
# so grids built on the same base grid share them through hard links.
BASE_GRID_FILES = ('cell_topo.bin', 'edge_topo.bin')

# --- Lifecycle Hooks ---


def _resource_dir(node_key: str) -> Path:
    # Resources are mounted at <project_root>/resource/<rel_path>
    return Path.cwd() / 'resource' / node_key.strip('.').replace('.', os.sep)


def MOUNT(node_key: str, params: dict | None = None):
    """
    Mounts a Grid resource.

    A grid is a base grid (geometry, topology and base attributes in cell_topo.bin /
    edge_topo.bin) plus its ordered vector interventions ('vector'). The base grid is
    either assembled from patches ('assembly') or reused from an existing grid
    ('base_grid'). ne.txt / ns.txt are computed from the base grid and the
    interventions, and build_report.json records counts and stage timings.
    Without params, an empty grid resource is created.
    """
    resource_dir = _resource_dir(node_key)
    resource_dir.mkdir(parents=True, exist_ok=True)

    if not params:
        _create_default_meta_if_not_exists(resource_dir)
        return

    assembly_params = params.get('assembly')
    base_grid = params.get('base_grid')
    if (assembly_params is None) == (base_grid is None):
        raise ValueError("A grid needs exactly one base: 'assembly' (patches) or 'base_grid' (an existing grid).")
    interventions = load_interventions(params.get('vector') or [])

    with collect_timings() as timings:
        with timed("MOUNT", node_key=node_key):
            with timed("grid.base"):
                if assembly_params is not None:
                    _assemble(assembly_params, node_key, resource_dir)
                else:
                    _link_base_grid(base_grid, node_key, resource_dir)
            meta = json.loads((resource_dir / 'grid.meta.json').read_text(encoding='utf-8'))
            with timed("grid.load_base"):
                grid = load_base_grid(resource_dir)
            with timed("grid.interventions", n=len(interventions)):
                finest_cell_size = min(min(size) for size in meta['grid_info']) if meta.get('grid_info') else None
                intervention_stats = apply_interventions(
                    grid, interventions, f"EPSG:{meta['epsg']}",
                    dem_path=meta.get('dem_path'), finest_cell_size=finest_cell_size,
                )
            with timed("grid.write_ne"):
                write_ne(resource_dir / 'ne.txt', grid)
            with timed("grid.write_ns"):
                write_ns(resource_dir / 'ns.txt', grid)

    report = {
        'node_key': node_key,
        'base': {'assembly': assembly_params} if assembly_params is not None else {'base_grid': base_grid},
        'cells': len(grid.cell_index),
        'edges': len(grid.edges),
        'interventions': intervention_stats,
        'stages': timings['stages'],
        **timings['values'],
    }
    (resource_dir / 'build_report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


# ===== Grid Mount Handlers =====
def _assemble(assembly_params: dict, node_key: str, resource_dir: Path):
    """Assemble the base grid from patches and sample DEM/LULC onto it."""
    schema_node_key = assembly_params.get('schema_node_key')
    patch_node_keys = assembly_params.get('patch_node_keys')
    if not schema_node_key or not patch_node_keys:
        raise ValueError("Assembly requires 'schema_node_key' and 'patch_node_keys'.")

    print(f"Starting assembly for grid: {node_key}")
    grading_threshold = 1
    with timed("assembly.compile", node_key=node_key):
        meta_info = assembly(
            resource_dir, schema_node_key, patch_node_keys, grading_threshold,
            assembly_params.get('dem_path'), assembly_params.get('lum_path'),
        )
    (resource_dir / 'grid.meta.json').write_text(json.dumps(meta_info, indent=4), encoding='utf-8')


def _link_base_grid(base_grid: str, node_key: str, resource_dir: Path):
    """Reuse base binaries and provenance; crest alone may read local DEM windows."""
    if base_grid == node_key:
        raise ValueError("A grid cannot use itself as its base grid.")
    base_dir = _resource_dir(base_grid)
    missing = [name for name in (*BASE_GRID_FILES, 'grid.meta.json') if not (base_dir / name).is_file()]
    if missing:
        raise ValueError(f"Base grid {base_grid} has no {', '.join(missing)} in {base_dir}")
    for name in BASE_GRID_FILES:
        os.link(base_dir / name, resource_dir / name)
    shutil.copy2(base_dir / 'grid.meta.json', resource_dir / 'grid.meta.json')

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
    resource_dir = _resource_dir(node_key)

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
    resource_dir = _resource_dir(node_key)

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
