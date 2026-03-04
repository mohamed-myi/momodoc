from datetime import datetime

from pydantic import BaseModel, Field


class NoteCreate(BaseModel):
    content: str = Field(..., min_length=1)
    tags: str | None = None


class NoteUpdate(BaseModel):
    content: str | None = Field(None, min_length=1)
    tags: str | None = None


class NoteResponse(BaseModel):
    id: str
    project_id: str
    content: str
    tags: str | None
    chunk_count: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
