# Desktop Troubleshooting

Last verified version: `0.1.0` (local dev + packaged backend smoke checks, 2026-02-25)

Use this order:
1. In-app diagnostics
2. Startup recovery actions
3. Logs/data folder review
4. Terminal checks (advanced)

## 1. Use In-App Diagnostics First

Open:
- `Settings -> Diagnostics`

Available tools:
- `Open Logs Folder`
- `Open Data Folder`
- `Test Backend Connection`
- `Restart Backend`
- `Copy Diagnostic Report`

If startup fails before the main UI loads, the startup error screen also provides:
- Retry
- Open Settings
- Open Logs
- Open Data Folder
- Copy Diagnostics

## 2. Common Startup Messages and Fixes

### Backend failed to start (port conflict)

Message usually mentions the configured port is already in use.

Fix:
- Open `Settings -> Server` and change the port, or
- Stop the conflicting local process using that port
- Retry from the startup screen

### Backend timeout / not ready in time

Fix:
- Retry once from the startup screen
- Open diagnostics and confirm backend health
- Check `sidecar.log` and `momodoc-startup.log`
- Large migrations or provider misconfiguration can delay startup

### Backend spawn failure

Fix:
- Open logs and diagnostics
- Reinstall using the packaged installer (ensures bundled backend runtime is present)
- If this is a dev build, confirm local backend dependencies exist

### Runtime / migration-style error

Fix:
- Open diagnostics -> copy report
- Review logs in data directory
- Back up the data directory before any cleanup/reset

### Token/auth mismatch message

Fix:
- Retry (desktop can restart backend and refresh runtime token)
- If persistent, use Diagnostics -> Restart Backend
- If still persistent, restart the desktop app

## 3. Where Logs and Data Live

Default data directory (platform-dependent):
- macOS: `~/Library/Application Support/momodoc/`
- Linux: `~/.local/share/momodoc/`
- Windows: `%APPDATA%\momodoc\`

Useful files:
- `sidecar.log` (desktop backend launcher / sidecar)
- `momodoc.log`
- `momodoc-startup.log`
- `session.token`
- `momodoc.port`
- `momodoc.pid`

## 4. Startup Settings That Affect Behavior

Open `Settings -> Startup & Launch` and verify:
- Launch profile (Desktop / Overlay / Web / VS Code / Custom)
- Auto-launch at login
- Tray icon enabled (required for tray-minimized startup)

If the app seems to "start but not show," check:
- tray icon is enabled
- launch profile is not set to minimized-to-tray without tray

## 5. Advanced Terminal Checks (Optional)

These are for maintainers or advanced users.

```bash
# backend health (replace port if customized)
curl -sf http://127.0.0.1:8000/api/v1/health

# view sidecar log (macOS example)
tail -n 200 ~/Library/Application\ Support/momodoc/sidecar.log
```

## 6. What to Include in a Support Report

From the app:
- `Settings -> Diagnostics -> Copy Diagnostic Report`

Attach or paste:
- redacted diagnostic report
- exact error message shown in startup screen (if any)
- app version / OS
- steps to reproduce

## Screenshot Notes

Troubleshooting screenshots (startup states + diagnostics UI) are pending manual capture from the packaged app verification run.
