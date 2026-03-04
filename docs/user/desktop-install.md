# Desktop Install

Last verified against source on 2026-03-04.

The desktop app is the most complete end-user surface in this repo. It adds onboarding, diagnostics, overlay chat, metrics, and packaged-build update support on top of the shared Momodoc UI.

## Recommended Paths

Choose one of these:

1. Download a packaged desktop build from GitHub Releases.
2. Use the installer scripts documented in [Command-Line Install](command-line-install.md).

## What The App Does On First Launch

Current desktop builds open a setup wizard when onboarding is `not_started` or `in_progress`.

The wizard can help you:

- choose allowed folders for indexing
- pick an AI mode
- choose a startup profile
- optionally create your first project

You can skip it and continue using the app immediately.

## Release Assets And Platform Notes

The repo contains two relevant sources of truth:

- desktop packaging config can build macOS dmg/zip and Windows NSIS installers
- the installer scripts only target a narrower set of published artifacts

Current script-backed expectations are:

- macOS command-line install: arm64 zip artifact
- Linux command-line install: x64 or arm64 AppImage
- Windows command-line install: x64 or arm64 NSIS `.exe`

Published release contents can vary by release, so the GitHub Releases page is the authoritative place to see what was actually uploaded for a given version.

## After Installation

The desktop app currently provides:

- project dashboard
- project chat, files, notes, and issues
- global chat on the dashboard
- settings
- diagnostics
- metrics
- optional overlay chat

## Updates

Packaged desktop builds can check for updates. Current updater behavior is:

- packaged builds only
- stable channel only
- update discovery can be automatic or manual
- download is manual after an update is found
- install happens on quit or via explicit install action

In dev or unpackaged runs, updater status is `unsupported`.

## Trust Warnings

Unsigned or unnotarized builds may trigger OS trust prompts.

Typical examples:

- macOS Gatekeeper warnings
- Windows SmartScreen warnings

Those warnings are separate from Momodoc runtime behavior.

## Uninstall

Remove:

- the installed app bundle or installer-managed app directory
- optional desktop shortcut or CLI shim if you created one

Optionally remove the Momodoc data directory if you want a full reset of:

- local settings
- logs
- indexes
- uploaded files
- local database

See [Desktop Troubleshooting](desktop-troubleshooting.md) for data-directory locations.
