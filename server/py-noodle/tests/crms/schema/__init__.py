from pynoodle import ResourceNodeTemplate

from .schema import Schema
from .hooks import MOUNT, UNMOUNT

template = ResourceNodeTemplate(
    crm=Schema,
    mount=MOUNT,
    unmount=UNMOUNT
)