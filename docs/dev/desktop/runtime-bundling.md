# Desktop Backend Runtime Bundling (Internal)

Last verified version: `0.1.0` (local package + packaged launcher smoke, 2026-02-25)

## Purpose

Document how the Electron desktop app bundles and launches the backend runtime so packaged builds do not require a PATH-installed `momodoc` CLI.

## Source Files

- `/Users/mohamedibrahim/momodoc/desktop/scripts/stage-backend-runtime.mjs`
- `/Users/mohamedibrahim/momodoc/desktop/electron-builder.yml`
- `/Users/mohamedibrahim/momodoc/desktop/src/main/backend-launch.ts`
- `/Users/mohamedibrahim/momodoc/desktop/src/main/sidecar.ts`
- `/Users/mohamedibrahim/momodoc/backend/cli/sidecar_entry.py`

## Packaging Flow (Current)

1. `npm run stage:backend-runtime`
   - Stages a backend runtime into `desktop/.backend-runtime-staging/`
2. `electron-builder` packages desktop app
3. `extraResources` copies staged runtime into:
   - `Momodoc.app/Contents/Resources/backend-runtime` (macOS packaged app path)
4. Desktop sidecar resolves launch strategy in packaged builds:
   - bundled `backend-runtime/run-backend.sh` (preferred)
   - system `momodoc serve` fallback (dev/unpackaged and fallback path)

## Runtime Launch Order (Packaged Desktop)

- Desktop app bootstraps Electron runtime (`app-runtime.ts`)
- `SidecarManager.start()` checks for existing healthy backend first
- If none exists, it resolves a packaged backend launcher
- Sidecar spawns bundled runtime with config-derived environment variables
- Sidecar waits for health readiness and then publishes backend-ready status to renderer

## Why This Improves UX

Users can install and launch the desktop app without:
- installing Python
- activating a virtualenv
- adding `momodoc` to PATH
- manually starting the backend in a terminal

## Known Limitations (Current Strategy)

Current bundling stages the local backend `.venv`, which can be machine-specific.

Notable risk:
- Python interpreter symlink portability (especially Homebrew-based macOS setups)

This is sufficient for:
- local packaged builds
- validating removal of PATH dependency

It is not yet a hardened cross-machine runtime packaging strategy.

## Verification Evidence (Local)

- Packaged app resources contain `backend-runtime/`
- Packaged launcher can:
  - `status`
  - `serve`
  - pass `/api/v1/health`
  - `stop`
- Verification used a stripped `PATH` to confirm no PATH dependency in packaged launcher path

## Future Hardening Options

- OS-specific self-contained Python runtime bundle
- standalone backend binaries per platform/arch
- CI-built backend runtime artifacts with portability checks
