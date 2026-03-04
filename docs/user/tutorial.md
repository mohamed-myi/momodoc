# Momodoc Tutorial

This is a comprehensive tutorial for everything currently available in Momodoc across:
- Desktop app (including overlay)
- Web frontend
- VS Code extension
- CLI

## Quick Path For New Desktop Users

If you just want to install and use Momodoc (not develop it), use these first:
- [Desktop Install](desktop-install.md)
- [Command-Line Install](command-line-install.md)
- [Desktop Troubleshooting](desktop-troubleshooting.md)

This tutorial remains the full cross-surface reference.

## 1. Product Surface (What Exists)

Momodoc is one backend with multiple clients.

| Surface | What it does |
|---|---|
| Backend (`momodoc serve`) | Stores projects/files/notes/issues/chat sessions, indexing, retrieval, LLM chat, sync jobs, metrics |
| Desktop app | Primary UI: projects, files, notes, issues, chat, global chat, metrics, settings, overlay |
| Overlay (desktop) | Global floating chat window across all projects |
| Web frontend | Browser UI for projects/files/notes/issues/chat/global chat |
| VS Code extension | Start/stop backend, ingest file, open web UI, sidebar chat |
| CLI | Manage lifecycle, projects, ingestion, notes/issues, search/chat, retrieval eval |
| HTTP API | Full programmable surface for all operations |

## 2. Prerequisites and Install

### Prerequisites
- Python 3.11+
- Node.js 18+
- `momodoc` installed from this repo (editable install)

### Install everything

```bash
make momo-install
cp .env.example .env
```

`make momo-install` creates `backend/.venv`, installs backend package (`momodoc` CLI), and installs desktop dependencies.

If you want only local retrieval/search without LLM responses, API keys are optional.

## 3. Start, Stop, and Check the Backend

### Start

```bash
make serve
```

### Status / stop

```bash
make status
make stop
```

### Development backend (auto reload)

```bash
make dev
```

### Important runtime behavior
- Backend writes runtime files in the Momodoc data dir (`session.token`, `momodoc.pid`, `momodoc.port`).
- Health endpoint is immediately available after critical startup; deferred startup continues in background.
- `GET /api/v1/health` returns `ready: true|false`.

## 4. Authentication Model

Most API endpoints require session token auth.

- Header: `X-Momodoc-Token: <token>`
- Exempt HTTP endpoints:
  - `GET /api/v1/health`
  - `GET /api/v1/token` (localhost-only)
- WebSocket auth uses query param, not header:
  - `ws://127.0.0.1:8000/ws?token=<token>`

Get token:

```bash
curl http://127.0.0.1:8000/api/v1/token
```

Or read directly from data dir:

```bash
cat ~/Library/Application\ Support/momodoc/session.token
```

## 5. Data Directory and Runtime Files

Default data directory:
- macOS: `~/Library/Application Support/momodoc`
- Linux: `~/.local/share/momodoc`
- Windows: `%APPDATA%/momodoc`
- Override: `MOMODOC_DATA_DIR`

Common files:
- `session.token`
- `momodoc.pid`
- `momodoc.port`
- `momodoc.log`
- `momodoc-startup.log`
- `sidecar.log` (desktop sidecar)
- DB: `<data_dir>/db/momodoc.db`
- Vectors: `<data_dir>/vectors`
- Uploads: `<data_dir>/uploads`

## 6. Ingestion and Sync Fundamentals

### 6.1 Supported file types

Momodoc currently ingests:
- Docs/text: `.md`, `.markdown`, `.rst`, `.txt`, `.pdf`, `.docx`
- Code/config: `.py`, `.js`, `.ts`, `.jsx`, `.tsx`, `.java`, `.go`, `.rs`, `.c`, `.cpp`, `.h`, `.rb`, `.php`, `.swift`, `.kt`, `.scala`, `.sh`, `.bash`, `.sql`, `.yaml`, `.yml`, `.json`, `.toml`, `.xml`, `.html`, `.css`, `.scss`

