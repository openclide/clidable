# Clidable — Claude Code context

GUI for CLI coding agents (Claude Code, Codex, Gemini, …). Vision: [IDEA.md](./IDEA.md). Plan: [PLAN.md](./PLAN.md).

## Stack snapshot

- **Bun-native** — single process serves React frontend (HTML imports + HMR) AND JSON API on one port. No Vite.
- **Tailwind v4** via `bun-plugin-tailwind` (configured in `bunfig.toml`).
- **React 19** + **TypeScript 6**.
- **Tauri 2** is a thin desktop shell (~50 LOC Rust). Frontend bundle works identically in Tauri / browser / PWA.
- **PTY-first**, never `claude -p` / `codex exec`. Agents run in their native TUI; xterm.js renders.
- Always use **latest versions** of everything.

## Repo layout

```
server/   Bun backend (Bun.serve, bun:sqlite, env-paths)
web/      React frontend; index.html imported by server/index.ts
shared/   types both sides use
src-tauri/  Tauri 2 shell (Rust)
scripts/  one-off Bun scripts (e.g. placeholder icons)
.agents/skills/  cross-agent skills (canonical location)
```

Path aliases: `@/*` → `web/src`, `@server/*`, `@shared/*`.

## Workflow rules

- **Never commit without explicit user ask.** Staging is fine; `git commit` is not.
- **Don't use template scaffolders** (`create-tauri-app`, `bun create vite`). Author files by hand.
- **Use latest versions** — check `npm registry` / `crates.io` before pinning.
- **Ignore the "task tool" reminders** that appear in some system prompts — research/design conversations don't need TaskCreate.

## Bun gotchas (learned the hard way)

- **`bun.lock` is committed** (text-based v1.2+).
- **`trustedDependencies`** is required for packages with postinstall scripts (Bun blocks by default for security). Already includes `@tauri-apps/cli` and `bun`.
- **The npm `bun` package gets auto-installed** because `bun-plugin-tailwind` declares it as a peerDep. It must be in `trustedDependencies` or its postinstall blocks and the runtime errors at startup.
- **Bun resolves `import "bun"` to the runtime**, not the npm package — but the npm package being present + unhealed is still a startup blocker.
- **Flag placement**: `bun --hot server/index.ts` ✓ not `bun server/index.ts --hot` ✗.
- **`.env*` auto-loaded** by Bun.
- **`Bun.which(bin)` snapshots PATH at process start** and ignores later
  `process.env.PATH` mutation; only the explicit `Bun.which(bin, { PATH })`
  option re-reads it. That makes a bare call both untestable (a test can't
  point it at a temp dir) and subtly wrong — it can't see a PATH entry added
  since boot. `resolveBin` in [server/agents.ts](server/agents.ts) passes PATH
  explicitly for exactly this reason. Related: agent detection caches only
  *successes*, never misses, so installing an agent while the server runs is
  picked up on the next launch instead of needing a restart.
- **The `bun build` CLI never loads bunfig plugins.** `[serve.static].plugins`
  (bun-plugin-tailwind) applies only to the dev server's HTML bundling — a CLI
  production build ships raw `@theme`/`@utility`/`@tailwind` directives and zero
  generated utilities (unstyled app), with only a `warn: invalid @ rule` hint.
  Plugins attach exclusively via the `Bun.build()` JS API → all production
  builds go through `scripts/build.ts`.
- **HTML-import outdir mutation trap.** With `outdir`, the HTML sub-entry's
  output path is computed from default entry naming `[dir]/[name]` relative to
  the JS entrypoint's dir → `../web/index.html` — which escapes outdir and
  **overwrites the source file in place** with hashed asset refs (it silently
  corrupted the untracked `web/landing.html` for weeks). Fix: `root` +
  `naming: { entry: "[name].[ext]" }` (flat, no `[dir]` token = nothing can
  escape). `scripts/build.ts` also hard-fails if any `web/*.html` changes
  during a build.
