# Desktop Engineering

Last verified against source on 2026-03-04.

## Main Responsibilities

The Electron app is not just a shell for the web UI. The desktop runtime currently owns:

- backend sidecar lifecycle
- tray, global shortcut, and overlay windows
- onboarding and desktop-only settings
- diagnostics and local log access
- packaged-build update checks
- startup profile orchestration

## Sidecar Lifecycle

The Electron main process manages backend lifecycle through `SidecarManager`.

Current behavior:

1. check whether a healthy backend already exists
2. if needed, inspect stale PID state and recover
3. resolve a launch command
4. spawn the backend detached with config-derived environment variables
5. wait up to 30 seconds for readiness
6. publish backend-ready or backend-failed state to the renderer

The sidecar tracks ownership. On shutdown it only stops a backend process it started itself.

## Shared Lifecycle Core

Desktop and VS Code reuse `extension/src/shared/sidecarLifecycleCore.ts`.

That shared core handles:

- health polling
- token and port reading
- managed-child tracking
- graceful stop logic

Desktop and extension differ in process launch strategy and logging, but the state machine is shared.

## Bundled Runtime Versus Dev Runtime

Desktop launch behavior depends on packaging state.

### Packaged builds

The app resolves a bundled backend launcher from `process.resourcesPath/backend-runtime/`.

That runtime is produced by:

- `desktop/scripts/stage-backend-runtime.mjs`
- `electron-builder` `extraResources`

### Development builds

The app starts:

- `momodoc serve`

from the surrounding environment.

This split is one of the most important desktop engineering boundaries in the repo.

## Startup Profiles

Desktop launch behavior is configurable through startup profiles:

- `desktop`
- `desktopOverlay`
- `desktopWeb`
- `vscodeCompanion`
- `custom`

The runtime resolves conflicts before launch, for example:

- tray-minimized startup disables visible main-window startup
- tray-minimized startup falls back to visible main-window startup if the tray is disabled
- a profile that would expose no visible surface is corrected to open the main window

## Main Runtime Sequence

At app startup, the Electron main process currently:

1. loads config
2. resolves startup profile warnings and targets
3. creates the sidecar manager
4. creates the hidden main window
5. registers IPC handlers
6. starts the backend if enabled
7. applies window visibility behavior
8. creates the tray if enabled
9. registers the global shortcut
10. starts the updater in packaged builds
11. applies auto-launch settings
12. runs optional overlay, browser, and VS Code launch actions

This is a real orchestration layer, not a thin boot script.

## IPC Structure

IPC is split by domain rather than handled in one file.

Current modules include:

- `ipc/backend.ts`
- `ipc/settings.ts`
- `ipc/overlay.ts`
- `ipc/window.ts`
- `ipc/updater.ts`
- `ipc/diagnostics.ts`
- `ipc/shared.ts`

Handlers receive a shared dependency bundle containing references such as:

- `mainWindow`
- `sidecar`
- `configStore`
- `overlay`
- `updater`

## Window Model

Desktop uses multiple windows:

- main application window
- overlay window

The main window:

- starts hidden
- restores saved bounds
- saves bounds with a debounce
- hides instead of quitting on close when tray behavior is active

The overlay window:

- is always-on-top
- frameless and transparent
- starts collapsed
- can expand for chat

## Overlay Chat

The overlay is intentionally global rather than project-scoped.

Current behavior:

- it is toggled by a global shortcut
- it talks to global chat sessions, not project chat sessions
- it can open the full application window when the interaction needs more context

That design keeps the overlay optimized for quick cross-project retrieval and chat.

## Shared Renderer Strategy

Most feature UI is shared between the web frontend and the desktop renderer through:

- `frontend/src/shared/renderer/components`
- `frontend/src/shared/renderer/lib`
- `frontend/src/shared/renderer/app/globals-core.css`

Desktop-specific renderer code adds shell capabilities such as:

- startup recovery screen
- updater status wiring
- diagnostics integration
- onboarding modal
- metrics view
- What’s New modal

The shared component tree remains mostly environment-agnostic by using a bootstrap API layer.

## Diagnostics And Recovery

Desktop engineering includes explicit failure recovery UX.

When backend startup fails, the renderer can show:

- classified startup messaging
- raw details behind a toggle
- retry
- open settings
- open logs folder
- open data folder
- copy diagnostics

This is implemented as part of the desktop shell, not the shared web UI.

## Updater Model

The updater exists only in packaged builds.

Current policy:

- stable channel only
- no prereleases
- no downgrades
- update download is manual after discovery
- install occurs on quit or through explicit install action

That behavior is controlled in `desktop/src/main/updater.ts`.