### 6.2 Ignored directories and files during directory sync/index

Ignored directories include:
- `node_modules`, `__pycache__`, `.git`, `.venv`, `venv`, `dist`, `build`, `.next`, `.tox`, `.mypy_cache`, `.pytest_cache`, `egg-info`

Also ignored:
- hidden files (filenames starting with `.`)
- unsupported extensions

### 6.3 How ingestion works

For each file, Momodoc:
1. Applies file-size guards.
2. Computes checksum.
3. Skips unchanged content.
4. Parses content by file type.
5. Chunks content (type-aware chunking).
6. Embeds chunks.
7. Stores chunks/vectors in LanceDB.
8. Updates metadata in SQLite.

### 6.4 Size limits

Two relevant limits:
- `MAX_UPLOAD_SIZE_MB` (upload endpoint streaming guard, default 100)
- `MAX_FILE_SIZE_MB` (ingestion pipeline guard, default 200)

### 6.5 Allowed path sandbox for directory indexing/sync

`index-directory`, `sync`, and `source_directory` validation require path allowlisting.

Set in `.env`:

```env
ALLOWED_INDEX_PATHS=["/Users/me/work","/Users/me/Documents"]
```

If unset, directory index/sync operations fail validation.

## 7. Desktop App: Complete Guide

### 7.1 Start desktop

```bash
a) make serve          # recommended in one terminal
b) make dev-desktop    # desktop in another terminal
```

Desktop can also start/restart backend sidecar internally. If sidecar cannot spawn `momodoc` from PATH, start backend manually (`make serve`).

### 7.2 Main navigation

Top navigation tabs:
- `Projects`
- `Metrics`
- `Settings`

### 7.2.1 First-run onboarding and launcher (desktop UX)

Current desktop builds include:
- a first-run setup wizard (skip/resume supported)
- a launcher-style home panel with quick actions
- recent projects and recent global chats
- status badges (backend/provider/watcher/update)

Open setup again later from:
- `Settings -> App Behavior -> Setup Wizard`

Troubleshooting now starts in-app:
- `Settings -> Diagnostics`
- or startup recovery actions when backend launch fails

If backend is not ready, desktop shows retry screen with `Retry` button.

### 7.3 Projects dashboard

Available actions:
- Create project (`new project`)
  - Fields: name (required), description (optional), source directory (optional)
- Edit project (hover row -> pencil)
- Delete project (hover row -> trash -> confirm)
- Infinite-scroll project list
- Open project details by clicking row

If you create a project with `source_directory`, backend can auto-trigger initial sync and desktop auto-navigates into that project when `sync_job_id` is returned.

### 7.4 Global chat panel on dashboard

Collapsed by default. Click to expand.

Capabilities:
- Chat across all projects
- Search-only mode
- Provider mode selection (`Gemini`, `Claude`, `OpenAI`, `Ollama`, `Search only`)
- Session list (create/select/rename/delete) in AI mode
- Include-history toggle (`ctx`) in AI mode
- Streaming responses with stop button
- Source inspection for AI responses

Global search mode additionally computes per-project result counts and reorders dashboard projects by relevance.

### 7.5 Project view

Project view tabs:
- `chat`
- `files`
- `notes`
- `issues`

Sidebar also shows:
- name, description
- source directory (if set)
- last sync status/time (`synced` or `sync failed`)
- counts for files/notes/issues

### 7.6 Files tab

Actions:
- `upload` button: file picker (multi-file)
- `folder` button: folder picker (uploads contained files)
- drag-and-drop files/folders
- `sync` button (only when project has `source_directory`)

Sync behavior:
- Polls sync job progress every second
- Shows progress bar and current file
- Shows completion summary:
  - completed
  - succeeded
  - unchanged (`skipped`)
  - failed
  - total chunks

File list row shows:
- filename
- type badge
- size
- chunk count
- relative time
- delete (hover)

### 7.7 Notes tab

Actions:
- Add note
- Edit note
- Delete note

