# Icons

All platform icons are generated from **`source-1024.png`** — the Clidable
mascot composited onto a macOS Big Sur-style squircle tile (824×824, r≈185
continuous corners, dark-plum gradient + violet glow, transparent outside the
tile). The mascot artwork itself is `web/logo.png`; the composite was produced
deterministically (no generative model), so mascot identity is pixel-exact.

To regenerate the whole set after changing the source:

```bash
bun run tauri icon src-tauri/icons/source-1024.png
```

That produces every required size/format:
- `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png` (cross-platform)
- `icon.icns` (macOS), `icon.ico` (Windows)
- `Square*.png` + `StoreLogo.png` (Windows Store)
- `android/` mipmaps and `ios/` AppIcon variants

`tauri.conf.json` references the desktop subset; `generate_context!()`
validates the files exist at compile time, so a missing icon fails
`cargo check`.
