# Icon Asset Pipeline

Momodoc desktop icon assets are generated from local source files in this repo.

## Tracked Source Assets

- Vector source asset: `assets/branding/icon-master.svg`
- 1024px raster master: `assets/branding/icon-1024.png`

Current implementation note:
- The generator script (`scripts/generate_desktop_icons.py`) is the canonical renderer for the raster exports in this repo today.
- `icon-master.svg` is tracked for design review/editing and is only auto-created if missing.

## Generated Desktop Assets

- `desktop/resources/icon.icns`
- `desktop/resources/icon.ico`
- `desktop/resources/tray-icon.png`

## Generate / Regenerate

From repo root:

```bash
python3 scripts/generate_desktop_icons.py
```

Notes:
- The script is dependency-free (Python stdlib only).
- It writes a modern PNG-based `.icns` directly and also attempts `iconutil` on macOS as a best-effort overwrite.
- In some environments `iconutil` may reject valid iconsets; the script falls back automatically and still emits `icon.icns`.
- The 1024px master render takes roughly 60-90 seconds; subsequent runs reuse the cached `icon-1024.png` if present. Delete that file to force a full re-render.

## Design Notes

- The icon is a monochrome lowercase "m" monogram on a pure black rounded-rect background.
- Subtle glassmorphism effects: radial gradient overlay, top-left glow, glass reflection on the upper half.
- The letter uses a vertical gradient from `#FFFFFF` to `#F0F0F0`.
- `tray-icon.png` is the standalone white "m" letterform on transparent, optimized for use as a macOS template image and other platform trays.
- The "m" path is constructed from straight segments and cubic beziers, flattened to a polygon for rasterization with 4x MSAA anti-aliasing.

## Ownership / Update Rules

- Update `icon-master.svg` and the generator script together when changing the design.
- Re-run the generator and commit all generated desktop assets in the same change.
- If packaging config icon paths change, update this doc and `desktop/electron-builder.yml`.
