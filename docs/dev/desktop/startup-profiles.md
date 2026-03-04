# Startup Profiles And Runtime Behavior

Last verified against source on 2026-03-04.

## Source Of Truth

- `desktop/src/shared/app-config.ts`
- `desktop/src/shared/desktop-settings.ts`
- `desktop/src/main/startup-profile-runtime.ts`
- `desktop/src/main/app-runtime.ts`
- `desktop/src/renderer/components/App.tsx`
- `desktop/tests/startupProfilesConfig.test.ts`

## Config Fields

Desktop startup behavior is configured with:

- `startupProfilePreset`
- `startupProfileCustom`
- `showInTray`
- `autoLaunch`

The preset type is:

- `desktop`
- `desktopOverlay`
- `desktopWeb`
- `vscodeCompanion`
- `custom`

`startupProfileCustom` uses this shape:

- `startBackendOnLaunch: boolean`
- `openMainWindowOnLaunch: boolean`
- `startMinimizedToTray: boolean`
- `openOverlayOnLaunch: boolean`
- `openWebUiOnLaunch: boolean`
- `openVsCodeOnLaunch: boolean`
- `restoreLastSession: boolean`

Default target values are:

- backend starts on launch
- main window opens on launch
- tray-minimized startup is off
- overlay launch is off
- web UI launch is off
- VS Code launch is off
- last-session restore is on

## Preset Defaults

Current presets resolve to:

- `desktop`: standard desktop window startup
- `desktopOverlay`: standard desktop startup plus overlay
- `desktopWeb`: standard desktop startup plus browser launch of the local web UI
- `vscodeCompanion`: backend on launch, no main window on launch, minimized to tray, best-effort VS Code launch
- `custom`: uses the stored `startupProfileCustom` targets after normalization

## Normalization And Migration

`normalizeAppConfig(...)` and `normalizeStartupProfileTargets(...)` ensure:

- missing keys are filled from defaults
- partial custom target objects are expanded
- invalid presets fall back to `desktop`
- onboarding state is normalized at the same time

`ConfigStore` loads normalized config, so older config files remain usable as fields are added.

## Conflict Resolution

`resolveEffectiveStartupProfile(...)` applies two runtime safety rules:

1. If `startMinimizedToTray` is enabled, visible main-window startup is disabled.
2. If tray-minimized startup is requested while `showInTray` is false, the app falls back to visible main-window startup and records a warning.

There is also a final safety fallback:

- if the resolved profile would open no visible surface at all, the main window is forced back on

## Startup Order

The main process currently starts in this order:

1. Load config from `ConfigStore`
2. Resolve startup profile conflicts and warnings
3. Create `SidecarManager`
4. Create the hidden main window
5. Register IPC handlers
6. Start the backend if `startBackendOnLaunch` is true
7. Notify the renderer of backend readiness or stoppage
8. Apply window visibility behavior
9. Create the tray icon if `showInTray` is true
10. Register the global shortcut
11. Start the updater for packaged builds
12. Apply OS auto-launch if `autoLaunch` is true
13. Run optional overlay, web UI, and VS Code launch actions

Failures in overlay, browser, or VS Code launch are logged but do not abort app startup.

## Restore Last Session

`restoreLastSession` is split across main and renderer behavior.

Current reality:

- the main process carries the setting in the startup profile contract
- the main process logs `restoreLastSession=false` as a no-op note
- the renderer implements the actual session restore using `localStorage["momodoc-desktop-last-session-v1"]`

The renderer restores:

- `dashboard`
- `settings`
- `metrics`
- or the last opened project view

If the resolved profile disables session restore, the renderer clears the stored session payload instead.

## Settings That Need Restart Versus Relaunch

`desktop/src/shared/desktop-settings.ts` classifies startup-related settings as next-launch behavior, not backend-restart behavior.

Current next-launch keys:

- `autoLaunch`
- `globalHotkey`
- `showInTray`
- `startupProfilePreset`
- `startupProfileCustom`

## Operational Notes

- `desktopWeb` opens `http://<host>:<port>/` in the system browser, using the configured backend host and port.
- `vscodeCompanion` launches the `code` command best-effort; it assumes VS Code is available on `PATH`.
- If backend startup is disabled by the profile, web UI launch is skipped because there is no ready backend to serve it.
