import json
import struct
from pathlib import Path

# --- Data Structures for IO (HydroElement) ---

class HydroElement:
    def __init__(self, data: bytes):
        # Unpack index, bounds and edge counts
        index, min_x, min_y, max_x, max_y, altitude, type, left_edge_num, right_edge_num, bottom_edge_num, top_edge_num = struct.unpack('!QdddddBBBBB', data[:53])
        self.index: int = index
        self.bounds: tuple[float, float, float, float] = (min_x, min_y, max_x, max_y)

        # Unpack edges
        total_edge_num = left_edge_num + right_edge_num + bottom_edge_num + top_edge_num
        edge_coords_types = '!' + 'Q' * total_edge_num
        edges: list[int] = list(struct.unpack(edge_coords_types, data[53:]))
        
        # Calculate edge starts
        left_edge_start = 0
        right_edge_start = left_edge_num
        bottom_edge_start = right_edge_start + right_edge_num
        top_edge_start = bottom_edge_start + bottom_edge_num
        
        # Extract edges
        self.left_edges: list[int] = edges[left_edge_start:right_edge_start]
        self.right_edges: list[int] = edges[right_edge_start:bottom_edge_start]
        self.bottom_edges: list[int] = edges[bottom_edge_start:top_edge_start]
        self.top_edges: list[int] = edges[top_edge_start:]

        # Default attributes (can be modified later)
        self.altitude = altitude    
        self.type = type              
        
    @property
    def center(self) -> tuple[float, float, float]:
        return (
            (self.bounds[0] + self.bounds[2]) / 2.0,  # center x
            (self.bounds[1] + self.bounds[3]) / 2.0,  # center y
            self.altitude,                            # center z
        )
    
    @property
    def ne(self) -> list[int | float]:
        return [
            self.index,                                     # element index
            len(self.left_edges),                           # number of left edges
            len(self.right_edges),                          # number of right edges
            len(self.bottom_edges),                         # number of bottom edges
            len(self.top_edges),                            # number of top edges
            *self.left_edges,                               # left edge indices
            *self.right_edges,                              # right edge indices
            *self.bottom_edges,                             # bottom edge indices
            *self.top_edges,                                # top edge indices
            *self.center,                                   # center coordinates (x, y, z)
            self.type,                                      # element type
        ]

# --- Grid CRM (Customer Resource Management) module ---

class Grid:
    """
    Grid CRM class implementing grid resource operations.
    """
    __tag__ = 'gridmen/Grid/1.0.0'

    def __init__(self, resource_space: str):
        """
        Initialize the Grid CRM with the given resource space.
        
        Args:
            resource_space: Path to the resource space for this grid
        """
        self.resource_space = Path(resource_space)
        self.meta_file = self.resource_space / 'grid.meta.json'

    def get_meta(self):
        """
        Get metadata for the grid.
        """
        if self.meta_file.exists():
            with open(self.meta_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        else:
            # Return default metadata if file doesn't exist
            return {
                'resource_space': str(self.resource_space),
                'bin_file_path': str(self.resource_space / 'cell_topo.bin'),
                'ne_file_path': str(self.resource_space / 'ne.txt')
            }

    def get_cells(self):
        """
        Get the grid cells.
        """
        bin_file_path = self.resource_space / 'cell_topo.bin'
        if bin_file_path.exists():
            # Read the binary file and return cell information
            with open(bin_file_path, 'rb') as f:
                data = f.read()
                # Process the binary data to extract cell information
                # This is a placeholder implementation
                return {"size": len(data), "path": str(bin_file_path)}
        else:
            return {}

# --- Block Generation Logic ---

class BlockGenerator:
    """
    Class for generating blocks from grid data.
    """
    MAX_BLOCKS_SIZE = 1024 * 1024

    def __init__(self, output_dir: str, base_name: str):
        self.output_dir = Path(output_dir)
        self.base_name = base_name
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.block_counter = 0
        self.blocks_meta = []

    def process(self, elements: list['HydroElement']):
        """
        Process a list of HydroElements and generate blocks.
        """
        if not elements:
            return

        min_x, min_y, max_x, max_y = elements[0].bounds

        for e in elements:
            ex_min_x, ex_min_y, ex_max_x, ex_max_y = e.bounds
            if ex_min_x < min_x:
                min_x = ex_min_x
            if ex_min_y < min_y:
                min_y = ex_min_y
            if ex_max_x > max_x:
                max_x = ex_max_x
            if ex_max_y > max_y:
                max_y = ex_max_y

        global_bounds = (min_x, min_y, max_x, max_y)

        self._recursive_split(elements, global_bounds)

        self._save_metadata(global_bounds)
    
    def _recursive_split(self, elements: list['HydroElement'], bounds: tuple[float, float, float, float]):
        """
        Recursively split elements into blocks based on their bounds.
        """
        count = len(elements)

        if count <= self.MAX_BLOCKS_SIZE:
            self._create_block_file(elements, bounds)
            return
        
        min_x, min_y, max_x, max_y = bounds
        width = max_x - min_x
        height = max_y - min_y

        list1, list2 = [], []
        bounds_1 = None
        bounds_2 = None

        if width >= height:
            split_x = min_x + width / 2.0
            for e in elements:
                cx, _, _ = e.center
                if cx < split_x:
                    list1.append(e)
                else:
                    list2.append(e)
            
            bounds_1 = (min_x, min_y, split_x, max_y)
            bounds_2 = (split_x, min_y, max_x, max_y)
        
        else:
            split_y = (min_y + max_y) / 2.0
            for e in elements:
                _, cy, _ = e.center
                if cy < split_y:
                    list1.append(e)
                else:
                    list2.append(e)

            bounds_1 = (min_x, min_y, max_x, split_y)
            bounds_2 = (min_x, split_y, max_x, max_y)
        
        if list1:
            self._recursive_split(list1, bounds_1)
        if list2:
            self._recursive_split(list2, bounds_2)
    
    def _create_block_file(self, elements: list['HydroElement'], bounds: tuple[float, float, float, float]):
        """
        Create a block file for the given elements and bounds.
        """
        self.block_counter += 1
        block_name = f"{self.base_name}_{self.block_counter}"
        file_name = f"{block_name}.bin"
        file_path = f".blocks/{file_name}"
        output_path = self.output_dir / file_name
    
        self._save_elements_to_bin(elements, output_path)

        self.blocks_meta.append({
            "block_id": self.block_counter,
            "name": block_name,
            "file": file_path,
            "count": len(elements),
            "bounds": bounds,
        })
        print(f"Created block file: {output_path} with {len(elements)} elements.")
    
    def _save_elements_to_bin(self, elements: list['HydroElement'], output_path: Path):
        """
        Save the given elements to a binary file.
        """
        with open(output_path, 'wb') as f:
            for e in elements:
                ne_record = e.ne
                fmt = '!' + 'd' * (len(ne_record) - 1) + 'I'

                record_data = struct.pack(fmt, *ne_record)
                length_prefix = struct.pack('!I', len(record_data))

                f.write(length_prefix + record_data)
    
    def _save_metadata(self, global_bounds: tuple):
        """
        Create block_meta.json
        """
        meta_data = {
            "total_blocks": self.block_counter,
            "global_bounds": global_bounds,
            "base_name": self.base_name,
            "blocks": self.blocks_meta
        }
        
        meta_path = self.output_dir / "block_meta.json"
        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(meta_data, f, indent=2)
        print(f"Block metadata saved to: {meta_path}")
