# System Design

## Problem Statement

Personal knowledge management tools either require cloud infrastructure (cost, privacy concerns) or sacrifice retrieval quality (basic keyword search). Momodoc provides local-first RAG with full embedding-based retrieval while remaining a single-process, zero-infrastructure deployment.

## Multi-Client Architecture

Momodoc serves four distinct client surfaces from one backend:

```
Desktop App (Electron)  ---+
Web Frontend (Next.js)  ---+--> FastAPI Backend --> SQLite + LanceDB
VS Code Extension       ---+                   --> LLM Providers
CLI (Typer)             ---+
```

The backend is the single source of truth. Clients are stateless HTTP consumers. This means:
- No client-to-client coordination is needed.
- Any combination of clients can run simultaneously.
- The backend can run headless (CLI-only) or with all four clients.

### Why not merge clients into one?

Each client serves a different workflow. The desktop app is the primary UI with metrics, settings, and an always-on-top overlay for quick queries. The web frontend provides a lighter browser-based experience. The VS Code extension integrates directly into the editor (ingest files, chat in sidebar). The CLI is for automation and scripting. Sharing a single backend means all four surfaces always see the same data without sync complexity.

## Tech Stack Rationale

### Python + FastAPI

Python was chosen for its dominant position in the ML/NLP ecosystem. sentence-transformers, PyMuPDF, python-docx, and tree-sitter all have mature Python bindings. FastAPI provides native async support, automatic OpenAPI docs, and Pydantic validation with minimal overhead. The async model matters because embedding and LLM calls are I/O-bound operations that benefit from concurrent request handling.

### SQLite (WAL mode)

A local-first tool should not require users to install and manage a database server. SQLite provides ACID transactions, foreign keys, and good enough throughput for a single-user workload. WAL (Write-Ahead Logging) mode enables concurrent reads while a write is in progress, which is important during sync jobs that write file metadata while the UI reads project listings.

### LanceDB (embedded)

LanceDB was selected over cloud vector databases (Pinecone, Weaviate) to keep the system entirely local and free of API costs. Unlike FAISS, LanceDB provides built-in Tantivy full-text search (enabling hybrid retrieval without a separate search index), persistent storage (no need to rebuild on restart), and SQL-like filtering (allowing project-scoped searches without loading all vectors into memory). The tradeoff is that LanceDB is less battle-tested at scale, but for personal knowledge management (thousands to tens of thousands of documents), this is acceptable.

### Electron for Desktop

The desktop app needs to manage a sidecar backend process, register global shortcuts, create overlay windows, and integrate with OS-level features (tray, auto-launch, file dialogs). Electron provides all of these through a mature API. The renderer shares React components with the web frontend, avoiding UI duplication. The overhead of Electron is justified by the shared component model and the complexity of the sidecar lifecycle.

### Next.js Static Export

The web frontend uses Next.js with `output: "export"` to produce static HTML/JS/CSS that the FastAPI backend serves directly. There is no separate frontend server. This eliminates a deployment concern (one process instead of two) and keeps the frontend as a pure static asset. The tradeoff is losing SSR, but for a local tool that authenticates via session token, SSR provides no benefit.

## Deployment Model

Momodoc runs as a single native Python process. No Docker, no separate database service, no reverse proxy. Data lives in the OS user data directory (`~/Library/Application Support/momodoc/` on macOS). The desktop app bundles a Python runtime so end users do not need Python installed.

This single-process model simplifies installation to one step and eliminates class-of-bugs related to service coordination. The constraint is single-machine, single-user deployment, which is the intended use case.

## Authentication Model

The backend generates a session token (`secrets.token_urlsafe(32)`) at startup and writes it to a file with mode `0600`. All API requests must include this token via the `X-Momodoc-Token` header. The token endpoint (`GET /api/v1/token`) returns the token but only to localhost requests.

This model works because:
- The backend only listens on `127.0.0.1` (not externally reachable).
- The token rotates on every restart (no long-lived credentials).
- File permissions restrict token access to the current user.

The tradeoff is that any local process can read the token file, but for a single-user local tool, this matches the threat model.

## State-Based Routing

The web frontend and desktop renderer use state-based routing (`useState<View>`) rather than URL-based routing. Views are `"dashboard"` or `"project"`. This was chosen because:
- The static export cannot handle dynamic URL segments without server-side rewrites.
- A single-page app with two primary views does not benefit from URL routing.
- State management is simpler when view transitions are function calls rather than URL pushes.

The tradeoff is no deep-linking or browser back/forward navigation, which is acceptable for a local tool where the entry point is always the dashboard.
