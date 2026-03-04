# Momodoc Log Files and Debugging

This guide covers where to find log files and how to use them for troubleshooting.

## Log Location

Logs are written under the Momodoc data directory (`MOMODOC_DATA_DIR` override supported).

Default locations:
- macOS: `~/Library/Application Support/momodoc/`
- Linux: `~/.local/share/momodoc/`
- Windows: `%APPDATA%\momodoc\`

## Log Files

### `momodoc.log`

The primary backend log. Contains:
- startup/shutdown lifecycle logs
- service and request logs
- uncaught exception traces

Rotation:
- `maxBytes = 10MB`
- `backupCount = 5`

### `momodoc-startup.log`

A dedicated startup log. Especially useful when the backend fails to start.

Rotation:
- `maxBytes = 5MB`
- `backupCount = 3`

### `sidecar.log`

Only produced when running the desktop app. Contains:
- sidecar start/stop/restart events
- backend stdout/stderr capture lines
- health polling and timeout messages
- stale PID/port cleanup events

## Common Startup Sequence (Desktop)

1. `sidecar.log`: sidecar decides whether backend is already running
2. `sidecar.log`: sidecar starts/reuses backend process
3. `momodoc.log`: backend critical startup (dirs, DB, migrations, token)
4. `momodoc.log`: deferred startup tasks begin
5. `sidecar.log`: backend health check succeeds

## Debugging Checklist

### Backend does not start

1. Check `momodoc.log` for migration/init/port errors
2. Check `momodoc-startup.log` for startup-path details
3. Check if stale runtime files exist (`momodoc.pid`, `momodoc.port`)

### Desktop cannot connect

1. Check `sidecar.log` for `Failed to start` or timeout lines
2. Verify `momodoc` CLI is available for sidecar spawn
3. Confirm backend health endpoint responds: `GET /api/v1/health`

### Token/auth failures (`401`)

1. Confirm `session.token` exists in data dir
2. Confirm clients send `X-Momodoc-Token`
3. Re-read token after backend restart (token rotates each run)

## Related Runtime Files

Also in data dir:
- `session.token`
- `momodoc.pid`
- `momodoc.port`
- `db/`
- `vectors/`
- `uploads/`
- `config.json` (desktop `electron-store`)
