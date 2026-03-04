# API Patterns

This document describes the API surface implemented today in `backend/app/routers/`, `backend/app/schemas/`, and `backend/app/dependencies.py`.

## Base Paths

- HTTP endpoints live under `/api/v1`.
- Interactive OpenAPI docs are available at `/docs` when the backend is running.
- Real-time sync and startup events use `WS /ws` outside the `/api/v1` prefix.

## Authentication

Momodoc uses a per-process session token generated during backend startup.

- Protected HTTP routes require the `X-Momodoc-Token` header.
- The middleware skips non-API routes, `OPTIONS` requests, `/api/v1/health`, and `/api/v1/token`.
- `GET /api/v1/token` is localhost-only and returns `403` for non-local callers.
- If a protected route is hit before startup finishes generating the token, the middleware returns `503` with `{"detail":"Server is starting up"}`.
- WebSocket clients pass the token as a query parameter: `ws://127.0.0.1:8000/ws?token=...`.

Client-specific token behavior:

- The web frontend fetches the token from `GET /api/v1/token`.
- The CLI reads `session.token` from the Momodoc data directory.
- The desktop app and VS Code extension read the token and port from runtime files in the data directory.

## Router and Service Pattern

Routers are intentionally thin. The normal pattern is:

1. Declare the route, response model, and status code.
2. Inject dependencies with `Depends()`.
3. Delegate business logic to a service module.
4. Return ORM objects or schema instances.

Example:

```python
@router.post("/projects/{project_id}/issues", response_model=IssueResponse, status_code=201)
async def create_issue(
    data: IssueCreate,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
):
    return await issue_service.create_issue(db, vectordb, embedder, project.id, data)
```

## Dependency Injection

The main reusable dependencies are:

| Dependency | Source of truth | What it returns |
|---|---|---|
| `get_db` | `dependencies.py` | `AsyncSession` |
| `get_settings` | `dependencies.py` | Cached `Settings` instance |
| `get_settings_store` | `dependencies.py` | JSON-backed `SettingsStore` |
| `get_vectordb` | `app.state` | `AsyncVectorStore` |
| `get_embedder` | `app.state` | Loaded `Embedder` or raises while still loading |
| `get_reranker` | `app.state` | `Reranker | None` |
| `get_llm_provider` | `app.state` | Default `LLMProvider` |
| `get_provider_registry` | `app.state` | `ProviderRegistry` |
| `get_query_llm` | `query_llm_resolver.py` | Optional LLM for HyDE/decomposition |
| `get_job_tracker` | `app.state` | `JobTracker` |
| `get_ws_manager` | `app.state` | `WSManager` |
| `get_project` | `project_service.py` | Resolves project by UUID or exact name |

## Schema Conventions

Most resource schemas follow the same pattern:

- `*Create` for `POST` bodies
- `*Update` for `PATCH` or `PUT` bodies
- `*Response` for serialized output

Common behavior:

- Partial updates use `model_dump(exclude_unset=True)`.
- ORM-backed response models typically use `model_config = {"from_attributes": True}`.
- Settings responses intentionally mask API keys before returning them to clients.
- Chat and search responses include retrieval metadata that is not persisted as a formal table-backed model. Search responses include an optional `query_plan` field with `type` (SIMPLE, KEYWORD_LOOKUP, CONCEPTUAL, MULTI_PART), `hyde`, `decomposed`, `search_mode_hint`, and `sub_queries`. Chat responses include `retrieval_metadata` with `query_plan`, `candidates_fetched`, `reranked`, and `retrieval_ms`.

## Project Path Resolution

Any route using `project=Depends(get_project)` accepts either:

- a project UUID, or
- the exact project name

The resolver performs:

```python
select(Project).where((Project.id == project_id) | (Project.name == project_id))
```

## Pagination

Pagination is implemented per endpoint, not globally. These list endpoints currently expose `offset` and `limit` query params:

- `GET /api/v1/projects`
- `GET /api/v1/projects/{project_id}/files`
- `GET /api/v1/projects/{project_id}/notes`
- `GET /api/v1/projects/{project_id}/issues`
- `GET /api/v1/projects/{project_id}/chat/sessions`
- `GET /api/v1/projects/{project_id}/chat/sessions/{session_id}/messages`
- `GET /api/v1/chat/sessions`
- `GET /api/v1/chat/sessions/{session_id}/messages`

