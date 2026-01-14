import logging
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException

from crms.proj import Proj

import pyproj

logger = logging.getLogger(__name__)

# APIs for projection operations ##################################################

router = APIRouter(prefix='/proj', tags=['projection-related apis'])

class Proj4DefsResponse(BaseModel):
    proj4_defs: str

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
        # Instantiate Proj CRM directly, without going through the noodle node system"
        proj = Proj('') 
        proj4_defs = proj.get_proj4_string(epsg_code)
        return Proj4DefsResponse(proj4_defs=proj4_defs)
    
    except Exception as e:
        logger.warning(f"Failed to get proj4_defs from Proj CRM: {str(e)}")
        try:
            crs = pyproj.CRS.from_epsg(epsg_code)
            proj_string = crs.to_proj4()
            return Proj4DefsResponse(proj4_defs=proj_string)
        
        except Exception as e:
            err_msg = f'Error retrieving proj4 definitions for EPSG code {epsg_code}: {str(e)}'
            logger.error(err_msg)
            raise HTTPException(status_code=404, detail=err_msg)
            