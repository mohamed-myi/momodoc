# Startup Profiles: Schema and Runtime Behavior

Last verified version: `0.1.0` (code review + tests/build + local runtime smoke, 2026-02-25)

## Purpose

Documents the desktop startup profile config contract, defaults, restart semantics, and how settings are executed in the Electron main process.

## Source Files

- `desktop/src/shared/app-config.ts`
- `desktop/src/shared/desktop-settings.ts`
- `desktop/src/main/config-store.ts`
- `desktop/src/main/app-runtime.ts`
- `desktop/src/main/startup-profile-runtime.ts`
- `desktop/src/main/window-factory.ts`

## Schema Fields

Top-level config fields:
- `startupProfilePreset`
- `startupProfileCustom`

### `startupProfilePreset`

Type: `desktop` | `desktopOverlay` | `desktopWeb` | `vscodeCompanion` | `custom`

Default: `desktop`

### `startupProfileCustom`

Type: `StartupProfileLaunchTargets`

Fields:
- `startBackendOnLaunch: boolean`
- `openMainWindowOnLaunch: boolean`
- `startMinimizedToTray: boolean`
- `openOverlayOnLaunch: boolean`
- `openWebUiOnLaunch: boolean`
- `openVsCodeOnLaunch: boolean`
- `restoreLastSession: boolean`

Default values: backend starts, main window opens, not minimized to tray, overlay/web/VS Code off, restore last session on.

## Preset Defaults

Defined in `STARTUP_PROFILE_PRESET_DEFAULTS`:
- `desktop`: desktop window only (standard startup)
- `desktopOverlay`: desktop window + overlay
- `desktopWeb`: desktop window + local web UI in browser
- `vscodeCompanion`: backend + tray/minimized + VS Code (best effort)

## Startup Sequence (Runtime)

1. Load config from `ConfigStore`
2. Resolve effective startup profile and conflicts (`resolveEffectiveStartupProfile(...)`)
3. Create sidecar manager
4. Create main window (hidden initially; `showOnReady: false`)
5. Register IPC handlers
6. Start backend if enabled by profile
7. Publish backend status to renderer
8. Apply main-window visibility behavior
9. Create tray (if enabled)
10. Register global shortcut(s)
11. Start updater (packaged builds)
12. Apply auto-launch login settings
13. Best-effort optional startup actions: overlay, web UI in browser, VS Code launch

## Conflict Handling / Fallbacks

Implemented in `startup-profile-runtime.ts`:
- `startMinimizedToTray + openMainWindowOnLaunch`: visible main-window startup is disabled when minimized-to-tray is selected
- hidden startup with tray disabled and no other visible surfaces: falls back to opening the main window (warning is logged)

## Resilience Rules

- Optional action failures do not block core app startup.
- VS Code and browser launches are best-effort and logged.
- Backend-disabled profiles skip web UI launch when backend is unavailable.

## Restore Last Session

Runtime contract includes `restoreLastSession`.

Current implementation split:
- main process: startup profile contract + logging
- renderer shell (`App.tsx`): persists/restores last view/project in localStorage when enabled

If `restoreLastSession=false`, stored session payload is cleared.

## Migration / Normalization

`normalizeAppConfig(...)` and `normalizeStartupProfileTargets(...)` ensure:
- missing startup profile fields are filled with defaults
- older configs remain valid
- partial `startupProfileCustom` payloads are safely expanded

`ConfigStore` normalizes stored config on load.

## Restart Semantics

These settings are classified as next-launch app behavior (not backend restart):
- `autoLaunch`
- `globalHotkey`
- `showInTray`
- `startupProfilePreset`
- `startupProfileCustom`

See: `DESKTOP_NEXT_LAUNCH_KEYS`, `changeTakesEffectOnNextLaunch(...)`

## Verification Coverage

Covered by tests: `desktop/tests/startupProfilesConfig.test.ts`

Includes: defaults, preset resolution, custom resolution, migration from old config shape, partial-field normalization, restart semantics helper checks.

## Troubleshooting Notes

- VS Code launch requires `code` command on PATH (best effort)
- Web UI launch uses configured host/port and opens system browser
- Tray-minimized startup requires tray icon enabled
