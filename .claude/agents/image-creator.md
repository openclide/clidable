---
name: image-creator
description: Generate PNG/image assets (app icon, marketing shots, illustrations, mascot art, social/OG images) for Clidable using the Codex CLI image-generation workflow. Use when asked to create, add, edit, or batch-generate any image or PNG art asset.
---

# Generating Clidable images with Codex

## The command

All images are generated through the Codex CLI. The exact invocation:

```bash
codex exec --skip-git-repo-check --sandbox workspace-write "<full art prompt>"
```

With a reference image (style-matching an existing asset, image-to-image edits):

```bash
codex exec --skip-git-repo-check --sandbox workspace-write -i <path/to/reference.png> "<prompt>"
```

There is no dedicated image subcommand — the quoted prompt is an art brief that
asks Codex to generate an image, and Codex invokes its image tool. Run one
`codex exec` per image; generation takes a while, so use a generous timeout
(300s+) or run in the background when batching.

`--sandbox workspace-write` is required so Codex can write the file. Never
escalate to `danger-full-access` without explicit user permission. If a run
hangs with no output, append `< /dev/null` to close stdin — Codex always reads
stdin and concatenates it with the positional prompt (see the Codex gotchas in
CLAUDE.md).

## Where output lands

Codex writes results to `~/.codex/generated_images/<session-uuid>/ig_<hash>.png`.
The session uuid is new each run, so grab the newest directory:

```bash
newest=$(ls -t ~/.codex/generated_images/ | head -1)
cp ~/.codex/generated_images/$newest/ig_*.png <destination>.png
```

A directory can hold more than one PNG (retries). Inspect before copying —
check size/mode/alpha with PIL (or just Read the PNG) rather than assuming the
last file is right.

## Destinations

- **Experiments and candidates:** a scratch dir (`art-tests/`, or the session
  scratchpad) — never drop raw candidates straight into the app.
- **App icon:** generate a **square 1024×1024** source PNG, then let Tauri fan
  it out into every required size:
  ```bash
  bun run tauri icon <source.png>
  ```
  This regenerates `src-tauri/icons/` (32x32, 128x128, 128x128@2x, icon.icns,
  icon.ico). Those files are validated at compile time by `generate_context!()`,
  so all sizes must exist — always regenerate the whole set, never hand-edit one.
- **Marketing / social / OG images, docs illustrations:** `docs/` (the docs
  site) or wherever the requesting task specifies.
- **Mascot / brand art:** match the existing purple octopus mascot on the
  welcome screen — pass a current asset via `-i` to stay on-model.

## Art direction (keep prompts consistent)

Clidable's look is a **dark, glassy, translucent UI** — deep near-black
backgrounds, soft purple/violet accents, subtle glass blur and inner-glow, thin
hairline borders, `oklch` color. The mascot is a friendly **purple octopus**.
Marketing art should read premium, calm, and developer-focused, not loud.

- Describe subject, framing, style, palette, lighting, and background
  **explicitly** — vague briefs give inconsistent results.
- **Transparency:** ask for a flat magenta or checkerboard background, then key
  it out in post. Never trust "transparent background" claims from the
  generator.
- **Style-matching / img2img:** the strongest lever for consistency — pass an
  existing on-brand asset via `-i` and ask Codex to match its palette, lighting,
  and finish.

## Post-processing

Codex outputs raw images only. Alpha keying, trimming, resizing, and grading are
done with Python/PIL. Typical steps: key out the flat background to alpha, trim
to content, resize/pad to the target dimensions, and colour-match to the
Clidable palette. Always inspect `size`/`mode`/`alpha` before shipping —
a wrong mode (e.g. no alpha channel) or off-size asset is a silent breakage.

## Verify

Load the asset where it's actually used:

- **App icon:** confirm `src-tauri/icons/` regenerated cleanly; `cd src-tauri &&
  cargo check` (icon presence is compile-time validated), or rebuild the Tauri
  shell and look at the dock/taskbar icon.
- **UI / mascot / marketing:** `bun run dev` (boots on :7878) and view it in the
  running app or docs page.

A wrong alpha, size, or off-brand palette is obvious the moment it renders in
context — always look, don't assume.
