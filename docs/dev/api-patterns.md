# API Patterns

## Base Path

All endpoints are under `/api/v1`. Interactive docs are at `/docs` when the backend is running.

## Authentication

All API requests (except `/api/v1/health` and `/api/v1/token`) require the `X-Momodoc-Token` header containing the session token. The token is auto-generated on server startup.

- **Web frontend**: Fetches token from `GET /api/v1/token` (localhost-only), includes it in all requests
- **CLI**: Reads token from `{data_dir}/session.token` automatically
- **VS Code extension**: Reads token from data directory files

## Router → Service Pattern

Routers are thin HTTP handlers. They:

1. Declare the endpoint (method, path, response model, status code)
2. Inject dependencies via `Depends()`
3. Call a service function
4. Return the result

**No business logic in routers.** All logic lives in service modules under `backend/app/services/`.

Example pattern (from `routers/issues.py`):

```python
@router.post("/projects/{project_id}/issues", response_model=IssueResponse, status_code=201)
async def create_issue(
    data: IssueCreate,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    return await issue_service.create_issue(db, project.id, data)
```

## Schema Conventions

Each resource has separate Pydantic models in `backend/app/schemas/`:

| Schema | Purpose |
|--------|---------|
| `{Resource}Create` | Request body for POST (creation) |
| `{Resource}Update` | Request body for PATCH (partial update) |
| `{Resource}Response` | Response model with `model_config = {"from_attributes": True}` |

**Partial updates** use `exclude_unset=True`:

```python
update_data = data.model_dump(exclude_unset=True)
```

This ensures only fields explicitly provided in the request are updated.

## Project Lookup

The `get_project` dependency (in `dependencies.py`) accepts both a **UUID** and a **project name** as the `{project_id}` path parameter:

```python
select(Project).where((Project.id == project_id) | (Project.name == project_id))
```

## Pagination

All list endpoints support:

- `?offset=` (default: 0, min: 0)
- `?limit=` (default: 20, min: 1, max: 100)

Defined via `Query()` parameters in router handlers.

## Error Responses

| Status | Exception | When |
|--------|-----------|------|
| 401 | `SessionTokenMiddleware` | Missing or invalid `X-Momodoc-Token` header |
| 404 | `NotFoundError` | Entity not found |
| 409 | `ConflictError` | Duplicate resource (e.g., project name already exists), or sync already running for project |
| 409 | `EmbeddingModelMismatchError` | Configured embedding model differs from stored |
| 422 | `ValidationError` | Invalid input (path traversal, file too large, etc.) |
| 429 | `RateLimitExceededError` | Chat rate limit exceeded (includes `Retry-After` header, `scope`, `limit` fields) |
| 500 | `VectorStoreError` | LanceDB operation failed |
| 500 | `Exception` (generic) | Unhandled exception (logged server-side) |
| 502 | `LLMError` | LLM API call failure |
| 503 | `LLMNotConfiguredError` | Chat requested without API key |
| 503 | `EmbeddingServiceUnavailableError` | Embedder not yet loaded or unavailable |

All error responses return `{"detail": "..."}`. The 429 response additionally includes `scope`, `limit`, and `retry_after_seconds` fields.

## Streaming (SSE)

Chat streaming is available at two endpoints:
- **Project-scoped:** `/projects/{id}/chat/sessions/{sid}/messages/stream`
- **Global:** `/chat/sessions/{sid}/messages/stream`

Both:
1. Accept `ChatMessageRequest` (query, optional top_k, optional include_history, optional pinned_source_ids)
2. Return `StreamingResponse` with `text/event-stream` content type
3. Event sequence:
   - `event: sources\ndata: [...]` — JSON array of `ChatSource` objects
   - `data: {"token": "..."}` — one per LLM token
   - `event: done\ndata: {}` — signals completion

The `include_history` field (default `false`) controls how much conversation context is sent to the LLM. When false, only the last 3 messages are included for basic conversational continuity. When true, the full last 20 messages are included.

The `pinned_source_ids` field (optional) lists source IDs (file/note/issue UUIDs) whose chunks should always be included in context, regardless of semantic similarity.

The `SearchRequest` `mode` field (default: `hybrid`) controls the search strategy: `hybrid` (vector+BM25), `vector` (embedding similarity only), `keyword` (BM25 full-text only).

## WebSocket

Real-time sync progress events are available via WebSocket:

