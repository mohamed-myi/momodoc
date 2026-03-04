# Momodoc Technical Portfolio

Last verified against source on 2026-03-04.

Momodoc is a local-first knowledge and project management system built around one FastAPI backend, embedded persistence, and multiple client surfaces that all operate against the same local data.

## Current Product Surfaces

- web frontend served as static assets by the backend
- Electron desktop app with sidecar backend management, overlay, diagnostics, updater, and onboarding
- VS Code extension with a sidebar chat webview, file-ingest command, and sidecar lifecycle management
- CLI for backend serving, chat, search, migrations, and evaluation workflows

## Core Technical Shape

- backend: Python 3.12, FastAPI, SQLAlchemy async, Alembic
- relational persistence: SQLite in WAL mode
- retrieval persistence: LanceDB
- embeddings: local `sentence-transformers`
- reranking: optional local cross-encoder reranker
- web UI: Next.js static export, React 19, TypeScript, Tailwind v4
- desktop: Electron with a packaged backend runtime for release builds
- extension: TypeScript VS Code extension with a shared sidecar lifecycle core

## Architectural Themes

- local-first by default: no cloud database or hosted backend is required
- one backend, many clients: desktop, web, VS Code, and CLI all converge on the same API and data stores
- retrieval over heterogeneous content: files, notes, and issues all land in one vector table
- optional LLM layer: search and indexing work without API keys; chat requires an available LLM provider

## Deep-Dive Documents

| Document | Focus |
|---|---|
| [System Design](system-design.md) | Runtime topology, deployment modes, auth, frontend serving, client boundaries |
| [RAG Pipeline](rag-pipeline.md) | Parsing, chunking, embedding, retrieval planning, reranking, chat context assembly |
| [Data Architecture](data-architecture.md) | SQLite and LanceDB split, async concurrency wrapper, deletion and migration behavior |
| [LLM Abstraction](llm-abstraction.md) | Provider interface, registry, hot reload, query-time LLM resolution, streaming |
| [Desktop Engineering](desktop-engineering.md) | Electron sidecar lifecycle, IPC, overlay, startup profiles, shared renderer strategy |
| [Architecture Decisions](architecture-decisions.md) | Key implementation decisions reflected in the current codebase |
