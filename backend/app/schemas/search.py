from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(10, ge=1, le=50)
    mode: str = Field("hybrid", pattern=r"^(hybrid|vector|keyword)$")


class SearchResult(BaseModel):
    source_type: str
    source_id: str
    filename: str | None
    original_path: str | None
    chunk_text: str
    chunk_index: int
    file_type: str
    score: float
    project_id: str
    section_header: str = ""


class SearchResponse(BaseModel):
    results: list[SearchResult]
    query_plan: dict | None = None
