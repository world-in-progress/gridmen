import c_two as cc

@cc.icrm(namespace='gridmen', version='1.0.0')
class IGrid:
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