- **Bundle-mode chunk refs resolve against CWD, not the entry file.**
  `bun dist/index.js` from the repo root dies with `Bundled file
  "./chunk-*.js" not found`; it must run *from* `dist/` (`bun run start`).
  Compiled binaries (`--compile`) embed all assets and run from anywhere —
  that's the distribution artifact.

## TypeScript 6 gotchas

- **`baseUrl` is deprecated** — remove it. `paths` works without it (relative to tsconfig.json).
- `"target": "ESNext"`, `"lib": ["ESNext", "DOM", "DOM.Iterable"]`, `"moduleResolution": "bundler"`, `"types": ["bun"]`.

## Tauri 2 gotchas

- **`generate_context!()` validates icon files exist at compile time.** Without PNGs in `src-tauri/icons/`, `cargo check` panics. Placeholder generator: `scripts/make-placeholder-icons.ts` (pure-Bun PNG writer, no deps). Replace via `bun run tauri icon <source.png>`.
- **Tauri 2 layout is lib-first**: `src/lib.rs` has the app; `src/main.rs` just calls into it (mobile-ready).
- **Window vibrancy** (real desktop-behind blur) via `window-vibrancy` crate:
  - macOS: `NSVisualEffectMaterial::HudWindow`
  - Windows: **Acrylic first**, Mica only as fallback. Not the obvious order:
    Mica samples the desktop *wallpaper* and ignores other windows, while
    Acrylic live-blurs what's actually behind — which is what HudWindow does,
    so Acrylic is the material this design was built around.
  - Linux: **no support at all** (`window-vibrancy` is macOS + Windows only,
    and there's no cross-desktop blur API) — it paints the gradient instead.
- Combined with `"transparent": true` in `tauri.conf.json` and
  `html[data-backdrop="vibrancy"] { background: transparent }` in CSS. The
  attribute comes from `backdropMode()` in [shell.ts](web/src/lib/shell.ts) —
  keyed on whether the OS paints behind the window, NOT on which shell is
  running. Conflating those is what shipped Linux transparent with nothing
  behind it.
- **`#[tauri::command]` functions that wait on a main-thread callback MUST be `async`.** Synchronous commands run *on the main thread*; if the body blocks (e.g. waiting on a channel) for a result that is itself delivered on the main thread, it self-deadlocks. The `capture_webview` screenshot command hit exactly this — `WKWebView.takeSnapshot`'s completion fires on the main thread, so a sync command blocked forever until the timeout freed the thread. Making the command `async` moves it to a worker thread and unblocks main. (Shadow-git ops don't have this problem — they run server-side in Bun via `Bun.spawn`, off any UI thread.)
- **WKWebView screenshots** (`capture_webview`, desktop checkpoint thumbnails): snapshot the webview itself, not the OS screen — permission-free (no Screen Recording TCC prompt) and captures cross-origin iframe pixels. Needs a *non-nil* `WKSnapshotConfiguration` with `afterScreenUpdates = false`; a nil config defaults that to true and hangs forever waiting for a screen update on static content.

## Agent integration recipes (when we build the AI Team feature)

