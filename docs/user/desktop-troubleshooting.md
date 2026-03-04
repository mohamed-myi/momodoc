# Desktop Troubleshooting

Last verified against source on 2026-03-04.

## Start With Diagnostics

The desktop app exposes self-service diagnostics in:

- `Settings -> Diagnostics`

Current actions there include:

- `Open Logs Folder`
- `Open Data Folder`
- `Test Backend Connection`
- `Restart Backend`
- `Copy Diagnostic Report`

If the backend fails during launch, the startup recovery screen also offers:

- `Retry`
- `Open Settings`
- `Open Logs`
- `Open Data Folder`
- `Copy Diagnostics`

## Common Startup Failures

### Port conflict

Typical symptom:

- startup message says the backend port is already in use

What to do:

- change the backend port in settings
- or stop the conflicting local process
- retry from the startup screen

### Timeout

Typical symptom:

- backend did not become ready in time

What to do:

- retry once
- open diagnostics
- inspect `sidecar.log`, `momodoc.log`, and `momodoc-startup.log`

### Spawn failure

Typical symptom:

- backend could not be launched at all

What to do:

- inspect `sidecar.log`
- if this is a packaged build, reinstall and verify the packaged app is intact
- if this is a dev build, make sure `momodoc` is available in the environment when required

### Runtime or migration-style failure

Typical symptom:

- backend starts then reports an error during initialization

What to do:

- copy the diagnostic report
- inspect backend logs
- back up the data directory before manual cleanup

### Auth mismatch

Typical symptom:

- startup message mentions token, auth, unauthorized, or forbidden

What to do:

- retry first
- restart the backend from diagnostics
- restart the desktop app if the problem persists

## Logs And Runtime Files

Default Momodoc data directory:

- macOS: `~/Library/Application Support/momodoc/`
- Linux: `~/.local/share/momodoc/`
- Windows: `%LOCALAPPDATA%\\momodoc\\`

Useful files:

- `momodoc.log`
- `momodoc-startup.log`
- `sidecar.log`
- `updater.log` in packaged desktop builds
- `session.token`
- `momodoc.port`
- `momodoc.pid`
- `config.json` for Electron-side desktop settings

## When The App Starts But Does Not Show A Window

Check desktop startup behavior in `Settings -> App Behavior`.

Current things that can affect visibility:

- startup profile
- tray icon enabled or disabled
- auto-launch
- minimized-to-tray behavior

If you expected a window and only the tray icon appears, inspect the selected startup profile first.

## Manual Checks

Advanced users can validate the backend directly:

```bash
curl -sf http://127.0.0.1:8000/api/v1/health
```

And inspect recent sidecar logs, for example on macOS:

```bash
tail -n 200 ~/Library/Application\ Support/momodoc/sidecar.log
```

## What To Include In A Support Report

Include:

- copied diagnostic report
- exact error text from the app
- app version
- operating system and architecture
- whether the build is packaged or a local dev run
- steps to reproduce
