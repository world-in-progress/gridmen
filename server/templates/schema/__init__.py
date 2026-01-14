from pynoodle import ResourceNodeTemplate

from crms.schema import Schema
from .hooks import MOUNT, UNMOUNT, PACK, UNPACK, PRIVATIZATION

template = ResourceNodeTemplate(
    crm=Schema,
    mount=MOUNT,
    unmount=UNMOUNT,
    pack=PACK,
    unpack=UNPACK,
    privatization=PRIVATIZATION
)