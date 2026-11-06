from pydantic import BaseModel, ConfigDict, Field, model_validator

class GridExportRequest(BaseModel):
    node_key: str
    target_path: str



class GridDisplayQuery(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    bounds: tuple[float, float, float, float]
    metersPerPixel: float = Field(gt=0)

    @model_validator(mode='after')
    def positive_extent(self):
        if self.bounds[2] <= self.bounds[0] or self.bounds[3] <= self.bounds[1]:
            raise ValueError('bounds must have positive extent')
        return self
