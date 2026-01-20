import logging
from pynoodle import noodle
from fastapi import APIRouter, HTTPException, Body

from ...schemas.base import BaseResponse
from ...schemas.vector import FeatureSaveBody, GetFeatureJsonResponse, GetFeatureResponse, UploadFeatureSaveBody, UploadFeatureFromFile

from icrms.ivector import IVector, UpdateFeatureBody

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# APIs for vector features ################################################

router = APIRouter(prefix='/vector', tags=['vector-related apis'])

@router.post('/save', response_model=BaseResponse)
def save_feature(node_key: str, lock_id: str | None = None, body: FeatureSaveBody=Body(..., description='save feature')):
    try:
        print('lock id:', lock_id)
        with noodle.connect(IVector, node_key, 'pw', lock_id=lock_id) as vector:
            vector.save_feature(body.feature_json)
        return BaseResponse(success=True, message='Feature saved successfully')
    except Exception as e:
        logger.error(f'Error saving feature: {e}')
        raise HTTPException(status_code=500, detail=f'Error saving feature: {e}')

@router.post('/save_uploaded', response_model=BaseResponse)
def save_uploaded_feature(node_key: str, lock_id: str | None = None, body: UploadFeatureFromFile=Body(..., description='save uploaded feature from file')):
    try:
        with noodle.connect(IVector, node_key, 'pw', lock_id=lock_id) as vector:
            vector.save_uploaded_feature(body.file_path)
        return BaseResponse(success=True, message='Uploaded feature saved successfully')
    except Exception as e:
        logger.error(f'Error saving uploaded feature: {e}')
        raise HTTPException(status_code=500, detail=f'Error saving uploaded feature: {e}')

@router.get('/', response_model=GetFeatureResponse)
def get_feature(node_key: str, lock_id: str | None = None, target_epsg: str = '4326'):
    try:
        with noodle.connect(IVector, node_key, 'pr', lock_id=lock_id) as vector:
            feature_data = vector.get_feature(target_epsg)
        return GetFeatureResponse(success=True, message='Feature retrieved successfully', data=feature_data)
    except Exception as e:
        logger.error(f'Error retrieving feature: {e}')
        raise HTTPException(status_code=500, detail=f'Error retrieving feature: {e}')

@router.get('/feature_json_computation', response_model=GetFeatureJsonResponse)
def get_feature_json_computation(node_key: str, lock_id: str | None = None):
    try:
        with noodle.connect(IVector, node_key, 'pr', lock_id=lock_id) as vector:
            feature_json = vector.get_feature_json_computation()
        return GetFeatureJsonResponse(success=True, message='Feature JSON computation retrieved successfully', data=feature_json)
    except Exception as e:
        logger.error(f'Error retrieving feature JSON computation: {e}')
        raise HTTPException(status_code=500, detail=f'Error retrieving feature JSON computation: {e}')

@router.put('/', response_model=BaseResponse)
def update_feature(node_key: str, lock_id: str | None = None, body: UpdateFeatureBody=Body(..., description='update feature')):
    try:
        with noodle.connect(IVector, node_key, 'pw', lock_id=lock_id) as vector:
            vector.update_feature(body)
        return BaseResponse(success=True, message='Feature updated successfully')
    except Exception as e:
        logger.error(f'Error updating feature: {e}')
        raise HTTPException(status_code=500, detail=f'Error updating feature: {e}')