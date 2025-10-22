import logging
from fastapi import APIRouter, HTTPException

# 修改相对导入为绝对导入
from nh_grid_server.core.config import settings
from crms.proj.proj import Proj  # 直接导入Proj类

import pyproj  # 直接导入pyproj用于备用方案

logger = logging.getLogger(__name__)

# APIs for projection operations ##################################################

router = APIRouter(prefix='/proj', tags=['projection-related apis'])

@router.get('/{epsg_code}')
def get_proj4_defs(epsg_code: int):
    """
    Description
    --
    Get proj4 definitions for a given EPSG code.
    
    Parameters
    --
    epsg_code: EPSG coordinate system code
    
    Returns
    --
    dict: Contains proj4_defs string
    """
    try:
        # 直接实例化 Proj CRM，不通过 noodle 节点系统
        proj = Proj("")  # 不需要 resource_space
        proj4_defs = proj.get_proj4_string(epsg_code)
        return {"proj4_defs": proj4_defs}
    except Exception as e:
        logger.warning(f"Failed to get proj4_defs from Proj CRM: {str(e)}")
        # 如果Proj CRM失败，使用备用方案
        try:
            crs = pyproj.CRS.from_epsg(epsg_code)
            proj_string = crs.to_proj4()
            return {"proj4_defs": proj_string}
        except Exception as e:
            logger.error(f"Failed to get proj4_defs directly: {e}")
            return {"proj4_defs": f"EPSG:{epsg_code}"}