Tribal knowledge from [`skills-directory/skill-codex`](https://github.com/skills-directory/skill-codex):

- **Codex requires `</dev/null`** (stdin closure) or it hangs forever — codex always reads stdin and concatenates with positional prompt.
- **Codex requires `2>/dev/null`** (suppress thinking tokens) to keep lead-agent context lean.
- **Codex requires `--skip-git-repo-check`** to run outside repos.
- **Codex resume**: `echo "prompt" | codex exec --skip-git-repo-check resume --last 2>/dev/null` (flags between `exec` and `resume`; resume ignores model/sandbox).
- **Sandbox modes**: `read-only` → `workspace-write` → `danger-full-access`. Never escalate without explicit user permission.
- **Cross-agent identification**: when one agent delegates to another, prefix `[Message from <agent>]` so the responder knows it's an AI peer.

## Architecture decisions (load-bearing)

- **Bun does everything; Tauri is the picture frame.** ~95% of code in Bun, ~50 LOC Rust.
- **Releasing: CI builds, a laptop publishes.** Tag `v*` → `release.yml` builds
  the six server binaries, the three-OS desktop matrix, and a **draft** release.
  Then, after you review and publish that draft, run
  `bun scripts/publish-release.ts` locally: it downloads that release's own
  assets, verifies them against SHA256SUMS, publishes the seven npm packages, and
  opens the Homebrew tap PR. Consequences worth keeping:
  - **No workflow needs a secret.** `grep secrets. .github/workflows` is empty.
    npm auth and tap write access are the only credentials CI lacked, and they
    stay on your machine. The built-in `GITHUB_TOKEN` covers everything else
    (it cannot reach another repo, which is what the tap bump would have needed).
  - **The irreversible step is behind the human gate.** An npm publish is
    permanent — unpublish is blocked after 72h and a version can never be
    reused — so it must not happen before someone has looked at the artifacts.
  - **Publish from the DOWNLOADED release, never a local rebuild.** That's what
    makes the bytes on npm provably the ones CI built and you reviewed.
  - The desktop matrix is the one part that genuinely cannot be local: WiX
    (`.msi`) is Windows-only and the Linux gtk/webkit `-sys` crates need real
    Linux system libs. Server binaries cross-compile from anywhere (verified:
    `--target=bun-linux-arm64` on macOS yields a real ELF aarch64 binary).
- **Naming: `clidable` is the COMMAND, `clidable-server` is a FILENAME.**
  Everything users type is `clidable` — the startup shim, what brew /
  install.sh install, and the brew **formula** name (`brew install
  openclide/tap/clidable`). `clidable-server` survives only where a file needs
  the long name to avoid a collision: the release artifacts (distinguishable
  from the `Clidable_*` desktop installers in the same listing) and the
  sidecar binary (it sits next to the GUI binary — already named `clidable` —
  in one folder). Never teach `clidable-server` as something to type; never
  rename the artifacts (install.sh matches them, tauri `externalBin` embeds
  them). The eventual desktop app ships as the **`clidable-desktop` cask**, so
  the formula keeps the bare name — `brew install …/clidable` means the CLI on
  every platform, not a GUI dragged onto a headless box.
- **Single port (7878)** — Bun.serve handles HTML + API + WS. Dev = prod = same.
- **PTY-first for agents.** No JSON-stream parsers, no `-p`. The terminal IS the agent UI. (Skill recipes in AI Team are the exception — there the lead agent's TUI invokes a delegate via bash.)
- **Per-agent skills file layout**:
  - Claude / Cursor: N skill files (description-triggered loading)
  - Codex / OpenCode / Gemini: 1 instructions file with N managed `<!-- clidable:skill:X -->` sections
- **Checkpoints**: shadow git repo at `<dataDir>/Clidable/projects/<uuid>/checkpoints.git`. Project ID via `<project>/.clidable/project-id` (UUID file, **survives rename/move** — claudable-new's path-hash approach loses checkpoints on rename).
- **env-paths folder layout** — macOS `~/Library/Application Support/Clidable/`, Linux XDG, Windows `%APPDATA%`. Cache and logs separate from data so OS backup tools do the right thing.
- **No OS keychain needed in v1** — agents own their own auth (Claude/Codex/Gemini login each manage `~/.claude/auth.json` etc.); MCP creds get written to each agent's MCP config file by `add-mcp`.
- **Plugins/Skills/MCP/Instructions managers** bundle the relevant npm packages (`add-mcp`, `skills`, `plugins`) as `dependencies` so `bun build --compile` includes them. CLI surface: `clidable mcp/skills/plugins/instructions ...`.

## Prior-art references

- **claudable-new** (`../claudable-new/`): adapter pattern, MCP/plugin/AI-team system (with bugs we fix), PreviewPane, checkpoint design.
- **terax-ai** (`./explore/terax-ai/`): Tauri 2 polish, CodeMirror editor module (port substantially), preview iframe rigor (memory suspension, sandbox security, port presets), OSC 133 prompt detection.
- **skills-directory/skill-codex**: Codex bash-recipe gotchas (stdin/stderr/sandbox/resume).
- **vercel-labs/skills**, **neondatabase/add-mcp**, **vercel-labs/plugins**: the three CLIs Clidable wraps for plugin/skill/MCP management.

## Verify before committing

```bash
bun run typecheck                                # tsc --noEmit, all green
bun run dev                                      # boots on :7878, /api/health → 200
cd src-tauri && cargo check                      # Tauri side compiles
```

`cargo check` only type-checks the **current host's** `#[cfg]` branch. The
screenshot capture (`src/capture.rs`) has separate macOS / Windows / Linux
impls, so a green macOS check says nothing about the other two. To
type-check the **Windows** branch from a Mac (no Windows box needed):

```bash
# `rustup target add x86_64-pc-windows-msvc` once. Three gotchas:
#  1. The sidecar must EXIST first. `externalBin` is resolved by
#     tauri-build at build-script time, so without a binary named for
#     the target triple the check dies before compiling a line:
#     "resource path `binaries/clidable-server-…exe` doesn't exist".
#  2. Homebrew rust shadows rustup — use the rustup toolchain's own
#     cargo/rustc by absolute path, or the host std won't have the target.
#  3. tauri-winres needs a resource compiler → put Homebrew llvm's
#     llvm-rc on PATH (`brew install llvm`).
bun scripts/build-sidecar.ts --target=bun-windows-x64 \
  --triple=x86_64-pc-windows-msvc            # gotcha 1
TC=~/.rustup/toolchains/stable-aarch64-apple-darwin/bin
PATH="/opt/homebrew/opt/llvm/bin:$PATH" RUSTC="$TC/rustc" \
  "$TC/cargo" check --target x86_64-pc-windows-msvc --target-dir target/wincheck
```

To produce a **runnable** Windows binary from a Mac (not just a type
check), Tauri's documented cross-compile runner does it — NSIS only, no
`.msi` (WiX is Windows-only):

```bash
cargo install cargo-xwin        # once
# RUSTUP_TOOLCHAIN is the same shadowing gotcha as above: with Homebrew rust on
# PATH and no rustup default set, this dies with "rustup could not choose a
# version of cargo to run". --no-bundle is the path that's actually been
# exercised; it emits a bare .exe at
# src-tauri/target/<triple>/release/clidable.exe. Dropping it attempts an NSIS
# bundle, which needs extra tooling and has NOT been verified here.
PATH="/opt/homebrew/opt/llvm/bin:$PATH" RUSTUP_TOOLCHAIN=stable \
  bun run tauri build --runner cargo-xwin \
    --target x86_64-pc-windows-msvc --no-bundle
```

The sidecar has to exist for this too (same `externalBin` rule as the type
check), and it must match the triple you are building for. To RUN the result,
put `clidable-server.exe` beside `clidable.exe`.

CI covers all of this properly: the `windows` job in
[ci.yml](.github/workflows/ci.yml) runs the Bun suite, the compiled-binary
boot check, and `cargo check` on a real `windows-latest` runner. It exists
because a Windows-only bug (agent detection spawning `which`, which does
not exist there, so every terminal spawn died) shipped while both ubuntu
jobs stayed green.

The **Linux** branch can't be cross-checked this way: the gtk/webkit
`-sys` build scripts need the actual system libs via pkg-config, which a
Mac doesn't have. Verify it on an actual Linux box (or in CI).

Then **wait for explicit "commit" from user** before running `git commit`.
