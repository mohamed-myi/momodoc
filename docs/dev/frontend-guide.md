# Frontend Guide

## Framework and Tooling

| Tool | Version | Notes |
|------|---------|-------|
| Next.js | 15 | App Router, static export (`output: "export"`) |
| React | 19 | Functional components + hooks |
| TypeScript | 5.7 | Strict mode enabled |
| Tailwind CSS | v4 | CSS-based config in `globals.css` (no `tailwind.config.js`) |
| Icons | lucide-react | Consistent icon library |

## Deployment

The frontend is built as a **static export** (`next export`) and served by the FastAPI backend via `SPAStaticFiles`. There is no separate frontend server.

- Build: `cd frontend && npm run build`, then copy `frontend/out/` → `backend/static/`
- Served at the root URL (`http://127.0.0.1:8000/`)
- API routes (`/api/v1/...`) are registered before the static mount and take priority

## Routing

The app uses **state-based routing** in `App.tsx`, not Next.js file-based routing:

```typescript
type View = "dashboard" | "project";

const [view, setView] = useState<View>("dashboard");
const [projectId, setProjectId] = useState<string | null>(null);
```

- `page.tsx` renders `<App />` — the single entry point
- `layout.tsx` provides the HTML shell and metadata
- Navigation is handled by setting `view` state, not by URL changes

When adding new views, extend the `View` type union and add a new branch in `App.tsx`.

## Component Structure

The frontend and desktop Electron renderer share a common component/lib layer via `frontend/src/shared/renderer/`. Frontend `components/` files are thin re-export wrappers that import from the shared layer.

```
shared/renderer/              # Shared source of truth (consumed by frontend + desktop)
├── components/
│   ├── UnifiedSearchChat.tsx # Coordinator component
│   ├── unified-search-chat/  # Extracted sub-components and hooks
│   │   ├── types.ts
│   │   ├── useChatSessionManager.ts
│   │   ├── useChatStreaming.ts
│   │   ├── SessionSidebar.tsx
│   │   ├── ChatMessagesPane.tsx
│   │   └── ChatInputBar.tsx
│   ├── FilesSection.tsx
│   ├── NotesSection.tsx
│   ├── IssuesSection.tsx
│   ├── ProjectView.tsx
│   ├── ErrorPage.tsx
│   ├── LoadingPage.tsx
│   └── ui/                   # badge, button, card, empty-state, input, select, spinner, textarea, toggle
├── lib/
│   ├── apiClientCore.ts      # Shared API client core (endpoint methods, request helper)
│   ├── momodocSse.ts         # Shared SSE event parser and dispatcher
│   ├── types.ts              # Shared TypeScript interfaces
│   ├── hooks.ts              # useDebounce, useInfiniteScroll, useWebSocket
│   └── utils.ts              # cn() utility
└── app/
    └── globals-core.css      # Shared CSS tokens and base rules

components/                   # Thin wrappers (re-export from shared/renderer/)
├── App.tsx                   # State-based router (entry point, NOT shared)
├── Dashboard.tsx             # Project list (NOT shared — has frontend-specific "use client")
├── UnifiedSearchChat.tsx     # Re-exports shared UnifiedSearchChat
├── FilesSection.tsx          # Re-exports shared FilesSection
├── NotesSection.tsx          # Re-exports shared NotesSection
├── IssuesSection.tsx         # Re-exports shared IssuesSection
├── ProjectView.tsx           # Re-exports shared ProjectView
├── ErrorPage.tsx             # Re-exports shared ErrorPage
├── LoadingPage.tsx           # Re-exports shared LoadingPage
└── ui/                       # Re-exports shared UI primitives
```

The desktop renderer (`desktop/src/renderer/components/`) follows the same thin-wrapper pattern, importing from the shared layer.

### UnifiedSearchChat

The `UnifiedSearchChat` component replaces the old separate `SearchSection` and `ChatInterface`. It provides:

- **Toggle OFF (Search mode):** Real-time debounced vector search with expandable result cards
- **Toggle ON (Deep Search / Chat mode):** RAG chat with streaming LLM responses, session sidebar (create, rename, delete, switch sessions), and source citations
- A "Remember conversation context" checkbox that controls whether full history (last 20 messages) or just recent context (last 3 messages) is sent to the LLM

Used in two contexts:
- **Project-scoped:** `<UnifiedSearchChat projectId={id} />` — searches/chats within a single project
- **Global:** `<UnifiedSearchChat isGlobal />` — searches/chats across all projects, with a callback (`onProjectScores`) to filter the Dashboard project list by result count

## Styling

- **Tailwind CSS v4** uses CSS-based configuration via `@theme` directive in `globals.css`
- There is no `tailwind.config.js` — all theme tokens are defined as CSS custom properties
- The app uses a **dark theme** by default:

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg-primary` | `#000000` | Page background |
| `--color-bg-secondary` | `#0a0a0a` | Card backgrounds |
| `--color-bg-elevated` | `#1c1c1e` | Elevated surfaces |
| `--color-bg-tertiary` | `#2c2c2e` | Tertiary surfaces |
| `--color-fg-primary` | `#ffffff` | Primary text |
| `--color-fg-secondary` | `#98989d` | Secondary/muted text |
| `--color-border` | `rgba(255,255,255,0.08)` | Borders |

- Typography uses system fonts with custom size tokens (`--text-display`, `--text-h1`, etc.)
- Border radii: `--radius-sm` (6px), `--radius-default` (8px), `--radius-lg` (10px)

