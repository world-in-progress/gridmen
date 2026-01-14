from pynoodle import ResourceNodeTemplate

from crms.patch import Patch
from .hooks import MOUNT, UNMOUNT, PACK, UNPACK, PRIVATIZATION

template = ResourceNodeTemplate(
    crm=Patch,
    mount=MOUNT,
    unmount=UNMOUNT,
    pack=PACK,
    unpack=UNPACK,
    privatization=PRIVATIZATION
)