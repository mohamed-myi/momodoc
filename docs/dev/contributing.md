# Contributing

## Development Setup

### Prerequisites

- Python 3.11+
- Node.js 18+

### Install everything

```bash
make momo-install
cp .env.example .env
```

This creates `backend/.venv`, installs the backend package (editable, includes the `momodoc` CLI), and installs desktop + frontend Node dependencies.

### Start the backend

```bash
make dev    # with auto-reload (development)
make serve  # foreground (production-like)
```

### Start the desktop app (dev mode)

```bash
make dev-desktop
```

### Build the web frontend

```bash
cd frontend && npm install && npm run build
rm -rf backend/static && cp -R frontend/out backend/static
```

### Build the VS Code extension

```bash
cd extension && npm install && npm run compile && npm run package
```

## Coding Standards

### Backend (Python)

- async/await throughout; type hints on all functions
- Ruff linting: line-length 100, target py311
- Strict router -> service -> data layer separation
- Separate `Create`, `Update`, `Response` Pydantic schemas per resource
- Updates use `exclude_unset=True` for partial patches
- UUID4 strings for all entity IDs, UTC `datetime` for all timestamps
- CPU-bound work offloaded to executors (`asyncio.to_thread()`)

### Frontend (TypeScript)

- TypeScript strict mode
- `"use client"` on all components
- Path alias `@/*` maps to `./src/*`
- Shared UI code lives in `frontend/src/shared/renderer/`; client-specific components are thin re-export wrappers

### Desktop (Electron + TypeScript)

- Main process logic split across domain modules (sidecar, IPC, window factory, shutdown)
- IPC handlers organized by domain under `ipc/`
- Renderer imports shared components from `frontend/src/shared/renderer/`

## Running Tests

```bash
make test
```

Tests live in `backend/tests/unit` and `backend/tests/integration`. The suite uses pytest with pytest-asyncio (`asyncio_mode = "auto"`).

### Writing tests

- Integration tests go in `backend/tests/integration/` and use the shared conftest fixtures (async DB session, mock vector store, test client)
- Unit tests go in `backend/tests/unit/` and mock all external dependencies
- Cover both the success path and error/edge cases

## Linting

```bash
cd backend && .venv/bin/ruff check app
cd desktop && npm run lint
cd extension && npm run compile
```

## Database Migrations

Migrations auto-run at startup. To create a new migration:

```bash
cd backend
alembic revision --autogenerate -m "description of change"
```

## Environment Configuration

All runtime settings are defined in `backend/app/config.py`. Copy `.env.example` to `.env` and configure as needed. Cloud LLM provider keys are optional (only needed for chat features).

The `ALLOWED_INDEX_PATHS` setting must be set for directory indexing/sync to work.

## Useful Make Targets

```bash
make dev              # backend with auto-reload
make serve            # backend (foreground)
make stop             # stop running backend
make status           # check running backend
make test             # backend pytest suite
make dev-desktop      # run desktop app in dev mode
make build-desktop    # desktop compile/build only
make package-desktop  # package desktop app for current platform
make clean            # delete momodoc data dir (confirmation required)
make help             # list all targets
```
