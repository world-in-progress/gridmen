import c_two as cc
from typing import Any

@cc.icrm()
class IProj:
    """
    ICRM
    =
    Interface of Core Resource Model (ICRM) for projection operations.
    """
    def get_proj4_string(self, epsg_code: int) -> str:
        """
        根据EPSG代码获取PROJ4字符串定义
        
        参数:
            epsg_code (int): EPSG坐标系代码
            
        Returns:
            str: PROJ4字符串定义
        """
        ...