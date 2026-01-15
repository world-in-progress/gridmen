from pynoodle import ResourceNodeTemplate

from crms.vector import Vector
from .hooks import MOUNT, UNMOUNT, PACK, UNPACK, PRIVATIZATION

template = ResourceNodeTemplate(
    crm=Vector,
    mount=MOUNT,
    unmount=UNMOUNT,
    pack=PACK,
    unpack=UNPACK,
    privatization=PRIVATIZATION
)