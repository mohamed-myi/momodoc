# Logging Architecture

This document describes the logging behavior that exists in the codebase today.

## Backend Logging

Backend logging is configured by `configure_logging()` in `backend/app/core/logging.py` and is called at the start of the lifespan in `backend/app/bootstrap/startup.py`.

Current behavior:

- stdout logging is always enabled
- file logging is enabled when a `log_dir` is provided
- uvicorn loggers are pointed at the same handler set
- noisy third-party loggers such as `httpx` and `urllib3` are downgraded to `WARNING`

Log format:

```text
%(asctime)s %(levelname)-8s %(name)-20s %(message)s
```

## Backend Log Files

### `momodoc.log`

- Path: `<data_dir>/momodoc.log`
- Rotation: `10 MB`, `5` backups
- Contents: normal backend runtime logs, request logs, migration logs, search/chat/sync logs, uncaught exception traces

### `momodoc-startup.log`

- Path: `<data_dir>/momodoc-startup.log`
- Rotation: `5 MB`, `3` backups
- Handler level: `DEBUG`
- Important nuance: the root logger still uses the configured global log level, so this file is startup-focused but not an unconditional full-debug trace

## Middleware Logging

### Request logging

`backend/app/middleware/logging.py` logs:

- HTTP method
- request path
- response status
- duration in milliseconds

It skips:

- `/api/v1/health`
- `/static/`
- `/_next/`
- `/favicon`

### Authentication middleware

`backend/app/middleware/auth.py` enforces auth but does not emit its own warning log lines on token failures. It returns JSON error responses directly.

## Desktop Logging

### `sidecar.log`

- Path: `path.join(getDataDir(), "sidecar.log")`
- Writer: `desktop/src/main/sidecar.ts`
- Contents:
  - backend start/stop/restart attempts
  - launch strategy selection
  - backend stdout/stderr capture
  - startup timeout and stale PID recovery messages
  - sidecar ownership and shutdown decisions

### `updater.log`

- Path: `path.join(app.getPath("userData"), "updater.log")`
- Writer: `desktop/src/main/updater.ts`
- Contents:
  - update checks
  - update availability/download events
  - updater errors

Important scope detail:

- `updater.log` only matters in packaged desktop builds because the updater is not started in dev mode.

## VS Code Extension Logging

The extension writes operational logs to a VS Code output channel named `Momodoc`.

Current behavior:

- no dedicated extension log file is created by the repo code
- sidecar start/stop output and errors are appended to the output channel
- the status bar is UI state, not a log sink

## Frontend Logging

The web frontend has no dedicated file logger in this repo.

Current behavior:

- browser console output is the only frontend-local log sink
- API errors are usually surfaced as UI state rather than structured logs

## Diagnostics and Log Discovery

Desktop diagnostics uses the Momodoc data dir as the "logs folder" it opens for the user.

In practice, that folder typically contains:

- `momodoc.log`
- `momodoc-startup.log`
- `sidecar.log`
- runtime files such as `session.token`, `momodoc.pid`, `momodoc.port`

`updater.log` may live under the Electron user-data path and should be treated as a separate desktop-specific log.
