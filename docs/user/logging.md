# Momodoc Logs And Debugging

Last verified against source on 2026-03-04.

## Default Log Location

Momodoc logs live under the Momodoc data directory unless you override the data directory.

Default locations:

- macOS: `~/Library/Application Support/momodoc/`
- Linux: `~/.local/share/momodoc/`
- Windows: `%LOCALAPPDATA%\\momodoc\\`

## Backend Log Files

Current backend log files are:

- `momodoc.log`
- `momodoc-startup.log`

`momodoc.log` is the main rotating backend log.

`momodoc-startup.log` captures startup-related information and is especially useful when initialization fails early.

## Desktop Log Files

When using the desktop app, you may also see:

- `sidecar.log`
- `updater.log`

`sidecar.log` records Electron-side backend lifecycle activity such as:

- reuse of an existing backend
- stale PID cleanup
- spawn attempts
- stdout and stderr capture
- readiness timeouts

`updater.log` exists for packaged desktop builds and records update checks, download state, and updater failures.

## Extension Logs

The VS Code extension does not currently write its own dedicated log file. Its operational logs go to the VS Code output channel:

- `View -> Output -> Momodoc`

## Other Useful Runtime Files

The same data directory also contains:

- `session.token`
- `momodoc.pid`
- `momodoc.port`
- `db/`
- `vectors/`
- `uploads/`
- `config.json` for desktop Electron settings

## Practical Debugging Order

1. Check `momodoc-startup.log` for startup or migration failures.
2. Check `momodoc.log` for backend request and service errors.
3. If using desktop, check `sidecar.log` for spawn and readiness problems.
4. If using a packaged desktop build and updates are involved, check `updater.log`.
5. If using the VS Code extension, inspect the `Momodoc` output channel.

## Common Cases

### Backend does not start

Inspect:

- `momodoc-startup.log`
- `momodoc.log`
- `momodoc.pid`
- `momodoc.port`

### Desktop cannot connect

Inspect:

- `sidecar.log`
- backend health at `http://127.0.0.1:8000/api/v1/health`
- `session.token`

### Token or auth issues

Inspect:

- whether `session.token` exists
- whether the client is sending `X-Momodoc-Token`
- whether the backend was restarted and rotated the token
