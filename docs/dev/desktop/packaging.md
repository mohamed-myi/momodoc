# Desktop Packaging (Maintainer)

This document describes local desktop packaging commands and artifact naming for Momodoc.

## Build vs Package

- `make build-desktop`
  - Compiles desktop renderer/main bundles only.
  - Does **not** produce an installer/archive.

- `make package-desktop`
  - Packages the desktop app for the current platform using `electron-builder`.
  - Produces installer/archive artifacts under `/Users/mohamedibrahim/momodoc/desktop/release/`.

## NPM Scripts (desktop/)

- `npm run verify:packaging-assets`
- `npm run package:dir`
- `npm run package:current`
- `npm run package:mac-zip`

## Artifact Naming Convention

Configured in `/Users/mohamedibrahim/momodoc/desktop/electron-builder.yml`:

```text
${productName}-${version}-${os}-${arch}.${ext}
```

Examples:
- `momodoc-0.1.0-mac-arm64.zip`
- `momodoc-0.1.0-mac-universal.dmg`
- `momodoc-0.1.0-win-x64.exe`

## Preflight Requirements

Desktop packaging scripts run a preflight check for required assets:

- `desktop/resources/icon.icns`
- `desktop/resources/icon.ico`
- `desktop/resources/tray-icon.png`
- `desktop/electron-builder.yml`

If icons are missing, regenerate them from repo root:

```bash
python3 scripts/generate_desktop_icons.py
```

## Release QA and Evidence (Required)

Desktop packaging is not a release sign-off by itself. Before publishing a release, use:

- `/Users/mohamedibrahim/momodoc/docs/release-verification-checklist.md`
- `/Users/mohamedibrahim/momodoc/docs/desktop-smoke-matrix.md`
- `/Users/mohamedibrahim/momodoc/docs/release-evidence-template.md`
- `/Users/mohamedibrahim/momodoc/docs/release-evidence-sample-dry-run-0.1.0.md` (example)
- `/Users/mohamedibrahim/momodoc/docs/desktop-release-runbook.md`
- `/Users/mohamedibrahim/momodoc/docs/desktop-updater.md`

Release tickets must include both:
- verification evidence
- documentation evidence
