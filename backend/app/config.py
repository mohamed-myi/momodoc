import os
from functools import cached_property
from pathlib import Path

from platformdirs import user_data_dir
from pydantic import field_validator
from pydantic_settings import BaseSettings

_CPU_COUNT = os.cpu_count() or 4
_REPO_ROOT = Path(__file__).resolve().parents[2]
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_ENV_FILES = (_REPO_ROOT / ".env", _BACKEND_ROOT / ".env")


class Settings(BaseSettings):
    # App
    app_name: str = "momodoc"
    debug: bool = False
    log_level: str = "INFO"
    host: str = "127.0.0.1"
    port: int = 8000

    # Data directory (override via env var; defaults to OS user data dir)
    momodoc_data_dir: str = ""

    # Database — derived from data_dir in practice; can be overridden for tests
    database_url: str = ""

    # LLM
    llm_provider: str = "claude"
    anthropic_api_key: str = ""
    claude_model: str = "claude-sonnet-4-6"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    google_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    ollama_base_url: str = "http://localhost:11434/v1"
    ollama_model: str = "qwen2.5-coder:7b"

    # Embedding
    embedding_model: str = "nomic-ai/nomic-embed-text-v1.5"
    embedding_dimension: int = 768
    embedding_device: str = ""
    embedding_trust_remote_code: bool = True
    embedding_max_workers: int = max(min(_CPU_COUNT // 2, 8), 2)

    # Vector DB async adapter
    vectordb_max_workers: int = max(min(_CPU_COUNT, 16), 4)
    vectordb_max_read_concurrency: int = max(min(_CPU_COUNT * 2, 32), 8)
    vectordb_search_nprobes: int = 32
    vectordb_search_refine_factor: int = 2

    # Directory sync pipeline
    sync_max_concurrent_files: int = 4
    sync_queue_size: int = 64

    # Direct directory indexing pipeline (sync API endpoint)
    index_max_concurrent_files: int = 4
    index_discovery_batch_size: int = 256

    # Chunking
    chunk_size_default: int = 2000
    chunk_overlap_default: int = 200
    chunk_size_code: int = 2000
    chunk_size_pdf: int = 3000
    chunk_size_markdown: int = 2000

    # Database connection pool
    db_pool_size: int = 5
    db_max_overflow: int = 10

    # Storage
    max_upload_size_mb: int = 100
    max_file_size_mb: int = 200
    allowed_index_paths: list[str] = []

    # Static frontend directory (relative to backend or absolute)
    static_dir: str = ""

    # Reranker
    reranker_enabled: bool = True
    reranker_model: str = ""
    reranker_device: str = ""
    reranker_max_workers: int = 2
    retrieval_candidate_k: int = 50

    # Chat/LLM endpoint rate limiting
    chat_rate_limit_enabled: bool = True
    chat_rate_limit_window_seconds: int = 60
    chat_rate_limit_global_requests: int = 120
    chat_rate_limit_client_requests: int = 30
    chat_stream_rate_limit_global_requests: int = 60
    chat_stream_rate_limit_client_requests: int = 15

    model_config = {
        # Resolve from project/backend roots so launching from another CWD still
        # loads settings consistently (desktop sidecar, IDE launchers, etc.).
        "env_file": tuple(str(path) for path in _ENV_FILES),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
        "enable_decoding": False,
    }

    @field_validator("allowed_index_paths", mode="before")
    @classmethod
    def parse_allowed_index_paths(cls, v: object) -> list[str]:
        if isinstance(v, str):
            return [p.strip() for p in v.split(",") if p.strip()]
        return v  # type: ignore[return-value]

    @field_validator("port")
    @classmethod
    def validate_port(cls, v: int) -> int:
        if not (1 <= v <= 65535):
            raise ValueError(f"Port must be between 1 and 65535, got {v}")
        return v

    @field_validator(
        "embedding_max_workers",
        "vectordb_max_workers",
        "vectordb_max_read_concurrency",
        "vectordb_search_nprobes",
        "vectordb_search_refine_factor",
        "sync_max_concurrent_files",
        "sync_queue_size",
        "index_max_concurrent_files",
        "index_discovery_batch_size",
        "chat_rate_limit_window_seconds",
        "chat_rate_limit_global_requests",
        "chat_rate_limit_client_requests",
        "chat_stream_rate_limit_global_requests",
        "chat_stream_rate_limit_client_requests",
    )
    @classmethod
    def validate_positive_int(cls, v: int) -> int:
        if v < 1:
            raise ValueError(f"Value must be >= 1, got {v}")
        return v

    @cached_property
    def data_dir(self) -> str:
        d = self.momodoc_data_dir or user_data_dir("momodoc")
        os.makedirs(d, exist_ok=True)
        return d

    @cached_property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        db_dir = os.path.join(self.data_dir, "db")
        os.makedirs(db_dir, exist_ok=True)
        return f"sqlite+aiosqlite:///{os.path.join(db_dir, 'momodoc.db')}"

    @cached_property
    def vector_dir(self) -> str:
        d = os.path.join(self.data_dir, "vectors")
        os.makedirs(d, exist_ok=True)
        return d

    @cached_property
    def upload_dir(self) -> str:
        d = os.path.join(self.data_dir, "uploads")
        os.makedirs(d, exist_ok=True)
        return d

    @property
    def session_token_path(self) -> str:
        return os.path.join(self.data_dir, "session.token")

    @property
    def pid_file_path(self) -> str:
        return os.path.join(self.data_dir, "momodoc.pid")

    @property
    def port_file_path(self) -> str:
        return os.path.join(self.data_dir, "momodoc.port")
