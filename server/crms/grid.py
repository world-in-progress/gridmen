import json
from pathlib import Path


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
