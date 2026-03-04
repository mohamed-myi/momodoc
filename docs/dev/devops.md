# DevOps

This document covers the current operational model for Momodoc across the backend, desktop sidecar flow, CLI, and supporting workspace scripts.

## Runtime Model

Momodoc's core service is a single local FastAPI backend process backed by embedded SQLite and LanceDB. Other product surfaces talk to that backend:

- the CLI connects over HTTP
- the web frontend calls the backend directly
- the desktop app starts or reuses the backend as a sidecar
- the VS Code extension can start or stop the backend on demand

There is no Docker configuration and no separate hosted vector database in this repo.

## Data Directory

Backend runtime state is stored under `platformdirs.user_data_dir("momodoc")` unless `MOMODOC_DATA_DIR` overrides it.

Typical default locations:

| OS | Default path |
|---|---|
| macOS | `~/Library/Application Support/momodoc/` |
| Linux | `~/.local/share/momodoc/` |
| Windows | `C:\Users\<user>\AppData\Local\momodoc\` |

Current backend-owned contents:

```text
<data_dir>/
  db/momodoc.db
  vectors/
  uploads/
  settings.json
  session.token
  momodoc.pid
  momodoc.port
  momodoc.log
  momodoc-startup.log
```

Desktop-specific files that are also written nearby in normal desktop usage:

- `sidecar.log` in the shared Momodoc data dir
- `updater.log` in Electron's `app.getPath("userData")`

## Configuration Precedence

The backend loads settings from:

1. persisted `settings.json`
2. environment variables and `.env`
3. coded defaults in `backend/app/config.py`

Important scope detail:

- `settings.json` currently persists only LLM-related settings because `SettingsStore` filters writes to that key set.
- Infrastructure settings such as `PORT`, `MOMODOC_DATA_DIR`, chunk sizes, and sync concurrency still come from env/defaults.

## Server Lifecycle

### CLI commands

| Command | Current behavior |
|---|---|
| `momodoc serve` | Starts the backend in the foreground |
| `momodoc serve --port 9000` | Overrides the port |
| `momodoc serve --reload` | Runs uvicorn reload mode |
| `momodoc status` | Prints PID, port, URL, and data dir if running |
| `momodoc stop` | Sends `SIGTERM`, waits up to 5 seconds (polling every 100ms), then escalates to `SIGKILL`; also cleans up `session.token`, PID, and port files |

### Process files

`cli/commands/server.py` currently manages these files:

- `momodoc.pid`: locked with an exclusive non-blocking file lock (`fcntl.flock` on Unix, `msvcrt.locking` on Windows) for single-instance startup protection; the lock is held for the entire process lifetime and released automatically on exit or crash
- `momodoc.port`: written on startup
- `session.token`: written by backend lifespan, not by the CLI wrapper

Behavior worth knowing:

- `serve` rejects an already-running backend before booting uvicorn.
- `serve` checks port availability before startup.
- `stop` cleans stale PID/port/token files when it detects a dead process.
- `status` is runtime-file based; it does not call the HTTP API.

## Startup Sequence

The authoritative startup flow lives in `backend/app/bootstrap/startup.py`.

### Critical path

Before requests are served, startup does the following:

1. configures logging
2. ensures data, upload, and vector directories exist
3. loads persisted LLM settings from `settings.json`
4. initializes the async SQLite engine/session factory
5. runs Alembic migrations
6. initializes `WSManager` (early, so startup broadcasts can use it)
7. checks the recorded embedding model and triggers vector reset if needed
8. initializes `VectorStore` and `AsyncVectorStore`
9. initializes the provider registry and default LLM provider
10. writes the session token to disk
11. initializes `JobTracker` and recovers stale jobs
12. initializes `ProjectFileWatcher` (lightweight; no watches started yet)
13. seeds `app.state` and launches deferred startup tasks

At this point the API is reachable, but `GET /api/v1/health` reports `"ready": false`. The session token file is written with restricted permissions (`0o600`, owner read/write only) to prevent other users on shared systems from reading it.

### Deferred startup

Background startup then:

- loads the embedder
- loads the reranker if enabled
- builds the LanceDB FTS index
- cleans orphaned vectors
- starts auto-sync for projects with `source_directory`
- starts file watchers for those projects
- broadcasts `startup_progress` events over WebSocket

## Auto-Sync and File Watching

Projects with a `source_directory` participate in two related flows:

- startup auto-sync launched from `bootstrap/startup.py`
- live file watching started through `bootstrap/watcher.py`

Current sync architecture:

- one active sync job per project enforced by `JobTracker`
- discovery and processing run through a bounded async queue
- per-file progress is persisted in `sync_jobs`
- file-level failures are recorded in `sync_job_errors`
- WebSocket broadcasts `sync_progress`, `sync_complete`, and `sync_failed`

Current watcher behavior:

- debounce window: `0.5s`
- ignores hidden filenames and ignored directory names
- only reacts to supported extensions
- create/modify events re-ingest files
- delete events remove file rows and vectors

## Makefile and Workspace Commands

### Root Makefile

| Command | What it actually does |
|---|---|
| `make momo-install` | Creates `backend/.venv`, installs backend package with dev extras, installs `desktop/` npm deps |
| `make dev` | Runs uvicorn reload mode from the backend venv |
| `make dev-desktop` | Runs `desktop` dev mode |
| `make build-desktop` | Runs `desktop` compile/build only |
| `make package-desktop` | Runs `desktop` packaging for the current platform |
| `make serve` | Runs `backend/.venv/bin/momodoc serve` |
| `make stop` | Runs `backend/.venv/bin/momodoc stop` |
| `make status` | Runs `backend/.venv/bin/momodoc status` |
| `make test` | Runs backend pytest only |
| `make clean` | Stops Momodoc and deletes the data dir after confirmation |

Important repo detail:

- `make momo-install` does not install `frontend/` or `extension/` dependencies.
- Install those workspaces manually when you need them.

### Frontend workspace

```bash
cd frontend
npm install
npm run dev
npm run build
npm run test:unit
npm run test:e2e
```

### Desktop workspace

```bash
cd desktop
npm install
npm run dev
npm run build
npm run typecheck
npm run test:unit
```

### VS Code extension workspace

```bash
cd extension
npm install
npm run compile
npm test
npm run package
```

## Environment Variables

`Settings` in `backend/app/config.py` is the source of truth. Pydantic reads env vars using the field names in upper snake case.

### App and server

| Env var | Default |
|---|---|
| `APP_NAME` | `momodoc` |
| `DEBUG` | `false` |
| `LOG_LEVEL` | `INFO` |
| `HOST` | `127.0.0.1` |
| `PORT` | `8000` |
| `MOMODOC_DATA_DIR` | platform default |
| `DATABASE_URL` | derived from `MOMODOC_DATA_DIR` |
| `STATIC_DIR` | `backend/static` if present |

### LLM providers

| Env var | Default |
|---|---|
| `LLM_PROVIDER` | `claude` |
| `ANTHROPIC_API_KEY` | empty |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` |
| `OPENAI_API_KEY` | empty |
| `OPENAI_MODEL` | `gpt-4o` |
| `GOOGLE_API_KEY` | empty |
| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` |
| `OLLAMA_MODEL` | `qwen2.5-coder:7b` |

### Embedding and vector DB

| Env var | Default |
|---|---|
| `EMBEDDING_MODEL` | `nomic-ai/nomic-embed-text-v1.5` |
| `EMBEDDING_DIMENSION` | `768` |
| `EMBEDDING_DEVICE` | empty, auto-detect at runtime |
| `EMBEDDING_TRUST_REMOTE_CODE` | `true` |
| `EMBEDDING_MAX_WORKERS` | CPU-derived |
| `VECTORDB_MAX_WORKERS` | CPU-derived |
| `VECTORDB_MAX_READ_CONCURRENCY` | CPU-derived |
| `VECTORDB_SEARCH_NPROBES` | `32` |
| `VECTORDB_SEARCH_REFINE_FACTOR` | `2` |

### Ingestion and storage

| Env var | Default |
|---|---|
| `SYNC_MAX_CONCURRENT_FILES` | `4` |
| `SYNC_QUEUE_SIZE` | `64` |
| `INDEX_MAX_CONCURRENT_FILES` | `4` |
| `INDEX_DISCOVERY_BATCH_SIZE` | `256` |
| `CHUNK_SIZE_DEFAULT` | `2000` |
| `CHUNK_OVERLAP_DEFAULT` | `200` |
| `CHUNK_SIZE_CODE` | `2000` |
| `CHUNK_SIZE_PDF` | `3000` |
| `CHUNK_SIZE_MARKDOWN` | `2000` |
| `MAX_UPLOAD_SIZE_MB` | `100` |
| `MAX_FILE_SIZE_MB` | `200` |
| `ALLOWED_INDEX_PATHS` | empty list |

### Database pool

| Env var | Default |
|---|---|
| `DB_POOL_SIZE` | `5` |
| `DB_MAX_OVERFLOW` | `10` |

### Reranker

| Env var | Default |
|---|---|
| `RERANKER_ENABLED` | `true` |
| `RERANKER_MODEL` | empty |
| `RERANKER_DEVICE` | empty |
| `RERANKER_MAX_WORKERS` | `2` |
| `RETRIEVAL_CANDIDATE_K` | `50` |

### Chat rate limiting

| Env var | Default |
|---|---|
| `CHAT_RATE_LIMIT_ENABLED` | `true` |
| `CHAT_RATE_LIMIT_WINDOW_SECONDS` | `60` |
| `CHAT_RATE_LIMIT_GLOBAL_REQUESTS` | `120` |
| `CHAT_RATE_LIMIT_CLIENT_REQUESTS` | `30` |
| `CHAT_STREAM_RATE_LIMIT_GLOBAL_REQUESTS` | `60` |
| `CHAT_STREAM_RATE_LIMIT_CLIENT_REQUESTS` | `15` |

## Static Frontend Serving

FastAPI serves a built static frontend when `backend/static/` exists.

Current web build flow:

```bash
cd frontend
npm install
npm run build
rm -rf ../backend/static
cp -R out ../backend/static
```

The static mount is registered after API routes, so `/api/v1/...` keeps priority.

## CLI Notes

The CLI is HTTP-based. It does not open the database directly.

Current command groups:

- `project`
- `ingest`
- `note`
- `issue`

Current top-level commands:

- `search`
- `chat`
- `rag-eval`
- `serve`
- `stop`
- `status`

### CLI HTTP client

All CLI commands (except `serve`/`stop`/`status`) connect to the backend via HTTP using a shared `api_client()` utility in `cli/utils.py`. This client resolves the backend URL through a 3-step fallback:

1. `MOMODOC_API_URL` environment variable
2. the port from `momodoc.port` file in the data directory
3. fallback to `http://127.0.0.1:{settings.port}`

