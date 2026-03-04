# System Design

Last verified against source on 2026-03-04.

## Problem Shape

Momodoc is designed for single-user, single-machine knowledge work:

- local files need to be indexed without cloud infrastructure
- retrieval should combine semantic search and full-text search
- the same corpus should be reachable from desktop, browser, editor, and CLI workflows

## Runtime Topology

The central runtime is the FastAPI backend. Every other surface either talks to it directly or manages it.

```text
Electron desktop renderer ----+
Web frontend -----------------+--> FastAPI backend --> SQLite
VS Code extension ----------- +                   --> LanceDB
CLI ------------------------- +                   --> local/remote LLM providers
```

Two important implementation details:

- the desktop renderer reaches the backend through the Electron main process, which manages the sidecar and exposes `window.momodoc` IPC bridges
- the web frontend is a static export; it does not ship its own Node server

## Client Surfaces

### Web frontend

The backend serves the frontend build from static files through `SPAStaticFiles`.

Current behavior:

- explicit asset paths still 404 normally
- non-asset paths fall back to `index.html`
- the frontend uses one exported Next page and internal state routing instead of App Router URL segments

### Desktop app

The desktop app is an Electron shell with:

- a main React renderer
- an optional overlay window
- packaged-build updater support
- sidecar management for the Python backend
- local config persisted in Electron store

Packaged builds prefer a bundled backend runtime. Development builds still use `momodoc serve`.

### VS Code extension

The extension contributes:

- an Activity Bar container with a chat webview
- commands to start and stop the backend
- a command and Explorer action to ingest a file into a project
- a status bar item reflecting backend state

The extension sidecar always launches `momodoc serve` from the environment; it does not bundle a backend runtime.

### CLI

The CLI is the headless entry point for server lifecycle and data operations.

Top-level commands:

- `serve`
- `stop`
- `status`
- `chat`
- `search`
- `rag-eval`

Command groups:

- `project`
- `ingest`
- `note`
- `issue`

## Deployment Modes

Momodoc does not have a single deployment shape. The current codebase supports several.

### Backend-only

Run `momodoc serve` or `make serve`, then use the browser, CLI, or VS Code extension against the local API.

### Desktop-managed

Launch the Electron app and let it:

- detect an existing backend
- or start its own sidecar
- then connect the renderer to that local backend

### Mixed local clients

It is valid for the desktop app, browser, CLI, and VS Code extension to all point at the same local backend at once. The desktop sidecar and VS Code sidecar both attempt to reuse a healthy existing backend before spawning their own.

## Persistence Model

Persistence is split by access pattern:

- SQLite stores relational entities, workflow state, chat history, sync jobs, and configuration markers
- LanceDB stores chunk text, vectors, and retrieval-facing metadata

This is not an abstract multi-database architecture exercise. It exists because the system needs:

- ACID-style metadata updates
- efficient vector retrieval and hybrid search over chunks

## Authentication Model

At startup, the backend generates a session token with `secrets.token_urlsafe(32)` and writes it to a `0600` token file inside the data directory.

Current request model:

- authenticated API requests send `X-Momodoc-Token`
- `GET /api/v1/token` is only available to localhost callers
- backend host defaults to `127.0.0.1`

This is designed for local trust boundaries, not internet exposure.

## Frontend Navigation Model

The current clients do not rely on server-side route resolution for their core app state.

Current view models:

- web: `dashboard | project | settings`
- desktop: `dashboard | project | settings | metrics`

The desktop renderer also persists and restores the last view when the startup profile allows it.

## Startup Model

The backend has a two-phase startup sequence.

### Critical path

Before serving requests it:

- configures logging
- loads persisted settings
- initializes the database and runs migrations
- initializes the WebSocket manager (early, for startup broadcasts)
- checks embedding-model compatibility
- initializes the LanceDB vector store
- creates the provider registry and default LLM provider
- writes the session token
- recovers job state
- initializes the file watcher

### Deferred startup

After the server is already accepting requests it:

- loads the embedder
- optionally loads the reranker
- builds the LanceDB FTS index
- cleans orphaned vectors
- launches auto-sync for projects with `source_directory`
- starts file watchers

That makes the system responsive sooner, but some capabilities become fully available only after deferred startup finishes.