## API Client

Backend communication uses a shared API client core (`shared/renderer/lib/apiClientCore.ts`) with environment-specific bootstrap adapters:

- **Shared core** (`apiClientCore.ts`): Contains `createRendererApiClient()` factory that accepts a bootstrap config (base URL resolver, token fetcher). Defines all endpoint methods (projects, files, notes, issues, chat, search, sync, export, batch, LLM providers).
- **Web adapter** (`lib/api.ts`): Bootstraps with `API_BASE = ""` (same-origin) and token fetched from `GET /api/v1/token`.
- **Desktop adapter** (`desktop/src/renderer/lib/api.ts`): Bootstraps with IPC-provided base URL and token. Adds desktop-only metrics endpoints.

Common behavior:
- All requests include the `X-Momodoc-Token` header
- File upload uses `FormData` (not JSON)
- Errors throw `ApiError` with `status` and `message` properties
- `getToken()` is exported for streaming requests that need the token directly
- Project-scoped chat methods: `createSession`, `getSessions`, `getMessages`, `deleteSession`, `updateSession`
- Global chat methods: `createGlobalSession`, `getGlobalSessions`, `getGlobalMessages`, `deleteGlobalSession`, `updateGlobalSession`
- `getProjects()` accepts optional `offset` and `limit` for paginated loading (infinite scroll)
- Sync methods: `startSync(projectId, path?)`, `getSyncStatus(projectId)`, `getJob(projectId, jobId)`
- `updateFile(projectId, fileId, data)` — Update file tags
- `getFileContent(projectId, fileId)` — File content preview
- `getFileChunks(projectId, fileId, offset?, limit?)` — File chunks
- `batchDeleteFiles(projectId, ids)` — Batch delete files
- `batchTagFiles(projectId, ids, tags)` — Batch tag files
- `batchDeleteIssues(projectId, ids)` — Batch delete issues
- `exportChat(projectId, sessionId, format)` — Export chat session
- `exportSearch(projectId, query, format, topK?)` — Export search results
- `connectWebSocket(token)` — Connect to `/ws` for real-time events

When adding new API methods, add them to `shared/renderer/lib/apiClientCore.ts` so both frontend and desktop benefit. Add TypeScript interfaces to `shared/renderer/lib/types.ts`.

## TypeScript Types

`lib/types.ts` contains all shared interfaces mirroring backend Pydantic schemas:

- `Project`, `CreateProject` — includes `source_directory` field
- `FileRecord`
- `Note`, `CreateNote`
- `Issue`, `CreateIssue`
- `ChatSession`, `ChatMessage`, `ChatSource`
- `SearchResult` — `source_type` is `"file" | "note" | "issue"`
- `FileUpdate` — `{ tags?: string }`
- `ChatMessageRequest` — includes `pinned_source_ids?: string[]` for pinning specific sources in chat context
- `SearchRequest` — includes `mode?: "hybrid" | "vector" | "keyword"` for search mode selection
- `JobProgress`, `SyncJob` — sync job progress tracking

Keep these in sync with backend schemas when modifying the API.

## Chat Streaming (SSE)

Streaming is handled by the `useChatStreaming` hook (extracted to `shared/renderer/components/unified-search-chat/useChatStreaming.ts`) and the shared SSE parser (`shared/renderer/lib/momodocSse.ts`):

1. Sends POST to `.../messages/stream` using `fetch` (not `EventSource`). The URL varies:
   - Project-scoped: `/api/v1/projects/{id}/chat/sessions/{sid}/messages/stream`
   - Global: `/api/v1/chat/sessions/{sid}/messages/stream`
2. Includes the `X-Momodoc-Token` header (fetched via `getToken()` from `api.ts`)
3. Request body includes `query`, and optionally `include_history: true`
4. Reads the response body as a stream
5. Parses SSE events via the shared `parseSSEEvents()` and `dispatchMomodocSSEEvent()`:
   - `event: sources` — arrives first with retrieval results
   - `data: {"token": "..."}` — individual tokens
   - `event: done` — signals completion
   - `event: error` — error payload
6. Tokens are appended to state as they arrive for real-time display

The same SSE parser is used by the desktop renderer (via shared module), the desktop overlay chat, and the VS Code extension (`extension/src/shared/momodocSse.ts`).

## Hooks (`lib/hooks.ts`)

- `useDebounce<T>(value, delay)` — Debounce a value by a given delay (used for search input)
- `useInfiniteScroll(loadMore, hasMore, loading)` — Returns a ref for a sentinel element; triggers `loadMore` via `IntersectionObserver` when the sentinel enters the viewport (used for Dashboard project list pagination)
- `useWebSocket(token)` — Connects to `/ws` WebSocket endpoint, returns event stream for real-time sync progress updates. Auto-reconnects on disconnect.

## WebSocket Integration

The frontend can connect to `WS /ws?token=<session-token>` for real-time sync progress events instead of polling `GET /files/sync/status`:

- Token is passed via query parameter (browsers can't send custom headers on WS)
- Events: `sync_progress` (file count, current file), `sync_complete`, `sync_failed`
- Used by `FilesSection.tsx` for real-time sync progress display

## Conventions

- All components use `"use client"` directive (SPA-style rendering)
- Functional components with hooks — no class components
- No global state library — local `useState`/`useEffect` per component
- Path alias: `@/*` maps to `./src/*` (configured in `tsconfig.json`)
- No ESLint or Prettier config files — uses Next.js built-in ESLint defaults
