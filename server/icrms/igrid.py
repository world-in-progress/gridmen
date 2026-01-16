"""
Interface for Grid resource operations.

This defines the contract that Grid resources must implement.
"""

from typing import Protocol


class IGrid(Protocol):
    """
    Interface for Grid resources.
    
    Defines the methods that a Grid resource must implement.
    """
    __tag__ = 'gridmen/IGrid/1.0.0'
    
    def get_meta(self):
        """
        Get metadata for the grid.
        """
        ...

    def get_cells(self):
        """
        Get the grid cells.
        """
        ...