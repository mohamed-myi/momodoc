# Frontend Guide

This document covers the current `frontend/` workspace and the shared renderer layer it consumes.

## Stack

| Tool | Current usage |
|---|---|
| Next.js | app directory with static export enabled |
| React | client-side stateful SPA shell |
| TypeScript | typed UI and shared API client |
| Tailwind CSS v4 | imported through CSS, no `tailwind.config.js` |
| Geist | font setup in `frontend/src/app/layout.tsx` |

## App Entry Points

The web frontend has a very small Next layer:

- `frontend/src/app/layout.tsx` defines metadata, Geist fonts, and imports `globals.css`
- `frontend/src/app/globals.css` imports Tailwind plus the shared renderer CSS core
- `frontend/src/app/page.tsx` renders `<App />`

The actual product shell lives under `frontend/src/components/`.

## Routing Model

The web app is effectively a single-page application with state-based navigation in `frontend/src/components/App.tsx`.

Current views:

```ts
type View = "dashboard" | "project" | "settings";
```

Current behavior:

- `dashboard` shows the project list plus global search/chat
- `project` shows the selected project's files, notes, issues, and project chat
- `settings` shows the backend-backed LLM settings form

There is no URL-based app routing between these views today.

## Shared Renderer Layout

`frontend/src/shared/renderer/` is the main reusable UI/runtime layer shared with the desktop renderer.

It currently contains:

- shared components such as `ProjectView`, `FilesSection`, `NotesSection`, `IssuesSection`, `UnifiedSearchChat`, `SettingsPanel`, `DirectoryBrowserModal`
- shared API/bootstrap-independent code under `lib/`
- shared CSS tokens in `app/globals-core.css`

## Web-Specific Components

The web workspace still owns some non-shared pieces:

- `App.tsx` is the web shell/router
- `Dashboard.tsx` is a web-specific dashboard implementation with project CRUD, infinite scroll, and the global `UnifiedSearchChat`

Most of the other files in `frontend/src/components/` are wrappers or re-exports around the shared renderer layer.

Current examples:

- `ProjectView.tsx` re-exports the shared project view
- `UnifiedSearchChat.tsx` re-exports the shared chat/search component
- `SettingsPanel.tsx` re-exports the shared settings panel

## API Bootstrap

The web frontend bootstraps the shared API client in `frontend/src/lib/api.ts`.

Current behavior:

- `NEXT_PUBLIC_API_BASE_URL` optionally points the frontend at a separate backend origin
- otherwise the frontend uses same-origin requests
- the session token is fetched from `GET /api/v1/token`
- the token is cached in memory after the first successful fetch

The shared API implementation lives in `frontend/src/shared/renderer/lib/apiClientCore.ts`.

Current shared methods include:

- projects: get, create, update, delete
- files: list, upload, delete
- notes: list, create, update, delete
- issues: list, create, update, delete
- project chat: create/list/update/delete sessions and fetch/send messages
- global chat: create/list/update/delete sessions and fetch/send messages
- search
- sync job start/status/get
- directory browsing
- LLM provider listing and settings update

Important current limitation:

- the web shared API client does not currently expose metrics, export, batch file operations, file-content preview, or file-chunk inspection methods even though backend endpoints exist for them
- those extra methods exist only in the desktop renderer API layer where implemented

## Chat and Search UI

`UnifiedSearchChat` is the shared component that drives both project chat and global chat.

Current behavior:

- fetches provider availability from `/api/v1/llm/providers`
- offers provider modes plus a built-in `Search only` mode
- uses project-scoped or global chat session APIs based on props
- persists the selected mode in `localStorage`
- persists session-sidebar width in `localStorage`
- uses SSE streaming for chat responses

For the web dashboard specifically:

- the global `UnifiedSearchChat` can feed project score data back into the project list
- the dashboard uses that score map to reorder projects when global search/chat produces matches

## SSE Streaming

The web frontend does not use `EventSource`. It uses `fetch()` and manually parses the response stream.

Current streaming flow:

1. create or ensure a chat session
2. `POST` to the relevant `.../messages/stream` endpoint
3. read the response body stream
4. parse SSE frames with the shared `momodocSse` helpers
5. update UI state for:
   - sources
   - retrieval metadata
   - token chunks
   - completion
   - errors

The same SSE parsing helpers are shared with the desktop renderer and the VS Code extension.

## Hooks

The web frontend currently re-exports the shared hooks from `frontend/src/shared/renderer/lib/hooks.ts`.

Current shared hooks:

- `useDebounce`
- `useInfiniteScroll`

There is no shared `useWebSocket` hook in the current codebase.

## Styling

`frontend/src/app/globals.css` does two things:

- imports Tailwind
- imports `../shared/renderer/app/globals-core.css`

`globals-core.css` is the main styling source of truth for the shared renderer.

Current characteristics:

- dark color system based on CSS custom properties
- shared spacing/radius/text tokens
- shared container utilities
- shared code-highlighting styles
- no Tailwind config file; theme values live in CSS

## Testing

Frontend tests currently live under `frontend/tests/`.

- Vitest integration tests cover UI behavior in `tests/integration/`
- Playwright E2E tests live in `tests/e2e/`
- `frontend/playwright.config.ts` starts the dev server automatically and injects `NEXT_PUBLIC_API_BASE_URL`

## Deployment

The web frontend is configured as a static export via `frontend/next.config.ts`:

```ts
output: "export"
```

Current deployment pattern:

1. `cd frontend && npm run build`
2. copy `frontend/out/` into `backend/static/`
3. let FastAPI serve the static output at `/`

## Conventions

- Keep reusable UI and shared client logic in `frontend/src/shared/renderer/` when both web and desktop need it.
- Keep web-only shell behavior in `frontend/src/components/`.
- Add new shared API methods to `apiClientCore.ts` first so the desktop renderer can reuse them when appropriate.
