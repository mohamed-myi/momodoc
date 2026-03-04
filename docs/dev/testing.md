# Testing

## Stack

- **pytest** with **pytest-asyncio** (`asyncio_mode = "auto"`)
- All test functions can be `async def` — no need for manual event loop management
- Tests live in `backend/tests/`

## Layout

```
backend/tests/
├── conftest.py        # Shared fixtures (DB, mocks, test client)
├── unit/              # Isolated unit tests
└── integration/       # Full router-to-service-to-DB tests
```

## Running Tests

```bash
cd backend && pip install -e ".[dev]" && pytest
# Or via Makefile:
make test
```

## Fixtures (conftest.py)

All shared fixtures are in `backend/tests/conftest.py`:

### Database

| Fixture | What it provides |
|---------|------------------|
| `db_engine` | In-memory SQLite async engine with tables created and foreign keys enabled |
| `db_session` | `AsyncSession` from the in-memory engine (yielded, auto-closes) |

### Mocks

| Fixture | What it mocks | Behavior |
|---------|---------------|----------|
| `mock_vectordb` | `VectorStore` (LanceDB wrapper) | `search()`, `hybrid_search()`, `fts_search()`, `get_by_filter()` all return `[]`; `add()`, `delete()`, `create_fts_index()` are no-ops |
| `mock_embedder` | `Embedder` | Returns zero-vectors (`[0.0] * 384`) for any input |
| `mock_llm` | `LLMProvider` | `complete()` returns `"Test answer"`, `stream()` yields `["Test ", "answer"]` |
| `mock_ws_manager` | `WSManager` | `broadcast()` is a no-op, `connect()`/`disconnect()` track connections |
| `test_settings` | `Settings` | In-memory DB, test data dir, 1MB max upload, test allowed paths |

### Test Client

| Fixture | What it provides |
|---------|------------------|
| `client` | `httpx.AsyncClient` with all FastAPI dependencies overridden (DB, VectorStore, Embedder, LLM, Settings) and session token authentication |

The `client` fixture creates a real FastAPI app via `create_app()`, sets `app.state.session_token` to a test token, then overrides all dependencies to use the test fixtures. All requests include the `X-Momodoc-Token` header. This exercises the full request path (middleware → router → service → DB) without any external services.

### Test Token

A constant `TEST_TOKEN` is defined in `conftest.py` and used for:
- Setting `app.state.session_token` on the test app
- Including `X-Momodoc-Token` header in the test `AsyncClient`

## Existing Test Coverage

### Unit Tests (`tests/unit/`)

| Test File | Coverage Area |
|-----------|---------------|
| `test_core_infrastructure.py` | VectorStore operations, security path validation, dependency providers, middleware, config |
| `test_ingestion_pipeline.py` | TextChunker, SectionAwareTextChunker, RegexCodeChunker, heading extractor, all 4 parsers (including heading extraction), IngestionPipeline (dedup, re-ingestion, error handling, checksum, vector record shape), TreeSitter chunker |
| `test_ingestion_registry_policy.py` | `ParserRegistry` ordering/selection, `ChunkingPolicy` file-type dispatch |
| `test_ingestion_directory_walk.py` | `iter_directory_paths`, `next_directory_batch`, ignore patterns, supported extensions filter |
| `test_security.py` | Path traversal validation |
| `test_session_token_middleware.py` | Session token middleware auth logic |
| `test_upload_limits.py` | Upload size enforcement |
| `test_file_upload_cleanup.py` | File upload cleanup on errors |
| `test_embedding_safety.py` | Embedding model consistency checks |
| `test_token_file_permissions.py` | Token file 0o600 permissions |
| `test_partial_updates.py` | Partial update behavior (`exclude_unset`) |
| `test_chat_service.py` | Chat service orchestration, pinned sources, per-source diversity cap, section header display in context |
| `test_search_service.py` | Search service modes (hybrid/vector/keyword) |
| `test_vectordb.py` | `VectorStore` operations (add, search, delete, FTS, `get_distinct_column`, `delete_by_ids`, `section_header` field) |
| `test_sync_service.py` | Sync service (directory sync, progress tracking, error handling) |
| `test_llm_factory.py` | `ProviderRegistry`, `create_llm_provider()`, provider metadata |
| `test_llm_providers_streaming.py` | LLM streaming for all providers (Claude, OpenAI, Gemini, Ollama) |
| `test_content_entity_service_helpers.py` | Shared CRUD lifecycle helpers for notes/issues |
| `test_retrieval_scoring.py` | Score extraction/normalization helpers, section_header field extraction |
| `test_rag_evaluation.py` | RAG evaluation metrics (Recall@K, Precision@K, Hit Rate@K, MRR) |
| `test_ws_manager.py` | WebSocket manager (connect, disconnect, broadcast) |
| `test_rate_limiter.py` | `ChatRateLimiter` sliding window logic |
| `test_file_watcher.py` | `ProjectFileWatcher` event handling |
| `test_embedder_lifecycle.py` | Embedder load/shutdown, thread pool lifecycle |
| `test_maintenance.py` | Orphaned vector cleanup |
| `test_job_tracker.py` | `JobTracker` persistence, stale job recovery |
| `test_architecture_regressions.py` | Structural invariants (import layering, module boundaries) |
| `test_note_service.py` | Note service CRUD with vector indexing |
| `test_system_config_service.py` | System config read/write, embedding model enforcement |
| `test_cli.py` | CLI command group composition, server commands |

### Integration Tests (`tests/integration/`)

| Test File | Coverage Area |
|-----------|---------------|
| `test_projects.py` | Project CRUD (create, list, get by ID/name, update, delete) |
| `test_project_cascade.py` | Project cascade deletion (files, notes, issues, sessions) |
| `test_issues.py` | Issue CRUD (create, list, filter by status, update, delete) |
| `test_notes.py` | Note CRUD |
| `test_chat.py` | Chat sessions and messages |
| `test_health.py` | Health endpoint |
| `test_auth.py` | Session token auth (valid, invalid, missing) |
| `test_file_content_endpoints.py` | File content preview and chunk retrieval |
| `test_files.py` | File upload, listing, sync endpoints |
| `test_search_endpoints.py` | Search endpoints (project-scoped, global) |
| `test_cors.py` | CORS middleware (allowed origins, rejected origins) |
| `conftest.py` | Integration-specific fixtures |

## Writing New Tests

### Integration Test Pattern

```python
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_create_thing(client: AsyncClient):
    response = await client.post("/api/v1/projects", json={
        "name": "test-project",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "test-project"
    assert "id" in data
```

### Unit Test Pattern

```python
import pytest
from app.core.security import validate_index_path
from app.core.exceptions import ValidationError

def test_rejects_path_outside_allowed():
    with pytest.raises(ValidationError):
        validate_index_path("/etc/passwd", ["/tmp/allowed"])
```

### Conventions

- Use the `client` fixture for integration tests — it provides a fully wired app with session token auth
- Use `db_session` directly for testing service functions in isolation
- All async tests are auto-detected (no need for `@pytest.mark.asyncio` decorator when using `asyncio_mode = "auto"`, but it doesn't hurt to be explicit)
- No external services are needed — everything is mocked
- Test files should be named `test_*.py`
- Historical audit prose removed from test files is preserved in `docs/test-audit-history.md`
