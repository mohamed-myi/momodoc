# Desktop Startup Error Taxonomy

Last verified against source on 2026-03-04.

## Source Of Truth

- `desktop/src/main/sidecar.ts`
- `desktop/src/main/ipc/backend.ts`
- `desktop/src/renderer/components/App.tsx`
- `docs/user/desktop-troubleshooting.md`

## Main-Process Startup State

`SidecarManager` exposes:

- `startupState`: `idle | starting | ready | failed | stopped`
- `lastStartupError`: best-effort raw error text
- `lastStartupErrorCategory`: `spawn-error | timeout | port-conflict | runtime-error | unknown | null`

The backend IPC handler returns those values through `get-backend-status`.

## How Categories Are Assigned

The sidecar sets categories from current runtime behavior:

- `spawn-error`: spawning the backend command throws before readiness polling completes
- `timeout`: the backend fails readiness within 30 seconds, or a stale existing process stays unhealthy during recovery
- `port-conflict`: stderr matches `port .*already in use`
- `runtime-error`: stderr contains `error`
- `unknown`: fallback when a failure is recorded without a more specific category

## Renderer Fallback Mapping

When the desktop renderer has no explicit category, `App.tsx` infers two additional support-oriented categories from the error text:

- auth-related text such as `token`, `auth`, `unauthorized`, or `forbidden` becomes `auth-mismatch`
- migration or database text such as `migrat`, `sqlite`, `database schema`, or `db` becomes `migration-error`

Those inferred categories are only used for messaging. They are not emitted by `SidecarManager`.

## When The Recovery Screen Appears

The startup recovery screen is shown when:

- the backend is not ready, and
- the current view is not `settings`

It presents:

- a headline based on startup state
- a user-facing recovery message mapped from the category
- optional raw details behind a `Show details` toggle

## Recovery Actions

The current recovery surface offers:

- `Retry`
- `Open Settings`
- `Open Logs`
- `Open Data Folder`
- `Copy Diagnostics`

`Retry` calls `restart-backend` over IPC. The other actions use desktop shell helpers so the user can inspect logs and produce a redacted diagnostics report without leaving the app.

## Troubleshooting Docs

The user-facing troubleshooting guide is:

- `docs/user/desktop-troubleshooting.md`

Keep that document aligned with this taxonomy when startup messaging changes.

## Current Gaps

- Startup failure classification is still regex-based in places and can miss specific root causes.
- `runtime-error` is a broad bucket driven by stderr text, not structured backend error codes.
- Some failures still surface only as generic raw error text plus `unknown`.
