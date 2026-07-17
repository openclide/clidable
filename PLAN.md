# Clidable — Implementation Plan

Concrete plan of action for each requirement in [IDEA.md](./IDEA.md). Grounded in research of prior art: [claudable-new](../claudable-new/), [terax-ai](./explore/terax-ai/), and current CLI agent integration patterns (Claude Code, Codex, Gemini).

## Foundation (the stack everything sits on)

- **Bun backend** — `Bun.serve` (HTTP+WS), `Bun.spawn({terminal})` for PTYs, `node:fs`, `bun:sqlite`. POSIX + Windows (ConPTY via Bun 1.3.14).
- **React + Vite + Tailwind v4** frontend — same bundle in all shells.
- **Tauri 2** wraps Bun as `externalBin` sidecar for desktop.
- **PWA** for browser / mobile — same frontend served by Bun.
- **`bun build --compile`** → single ~60 MB binary per platform. No Node/Bun needed on user's machine.
- **PTY-first, never `-p`** — agents run in their native TUI; xterm.js renders verbatim.
- **Folder layout** via `env-paths`: data, cache, logs in OS-appropriate dirs; secrets in OS keychain.
- **Project identity** by UUID at `<project>/.clidable/project-id` (survives rename/move).

---

## 1. Textbox input instead of terminal input

**Decision**: CodeMirror 6 composer as primary input; xterm.js pane stays interactive as secondary.

- Minimal CM6 instance below the terminal pane: `lineWrapping` + `markdown()` + placeholder + `Mod-Enter` → send.
- Send writes to PTY stdin via WebSocket.
- **Bracketed paste mode** for multi-line: wrap content in `\e[200~...\e[201~` so the TUI treats it as one paste, not N submits.
- Paste/drop handlers: images upload to `/api/images`, inline replaced as `@/tmp/abc.png`.
- `@filename` autocomplete over project files.
- Terminal stays focusable — click in to type slash commands, Ctrl-C, native readline.

**Inspiration**: claudable-new's textarea + image-paste pattern; CM6 from the editor stack (free reuse).

**Size**: ~150 LOC composer + ~30 LOC paste handler.

---

## 2. Checkpoints before every message  — ✅ shipped (retention deferred)

**Decision**: Native, agent-agnostic. Shadow git repo per project, snapshot before each user turn.

- Shadow bare repo at `<dataDir>/Clidable/projects/<uuid>/checkpoints.git`. Project's working tree is the `--work-tree`.
- Trigger: composer Send AND OSC 133 prompt-detection (catches direct-terminal users).
- Use system `git` via `Bun.spawn(["git", ...])`; fall back to `isomorphic-git`.
- **Respect `.gitignore`** + always-ignore list (`node_modules`, `.next`, `dist`, `target`, `.DS_Store`, etc.) — the main bug to fix from claudable-new.
- Optional preview-iframe screenshot per checkpoint (nice UX).
- Restore: `git restore --source=<sha> -- .` + truncate conversation transcript after that message.
- Metadata in SQLite (`bun:sqlite`), not `index.json` — kills concurrency races.
- Retention: last 100 or 30 days, whichever larger. Nightly `git gc`.
- Disable Claude's own `/rewind` in UI for consistency across agents.

**Inspiration**: claudable-new's [`src/lib/checkpoints/index.ts`](../claudable-new/src/lib/checkpoints/index.ts) — port verbatim, fix ignore handling, shell-string commands, add conversation truncation.

**Size**: ~400 LOC (300 ported + 100 fixes/upgrades).

### Build status (as of this pass)

Shipped in milestones M1–M5 plus a file-watcher and cross-pane wiring:

