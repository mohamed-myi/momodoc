from pydantic import BaseModel, Field


class BatchDeleteRequest(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=100)


class BatchTagRequest(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=100)
    tags: str


class BatchDeleteResponse(BaseModel):
    deleted: int
    errors: list[str] = []


class BatchTagResponse(BaseModel):
    updated: int
    errors: list[str] = []
