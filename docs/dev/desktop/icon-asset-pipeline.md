# Desktop Icon And Packaging Asset Pipeline

Last verified against source on 2026-03-04.

## Source Of Truth

- `scripts/generate_desktop_icons.py`
- `desktop/scripts/verify-packaging-assets.mjs`
- `desktop/electron-builder.yml`

## Inputs

The generator script works from repo-level branding assets:

- `assets/branding/icon-master.svg`
- `assets/branding/icon-1024.png`

`icon-master.svg` is treated as a reusable source asset. The generator will create it if it does not already exist.

`icon-1024.png` is the cached master raster. The script reuses it when present and only re-renders it when missing.

## Generated Outputs

The script currently writes:

- `assets/branding/icon-master.svg` if missing
- `assets/branding/icon-1024.png`
- `desktop/resources/icon.ico`
- `desktop/resources/icon.icns`
- `desktop/resources/tray-icon.png`
- `desktop/resources/dmg-background.png`
- `desktop/resources/nsis-header.bmp`
- `desktop/resources/nsis-sidebar.bmp`

## How Generation Works

The script is pure Python stdlib. It does not depend on Pillow or other third-party libraries.

Current rendering details:

- the main app icon is rasterized directly from an internal path definition for the `m` monogram
- the tray icon is a transparent white monogram without the rounded black background
- the ICO file embeds multiple PNG sizes
- the ICNS file is written directly and then optionally regenerated with `iconutil` on macOS
- the DMG and NSIS packaging graphics are generated from dedicated samplers in the same script

The 1024px master render is the expensive step. Subsequent runs are faster because the cached PNG is reused.

## Commands

From the repo root:

```bash
python3 scripts/generate_desktop_icons.py
```

From `desktop/`:

```bash
python3 ../scripts/generate_desktop_icons.py
```

## Packaging Dependency

Desktop packaging preflight currently requires:

- `icon.icns`
- `icon.ico`
- `tray-icon.png`
- `dmg-background.png`
- `nsis-header.bmp`
- `nsis-sidebar.bmp`

If any of those are missing, `desktop/scripts/verify-packaging-assets.mjs` fails the packaging step.

## Platform Notes

- On macOS, the script may use `sips` for PNG resizing and `iconutil` for a native `.icns` rebuild.
- On non-macOS systems, the script still writes `.icns` directly using PNG-compressed icon chunks.
- If `iconutil` fails, the direct `.icns` output remains as the fallback artifact.

## Maintenance Rules

- When the icon design changes, regenerate all derived desktop assets in the same change.
- Keep this document aligned with the actual script outputs rather than older packaging assumptions.