- **M1 — Foundation.** `server/checkpoints/{paths,project,lock,shadow,index}.ts`. Per-project UUID at `<project>/.clidable/project-id` (race-safe `wx` create; survives rename), shadow `git init`, always-ignore via `info/exclude`, SQLite `checkpoints` table, per-project FIFO lock, `createCheckpoint`/`listCheckpoints`. Noop snapshots recorded as `noop=1, sha=NULL` (dense timeline, no empty commits). `scripts/verify-checkpoints.ts`.
- **M2 — Create + composer.** `POST /api/checkpoints`; composer Send fires a real snapshot (fire-and-forget) + the ✓ confirmation chip (success / "no changes" / error tone).
- **M3 — List + real UI.** `GET /api/checkpoints`; RewindPopover, SincePicker, composer chip all read real data via `checkpoints-client` (+ create pub-sub, most-recent cache). Mock data dropped.
- **M4 — Restore.** `POST /api/checkpoints/restore` → `git reset --hard <sha>` under the lock; noop resolves to nearest prior real SHA; confirm dialog; cross-project guard.
- **M5 — Diff pivot.** `/api/git/{status,diff}` accept `checkpointSha` (targets the shadow repo); SincePicker re-bases the changes list + diff; composer "compare" pivots cross-pane via `diff-base-store` + reveal intent, then auto-selects the first changed file.
- **File watcher** (`server/watcher.ts` + `/api/watch` + `file-watch-client.ts`): editor / changes / tree auto-reload on any disk write (agent edits, restores). Gated to the active Code-pane project; `.gitignore`-aware; adaptive debounce; atomic-save temp-file normalization. Subsumed the restore-specific refresh pub-sub.

**Deferred — M6 retention** (the only remaining piece of §2): prune to "last 100 or 30 days, whichever larger" + `git gc` per shadow repo, on a startup + interval schedule. Nothing breaks without it; it only bounds growth over weeks of use. Open design fork to settle when picked up: whether to rewrite shadow history so pruned commits become `gc`-reclaimable (correct, fiddly) vs. SQLite-prune + `gc --auto` only (simple, keeps git history). Guards needed: never prune the initial checkpoint or one currently used as a diff base; run under the per-project lock.

**Also deferred** (not blockers): OSC 133 prompt-detection trigger (composer Send is wired; direct-terminal users not yet); per-checkpoint preview screenshots (blocked on §3 preview iframe — `screenshot` column + UI thumbnail slot already in place); disabling Claude's native `/rewind`.

---

## 3. Preview of projects (iframe/webview opens the webserver)

**Decision**: Hybrid — claudable-new's dev-server lifecycle + terax-ai's iframe UX/security rigor.

**From claudable-new** (dev-server lifecycle):
- Project Manager auto-assigns free port from 3001, spawns detected dev command (`bun/pnpm/npm run dev`), tracks ChildProcess.
- Framework detection: Next.js, Vite (React/Svelte/Vue), Expo, Astro, Hono, Remix, etc.
- Viewport switcher (desktop / tablet / mobile) for responsive testing.
- LAN QR code in the pane for testing the dev URL on a phone.
- Server logs streamed via SSE to a collapsible log panel.
- Optional auto-restart on `package.json` change.

**From terax-ai** (iframe UX & security):
- **Memory suspension**: tear iframe down after 30s of invisibility (a background dev page can hold hundreds of MB). "Suspended" state with reload button.
- **Deliberate sandbox**: `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"` — **omits `allow-top-navigation*`** so a compromised dev server can't navigate the Tauri webview to an attacker origin and expose `window.__TAURI__` IPC.
- **Cross-origin reload via remount**: `<iframe key={`${url}#${nonce}`} />`. `contentWindow.location.reload()` throws on cross-origin; bumping the key is the reliable path.
- **X-Frame-Options warning banner** for non-local URLs (most public sites refuse to embed; banner pre-empts the confusing blank-iframe).
- **Curated port presets dropdown**: Vite 5173, Next 3000, Astro 4321, Storybook 6006, Metro 8081, Django 8000, Flask 5000, Gradio 7860, Ollama 11434, etc.
- **Port liveness probe** before navigating, so users don't land on a blank page because the server hasn't started yet.
- **SSRF-hardened HTTP path** if Clidable ever proxies arbitrary URLs: IP classification (block cloud metadata 169.254.169.254, link-local, etc.), DNS-rebinding protection (pin `fetch` to the resolved-safe IPs), header CRLF guard, scheme allowlist, hop-by-hop header blocklist. Port from terax-ai's [`src-tauri/src/modules/net.rs`](./explore/terax-ai/src-tauri/src/modules/net.rs) to ~150 LOC of TypeScript.
- Polished empty + suspended states with explanatory copy.
- Keep terax-ai's tests for the preview pane.