Current bounds:

- Most list endpoints use `offset >= 0`, `1 <= limit <= 100`.
- Chat message history uses `1 <= limit <= 200`.
- File chunks use `1 <= limit <= 1000` plus `offset >= 0`.

## Request Knobs That Matter

### Search

`SearchRequest` includes:

- `query`: required, non-empty
- `top_k`: `1..50`, default `10`
- `mode`: `hybrid`, `vector`, or `keyword`; default `hybrid`

### Chat

`ChatMessageRequest` includes:

- `query`: required, non-empty
- `top_k`: `1..50`, default `10`
- `include_history`: default `false`
- `llm_mode`: optional provider override (`claude`, `openai`, `gemini`, `ollama`)
- `pinned_source_ids`: optional list of file/note/issue IDs to force into context

Important current behavior:

- `include_history=false` keeps only the recent short context window.
- `include_history=true` increases the history window to the full configured history budget.
- Query planning may switch a `hybrid` search into effective keyword mode for identifier-style lookups.
- HyDE and query decomposition only run when `get_query_llm()` resolves a usable provider.

## Rate Limiting

Chat endpoints are protected by `ChatRateLimiter`, a two-tier sliding-window system with separate buckets for streaming and non-streaming requests:

| Bucket | Default limit | Window |
|---|---|---|
| Non-stream per-client | 30 requests | 60 seconds |
| Non-stream global | 120 requests | 60 seconds |
| Stream per-client | 15 requests | 60 seconds |
| Stream global | 60 requests | 60 seconds |

Client identity is derived from a SHA-256 hash of the `X-Momodoc-Token` header, falling back to IP address, then `"anonymous"`.

## Chat Session Ownership

Chat sessions are ownership-scoped. Project-scoped endpoints enforce that the session's `project_id` matches the path parameter, while global endpoints enforce that `project_id IS NULL`. A session created via `/api/v1/projects/{id}/chat/sessions` cannot be accessed via `/api/v1/chat/sessions/{session_id}` and vice versa -- the service returns `404` even though the session exists.

## File Upload Limits

File uploads are subject to a configurable maximum file size (`max_upload_size_mb`, default `100 MB`). The file is streamed to disk in 64 KB chunks, and if the cumulative size exceeds the limit mid-upload, a `422 ValidationError` is raised and the partially-written file is cleaned up.

## Batch Operations

Batch endpoints (`batch-delete`, `batch-tag`) enforce `min_length=1, max_length=100` on the `ids` array. Batch operations use partial-success semantics: items are processed sequentially, individual failures are collected but do not abort the batch, and the response includes both a count and an `errors` list.

## Error Responses

Error handling is registered in `backend/app/bootstrap/exceptions.py` plus the auth middleware.

| Status | Source | Current behavior |
|---|---|---|
| `401` | `SessionTokenMiddleware` | Missing or invalid `X-Momodoc-Token` |
| `403` | `GET /api/v1/token` | Caller is not localhost |
| `404` | `NotFoundError` or explicit `HTTPException` | Missing entity or unknown provider |
| `409` | `ConflictError` | Duplicate project name or concurrent sync conflict |
| `409` | `EmbeddingModelMismatchError` | Embedding model safety conflict |
| `422` | `ValidationError` | Invalid request data, path sandbox violations, parse/size issues |
| `429` | `RateLimitExceededError` | Includes `Retry-After`, `scope`, `limit`, `retry_after_seconds` |
| `500` | `VectorStoreError` | Returns `{"detail":"Internal vector storage error"}` |
| `500` | generic exception handler | Returns `{"detail":"Internal server error"}` |
| `502` | `LLMError` | Upstream provider failure |
| `503` | `LLMNotConfiguredError` | No provider configured for chat |
| `503` | `EmbeddingServiceUnavailableError` | Embedder unavailable or still loading |

## Streaming (SSE)

Streaming chat endpoints:

- `POST /api/v1/projects/{project_id}/chat/sessions/{session_id}/messages/stream`
- `POST /api/v1/chat/sessions/{session_id}/messages/stream`

Current event sequence from `chat_service.stream_query()`:

1. `event: sources` with the serialized source list
2. `event: retrieval_metadata` when retrieval diagnostics are available
3. repeated unnamed `data:` events containing `{"token":"..."}` payloads
4. `event: done` with `{"message_id":"..."}` when the assistant message is persisted
5. `event: error` only if streaming fails mid-flight

Transport details:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

## WebSocket

`WS /ws` is the real-time channel for non-chat push events.

- Auth uses `?token=` because browser WebSocket handshakes cannot attach the custom header used by HTTP routes.
- Invalid or missing token closes the socket with code `4001`.
- Missing `ws_manager` closes the socket with code `4002`.
- The server currently broadcasts `startup_progress`, `sync_progress`, `sync_complete`, and `sync_failed`.

## Endpoint Reference

### Health and bootstrap

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/health` | Returns `status`, `service`, and `ready` |
| `GET` | `/api/v1/token` | Localhost-only token bootstrap |

### Projects

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/projects` | Creates project; may auto-trigger sync and watcher if `source_directory` is set |
| `GET` | `/api/v1/projects` | Paginated list with counts |
| `GET` | `/api/v1/projects/{project_id}` | Accepts UUID or exact name |
| `PATCH` | `/api/v1/projects/{project_id}` | Updates project; changing `source_directory` may trigger sync and watcher update |
| `DELETE` | `/api/v1/projects/{project_id}` | Deletes project, cascaded DB rows, vectors, and managed uploaded files |

### Directory browsing

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/directories/browse` | Returns allowed roots or subdirectories under an allowed path. Skips dotfiles/directories, does not follow symlinks, sorts case-insensitively. Returns `422` when `ALLOWED_INDEX_PATHS` is empty. Response includes `parent_path` for upward navigation (`null` when parent is outside allowed paths). |

### Files and sync

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/projects/{project_id}/files/upload` | Uploads to `upload_dir`, ingests, returns `FileResponse` |
| `POST` | `/api/v1/projects/{project_id}/files/index-directory` | One-shot directory ingestion; validates `ALLOWED_INDEX_PATHS` |
| `POST` | `/api/v1/projects/{project_id}/files/sync` | Starts background sync job, returns `202` |
| `GET` | `/api/v1/projects/{project_id}/files/sync/status` | Active job or `null` |
| `GET` | `/api/v1/projects/{project_id}/files/jobs/{job_id}` | Current job snapshot |
| `GET` | `/api/v1/projects/{project_id}/files` | Paginated file list |
| `GET` | `/api/v1/projects/{project_id}/files/{file_id}` | Single file |
| `PATCH` | `/api/v1/projects/{project_id}/files/{file_id}` | Updates tags only |
| `GET` | `/api/v1/projects/{project_id}/files/{file_id}/content` | Re-parses the file from disk |
| `GET` | `/api/v1/projects/{project_id}/files/{file_id}/chunks` | Returns stored LanceDB chunks |
| `DELETE` | `/api/v1/projects/{project_id}/files/{file_id}` | Deletes DB row first, then vectors and managed file |
| `POST` | `/api/v1/projects/{project_id}/files/batch-delete` | Batch delete files |
| `POST` | `/api/v1/projects/{project_id}/files/batch-tag` | Batch update tags |

Current sync-job note:

- `SyncJobResponse` includes `completed_files`, `succeeded_files`, and `errors`.
- `completed_files` and `succeeded_files` are computed response fields, not DB columns.
- The current routers return `errors: []` because `_job_to_response()` does not load `SyncJob.errors`.

### Notes

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/projects/{project_id}/notes` | Creates and indexes note chunks |
| `GET` | `/api/v1/projects/{project_id}/notes` | Paginated note list |
| `GET` | `/api/v1/projects/{project_id}/notes/{note_id}` | Single note |
| `PATCH` | `/api/v1/projects/{project_id}/notes/{note_id}` | Re-indexes when content changes |
| `DELETE` | `/api/v1/projects/{project_id}/notes/{note_id}` | Deletes note and vectors |

### Issues

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/projects/{project_id}/issues` | Creates issue and indexes it |
| `GET` | `/api/v1/projects/{project_id}/issues` | Paginated issue list; optional `status` filter |
| `PATCH` | `/api/v1/projects/{project_id}/issues/{issue_id}` | Updates and re-indexes when needed |
| `DELETE` | `/api/v1/projects/{project_id}/issues/{issue_id}` | Deletes issue and vectors |
| `POST` | `/api/v1/projects/{project_id}/issues/batch-delete` | Batch delete issues |