Note tags:
- Desktop note creation UI currently does not expose a tags input.
- If tags exist (created via API/CLI), tags are displayed as badges.

### 7.8 Issues tab

Actions:
- Add issue with:
  - title
  - optional description
  - priority (`low`, `medium`, `high`, `critical`)
- Click status icon to cycle status:
  - `open` -> `in_progress` -> `done` -> `open`
- Delete issue
- Collapse/expand completed issues group

### 7.9 Project chat tab

Everything from global chat applies, scoped to one project.

AI mode:
- Streams assistant tokens via SSE
- Optional history inclusion (`include_history`)
- Provider per message via mode selector
- Session sidebar on desktop width
- Sources list with expandable snippets

Search-only mode:
- Runs retrieval only (no LLM)
- Renders ranked chunk results with score and source path

### 7.10 Metrics page

Displays:
- Overview cards: projects, files, chunks, messages, storage, uptime
- Per-project sortable table:
  - name, files, chunks, messages, storage
- 30-day chat activity bars
- 30-day sync activity bars
- Storage breakdown:
  - uploads, database, vectors
  - by file type

### 7.11 Settings page

Settings auto-save (debounced) and show `Saving...` while flushing.

Backend-affecting changes mark `Restart Backend` as required.

#### LLM Provider settings
- Default provider selector
- Claude: API key + model
- OpenAI: API key + model
- Gemini: API key + model
- Ollama: base URL + model

#### Server settings
- Port
- Max upload size MB
- Data directory (manual input + folder picker)
- Log level (`DEBUG|INFO|WARNING|ERROR`)

#### Chunking advanced settings
- Default chunk size
- Chunk overlap
- Code chunk size
- PDF chunk size
- Markdown chunk size

#### App behavior settings
- Auto-launch on startup
- Show in system tray
- Global hotkey for overlay

Important:
- `Global Hotkey` explicitly requires app restart.
- `autoLaunch` and `showInTray` are persisted immediately but operational behavior is initialized at app startup.

#### Updater controls
- `Check for Updates`
- `Install & Restart` when downloaded

Updater runs only in packaged (non-dev) desktop builds.

### 7.12 Overlay setup and usage

Default toggle hotkey:
- `CommandOrControl+Shift+Space`

Where to configure:
- Desktop -> `Settings` -> `App Behavior` -> `Global Hotkey (Overlay)`

How to use:
1. Press global hotkey to show/hide overlay.
2. Overlay starts collapsed (input bar).
3. Type message and send.
4. On first send, overlay auto-expands.
5. Use expand/collapse button in overlay header.
6. Press `Esc`:
   - if expanded: collapses
   - if collapsed: toggles visibility
7. Click `Open full app` in overlay footer to focus main desktop app.

Overlay characteristics:
- Always on top
- Frameless transparent window
- Uses global chat session endpoints (`/api/v1/chat/sessions/...`)

### 7.13 Tray integration

When tray is enabled, menu has:
- `Show momodoc`
- `Toggle Overlay`
- `Settings`
- `Quit`

Double-clicking tray icon shows main window.

## 8. Web Frontend Guide

Web UI is the static frontend served by backend (if `backend/static` exists).

Run:
- start backend (`make serve`)
- open `http://127.0.0.1:8000`

Current web UI features:
- Dashboard project CRUD
- Global chat panel
- Project tabs: chat/files/notes/issues
- File upload/folder upload/sync progress
- Notes CRUD
- Issues CRUD and status cycling

Not currently present in web UI:
- Desktop settings page
- Metrics dashboard page
- Overlay, tray, global shortcuts, updater

## 9. VS Code Extension Guide

See [VS Code Extension](vscode-extension.md) for the full extension guide.

Quick start:

### 9.1 Contributed commands
- `Momodoc: Start Server` (`momodoc.startServer`)
- `Momodoc: Stop Server` (`momodoc.stopServer`)
- `Momodoc: Open Web UI` (`momodoc.openUI`)
- `Momodoc: Ingest File` (`momodoc.ingestFile`)

