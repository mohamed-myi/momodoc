from datetime import datetime

from pydantic import BaseModel


class FileResponse(BaseModel):
    id: str
    project_id: str
    filename: str
    original_path: str | None
    file_type: str
    file_size: int
    chunk_count: int
    tags: str | None = None
    indexed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class FileUpdate(BaseModel):
    tags: str | None = None


class DirectoryIndexRequest(BaseModel):
    path: str


class IngestionResultResponse(BaseModel):
    file_id: str
    filename: str
    chunks_created: int
    skipped: bool = False
    errors: list[str] = []


class DirectoryIndexResponse(BaseModel):
    results: list[IngestionResultResponse]
    total_files: int
    total_chunks: int
    skipped: int


class SyncRequest(BaseModel):
    path: str | None = None
