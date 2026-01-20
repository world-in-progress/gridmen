import json
import mmap
import struct
from pathlib import Path


# --- Data Structures for IO (HydroElement/HydroSides) ---

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

class HydroSide:
    def __init__(self, data: bytes):
        # Unpack index, direction, bounds, adjacent grid indices, AND altitude, type
        # Original: '!QBddddQQ' (58 bytes) -> New: '!QBddddQQdi' (58 + 8 + 4 = 70 bytes)
        index, direction, min_x, min_y, max_x, max_y, grid_index_a, grid_index_b, altitude, type_val = struct.unpack('!QBddddQQdi', data)
        self.index = index
        self.direction = direction
        self.bounds = (min_x, min_y, max_x, max_y)
        self.grid_index_a = grid_index_a
        self.grid_index_b = grid_index_b
        
        # Attributes from binary
        self.altitude = altitude
        self.type = type_val
    
    @property
    def length(self) -> float:
        return (self.bounds[2] - self.bounds[0]) if self.direction == 1 else (self.bounds[3] - self.bounds[1])
    
    @property
    def center(self) -> tuple[float, float, float]:
        return (
            (self.bounds[0] + self.bounds[2]) / 2.0,  # center x
            (self.bounds[1] + self.bounds[3]) / 2.0,  # center y
            self.altitude,                            # center z
        )
    
    @property
    def ns(self) -> list[int | float]:
        left_grid_index, right_grid_index, bottom_grid_index, top_grid_index = 0, 0, 0, 0
        if self.direction == 0: # vertical side
            left_grid_index = self.grid_index_a if self.grid_index_a is not None else 0
            right_grid_index = self.grid_index_b if self.grid_index_b is not None else 0
        else: # horizontal side
            top_grid_index = self.grid_index_a if self.grid_index_a is not None else 0
            bottom_grid_index = self.grid_index_b if self.grid_index_b is not None else 0
        
        direction = 1 if self.direction == 1 else 2 # convert to 1 for horizontal, 2 for vertical (0 -> 2)
            
        return [
            self.index,             # side index
            direction,              # direction (1 for horizontal, 2 for vertical)
            left_grid_index,        # left grid index (1-based)
            right_grid_index,       # right grid index (1-based)
            bottom_grid_index,      # bottom grid index (1-based)
            top_grid_index,         # top grid index (1-based)
            self.length,            # length of the side
            *self.center,           # center coordinates (x, y, z)
            self.type,              # side type
        ]
    
class HydroElements:
    def __init__(self, file_path: str):
        self.fp = file_path
        self.es: list[HydroElement] = []
        
        with open(file_path, 'r+b') as f:
            with mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
                cursor = 0
                while cursor < mm.size():
                    mm.seek(cursor)
                    length_prefix = struct.unpack('!I', mm.read(4))[0]
                    mm.seek(cursor + 4)
                    data = mm.read(length_prefix)
                    cursor += 4 + length_prefix
                    
                    self.es.append(HydroElement(data))
    

    def save(self, output_path: str):
        with open(output_path, 'w+b') as f:
            for e in self.es:
                ne_record = e.ne
                # Recalculate format based on actual content types
                # Original failed logic: fmt = '!' + 'd' * (len(ne_record) - 1) + 'I'
                # Recommendation: Use Q for IDs if possible, but to match legacy logic:
                fmt = '!' + 'd' * (len(ne_record) - 1) + 'I'
                
                record_data = struct.pack(fmt, *ne_record)
                length_prefix = struct.pack('!I', len(record_data))
                
                f.write(length_prefix + record_data)

    def export_ne(self, output_path: str):
        with open(output_path, 'w') as f:
            for e in self.es:
                ne_record = e.ne
                f.write(' '.join(map(str, ne_record)) + '\n')

class HydroSides:
    def __init__(self, file_path: str):
        self.fp = file_path
        self.ss: list[HydroSide] = []
        
        with open(file_path, 'r+b') as f:
            with mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
                cursor = 0
                while cursor < mm.size():
                    mm.seek(cursor)
                    length_prefix = struct.unpack('!I', mm.read(4))[0]
                    mm.seek(cursor + 4)
                    data = mm.read(length_prefix)
                    cursor += 4 + length_prefix
                    
                    self.ss.append(HydroSide(data))
    
                
    def save(self, output_path: str):
        with open(output_path, 'w+b') as f:
            for s in self.ss:
                ns_record = s.ns
                # Same fix as HydroElements.save
                fmt = '!' + 'd' * (len(ns_record) - 1) + 'I'
                
                record_data = struct.pack(fmt, *ns_record)
                length_prefix = struct.pack('!I', len(record_data))
                
                f.write(length_prefix + record_data)

    def export_ns(self, output_path: str):
        with open(output_path, 'w') as f:
            for s in self.ss:
                ns_record = s.ns
                f.write(' '.join(map(str, ns_record)) + '\n')

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

