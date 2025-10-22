import logging
import pyproj
from icrms.iproj import IProj

logger = logging.getLogger(__name__)

class Proj:
    def __init__(self, resource_space: str):
        """Initialize Proj CRM"""
        # resource_space在这里可能包含EPSG代码或其他配置信息
        # 但由于这是个纯计算类CRM，可能不需要持久化存储
        self.resource_space = resource_space
    
    def get_proj4_string(self, epsg_code: int) -> str:
        """
        根据EPSG代码获取PROJ4字符串定义
        
        参数:
            epsg_code (int): EPSG坐标系代码
            
        Returns:
            str: PROJ4字符串定义
        """
        try:
            crs = pyproj.CRS.from_epsg(epsg_code)
            proj_string = crs.to_proj4()
            return proj_string
        except Exception as e:
            logger.warning(f"无法通过pyproj获取EPSG {epsg_code}的PROJ4表示: {e}")
            return f"EPSG:{epsg_code}"