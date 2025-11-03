import logging
import pyproj
from icrms.iproj import IProj

logger = logging.getLogger(__name__)

class Proj:
    def __init__(self, resource_space: str):
        """Initialize Proj CRM"""
        # resource_space may contain EPSG code or other configuration information here
        # But since this is a pure computational CRM, it may not need persistent storage
        self.resource_space = resource_space
    
    def get_proj4_string(self, epsg_code: int) -> str:
        """
        Get PROJ4 string definition by EPSG code
        
        Parameters:
            epsg_code (int): EPSG coordinate system code
            
        Returns:
            str: PROJ4 string definition
        """
        # Special case for EPSG:2326 (Hong Kong 1980 Grid System)
        if epsg_code == 2326:
            return '+proj=tmerc +lat_0=22.3121333333333 +lon_0=114.178555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 +units=m +no_defs'
        
        # If EPSG is 4326, directly return the PROJ.4 definition for WGS84
        if epsg_code == 4326:
            return '+proj=longlat +datum=WGS84 +no_defs'
        
        try:
            crs = pyproj.CRS.from_epsg(epsg_code)
            proj_string = crs.to_proj4()
            return proj_string
        except Exception as e:
            logger.warning(f'Unable to get PROJ4 representation for EPSG {epsg_code} via pyproj: {e}')
            return f'EPSG:{epsg_code}'