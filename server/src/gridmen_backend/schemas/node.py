from pydantic import BaseModel

class NodeToken(BaseModel):
    node_key: str
    lock_id: str | None = None