- **Endpoint:** `WS /ws?token=<session-token>`
- **Auth:** Token passed via query parameter (not header -- browsers can't send custom headers on WS handshakes)
- **Middleware bypass:** The session token middleware explicitly skips `/ws` paths
- **Events:** JSON messages with `type` field: `sync_progress`, `sync_complete`, `sync_failed`
- **Alternative to SSE polling:** Instead of polling `GET /files/sync/status` every second, clients can subscribe to WebSocket for instant updates

## Endpoint Reference

| Resource | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| Health | GET | `/health` | Service health check |
| Token | GET | `/token` | Get session token (localhost only) |
| Projects | POST | `/projects` | Create a project |
| | GET | `/projects` | List projects (with counts) |
| | GET | `/projects/{id}` | Get project details |
| | PATCH | `/projects/{id}` | Update project |
| | DELETE | `/projects/{id}` | Delete project + all data |
| Files | POST | `/projects/{id}/files/upload` | Upload and ingest a file (returns `FileResponse`) |
| | POST | `/projects/{id}/files/index-directory` | Index a directory |
| | POST | `/projects/{id}/files/sync` | Start background directory sync (202 Accepted, returns `JobResponse`) |
| | GET | `/projects/{id}/files/sync/status` | Get active sync job for project (or null) |
| | GET | `/projects/{id}/files/jobs/{job_id}` | Get sync job by ID (`JobResponse`) |
| | GET | `/projects/{id}/files` | List project files |
| | GET | `/projects/{id}/files/{file_id}` | Get file details |
| | PATCH | `/projects/{id}/files/{file_id}` | Update file tags (`FileUpdate`) |
| | GET | `/projects/{id}/files/{file_id}/content` | File content preview (`FileContentResponse`) |
| | GET | `/projects/{id}/files/{file_id}/chunks` | File chunks with pagination (`FileChunksResponse`) |
| | DELETE | `/projects/{id}/files/{file_id}` | Delete file + vectors |
| | POST | `/projects/{id}/files/batch-delete` | Batch delete files (`BatchDeleteResponse`) |
| | POST | `/projects/{id}/files/batch-tag` | Batch tag files (`BatchTagResponse`) |
| Notes | POST | `/projects/{id}/notes` | Create and vectorize a note |
| | GET | `/projects/{id}/notes` | List project notes |
| | PATCH | `/projects/{id}/notes/{note_id}` | Update note (re-vectorizes) |
| | DELETE | `/projects/{id}/notes/{note_id}` | Delete note + vectors |
| Issues | POST | `/projects/{id}/issues` | Create an issue |
| | GET | `/projects/{id}/issues` | List issues (`?status=` enum filter: open/in_progress/done) |
| | PATCH | `/projects/{id}/issues/{issue_id}` | Update issue |
| | DELETE | `/projects/{id}/issues/{issue_id}` | Delete issue |
| | POST | `/projects/{id}/issues/batch-delete` | Batch delete issues (`BatchDeleteResponse`) |
| Chat (project) | POST | `/projects/{id}/chat/sessions` | Create session |
| | GET | `/projects/{id}/chat/sessions` | List sessions |
| | DELETE | `/projects/{id}/chat/sessions/{sid}` | Delete session |
| | PATCH | `/projects/{id}/chat/sessions/{sid}` | Update session (title) |
| | GET | `/projects/{id}/chat/sessions/{sid}/messages` | Get message history |
| | POST | `/projects/{id}/chat/sessions/{sid}/messages` | Send message (full response) |
| | POST | `/projects/{id}/chat/sessions/{sid}/messages/stream` | Send message (SSE stream) |
| Chat (global) | POST | `/chat/sessions` | Create global session (no project) |
| | GET | `/chat/sessions` | List global sessions |
| | DELETE | `/chat/sessions/{sid}` | Delete global session |
| | PATCH | `/chat/sessions/{sid}` | Update global session (title) |
| | GET | `/chat/sessions/{sid}/messages` | Get global session messages |
| | POST | `/chat/sessions/{sid}/messages` | Send global message (full response) |
| | POST | `/chat/sessions/{sid}/messages/stream` | Send global message (SSE stream) |
| Search | POST | `/search` | Global search (hybrid/vector/keyword via `mode` field) |
| | POST | `/projects/{id}/search` | Project-scoped search |
| Export | GET | `/projects/{id}/chat/sessions/{sid}/export` | Export chat as Markdown or JSON (`?format=markdown\|json`) |
| | GET | `/projects/{id}/search/export` | Export search results (`?query=...&format=...&top_k=N`) |
| WebSocket | WS | `/ws` | Real-time sync progress events (token via `?token=` query param) |
|| LLM | GET | `/llm/providers` | List available LLM providers with configuration status |

## Adding a New Endpoint

1. **Schema** — Define `Create`, `Update`, `Response` models in `backend/app/schemas/`
2. **Service** — Implement async business logic in `backend/app/services/`
3. **Router** — Create thin handler in `backend/app/routers/` using `Depends()` for injection
4. **Register** — Add `app.include_router(router, prefix="/api/v1", tags=["tag"])` in `bootstrap/routes.py`
5. **Frontend** — Add method to `frontend/src/shared/renderer/lib/apiClientCore.ts` and types to `shared/renderer/lib/types.ts`
6. **Test** — Add integration tests in `backend/tests/integration/`
