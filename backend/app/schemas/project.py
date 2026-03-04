from datetime import datetime

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    source_directory: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    source_directory: str | None = None


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: str | None
    source_directory: str | None = None
    created_at: datetime
    updated_at: datetime
    file_count: int = 0
    note_count: int = 0
    issue_count: int = 0
    last_sync_at: datetime | None = None
    last_sync_status: str | None = None
    sync_job_id: str | None = None

    model_config = {"from_attributes": True}


class PaginationParams(BaseModel):
    offset: int = Field(0, ge=0)
    limit: int = Field(20, ge=1, le=100)
