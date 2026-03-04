# Desktop Install (Recommended)

Last verified version: `0.1.0` (local packaged build on macOS, 2026-02-25)

Momodoc is designed to run as a desktop app without needing the App Store or paid hosting.

## Recommended Path

1. Install the desktop app from GitHub Releases (GUI download) or the command-line installer.
2. Launch `momodoc` from Applications / Start Menu / desktop shortcut.
3. Complete the first-run setup wizard.

## Download From GitHub Releases

Release artifacts are published here:
- [GitHub Releases](https://github.com/mohamedibrahim/momodoc/releases)

Typical artifacts:
- macOS: `momodoc-<version>-mac-universal.dmg` and `.zip`
- Windows: `momodoc-<version>-win-x64.exe` / `momodoc-<version>-win-arm64.exe`
- Linux (when published): `.AppImage` and/or `.deb`

## First Launch (What to Expect)

On first launch, Momodoc opens a setup wizard that guides you through:
- allowed folders (for indexing/sync)
- AI mode (search-only, local Ollama, or cloud providers)
- startup behavior (desktop/overlay/web/VS Code companion presets)
- optional first project creation

You can skip and finish later. The app stays usable.

## Desktop Launch Profiles (Open Together)

Open `Settings -> Startup & Launch` to control what opens together when Momodoc starts:
- Desktop window
- Overlay
- Web UI in browser
- VS Code (best effort)
- Tray behavior / auto-launch

## Unsigned Build Warnings (Expected)

Momodoc can be distributed without paid code signing/notarization, but OS trust warnings are expected.

- macOS: Gatekeeper may warn that the app is from an unidentified developer.
- Windows: SmartScreen may warn before running the installer.

If you trust the release source (`mohamedibrahim/momodoc` GitHub Releases), continue using your OS's "Open anyway" / "More info -> Run anyway" flow.

## Updating

- Packaged desktop builds check for updates via GitHub Releases.
- The app may show a "What's New" dialog after version changes.
- You can also manually check updates in `Settings -> About`.

## Uninstall

1. Quit Momodoc.
2. Remove the installed app bundle/installer location for your platform.
3. Optionally remove Momodoc data files if you want a full reset (projects, indexes, logs, local settings).

Data directory locations are listed in:
- [Desktop Troubleshooting](desktop-troubleshooting.md)

If you installed via the command-line installer, see platform-specific paths in:
- [Command-Line Install](command-line-install.md)

## Troubleshooting (Start Here)

Use in-app diagnostics first:
- `Settings -> Diagnostics`
- `Open Logs Folder`
- `Open Data Folder`
- `Copy Diagnostic Report`

Then see [Desktop Troubleshooting](desktop-troubleshooting.md).

## Screenshot Notes

Screenshots are pending manual capture from a packaged app verification run and will be added after final release verification.
