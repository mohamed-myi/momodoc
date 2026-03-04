from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class IssueStatus(str, Enum):
    open = "open"
    in_progress = "in_progress"
    done = "done"


class IssuePriority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class IssueCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=512)
    description: str | None = None
    priority: IssuePriority = IssuePriority.medium


class IssueUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=512)
    description: str | None = None
    status: IssueStatus | None = None
    priority: IssuePriority | None = None


class IssueResponse(BaseModel):
    id: str
    project_id: str
    title: str
    description: str | None
    status: str
    priority: str
    chunk_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
