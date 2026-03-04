from datetime import datetime

from pydantic import BaseModel, Field


class ChatSessionCreate(BaseModel):
    title: str | None = None


class ChatSessionUpdate(BaseModel):
    title: str | None = Field(None, min_length=1)


class ChatSessionResponse(BaseModel):
    id: str
    project_id: str | None
    title: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(10, ge=1, le=50)
    include_history: bool = False
    llm_mode: str | None = Field(
        None,
        description="LLM provider to use for this request (claude, openai, gemini, ollama). "
        "If omitted, the server default (LLM_PROVIDER env var) is used.",
    )
    pinned_source_ids: list[str] | None = Field(
        None,
        description="Optional list of source IDs (file/note/issue) whose chunks should always "
        "be included in the context, regardless of semantic similarity.",
    )


class ChatSource(BaseModel):
    source_type: str
    source_id: str
    filename: str | None
    original_path: str | None
    chunk_text: str
    chunk_index: int
    score: float
    section_header: str = ""


class ChatMessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    sources: list[ChatSource] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatResponse(BaseModel):
    answer: str
    sources: list[ChatSource]
    model: str
    user_message_id: str
    assistant_message_id: str
    retrieval_metadata: dict | None = None
