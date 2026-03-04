# Testing

Momodoc currently has tests in four workspaces: backend, frontend, desktop, and extension.

## Current Test Matrix

| Workspace | Stack | Source of truth |
|---|---|---|
| `backend/` | `pytest`, `pytest-asyncio` | `backend/pyproject.toml`, `backend/tests/` |
| `frontend/` | `Vitest`, `Playwright` | `frontend/vitest.config.ts`, `frontend/playwright.config.ts`, `frontend/tests/` |
| `desktop/` | `Vitest` | `desktop/vitest.config.ts`, `desktop/tests/` |
| `extension/` | Node built-in test runner after TypeScript compile | `extension/package.json`, `extension/src/*.test.ts` |

## How To Run Tests

### Backend

```bash
make test
# or
cd backend
.venv/bin/pytest
```

### Frontend

```bash
cd frontend
npm run test:unit
npm run test:e2e
```

### Desktop

```bash
cd desktop
npm run test:unit
```

Current repo state note:

- There are checked-in specs under `desktop/tests/e2e/`, but the `desktop` workspace does not currently expose a dedicated Playwright script/config the way `frontend/` does.

### VS Code extension

```bash
cd extension
npm test
```

## Backend Tests

### Layout

```text
backend/tests/
  conftest.py
  integration/
  unit/
```

### Key fixtures

`backend/tests/conftest.py` currently provides:

| Fixture | Purpose |
|---|---|
| `db_engine` | In-memory async SQLite engine with tables created |
| `db_session` | Async SQLAlchemy session with global session factory override |
| `mock_vectordb` | AsyncVectorStore mock |
| `mock_embedder` | Embedder mock |
| `mock_reranker` | Reranker mock |
| `mock_llm` | LLMProvider mock |
| `mock_provider_registry` | Provider registry mock |
| `mock_job_tracker` | Real `JobTracker` instance |
| `mock_ws_manager` | WebSocket manager mock |
| `mock_file_watcher` | File watcher mock |
| `test_settings` | Test `Settings` override |
| `client` | Fully wired `httpx.AsyncClient` against `create_app()` with auth header set |

### What backend tests cover

The checked-in backend suite currently covers:

- routers and auth
- ingestion pipeline and directory walking
- vector store and async vector wrapper behavior
- query planning and search service behavior
- chat orchestration and streaming helpers
- rate limiting
- job tracking and sync service behavior
- embedding model registry/safety/settings store
- file watcher, maintenance, websocket manager, tokenizer, hardware helpers
- CLI composition and architecture regressions

## Frontend Tests

### Vitest

`frontend/vitest.config.ts` currently:

- runs in `jsdom`
- loads `frontend/tests/setup.ts`
- includes `src/**/__tests__/**/*` and `tests/**/*.{test,spec}.{ts,tsx}`
- excludes `tests/e2e/**`
- measures coverage primarily over `src/shared/renderer/**/*`

Current checked-in frontend test directories:

- `frontend/tests/integration/`
- `frontend/tests/e2e/`
- `frontend/tests/utils/`

### Playwright

`frontend/playwright.config.ts` currently:

- starts the Next dev server automatically
- serves the UI at `http://localhost:3000`
- injects `NEXT_PUBLIC_API_BASE_URL`, defaulting to `http://127.0.0.1:8000`
- captures traces on first retry and screenshots on failure

Important test-shape detail:

- The frontend E2E tests are meant to exercise the real UI against either the real backend or explicit route mocks depending on the spec.

## Desktop Tests

`desktop/vitest.config.ts` currently:

- uses `jsdom`
- loads `desktop/tests/setup.ts`
- includes `src/**/__tests__/**/*`, `tests/unit/**/*`, and `tests/integration/**/*`
- excludes `tests/e2e/**`

The checked-in desktop suite covers areas such as:

- backend launch command selection
- diagnostics report generation
- startup profile normalization/runtime rules
- onboarding state helpers
- desktop settings restart semantics
- IPC settings behavior

There are also checked-in browser-style specs under `desktop/tests/e2e/`, which currently function more as staged coverage than a wired npm test command.

## VS Code Extension Tests

The extension compiles TypeScript and then runs Node's built-in test runner over the compiled output.

Current extension tests include:

- `chatViewMessageHandlers.test.ts`
- `chatViewTemplate.test.ts`
- `shared/momodocSse.test.ts`
- `shared/sidecarLifecycleCore.test.ts`

## Guidance For New Tests

### Backend

- Use the `client` fixture for request-level tests.
- Use service functions directly with `db_session` for narrower unit tests.
- Mock external dependencies such as LLM providers, embedder, and vector store unless the test is specifically about that integration boundary.

### Frontend and desktop

- Prefer testing shared renderer behavior through the shared component surface where possible.
- Keep browser/E2E tests focused on user-visible flows.
- Keep selectors stable; use roles, labels, and explicit test IDs where needed.

### Extension

- Keep tests host-independent when possible by isolating pure message/template helpers from VS Code APIs.
