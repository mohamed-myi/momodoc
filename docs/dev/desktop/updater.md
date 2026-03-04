# Desktop Updater Behavior

Last verified against source on 2026-03-04.

## Scope

This document describes the current Electron auto-update flow implemented by the desktop app. The source of truth is the updater runtime and its IPC handlers:

- `desktop/src/main/updater.ts`
- `desktop/src/main/ipc/updater.ts`
- `desktop/src/shared/updater-status.ts`
- `desktop/src/main/app-runtime.ts`
- `desktop/electron-builder.yml`

## When The Updater Exists

The updater is only created for packaged desktop builds. In `bootstrapDesktopApp(...)`, the app starts `UpdateManager` only when `isDev` is false.

In development or other unpackaged runs:

- `window.momodoc.getUpdaterStatus()` returns `unsupported`
- `check-for-updates` and `download-update` publish the same `unsupported` status back to the renderer
- the UI is expected to explain that updates are packaged-build only

## Current Channel And Install Policy

`UpdateManager` configures `electron-updater` with these defaults:

- `autoDownload = false`
- `autoInstallOnAppQuit = true`
- `allowPrerelease = false`
- `allowDowngrade = false`

That means the current product behavior is:

- stable releases only
- users must explicitly trigger the download after an update is found
- once downloaded, installation happens when the app quits or when `quitAndInstall()` is invoked
- older versions are not considered valid upgrade targets

## Check Timing

`UpdateManager.start()` performs:

- an initial check 10 seconds after startup
- recurring checks every 4 hours

The renderer can also invoke a manual check through IPC.

## Status Model

The updater publishes structured status payloads built by `makeUpdaterStatus(...)`. Current states are:

- `idle`
- `checking`
- `available`
- `downloading`
- `downloaded`
- `not-available`
- `error`
- `unsupported`

The main process also sends renderer events when useful:

- `update-available`
- `update-downloaded`
- `updater-status`

## User Flow

The current packaged-build flow is:

1. App starts and schedules the first update check.
2. `checkForUpdates()` contacts the configured release feed.
3. If an update is found, status becomes `available` and the renderer can offer a download action.
4. The renderer calls `download-update` to start `autoUpdater.downloadUpdate()`.
5. Progress is emitted as `downloading`.
6. When the payload finishes downloading, status becomes `downloaded`.
7. The app can restart into the update through `quit-and-install`, or install on quit.

## Logging

Updater logs are written to:

- `<userData>/updater.log`

This file is separate from the sidecar runtime logs and is the first place to check for:

- feed or metadata failures
- download failures
- version comparison issues
- GitHub publishing mistakes

## Release And Publishing Expectations

`electron-builder.yml` publishes through GitHub:

- provider: `github`
- owner: `mohamedibrahim`
- repo: `momodoc`

Successful update checks therefore depend on:

- packaged artifacts being published to the configured GitHub Releases feed
- matching updater metadata being present
- monotonically increasing stable version numbers
- platform-specific artifacts matching the desktop build target

## Known Constraints

- End-to-end verification requires a packaged app and published release artifacts.
- The updater does not run in local `vite` development.
- Pre-release channels are not implemented in the current desktop runtime.
