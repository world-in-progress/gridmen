import c_two as cc
from typing import Any

@cc.icrm(namespace='gridmen', version='1.0.0')
class IProj:
    """
    ICRM
    =
    Interface of Core Resource Model (ICRM) for projection operations.
    """
    def get_proj4_string(self, epsg_code: int) -> str:
        """
        Get PROJ4 string definition by EPSG code
        
        Parameters:
            epsg_code (int): EPSG coordinate system code
            
        Returns:
            str: PROJ4 string definition
        """
        ...