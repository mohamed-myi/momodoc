# Desktop Backend Runtime Bundling

Last verified against source on 2026-03-04.

## Purpose

Packaged desktop builds bundle a backend runtime so the Electron app can launch `momodoc` without requiring the user to install the CLI separately.

Relevant source files:

- `desktop/scripts/stage-backend-runtime.mjs`
- `desktop/src/main/backend-launch.ts`
- `desktop/src/main/sidecar.ts`
- `desktop/electron-builder.yml`
- `backend/cli/sidecar_entry.py`

## What Gets Staged

`npm run stage:backend-runtime` copies the backend into `desktop/.backend-runtime-staging/backend/`.

Required inputs:

- `backend/app`
- `backend/cli`
- `backend/migrations`
- `backend/alembic.ini`
- `backend/pyproject.toml`
- `backend/.venv`

The staging script fails fast if any of those paths are missing.

## Copy Filters

The staging script removes cache and non-runtime content while copying. Current exclusions include:

- `__pycache__`
- `.pytest_cache`
- `.ruff_cache`
- `.mypy_cache`
- `backend/tests`
- `.venv/include`
- selected native-package include trees
- `.pyc`
- wheel metadata files such as `RECORD` and `INSTALLER`

This is still a source copy of the current backend plus its local virtualenv, not a platform-neutral artifact.

## Generated Launchers

The staging step writes these launchers at the staging root:

- `run-backend.sh`
- `run-backend.cmd`
- `run-backend.ps1`
- `backend-runtime.json`

`backend-runtime.json` records the generation timestamp, bundled entries, and portability notes.

## Launcher Resolution Order

The packaged desktop app resolves its backend command through `resolveBackendLaunchCommand(...)`.

### Packaged macOS and Linux

The main process prefers:

1. `backend-runtime/run-backend.sh`
2. fallback to `momodoc serve` if no bundled launcher is available

Inside `run-backend.sh`, execution order is:

1. bundled `.venv/bin/python`
2. bundled `.venv/bin/python3`
3. system `python3` with `PYTHONPATH` pointed at the bundled backend and site-packages
4. `momodoc` from `PATH`

### Packaged Windows

The main process prefers:

1. `backend-runtime/run-backend.cmd`
2. `powershell.exe -File backend-runtime/run-backend.ps1`
3. fallback to `momodoc serve` if neither launcher exists

Inside the Windows launchers, execution order is:

1. bundled `.venv\\Scripts\\python.exe`
2. `momodoc` from `PATH`

There is no system-Python fallback in the Windows launcher scripts.

### Development / Unpackaged Runs

When `app.isPackaged` is false, the desktop runtime skips bundled-launcher resolution and starts:

- `momodoc serve`

That is why local desktop development still depends on the backend CLI being available in the environment.

## Packaging Integration

`electron-builder.yml` copies the staged runtime into packaged app resources with:

```yaml
extraResources:
  - from: .backend-runtime-staging
    to: backend-runtime
```

That yields a packaged resource directory shaped like:

- `Resources/backend-runtime/backend/...`
- `Resources/backend-runtime/run-backend.sh` or Windows equivalents

## Runtime Behavior

At app startup:

1. `SidecarManager` first checks whether a healthy backend already exists.
2. If none is available, it resolves the launch command.
3. It spawns the backend detached with config-derived environment variables.
4. It waits up to 30 seconds for health readiness.
5. On success, startup state becomes `ready`.
6. On failure, startup state becomes `failed` with a category such as `spawn-error`, `timeout`, or `port-conflict`.

## Current Limitations

- The bundled `.venv` is copied from the local machine and may contain machine-specific interpreter paths.
- This packaging strategy is suitable for local packaging and smoke testing, but it is not yet a hardened cross-machine runtime distribution format.
- Dev mode still relies on `momodoc` being available outside the packaged app.
