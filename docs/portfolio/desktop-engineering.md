# Desktop Engineering

## Sidecar Lifecycle

The desktop app does not embed the Python backend. Instead, it manages it as a sidecar process: a child process that the Electron main process starts, monitors, and stops.

### Startup sequence

1. Check for an already-running backend (health check at `/api/v1/health`)
2. If found and healthy, reuse it (read port/token from data directory files)
3. If not found, resolve the launch command:
   - Packaged builds: bundled `backend-runtime/run-backend.sh` (no PATH dependency)
   - Dev builds: `momodoc serve` from PATH
4. Spawn the backend process (detached, with config-derived environment variables)
5. Poll health endpoint until ready (30-second timeout)
6. Read `session.token` and `momodoc.port` from data directory
7. Publish backend-ready status to renderer

### Shared lifecycle core

The sidecar logic is shared between the desktop app and the VS Code extension via `sidecarLifecycleCore.ts`. Both clients need the same capabilities (start, stop, health check, token/port reading) but differ in their logging and process management. The shared core provides the lifecycle state machine while each client provides its own logger and process spawner.

### Ownership tracking

The sidecar manager tracks whether it started the backend or discovered an existing one. On shutdown, it only stops processes it owns. This prevents the desktop app from killing a backend that the user started manually via `make serve`.

### Graceful shutdown

Shutdown follows a deterministic sequence in `shutdown.ts`:
1. Unregister global shortcuts
2. Stop updater
3. Destroy overlay and tray
4. Stop sidecar (if owned)
5. Exit

This ordering prevents UI artifacts (overlay flashing, tray menu appearing after quit) and ensures the backend process is the last thing stopped.

## Domain-Split IPC

IPC between the Electron main and renderer processes is organized by domain rather than in a monolithic handler:

| Module | Channels | Purpose |
|--------|----------|---------|
| `ipc/backend.ts` | `get-backend-url`, `get-token`, `get-backend-status`, `restart-backend` | Backend connectivity |
| `ipc/settings.ts` | `get-settings`, `update-settings` | Desktop config store read/write |
| `ipc/overlay.ts` | `toggle-overlay`, `expand-overlay`, `collapse-overlay` | Overlay window control |
| `ipc/window.ts` | `open-main-window`, `select-directory`, `open-web-ui`, minimize/maximize/close | Window management |
| `ipc/updater.ts` | Update check, download, install | Auto-updater control |
| `ipc/diagnostics.ts` | Diagnostic report generation | Health and debug info |

All handlers receive a shared `IpcDeps` object containing references to `mainWindow`, `sidecar`, `configStore`, `overlay`, and `updater`. Registration is centralized in `ipc.ts`.

This pattern keeps each IPC domain self-contained and testable. Adding a new IPC channel means adding a handler to the appropriate domain module and registering it in the central orchestrator.

## Window Factory

`window-factory.ts` encapsulates all window creation logic:

- Restores saved window bounds from config (position + size)
- Debounced save (500ms) on move/resize to avoid config store thrashing
- macOS hidden title bar (`titleBarStyle: 'hiddenInset'`)
- `ready-to-show` gate: window is created hidden and only shown after content loads
- Returns a `MainWindowHandle` with the window instance and a cleanup function

In dev mode, the window loads from the Vite dev server (`http://localhost:5173`). In production, it loads from the bundled `dist/index.html`.

On macOS, closing the window hides it to the tray (if tray is enabled) instead of quitting, unless the app is actually quitting. This matches macOS conventions.

## Overlay Chat

The overlay is a separate Electron `BrowserWindow` with specific properties:

| Property | Value | Why |
|----------|-------|-----|
| Always on top | true | Must float above other windows |
| Frameless | true | Custom UI chrome, no title bar |
| Transparent | true | Rounded corners, shadow effects |
| Resizable | false | Fixed dimensions (500x60 collapsed, 500x500 expanded) |
| Skip taskbar | true | Should not appear in alt-tab |

The overlay loads a separate entry point (`overlay.html` / `overlay-main.tsx`) that renders `OverlayChat`, a dedicated React component. It uses global chat sessions (`/api/v1/chat/sessions/...`) rather than project-scoped sessions, since the overlay is meant for quick cross-project queries.

Interaction flow:
1. Global hotkey (`CommandOrControl+Shift+Space`) toggles visibility
2. Starts collapsed (input bar only)
3. Auto-expands on first message send
4. `Esc` collapses if expanded, hides if collapsed
5. "Open full app" button in footer focuses the main window

## Shared UI Layer

The web frontend and desktop renderer share a single source of truth for UI components:

```
frontend/src/shared/renderer/
    components/          (UnifiedSearchChat, ProjectView, FilesSection, etc.)
    components/ui/       (button, card, input, select, etc.)
    lib/                 (apiClientCore, momodocSse, types, hooks, utils)
    app/globals-core.css (shared CSS tokens)
```

Both `frontend/src/components/` and `desktop/src/renderer/components/` contain thin re-export wrappers.

### Bootstrap pattern

The shared API client (`apiClientCore.ts`) requires a bootstrap object that provides `getBaseUrl()` and `getToken()`. Each client supplies its own:

- **Web frontend**: `getBaseUrl = ""` (same origin), `getToken` from `GET /api/v1/token`
- **Desktop**: `getBaseUrl` and `getToken` from `window.momodoc.getBackendUrl()` and `getToken()` (IPC to main process)

This means the entire shared component tree is environment-agnostic. It does not know if it is running in a browser or in Electron.

## Backend Runtime Bundling

Packaged desktop builds bundle the Python backend runtime so users do not need Python installed:

1. `stage-backend-runtime.mjs` copies the backend `.venv` into a staging directory
2. `electron-builder` packages it as `extraResources`
3. At runtime, the sidecar resolves the bundled launcher script

The current approach stages the local `.venv`, which is machine-specific (Python interpreter symlinks may not be portable). This is sufficient for local packaged builds and validating the PATH-free experience. Cross-machine portability would require OS-specific self-contained Python bundles or standalone binaries.
