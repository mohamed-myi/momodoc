# Command-Line Install

Last verified against source on 2026-03-04.

This document covers the installer scripts in:

- `scripts/install.sh`
- `scripts/install.ps1`

These scripts install packaged desktop builds. They do not build the app from source.

## Platform Support In The Current Scripts

Current scripted support is:

- macOS arm64 via zip artifact
- Linux x64 and arm64 via AppImage
- Windows x64 and arm64 via NSIS `.exe`

Important current limitation:

- `scripts/install.sh` explicitly rejects macOS x64

## macOS And Linux

Install the latest supported release:

```bash
curl -fsSL https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.sh | bash
```

Useful options:

```bash
# pin a specific release tag
curl -fsSL https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.sh | bash -s -- --version v0.1.0

# dry run
curl -fsSL https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.sh | bash -s -- --dry-run

# install somewhere else
curl -fsSL https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.sh | bash -s -- --install-dir "$HOME/Applications"

# skip desktop shortcut creation
curl -fsSL https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.sh | bash -s -- --no-desktop-shortcut

# create an optional CLI shim
curl -fsSL https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.sh | bash -s -- --cli-shim
```

Current script behavior:

- resolves the latest release unless `--version` is provided
- downloads `SHA256SUMS.txt`
- verifies the artifact checksum
- installs to a per-user location by default
- optionally creates a desktop shortcut and CLI shim

## Windows PowerShell

The PowerShell installer is a parameterized script, not a helper function. The most reliable path is to download it and run it as a file.

Install the latest release:

```powershell
$tmp = Join-Path $env:TEMP "momodoc-install.ps1"
irm https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.ps1 -OutFile $tmp
powershell -ExecutionPolicy Bypass -File $tmp
```

Useful options:

```powershell
# pin a version
powershell -ExecutionPolicy Bypass -File $tmp -Version v0.1.0

# dry run
powershell -ExecutionPolicy Bypass -File $tmp -DryRun

# install somewhere else
powershell -ExecutionPolicy Bypass -File $tmp -InstallDir "$env:LOCALAPPDATA\Programs\momodoc"

# skip desktop shortcut
powershell -ExecutionPolicy Bypass -File $tmp -NoDesktopShortcut

# create CLI shim
powershell -ExecutionPolicy Bypass -File $tmp -CreateCliShim

# silent NSIS run
powershell -ExecutionPolicy Bypass -File $tmp -Silent
```

Current script behavior:

- resolves the latest release unless `-Version` is provided
- downloads `SHA256SUMS.txt`
- verifies the installer checksum
- runs the NSIS installer
- optionally creates a desktop shortcut and `momodoc-desktop.cmd` shim

## Default Install Locations

Current script defaults are:

- macOS: `~/Applications/momodoc.app`
- Linux: `~/.local/opt/momodoc/momodoc.AppImage`
- Windows: `%LocalAppData%\\Programs\\momodoc`

## Optional CLI Shim Names

If enabled, the scripts create:

- macOS and Linux: `~/.local/bin/momodoc-desktop`
- Windows: `~/.local/bin/momodoc-desktop.cmd`

These launch the desktop app. They are not the backend `momodoc` CLI.

## Uninstall

Remove the installed application path and any shortcut or shim you created.

Typical default paths:

- macOS: `~/Applications/momodoc.app`
- Linux: `~/.local/opt/momodoc/`
- Windows: `%LocalAppData%\\Programs\\momodoc`

You can also remove the Momodoc data directory if you want to wipe local state. See [Desktop Troubleshooting](desktop-troubleshooting.md) for those locations.