It also automatically reads the session token from `session.token` and attaches it as an `X-Momodoc-Token` header. Default HTTP timeout is 120 seconds.

Important current behavior:

- `search` is retrieval-only and does not call an LLM.
- `chat` supports `--model` for provider override and has two modes: `--query` for a single non-interactive query, and (when `--query` is omitted) a full interactive REPL with persistent session, multi-turn conversation, and exit on `exit`/`quit`/`Ctrl+C`.
- `rag-eval` bypasses the HTTP API entirely and loads `Embedder`, `VectorStore`, and `AsyncVectorStore` directly in-process. It supports `--output` for writing a JSON report, `--max-cases` to cap evaluation size, and `--concurrency` (default 8) for parallel retrieval. Metrics include recall@K, precision@K, hit rate@K, and MRR. Note: runs the embedding model in a separate process, so high memory usage if the backend is also running.

## Desktop and Extension Operational Notes

### Shutdown sequence

The backend lifespan shutdown performs ordered resource teardown:

1. Stop all file watchers
2. Shutdown embedder thread pool and loky process pool
3. Shutdown reranker thread pool
4. Cancel deferred FTS index task (with `asyncio.CancelledError` suppression)
5. Shutdown vector DB executor
6. Remove `session.token`

### Desktop

- The packaged desktop app resolves a backend launch command through `resolveBackendLaunchCommand()`: looks for `backend-runtime/run-backend.sh` (Unix) or `run-backend.cmd`/`run-backend.ps1` (Windows) under `process.resourcesPath`; on Windows falls back from `.cmd` to PowerShell with `-ExecutionPolicy Bypass`; in dev mode falls back to `momodoc serve`.
- The child process is spawned detached (`detached: true`) and unref'd so Electron dev restarts only kill Electron, not the backend.
- The sidecar has a structured startup state machine (`idle` -> `starting` -> `ready`/`failed`/`stopped`) and classifies failures into categories: `spawn-error`, `timeout`, `port-conflict`, `runtime-error`, `unknown`. Stderr is pattern-matched for `port.*already in use` and `error` to classify in real time.
- When a stale PID file is found with a live process, the sidecar polls the health endpoint for 20 seconds; if unresponsive, it sends `SIGKILL` and starts fresh. New process spawn has a 30-second readiness timeout.
- The sidecar only stops the backend if it owns the process it started.
- The desktop app logs sidecar lifecycle messages to `sidecar.log`.
- Desktop `ConfigStore.toEnvVars()` does NOT inject LLM settings (provider, API keys, models) as environment variables -- those are managed exclusively through `settings.json` via the settings API. Only infrastructure settings are env-var-injected: `PORT`, `HOST`, `MOMODOC_DATA_DIR`, `LOG_LEVEL`, `DEBUG`, and all chunking/rate-limiting/concurrency/retrieval settings.

### VS Code extension

- The extension does not auto-start the backend on activation.
- It registers commands to start/stop the server, open the web UI, ingest a file, and open settings.
- On activation it only checks whether a backend is already running and updates the status bar/output channel accordingly.
