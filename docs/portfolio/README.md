# Momodoc: Technical Portfolio

Momodoc is a personal RAG-based knowledge management system. Users organize files, notes, and issues into projects, then query them with AI-powered chat that retrieves relevant context and cites sources. Everything except chat runs without an API key.

## Tech Stack at a Glance

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, SQLAlchemy (async), Alembic |
| Vector Store | LanceDB (embedded), sentence-transformers |
| Metadata Store | SQLite (WAL mode) |
| LLM Integration | Claude, OpenAI, Gemini, Ollama (switchable per request) |
| Web Frontend | Next.js 15, React 19, TypeScript (strict), Tailwind CSS v4 |
| Desktop | Electron (sidecar lifecycle, overlay chat, settings, updater) |
| VS Code Extension | Sidecar lifecycle, chat sidebar, file ingestion |
| CLI | Typer + Rich |

## Architecture Summary

Four clients (desktop, web, VS Code extension, CLI) connect to a single FastAPI backend over localhost HTTP. The backend manages all data (SQLite for metadata, LanceDB for vectors) and orchestrates the RAG pipeline: parse, chunk, embed, store, retrieve, and generate.

## Deep-Dive Documents

| Document | Focus |
|----------|-------|
| [System Design](system-design.md) | Multi-client architecture, tech stack rationale, deployment model, authentication |
| [RAG Pipeline](rag-pipeline.md) | Parsing, chunking strategies, embedding choices, hybrid search, deduplication |
| [Data Architecture](data-architecture.md) | Dual-store design, async concurrency patterns, deletion strategy |
| [LLM Abstraction](llm-abstraction.md) | Provider-agnostic layer, factory pattern, streaming, rate limiting |
| [Desktop Engineering](desktop-engineering.md) | Electron sidecar, IPC design, overlay system, shared UI layer |
| [Architecture Decisions](architecture-decisions.md) | Key ADRs with alternatives considered and rationale |
