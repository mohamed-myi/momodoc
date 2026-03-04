# Desktop Packaging

Last verified against source on 2026-03-04.

## Source Of Truth

- `desktop/package.json`
- `desktop/electron-builder.yml`
- `desktop/scripts/stage-backend-runtime.mjs`
- `desktop/scripts/verify-packaging-assets.mjs`

## Packaging Outputs

Desktop packaging writes artifacts to:

- `desktop/release/`

Artifact names follow:

```text
${productName}-${version}-${os}-${arch}.${ext}
```

With the current config, examples include:

- `momodoc-0.1.0-mac-universal.dmg`
- `momodoc-0.1.0-mac-universal.zip`
- `momodoc-0.1.0-win-x64.exe`
- `momodoc-0.1.0-win-arm64.exe`

## Platform Targets

Current `electron-builder` targets are:

- macOS: `dmg` and `zip`, both `universal`
- Windows: `nsis`, `x64` and `arm64`

There is no Linux packaging target configured in `electron-builder.yml`.

## Build Versus Package

`npm run build` in `desktop/` compiles the Electron and renderer bundles only.

Packaging scripts do more than that. They:

1. stage the backend runtime
2. verify required packaging assets
3. build the app
4. run `electron-builder`

## Packaging Scripts

Current desktop packaging scripts are:

- `npm run package:dir`
- `npm run package:current`
- `npm run package:mac-zip`
- `npm run package:ci:mac`

Behavior:

- `package:dir` creates an unpacked app directory
- `package:current` packages for the current platform using the config targets
- `package:mac-zip` builds only the macOS zip target
- `package:ci:mac` builds macOS zip and dmg for arm64, disables hardened runtime, and clears signing identity for CI-style unsigned packaging

## Runtime Bundling Dependency

Every packaging script stages `.backend-runtime-staging/` first. That step copies:

- backend source
- backend migrations
- `backend/.venv`
- launcher scripts used by the packaged sidecar

Without that staging step, packaged builds will not have the bundled backend runtime expected by `desktop/src/main/backend-launch.ts`.

## Packaging Asset Preflight

`npm run verify:packaging-assets` requires these files:

- `desktop/resources/icon.icns`
- `desktop/resources/icon.ico`
- `desktop/resources/tray-icon.png`
- `desktop/resources/dmg-background.png`
- `desktop/resources/nsis-header.bmp`
- `desktop/resources/nsis-sidebar.bmp`
- `desktop/electron-builder.yml`

If required assets are missing, the script instructs you to regenerate icon assets with:

```bash
python3 ../scripts/generate_desktop_icons.py
```

From the repo root, the equivalent command is:

```bash
python3 scripts/generate_desktop_icons.py
```

## Publish Configuration

Auto-update publishing is configured for GitHub Releases:

- owner: `mohamedibrahim`
- repo: `momodoc`

Packaging locally with `--publish never` does not publish anything; it only produces artifacts for local verification.

## What This Document Does Not Cover

This repo does not currently contain the extra release-checklist documents referenced by older versions of this file. The maintained packaging truth is the build config and scripts listed above.
