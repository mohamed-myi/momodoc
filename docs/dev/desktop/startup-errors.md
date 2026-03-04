# Desktop Startup Error Taxonomy (Internal)

Last verified version: `0.1.0` (code-level review + local build/tests, 2026-02-25)

## Purpose

Document how desktop backend startup errors are classified and mapped to user-facing recovery messages.

## Source Files

- `/Users/mohamedibrahim/momodoc/desktop/src/main/sidecar.ts`
- `/Users/mohamedibrahim/momodoc/desktop/src/main/ipc/backend.ts`
- `/Users/mohamedibrahim/momodoc/desktop/src/renderer/components/App.tsx`

## Main-Process Startup State

`SidecarManager` exposes:
- `startupState`: `idle | starting | ready | failed | stopped`
- `lastStartupError`: raw error/log-derived string (best effort)
- `lastStartupErrorCategory`: `spawn-error | timeout | port-conflict | runtime-error | unknown | null`

## Renderer Message Mapping

The startup recovery screen in `App.tsx` maps:
- explicit categories from sidecar (`port-conflict`, `timeout`, `spawn-error`, `runtime-error`)
- inferred patterns from error text (best effort):
  - token/auth/unauthorized -> auth-mismatch guidance
  - migration/sqlite/db text -> migration/data guidance

## UX Rules

- Raw error details are hidden by default behind a `Show details` toggle.
- Logs and diagnostics are one click away.
- Recovery actions are shown inline:
  - Retry
  - Open Settings
  - Open Logs
  - Open Data Folder
  - Copy Diagnostics

## Troubleshooting Doc Link

User-facing mapping and recovery steps live in:
- `/Users/mohamedibrahim/momodoc/DESKTOP_TROUBLESHOOTING.md`

## Known Gaps

- Not all backend failures are classified in the main process yet (some still fall back to generic runtime guidance).
- Final screenshot evidence for each startup state is pending packaged-app manual verification.