Also in explorer context menu on files: `Momodoc: Ingest File`.

### 9.2 Sidebar chat view (Activity Bar -> Momodoc)

Toolbar controls:
- Project selector
- Session selector (`New chat` + existing sessions)
- Model selector (`gemini|claude|openai|ollama`, availability-aware)
- New session `+`

Chat behavior:
- Project-scoped chat only (no global mode in extension sidebar)
- Streams assistant tokens
- Shows source links
- Clicking source with `original_path` opens file in editor (line 1)
- Restores selected project/session/model across reloads via webview state

## 10. CLI: Complete Command Guide

### 10.1 Lifecycle

```bash
momodoc serve
momodoc stop
momodoc status
```

### 10.2 Projects

```bash
momodoc project create my-project -d "description"
momodoc project list
momodoc project show my-project
momodoc project delete my-project
```

### 10.3 Ingestion

```bash
momodoc ingest file my-project /path/to/file.pdf
momodoc ingest dir my-project /path/to/directory
```

### 10.4 Notes

```bash
momodoc note add my-project "remember this" --tags "tag1,tag2"
momodoc note list my-project
```

### 10.5 Issues

```bash
momodoc issue add my-project "Fix parser" --desc "details" --priority high
momodoc issue list my-project --status open
momodoc issue done my-project <issue-id>
```

### 10.6 Search

```bash
momodoc search "query text" --project my-project --top-k 5
```

### 10.7 Chat

```bash
momodoc chat my-project --query "How does sync work?"
momodoc chat my-project --model claude
momodoc chat my-project
```

### 10.8 Retrieval evaluation

```bash
momodoc rag-eval /path/to/cases.jsonl --output report.json --max-cases 100 --concurrency 8
```

JSONL case format (one object per line):

```json
{"query":"...","expected_source_ids":["id1","id2"],"project_id":"...","mode":"hybrid","top_k":10}
```

Required keys: `query`, `expected_source_ids`.

## 11. End-to-End Workflows

### Workflow A: Desktop-first with auto sync
1. Start backend and desktop.
2. Create project with `source directory` set.
3. Watch initial sync progress in project `files` tab.
4. Use `chat` tab to ask project questions.
5. Open dashboard global chat for cross-project queries.
6. Use overlay for quick global asks via hotkey.

### Workflow B: CLI and API power use
1. Create project via CLI.
2. Index directory via API with explicit mode checks.
3. Search with `mode=hybrid|vector|keyword` and compare.
4. Chat with `pinned_source_ids` for deterministic context injection.
5. Export chat and search results for reporting.

### Workflow C: VS Code integrated
1. Start server via `Momodoc: Start Server`.
2. Ingest files from explorer context menu.
3. Use Momodoc sidebar chat with selected project/session/model.
4. Click source links to jump into files.

## 12. Troubleshooting

### 401 Invalid or missing session token
- Use fresh token from `GET /api/v1/token`.
- Ensure `X-Momodoc-Token` is present.

### 403 from `/api/v1/token`
- That endpoint is localhost-only.

### 422 on index/sync/source_directory
- Path missing, not a directory, outside `ALLOWED_INDEX_PATHS`, or allowlist not configured.

### 409 conflicts
- Duplicate project names.
- Embedding model mismatch safety checks.
- Attempting to start a sync while one is active for project.

### 429 rate limit on chat endpoints
- Tune chat rate limit env vars.
- Retry after server-provided `Retry-After`.

### 503 chat provider not configured
- Configure selected provider API key/model.

### 502 chat upstream error
- Provider returned failure. Check logs.

### Desktop cannot connect or sidecar fails
- Ensure `momodoc` CLI is installed and on PATH.
- Start backend manually with `make serve`.
- Check `sidecar.log`.

### Overlay hotkey not working
- Verify hotkey in Settings.
- Restart desktop app after changing hotkey.
- Check for OS/global shortcut conflicts.

### Extension chat shows no projects
- Backend not running or token/port files missing.
- Start server via command palette.
