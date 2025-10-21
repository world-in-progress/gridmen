from __future__ import annotations
import os
import sys
import time
import yaml
import shutil
import logging
import threading
from contextlib import contextmanager
from typing import Generator, Type, TypeVar

sys.path.insert(0, os.path.join(settings.ROOT_DIR, '..', 'py-noodle', 'src'))

from ..core.config import settings
from pynoodle import noodle, NOODLE_INIT, NOODLE_TERMINATE

# Configure logging
logger = logging.getLogger('BSTreeger')

T = TypeVar('T')

class BootStrappingTreeger:
    instance: 'BootStrappingTreeger' = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls.instance is None:
            with cls._lock:
                if cls.instance is None:
                    cls.instance = super(BootStrappingTreeger, cls).__new__(cls)
                    cls.instance._initialized = False
        return cls.instance

    def __init__(self):
        if getattr(self, '_initialized', False):
            return
        
        # Pre-remove memory temp directory if it exists
        if (
            settings.MEMORY_TEMP_DIR
            and settings.PRE_REMOVE_MEMORY_TEMP_DIR
            and os.path.exists(settings.MEMORY_TEMP_DIR)
            ):
            try:
                shutil.rmtree(settings.MEMORY_TEMP_DIR)
            except OSError as e:
                logger.error(f'Failed to remove memory temp directory: {e}')
        
        self._meta_path = settings.SCENARIO_META_PATH
        
        if not self._meta_path:
            raise ValueError('Treeger meta path must be set in settings')

        try:
            # Initialize Noodle
            NOODLE_INIT()
            
            # Load meta data and mount nodes
            with open(self._meta_path, 'r') as f:
                meta_data = yaml.safe_load(f)
            
            # Mount root node
            noodle.mount('root')
            
            # Mount other nodes from meta
            if 'nodes' in meta_data:
                for node in meta_data['nodes']:
                    node_key = node['key']
                    template_name = node.get('template')
                    mount_params = node.get('params')
                    parent_key = '.'.join(node_key.split('.')[:-1])
                    
                    # Ensure parent node is mounted
                    if parent_key and parent_key != 'root' and not noodle.has_node(parent_key):
                        noodle.mount(parent_key)
                    
                    # Mount the node
                    noodle.mount(node_key, template_name, mount_params)
            
            self._initialized = True
            
        except Exception as e:
            logger.error(f'Failed to initialize Noodle from {self._meta_path}: {e}')
            self._initialized = False
            raise
        
    def terminate(self):
        NOODLE_TERMINATE()
        logger.info('Noodle CRM shutdown successfully')
    
    def mount_node(self, node_type: str, node_key: str, params: dict = None):
        """Mount a node with given parameters"""
        parent_key = '.'.join(node_key.split('.')[:-1])
        
        # Ensure parent nodes exist
        if parent_key and not noodle.has_node(parent_key):
            # Recursively create parent nodes
            parts = node_key.split('.')
            for i in range(1, len(parts)):
                current_key = '.'.join(parts[:i])
                if not noodle.has_node(current_key):
                    noodle.mount(current_key)
        
        # Mount the actual node
        result = noodle.mount(node_key, f'{node_type.capitalize()}Node', params)
        return result
    
    def unmount_node(self, node_key: str):
        """Unmount a node"""
        result = noodle.unmount(node_key)
        return result
    
    def link(self, icrm: Type[T], node_key: str, access_mode: str) -> str | None:
        """Link to a resource node and return lock ID"""
        return noodle.link(icrm, node_key, access_mode)
    
    def access(self, icrm: Type[T], node_key: str, lock_id: str) -> T:
        """Access a node with existing lock ID"""
        return noodle.access(icrm, node_key, lock_id)
    
    def unlink(self, node_key: str, lock_id: str):
        """Unlink from a resource node"""
        return noodle.unlink(node_key, lock_id)
    
    @contextmanager
    def connect(self, node_key: str, icrm: Type[T], duration=None, reuse=None) -> Generator[T, None, None]:
        """Context manager to connect to a node"""
        # Map treeger parameters to pynoodle parameters
        access_mode = 'lw'  # default to local write
        
        with noodle.connect(icrm, node_key, access_mode) as crm:
            yield crm

BT = BootStrappingTreeger