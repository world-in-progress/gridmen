from pynoodle import ResourceNodeTemplate

from crms.grid import Grid
from .hooks import MOUNT, UNMOUNT, PACK, UNPACK, PRIVATIZATION

template = ResourceNodeTemplate(
    crm=Grid,
    mount=MOUNT,
    unmount=UNMOUNT,
    pack=PACK,
    unpack=UNPACK,
    privatization=PRIVATIZATION
)