**Inspiration**: claudable-new's [`PreviewPane.tsx`](../claudable-new/src/components/PreviewPane.tsx) + [`projects/manager.ts`](../claudable-new/src/lib/projects/manager.ts) (lifecycle); terax-ai's [`src/modules/preview/`](./explore/terax-ai/src/modules/preview/) (iframe rigor) + [`net.rs`](./explore/terax-ai/src-tauri/src/modules/net.rs) (SSRF defense).

**Size**: ~900 LOC (ProjectManager 350 + PreviewPane 250 + AddressBar w/ port presets 200 + SSRF guards 100).

---

## 4. Easy Plugin / Skill / MCP / Instructions management

**Decision**: One unified "Agent Configuration" surface covering all four artifacts. User-facing CLI is `clidable skills/mcp/plugins/instructions ...`. Underneath: library imports where possible, bundled subprocess where not, direct file ops for instructions.

### Plugins / Skills / MCP

- Add `add-mcp`, `skills`, `plugins` as `dependencies` so `bun build --compile` bundles them. **No `bunx` at runtime — user doesn't need Bun installed.**
- **MCP**: `import { upsertServer, removeServer, listInstalledServers } from "add-mcp"` — programmatic API exists. In-process function calls.
- **Skills**: same pattern if `skills` exposes a library API; else re-exec Clidable as host (`Bun.spawn([process.execPath, "__run-skills", ...])`).
- **Plugins**: `vercel-labs/plugins` is CLI-only (no library API) — re-exec trick. Covers Claude Code + Cursor. Fall back to own implementation for Codex/Gemini until upstream adds them.
- GUI buttons call the same internal functions the CLI does. One implementation, two surfaces.
- **State source of truth**: read config files directly (`~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/settings.json`, `~/.claude/skills/`), never parse CLI output.
- Pin versions in `package.json`. Pre-warm at startup so first install has no cold-start delay.
- For MCP servers that need Node at runtime (e.g. `npx @modelcontextprotocol/server-foo`), warn once during install.

### Instructions files (AGENTS.md / CLAUDE.md / GEMINI.md / .cursor/rules / CONVENTIONS.md)

