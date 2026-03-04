# Desktop Updater Behavior (Maintainer + Support)

Last verified version: `0.1.0` (code review + local build, 2026-02-25)

## Scope

Documents the Electron auto-updater behavior for packaged desktop builds and the release/versioning expectations for successful update checks.

## Source Files

- `/Users/mohamedibrahim/momodoc/desktop/src/main/updater.ts`
- `/Users/mohamedibrahim/momodoc/desktop/src/main/ipc/updater.ts`
- `/Users/mohamedibrahim/momodoc/desktop/src/shared/updater-status.ts`
- `/Users/mohamedibrahim/momodoc/desktop/electron-builder.yml`

## Packaged-Build Only

Updater support is packaged-build only.

In dev/unpackaged mode:
- updater IPC returns `unsupported`
- UI shows a packaged-only message instead of silent failure

## Channel / Versioning Behavior

Current defaults:
- stable channel only (`allowPrerelease = false`)
- no downgrade installs (`allowDowngrade = false`)
- auto-download enabled
- install on app quit enabled

Implication:
- release versioning and metadata must be consistent for GitHub Releases assets
- pre-release update flows are not part of the supported path unless explicitly changed

## Check Timing

Current behavior in `UpdateManager.start()`:
- first check ~10 seconds after app startup
- recurring checks every 4 hours

Users can also manually trigger:
- `Settings -> About -> Check for Updates`

## User-Visible States

Structured updater status payload supports:
- `idle`
- `checking`
- `available`
- `downloading`
- `downloaded`
- `not-available`
- `error`
- `unsupported`

These states power the settings UI and diagnostics-style messaging.

## Logging

Updater logs are written to:
- `<userData>/updater.log`

Use this file when diagnosing:
- failed checks
- download issues
- metadata mismatch problems

## Release Sequencing Requirements (for Updater Success)

1. Publish packaged artifacts to GitHub Releases (draft -> final as appropriate)
2. Ensure updater metadata files (`latest*.yml`) are present
3. Ensure version numbers increase monotonically for stable releases
4. Verify asset names/checksums before testing update flows

## Known Limitations

- End-to-end updater verification requires GitHub-hosted release artifacts and a packaged app upgrade path.
- Unsigned builds may present OS trust warnings unrelated to updater logic.