### Project chat

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/projects/{project_id}/chat/sessions` | Creates session |
| `GET` | `/api/v1/projects/{project_id}/chat/sessions` | Paginated session list |
| `DELETE` | `/api/v1/projects/{project_id}/chat/sessions/{session_id}` | Deletes session |
| `PATCH` | `/api/v1/projects/{project_id}/chat/sessions/{session_id}` | Renames session |
| `GET` | `/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages` | Paginated history |
| `POST` | `/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages` | Non-streaming chat response |
| `POST` | `/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages/stream` | SSE chat response |

### Global chat

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/chat/sessions` | Creates session with `project_id = null` |
| `GET` | `/api/v1/chat/sessions` | Paginated session list |
| `DELETE` | `/api/v1/chat/sessions/{session_id}` | Deletes session |
| `PATCH` | `/api/v1/chat/sessions/{session_id}` | Renames session |
| `GET` | `/api/v1/chat/sessions/{session_id}/messages` | Paginated history |
| `POST` | `/api/v1/chat/sessions/{session_id}/messages` | Non-streaming global chat |
| `POST` | `/api/v1/chat/sessions/{session_id}/messages/stream` | SSE global chat |

### Search and export

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/search` | Global search |
| `POST` | `/api/v1/projects/{project_id}/search` | Project-scoped search |
| `GET` | `/api/v1/projects/{project_id}/chat/sessions/{session_id}/export` | Chat export; returns `StreamingResponse` with `Content-Disposition: attachment` header. Format defaults to `markdown`. Filename derived from session title (spaces to underscores, truncated to 50 chars). |
| `GET` | `/api/v1/projects/{project_id}/search/export` | Search export; same download behavior as chat export. Accepts `query` (required, `min_length=1`) and `top_k` (1-50, default 10) as query params -- executes a fresh search at export time. |

### LLM and settings

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/llm/providers` | Provider availability summary |
| `GET` | `/api/v1/llm/providers/{provider}/models` | Live API-backed model list when possible, curated fallback otherwise. OpenAI results are filtered to chat-relevant prefixes (`gpt-4`, `gpt-5`, `gpt-3.5`, `o1`, `o3`, `o4`). Gemini strips `models/` prefixes and filters to `gemini-*`. Ollama hits `{base_url}/api/tags` with a 5-second timeout. Each model includes an `is_default` flag. |
| `GET` | `/api/v1/settings` | Returns masked LLM settings |
| `PUT` | `/api/v1/settings` | Persists LLM settings to `settings.json` via `SettingsStore.update()`, mutates the in-memory `Settings` singleton via `object.__setattr__()`, then calls `registry.reload(settings)` to invalidate all cached providers. Empty-string values are not applied to in-memory settings (filtered by `value not in (None, "")`) |

### Metrics

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/metrics/overview` | Overview counters plus uptime-related data |
| `GET` | `/api/v1/metrics/projects` | Per-project metrics |
| `GET` | `/api/v1/metrics/chat` | Chat metrics with `days` filter (`1..365`, default `30`). Returns `daily` array of `{date, sessions, messages}`, `total_sessions`, `total_messages`, `avg_messages_per_session` |
| `GET` | `/api/v1/metrics/storage` | Storage usage: `database_bytes`, `vectors_bytes`, `uploads_bytes` computed by walking filesystem dirs in a thread pool |
| `GET` | `/api/v1/metrics/sync` | Sync metrics with `days` filter (`1..365`, default `30`) |

## Adding a New Endpoint

1. Define or extend schemas in `backend/app/schemas/`.
2. Implement the business logic in a service module under `backend/app/services/`.
3. Add a thin router handler under `backend/app/routers/`.
4. Register the router in `backend/app/bootstrap/routes.py`.
5. Add frontend/shared client support in `frontend/src/shared/renderer/lib/apiClientCore.ts` and `frontend/src/shared/renderer/lib/types.ts`.
6. Add backend tests and, when applicable, frontend/desktop/extension coverage.