- "Instructions" tab in Clidable lists every agent-instruction file in the current project + user home.
- **Treat AGENTS.md as canonical** (the cross-agent convention adopted by Codex / OpenCode / others). One-click mirror to CLAUDE.md, GEMINI.md, CONVENTIONS.md.
- For Cursor: translate AGENTS.md content into `.cursor/rules/*.mdc` files with appropriate frontmatter (`alwaysApply: true` for global rules).
- **Editor**: CM6 with markdown syntax highlighting + side-by-side preview of how the content lands in each target agent's file.
- **Managed sections preserved**: the AI Team / Skills features write between `<!-- clidable:skill:<id> -->` … `<!-- /clidable:skill:<id> -->` markers ([see #5](#5-easy-ai-team-management)). The editor renders these blocks as read-only with a "managed by Clidable" badge; free edit outside the markers. No accidental overwrites.
- **Sync direction is explicit**: user picks "AGENTS.md is canonical → mirror to others" or "edit each independently." Default to canonical+mirror for new projects; preserve independence if the user has already edited divergent files.
- **Import resolution**: CLAUDE.md's `@path/to/file.md` includes resolved + previewed inline. Note: AGENTS.md doesn't standardize imports — when mirroring CLAUDE.md → AGENTS.md, expand the imports inline so other agents see the same content.
- **Per-scope view**: project root (`./AGENTS.md`), user-global (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`), nested (subdir-level `<dir>/CLAUDE.md` that Claude Code loads when working in that subdir). Tree view in the sidebar.
- **Templates library**: starter content for common project types (next-app, monorepo, python, rust, expo, etc.). Apply via `clidable instructions template apply <name>`.
- **Auto-init**: when a project has no instruction file, offer one-click scaffolding of a sensible AGENTS.md based on detected framework.
- **Diff per save**: each save writes a snapshot to the shadow git repo too (see #2). Trivial undo of "I broke my CLAUDE.md."

### CLI surface

```
clidable mcp add | remove | list <server>
clidable skills add | remove | list | search <repo>
clidable plugins add | discover | targets <source>
clidable instructions list | edit [target] | sync --from <file> | template apply <name>
```

**Inspiration**: `neondatabase/add-mcp`, `vercel-labs/skills`, `vercel-labs/plugins`. claudable-new's [`plugins/config.ts`](../claudable-new/src/lib/plugins/config.ts) (1700 LOC) for fallback paths. Instructions management is greenfield (no widely-adopted prior art) — design owned by Clidable.

**Size**: ~700 LOC (3 manager modules 300 + instructions manager 250 + UI integration + CLI dispatch 150).

---

## 5. Easy AI team management

**Decision**: Role-based skill system. Each (role × delegate-agent) pair renders a skill, written into each lead agent's native format.

- **Role library** (extends claudable-new's 8 with non-technical roles):
  - Technical: architect, reviewer, debugger, ui-designer, tester, security, performance, documenter
  - Product: marketer, PM, copywriter, SEO
  - Operational: DevOps, DBA, refactorer, i18n
  - Strategic: researcher, legal-compliance, cost-optimizer
  - Custom: user-defined
- **Delegate recipes** — one file per delegate (codex.ts, claude.ts, gemini.ts, opencode.ts, cursor.ts, aider.ts) with validated bash commands. Codex recipe **must include `</dev/null`** (stdin closure) and `2>/dev/null` (suppress thinking tokens) — both validated by `skill-codex`.
- **Lead serializers** — one per lead agent:
  - Claude → `.claude/skills/<role>/SKILL.md` (real description-triggered skill)
  - Cursor → `.cursor/rules/<role>.mdc`
  - Codex / OpenCode → managed section in `AGENTS.md`
  - Gemini → managed section in `GEMINI.md`
- Per-role config: handler agent, model, sandbox, reasoning effort, which leads it's enabled for.
- Per-project config at `<project>/.clidable/ai-team.json`.
- "Test specialist" button: sends canned prompt to verify wiring before user actually needs it.
- **Fix claudable-new's recipe bugs**: drop `--no-interactive` (not a real flag), add codex `</dev/null` + `2>/dev/null`, fix `$ARGUMENTS` substitution per-lead, fix `copilot: 'gh copilot'` mapping.

**Inspiration**: claudable-new's [`types/ai-team.ts`](../claudable-new/src/types/ai-team.ts) + [`ai-team/config.ts`](../claudable-new/src/lib/ai-team/config.ts) for data model & UI; `skills-directory/skill-codex` for recipe quality; `klaudworks/ralph-meets-rex` for later YAML-workflow mode (v1.5).

**Size**: ~800 LOC (roles 200 + delegate recipes 300 + lead serializers 200 + config/sync 100); UI reuse from claudable-new saves ~500 LOC more.

---

## 6. Multi-agent / multi-terminal management

**Decision**: PTY-first. xterm.js renders. Tabs per agent per project. Sessions persist independent of WebSocket lifecycle.

**Backend (Bun)**:
- PTY pool managed by a session manager — PTYs outlive WebSocket reconnects.
- `Bun.Terminal` for PTY (POSIX + Windows ConPTY).
- WS protocol: `{type: "input"|"resize"}` ↔ `{type: "output"}`.
- Spawn agent **directly**: `pty.spawn("claude", [], {cwd: projectPath})` — not a shell that the user has to type `claude` into.
- **OSC 133** for prompt-boundary detection (checkpoint trigger); **OSC 7** for cwd tracking.
- Ring buffer per session for replay on reconnect (mobile sleep, tab refresh).
- Per-agent env injection: `TERM=xterm-256color`, `COLORTERM=truecolor`, `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1`, etc.
- Backpressure: coalesce output (~5ms debounce or N-byte batches).

**Frontend (React)**:
- xterm.js + `addon-fit` + `addon-web-links` + `addon-webgl` (perf).
- TerminalManager: tabs ("Claude (2)", "Codex"), per-project scoping, agent-selector welcome screen.
- Click into terminal for direct typing; otherwise use CM6 composer.
- Split panes deferred to v1.1.

**Inspiration**: claudable-new's [`Terminal.tsx`](../claudable-new/src/components/Terminal.tsx) + [`TerminalManager.tsx`](../claudable-new/src/components/TerminalManager.tsx) for frontend; terax-ai for backend rigor (OSC sequences, WebGL pool, session persistence).

**Size**: ~1200 LOC (frontend port 900 + backend rewrite 250 + OSC middleware 50).

---

## 7. Create projects right inside the tool

**Decision**: "New Project" wizard with framework templates + "Open existing" path.

- Template picker: Next.js, Vite + React, Vite + Svelte, Expo, Astro, Hono, Remix, blank folder.
- Backend runs scaffold (`bunx create-next-app`, `bun create vite`, etc.) into chosen directory.
- Creates `<project>/.clidable/project-id` UUID file.
- Auto-init git repo + first commit.
- Auto-detect package manager (bun > pnpm > npm > yarn).
- "Open existing": file picker → walk dir for project type detection (package.json, Cargo.toml, pyproject.toml) → register in projects list.
- Recent projects in sidebar + project switcher dropdown.
- Project metadata in SQLite + `meta.json` per project.

**Inspiration**: claudable-new's [`projects/manager.ts`](../claudable-new/src/lib/projects/manager.ts) already has Next.js + Expo creation; extend the template list.

**Size**: ~400 LOC (wizard UI 200 + scaffold logic 150 + detection 50).

---

## 8. CodeMirror / VS Code for code edition  — ✅ shipped (editor + diffs; AI diff deferred)

> **Build status:** Editor + file explorer + git diff shipped (M1–M3).
> - **M1** — `/api/fs/{list,read,write}` (realpath-sandboxed) + CM6 editor (`web/src/lib/code-mirror/` + `EditorPane`) + lazy file-tree explorer, wired into the Code pane.
> - **M2** — multi-file tabs (`EditorStack`/`EditorTabs`), per-tab dirty dot, ⌘W close-with-confirm.
> - **M3** — git diff: `/api/git/{status,diff}` (real `.git` and, via §2's `checkpointSha`, the shadow repo), `diff-cache` (LRU + dedup), `GitDiffPane` (`unifiedMergeView`), `ChangesList`. Folded into the Code pane as a **Files | Changes** sidebar toggle (no separate top-level Diff mode).
> - VS Code keymap (`@replit/codemirror-vscode-keymap`) in. File I/O via Bun fetch (not Tauri invoke), as planned.
> **Deferred:** the AI/agent accept-reject diff (`AiDiffPane`, per-hunk `mergeControls`) and agent-attribution gutter stripes — the checkpoint-diff path (§2 M5) covers "what changed since the agent's last message" for now. 4 curated themes + vim mode also deferred (single hardcoded transparent theme ships).

**Decision**: CodeMirror 6. Port terax-ai's editor module substantially. VS-Code-feel via keymap + theme.

- Stack: `@uiw/react-codemirror` + `@codemirror/state` + `@codemirror/view` + `@codemirror/merge` + lazy-imported language packs.
- **Port from terax-ai's `src/modules/editor/`** (~2000 LOC):
  - `lib/extensions.ts` — Compartment-based runtime reconfig
  - `lib/languageResolver.ts` — extension → language pack (lazy)
  - `lib/useDocument.ts` — load+save+dirty
  - `AiDiffPane.tsx` — accept/reject for agent edits (`unifiedMergeView`, +/− stats, status badge)
  - `GitDiffPane.tsx` — working-tree + commit diffs against shadow repo
  - `lib/diffCache.ts` — memoized diff computation
  - Lazy wrappers (`*StackLazy.tsx`)
- **Adjust**: file I/O via Bun WS (not Tauri `invoke`); AI integration through Clidable's agent adapter (not Vercel AI SDK).
- **Add**: agent-attribution gutter stripes (color per agent), checkpoint markers in gutter, per-hunk accept/reject toggle (`mergeControls: true`).
- VS Code feel: `@replit/codemirror-vscode-keymap` + VS Code-styled theme. ~90% perceived experience, ~5% Monaco's bundle cost.
- 4 curated themes for v1; vim mode opt-in.

**Inspiration**: terax-ai's editor module (port ~verbatim with the adjustments above). Monaco rejected: 5–10MB bundle, mobile-hostile, harder to extend.

**Size**: ~2000 LOC ported + ~300 LOC adjustments.

---

## 9. Glassmorphism and modern UI

**Decision**: Two-layer glass — OS-level window vibrancy (Tauri) + CSS `backdrop-filter` (in-webview). Tailwind v4 + Radix primitives + design language inspired by claudable-new's [`DESIGN.md`](../claudable-new/DESIGN.md).

**Layer 1 — Window vibrancy (real desktop-behind blur)**:
- Use the `window-vibrancy` crate (or `tauri-plugin-window-vibrancy`) in Tauri's setup hook.
- macOS: `apply_vibrancy(NSVisualEffectMaterial::HudWindow)` — native, excellent quality (same as System Settings).
- Windows 11: `apply_mica()` — performant, wallpaper-tinted.
- Windows 10: `apply_acrylic()` fallback — real blur, heavier on GPU.
- Linux: compositor-dependent (KWin / Hyprland yes, GNOME Mutter no). Default to solid gradient on Linux; let users opt in.
- `tauri.conf.json`: `"transparent": true`. Body/HTML CSS: `background: transparent !important;`.

**Layer 2 — In-webview glass (CSS)**:
- `backdrop-blur-xl` + semi-transparent backgrounds (`bg-white/[0.09]`) + subtle borders (`border-white/12`) + soft shadows for sidebars, modals, dropdowns, the bar above the editor.
- Use `color-mix(in srgb, currentColor X%, transparent)` patterns rather than hardcoded `rgba(...)` so light/dark mode automatically reflows.

**Graceful degradation in browser / PWA mode**:
- In browser tabs, the desktop isn't visible — Layer 1 has nothing to bleed through.
- Toggle via `body[data-shell="tauri"|"browser"]`. In browser mode, body background becomes a tasteful solid gradient that approximates the vibrancy look.
- One CSS variable swap, no duplicate components.

**Design language**:
- Dark-first; light theme respected.
- Accent: purple-to-blue gradient for primary actions and AI markers.
- Per-agent accent colors (Claude amber, Codex emerald, Gemini violet, Cursor blue) for attribution chips, terminal tab indicators, diff gutter stripes.
- Components: Radix primitives styled with Tailwind. Icons via lucide-react or hugeicons.
- Subtle animations via `framer-motion`; `prefers-reduced-motion` respected.
- Layout: 3-pane (file tree | main work | preview/diff/checkpoints) with collapsible sides.

**Performance guardrails**: don't animate `backdrop-filter` radius; default to no-blur on Linux; let users disable vibrancy on low-end hardware.

**Inspiration**: terax-ai for the "every surface is transparent, let vibrancy bleed through" discipline (see [`lib/extensions.ts`](./explore/terax-ai/src/modules/editor/lib/extensions.ts) — explicit `backgroundColor: "transparent !important"` on every editor surface); claudable-new's design system; Linear's chrome polish.

**Size**: ~400 LOC base design system + ~50 LOC Tauri vibrancy setup; applied throughout.

---

## 10. Mobile-friendly

**Decision**: PWA, responsive layout, terminal becomes scrolling log on phones with composer as the only input.

- Single responsive layout: 3-pane on desktop → single-pane + tab switcher on mobile.
- Touch-friendly hit targets (≥44×44).
- xterm.js works on mobile but is cramped — on phones, the terminal becomes a scrollable log; the CM6 composer is the only practical input.
- File tree / preview / diff panes available via bottom-sheet on mobile.
- PWA manifest + service worker: installable from any browser, opens in standalone mode.
- LAN QR code in PreviewPane for testing the project on a phone.
- **Phones connect to remote Clidable servers** to drive desktop/server sessions. Phones are clients, not agent hosts. Onboarding makes this explicit.

**Inspiration**: claudable-new's mobile viewport mode + QR code; PWA best practices.

**Size**: ~300 LOC responsive variants + ~50 LOC service worker + manifest.

---

## 11. Runs as a desktop app and as a web app on the browser

**Decision**: Tauri 2 wraps the Bun binary on desktop. Same Bun binary serves the web app.

- **One** React frontend bundle, identical in all shells.
- **Bun backend** (`bun build --compile`) → per-platform binaries (mac-arm64, mac-x64, linux-x64, linux-arm64, win-x64). ~60 MB each.
- **Tauri shell**:
  - `tauri.conf.json` lists Bun binary as `externalBin` sidecar.
  - On launch, Tauri spawns the Bun sidecar on a loopback port (`127.0.0.1`); the loopback bind + same-site gate are the protection — no URL token (Clidable has no auth, §12).
  - Webview points at `http://127.0.0.1:<port>/`.
  - ~50 LOC of Rust + config. Final bundle ~80 MB.
- **Web mode**: same Bun binary, no Tauri. `clidable serve --port 7878` and point any browser at it.
- **UI detects shell**: `if (window.__TAURI__) { useTauriAPIs } else { browserFallbacks }` for OS-native features (file picker, system tray, deep links).
- **Updates**: Tauri auto-updater for the shell; Bun binary can self-update inside.
- **Distribution**: macOS notarization, Windows code-signing, Linux `.deb` + `.AppImage`.

**Inspiration**: terax-ai's Tauri 2 setup for desktop polish; Bun's single-binary compile workflow.

**Size**: ~100 LOC Rust + config; rest is build pipeline and CI.

---

## 12. Runs locally or behind your own access layer

**Decision**: One Bun binary, **localhost-only by design**. Remote access is the user's *access layer*, not Clidable's job — so Clidable ships **no built-in auth or TLS, ever**.

- **Local mode** (default, used by the Tauri shell): `clidable-server --bind 127.0.0.1` (the default). Loopback-only, single-user, no auth needed — nothing off-box can reach it.
- **Remote access**: keep the loopback bind and put an **access layer** in front — **Tailscale/WireGuard** (recommended), **Cloudflare Tunnel + Access**, or an authenticating reverse proxy. That layer owns TLS *and* auth.
- **`--allow-lan` escape hatch**: binds beyond loopback for a firewalled/VPN'd network you control. Adds no auth; prints a loud network-exposed warning. `--auth`/`--tls` are refused unconditionally (`refusing to start: Clidable has no built-in auth/TLS by design …`).
- **Same-site gate + loopback-`Host` check** shield `/api` and the preview proxy from drive-by browser requests (CSRF / DNS-rebind) even on an `--allow-lan` bind — a hardening layer, **not** auth (`server/net/origin.ts`).
- Health endpoint + structured logs for ops.

**Non-goal — built-in auth / TLS / multi-user.** Clidable spawns terminals, so network exposure is RCE by design; it never authenticates requests itself. *Multi-user* would require Clidable to know who the user is (= auth), so it's out too — a shared-team deployment is single-tenant Clidable behind an identity-aware proxy. This retires the old "server mode + auth" milestone.

**Status**: shipped as scope-*removed* — the localhost-only guard, `--allow-lan`, and the same-site gate are already in the tree; there is no auth middleware to build.

---

## Suggested build order

1. ✅ **Foundation** — Bun server skeleton + Tauri shell + React frontend skeleton + env-paths layout.
2. ✅ **Terminal pane (#6)** — earliest usable demo: spawn Claude in a PTY, render in xterm.js, compose via CM6 (#1).
3. ✅ **Code editor + diffs (#8)** — ported terax-ai's editor module (AI-diff deferred; see §8).
4. ✅ **Checkpoints (#2)** — shadow git repo, trigger on send (retention/M6 deferred; see §2). Added a file watcher for auto-reload along the way.
5. **Projects (#7) + Preview (#3)** — open/create, dev server, iframe. ← next up; Preview also unblocks checkpoint screenshots.
6. **Plugin/Skill/MCP management (#4)** — `clidable skills/mcp/plugins` CLI + GUI.
7. **AI Team (#5)** — role library, delegate recipes, lead serializers.
8. **Glassmorphism polish (#9)** — design system pass.
9. **Mobile / PWA (#10)** — responsive, service worker, manifest.
10. ✅ **Localhost-only + access-layer model (#12)** — loopback default, `--allow-lan`, same-site gate shipped; **built-in auth / TLS / multi-user is a non-goal** (delegated to your tunnel/proxy).

Each step ≈ 2–5 days of focused work. Net MVP target: ~6–8 weeks for one dedicated engineer.

---

## Deferred to v1.5+

- Workflow / pipeline orchestration (rmr-style YAML workflows) — once free-form delegation is proven.
- MCP bridge for structured event capture from agents — PTY-is-the-UI is the v1 stance; this is an upgrade.
- Split-pane terminals.
- Multi-user collaboration on the same project (a shared session behind your access layer — not per-user auth; see §12).
- Slack/Discord/Telegram mirroring of agent output.
