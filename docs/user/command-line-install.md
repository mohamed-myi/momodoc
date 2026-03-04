# Command-Line Install (Desktop App)

Last verified version: `0.1.0` (script syntax/dry-run verified locally on macOS, 2026-02-25)

This installs the **desktop app** from GitHub Releases so users can launch Momodoc like a normal desktop application (no terminal needed after install).

## macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.sh | bash
```

Options:

```bash
# install a specific tag
curl -fsSL https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.sh | bash -s -- --version v0.1.0

# dry-run (show what would happen)
curl -fsSL https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.sh | bash -s -- --dry-run

# create optional CLI shim (advanced users)
curl -fsSL https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.sh | bash -s -- --cli-shim
```

## Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.ps1 | iex
```

Options:

```powershell
# install a specific tag
irm https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.ps1 | iex; Install-MomodocDesktop -Version v0.1.0

# dry-run
irm https://raw.githubusercontent.com/mohamedibrahim/momodoc/main/scripts/install.ps1 | iex; Install-MomodocDesktop -DryRun
```

## What the Installer Does

- Detects OS / architecture
- Downloads the latest (or pinned) release artifact from GitHub Releases
- Verifies artifact checksum (`SHA256SUMS.txt`)
- Installs the desktop app to a standard user location
- Creates a desktop shortcut/alias by default (platform support varies)
- Optionally creates a CLI shim for advanced users

## Notes on Verification

- `scripts/install.sh` help/syntax/dry-run were verified locally.
- Windows PowerShell execution and real GitHub download/install still require manual verification on target OS.
- Linux install behavior depends on published Linux artifacts (`.AppImage` / `.deb`).

## After Install

Launch Momodoc from:
- macOS: `Applications`
- Windows: `Start Menu` / desktop shortcut
- Linux: app launcher / desktop shortcut (artifact-dependent)

Then complete the first-run setup wizard.

## Uninstall

Exact paths vary by OS and selected options.

- macOS:
  - remove `~/Applications/momodoc.app`
  - remove Desktop alias/shortcut if created
- Windows:
  - remove `%LocalAppData%\Programs\momodoc` (or uninstall from Apps/Installed Apps if the installer registers there)
  - remove Desktop shortcut if present
- Linux:
  - remove `~/.local/opt/momodoc/` (AppImage install path used by script)
  - remove generated desktop shortcut (`~/.local/share/applications/momodoc.desktop` or Desktop shortcut, if created)

Optional:
- remove Momodoc app data directory only if you want to delete local projects/indexes/logs too (see [Desktop Troubleshooting](desktop-troubleshooting.md) for locations).
