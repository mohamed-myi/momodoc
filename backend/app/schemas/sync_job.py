from datetime import datetime

from pydantic import BaseModel


class SyncJobErrorResponse(BaseModel):
    id: str
    filename: str
    error_message: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SyncJobResponse(BaseModel):
    id: str
    project_id: str
    status: str
    total_files: int
    processed_files: int
    completed_files: int
    succeeded_files: int
    skipped_files: int
    failed_files: int
    total_chunks: int
    current_file: str
    error: str | None
    errors: list[SyncJobErrorResponse] = []
    created_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}
