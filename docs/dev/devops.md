# DevOps

## Architecture

Momodoc runs as a **single native Python process**. No Docker, no separate vector database. The FastAPI backend serves the API, static frontend, and manages embedded LanceDB and SQLite databases.

All data is stored in the **OS user data directory** (via `platformdirs`):

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/momodoc/` |
| Linux | `~/.local/share/momodoc/` |
| Windows | `C:\Users\<user>\AppData\Local\momodoc\` |

Override with `MOMODOC_DATA_DIR` environment variable.

### Data Directory Layout

```
<data_dir>/
├── db/momodoc.db        # SQLite database
├── vectors/             # LanceDB vector tables
├── uploads/             # Managed file uploads
├── session.token        # Transient auth token (auto-generated on startup)
├── momodoc.pid          # PID of running server
└── momodoc.port         # Port of running server
```

## Server Lifecycle

### CLI Commands

| Command | Description |
|---------|-------------|
| `momodoc serve` | Start the server (foreground, binds to 127.0.0.1:8000) |
| `momodoc serve --port 9000` | Start on a custom port |
| `momodoc serve --reload` | Start with auto-reload for development |
| `momodoc status` | Check if the server is running (PID, port, URL) |
| `momodoc stop` | Stop the running server (SIGTERM, then SIGKILL after 5s) |

### Process Management

- On `serve`: writes PID to `momodoc.pid`, port to `momodoc.port` in the data directory
- On `stop`: reads PID from file, sends SIGTERM, waits up to 5 seconds, then SIGKILL if needed
- Stale PID files (process not running) are automatically cleaned up
- Port conflicts are detected before starting

### Session Token

- Generated on startup: `secrets.token_urlsafe(32)`
- Written to `{data_dir}/session.token`
- Required as `X-Momodoc-Token` header on all API requests (except health and token endpoints)
- The CLI reads the token automatically from the data directory
- The web frontend fetches it via `GET /api/v1/token` (localhost-only)
- Deleted on shutdown

### Application Startup

The lifespan sequence includes:

The startup sequence is driven by `bootstrap/startup.py`:

1. Configure logging (rotating file handlers for `momodoc.log` and `momodoc-startup.log`)
2. Create data/upload/vector directories
3. Initialize SQLite database engine (WAL mode, foreign keys ON, 5s busy timeout)
4. Run Alembic migrations programmatically
5. Verify embedding model consistency (`system_config` table)
6. Initialize `VectorStore` (LanceDB) and `AsyncVectorStore`
7. Initialize default LLM provider and `ProviderRegistry`
8. Generate session token and write to disk (`session.token`, `0o600` permissions)
9. Initialize `JobTracker` and recover stale jobs from previous crashes (`recover_stale_jobs()`)
10. Initialize `WSManager` and `ProjectFileWatcher`
11. Mark app ready and launch deferred startup task

**Deferred startup** (runs in background after the API is live):
- Load embedding model (`nomic-ai/nomic-embed-text-v1.5`) via `Embedder`
- Load cross-encoder reranker (if `RERANKER_ENABLED`; MiniLM on CPU, BGE on capable GPU)
- Build FTS index asynchronously via `AsyncVectorStore.create_fts_index()`
- Cleanup orphaned vectors (`maintenance.cleanup_orphaned_vectors`)
- Auto-trigger sync for projects with `source_directory`
- Start filesystem watchers for those projects
- Broadcast progress via WebSocket `startup_progress` events

### Auto-Sync

On startup, all projects with a `source_directory` are automatically synced in the background:
- Sync jobs are launched via `asyncio.create_task()` (non-blocking — doesn't delay server startup)
- Each project gets its own background job with progress tracking
- Directories that no longer exist are skipped with a warning log
- Sync progress events are broadcast via WebSocket to connected clients
- Jobs are persisted in SQLite (`sync_jobs` + `sync_job_errors` tables). Stale jobs from crashes are recovered on startup.
- Check server logs for sync progress and errors

## WebSocket

Real-time sync progress events are available via WebSocket:

- **Endpoint:** `WS /ws?token=<session-token>`
- **Auth:** Token via query parameter (not header — browsers can't send custom headers on WS handshakes)
- **Events:** JSON messages with `type` field: `sync_progress`, `sync_complete`, `sync_failed`, `startup_progress`
- **Manager:** `WSManager` in `core/ws_manager.py` — manages connections, broadcasts events to all connected clients
- Alternative to polling `GET /files/sync/status` every second

## Makefile Targets

| Target | What it runs | Description |
|--------|-------------|-------------|
| `make momo-install` | Create venv + `pip install` + desktop `npm install` | Install backend and desktop dependencies |
| `make dev` | `uvicorn --reload` | Start backend only with auto-reload |
| `make dev-desktop` | `cd desktop && npm run dev` | Start Electron desktop app in dev mode |
| `make build-desktop` | `cd desktop && npm run build` | Build desktop app bundles (compile only; no installer) |
| `make package-desktop` | `cd desktop && npm run package:current` | Package desktop app for current platform (installer/archive) |
| `make serve` | `momodoc serve` | Start the momodoc server |
| `make stop` | `momodoc stop` | Stop a running momodoc instance |
| `make status` | `momodoc status` | Check if momodoc is running |
| `make test` | `cd backend && pytest` | Run backend test suite |
| `make clean` | Stop server + remove data dir | Remove all data (DESTROYS DATA, requires confirmation) |
| `make help` | Parse Makefile | Show all targets with descriptions |

To build the static frontend and serve it from FastAPI, run manually:

```bash
cd frontend && npm install && npm run build
rm -rf backend/static && cp -R frontend/out backend/static
```

## Environment Variables

All config is via `.env` file (see `.env.example`). Key variables:

### Required for Chat

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `claude` | Default LLM backend (`claude`, `openai`, `gemini`, `ollama`) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (required when `LLM_PROVIDER=claude`) |
| `OPENAI_API_KEY` | — | OpenAI API key (required when `LLM_PROVIDER=openai`) |
| `GOOGLE_API_KEY` | — | Google API key (required when `LLM_PROVIDER=gemini`) |

### Optional — LLM Models (env fallback; UI settings take precedence)

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Claude model identifier |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model identifier |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model identifier |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama API base URL |
| `OLLAMA_MODEL` | `qwen2.5-coder:7b` | Ollama model identifier |

### Optional — Server and Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `127.0.0.1` | Server bind address |
| `PORT` | `8000` | Server port |
| `MOMODOC_DATA_DIR` | OS default | Override data directory |
| `MAX_UPLOAD_SIZE_MB` | `100` | Max file upload size |
| `MAX_FILE_SIZE_MB` | `200` | Max file size for directory indexing |
| `DEBUG` | `false` | Enable debug mode |
| `ALLOWED_INDEX_PATHS` | `[]` | Whitelisted directories for codebase indexing (empty = all rejected) |
| `DB_POOL_SIZE` | `5` | SQLAlchemy connection pool size |
| `DB_MAX_OVERFLOW` | `10` | Maximum overflow connections |
| `VECTORDB_SEARCH_NPROBES` | `24` | LanceDB search nprobes (higher = more accurate, slower) |
| `VECTORDB_SEARCH_REFINE_FACTOR` | `2` | LanceDB refine factor |
| `VECTORDB_MAX_READ_CONCURRENCY` | — | Max concurrent LanceDB reads via `AsyncVectorStore` |

### Optional — Reranker

| Variable | Default | Description |
|----------|---------|-------------|
| `RERANKER_ENABLED` | `true` | Enable the cross-encoder reranker for two-stage retrieval |
| `RERANKER_MODEL` | (auto-detect) | Reranker model name. Empty means auto-detect based on hardware (MiniLM on CPU, BGE on GPU) |
| `RERANKER_DEVICE` | (auto-detect) | Force a device for the reranker (`cpu`, `cuda`, `mps`). Empty means auto-detect |
| `RERANKER_MAX_WORKERS` | `2` | Thread pool size for the reranker |
| `RERANKER_TOP_K` | `10` | Number of results after reranking |
| `RETRIEVAL_CANDIDATE_K` | `50` | Number of candidates fetched before reranking (overretrieval factor) |

## CLI

The CLI is built with Typer + Rich and lives in `backend/cli/`. The top-level composition is in `cli/main.py`, with server commands in `cli/commands/server.py` and RAG evaluation in `cli/commands/rag_eval.py`. It communicates with the running backend via HTTP (it does not access the DB directly).

### Running CLI Commands

```bash
cd backend && pip install -e .
momodoc serve                              # Start the server
momodoc project list                       # List projects
momodoc ingest file proj ./f.pdf           # Ingest a file
momodoc chat proj -q "question"            # Chat (single query)
momodoc chat proj                          # Interactive chat mode
momodoc chat proj --model gemini           # Chat with specific LLM provider
momodoc rag-eval proj -q "query" -k 5     # RAG retrieval evaluation
```

### Available CLI Command Groups

- `serve` / `stop` / `status` — Server lifecycle (in `cli/commands/server.py`)
- `project` — create, list, show, delete
- `ingest` — file, dir
- `note` — add, list
- `issue` — add, list, done
- `search` — vector search (no LLM)
- `chat` — single query or interactive mode (supports `--model` flag for LLM provider override)
- `rag-eval` — RAG retrieval quality evaluation (Recall@K, Precision@K, Hit Rate@K, MRR)

### Token and Port Auto-detection

The CLI (`cli/utils.py`) automatically:
- Reads the port from `{data_dir}/momodoc.port` to find the running server
- Reads the token from `{data_dir}/session.token` and includes it in `X-Momodoc-Token` header
- Falls back to `MOMODOC_API_URL` env var or `http://127.0.0.1:8000` default

## VS Code Extension

The `extension/` directory contains a VS Code extension for sidecar lifecycle management:

- Auto-starts the backend when VS Code opens (if not already running)
- Status bar indicator showing server state
- Chat sidebar (webview) for RAG-powered Q&A
- Right-click context menu to ingest files into a project
- Respects `MOMODOC_DATA_DIR` environment variable (reads port/token/PID from the custom location)

## Service URL

When running: `http://127.0.0.1:8000` (both frontend and API on same port).
API docs at `/docs`.
