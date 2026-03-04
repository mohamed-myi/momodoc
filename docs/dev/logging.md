# Logging Architecture

This document covers the logging subsystem from a development and operations perspective.

## Configuration

Logging is configured by `configure_logging()` in `backend/app/core/logging.py`, called at the start of the `lifespan` in `bootstrap/startup.py`.

## Log Files

### `momodoc.log`

Source: backend process (`backend/app/core/logging.py`)

Contains:
- startup/shutdown lifecycle logs
- migration logs
- service/router/core logs
- request logs (`RequestLoggingMiddleware` in `middleware/logging.py`: logs method, path, status code, and duration for every request)
- uncaught exception traces

Rotation: `maxBytes = 10MB`, `backupCount = 5`

### `momodoc-startup.log`

Source: backend process (additional rotating handler)

Contains: same logger stream directed to a dedicated startup-oriented file. Handler level is DEBUG but effective output depends on global `LOG_LEVEL`.

Rotation: `maxBytes = 5MB`, `backupCount = 3`

### `sidecar.log`

Source: desktop Electron sidecar (`desktop/src/main/sidecar.ts`)

Contains:
- sidecar start/stop/restart events
- backend stdout/stderr capture lines
- health polling and timeout messages
- stale PID/port cleanup events

Only produced when running the desktop app.

## Middleware Logging

Two middleware layers participate in logging:

1. **`RequestLoggingMiddleware`** (`backend/app/middleware/logging.py`): Logs every HTTP request with method, path, status code, and response time. Applied in `main.py` during app creation.
2. **`SessionTokenMiddleware`** (`backend/app/middleware/auth.py`): Logs authentication failures (invalid/missing token) as warnings.

## Related Runtime Files

In the data directory:
- `session.token`
- `momodoc.pid`
- `momodoc.port`
- `db/`
- `vectors/`
- `uploads/`
- `config.json` (desktop `electron-store`)
