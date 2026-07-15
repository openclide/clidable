# Workspace Guide

A full tour of the Clidable UI, from the welcome screen to multi-project, multi-agent workspaces.

## The welcome screen

What you see when Clidable opens (or when you click the home button later):

- **Agent row** — icons for every supported agent: Claude Code, Codex CLI, Antigravity CLI, Cursor, Qwen Code, Kimi CLI, OpenCode, GitHub Copilot. Installed agents are full-color; missing ones are dimmed with an amber dot (hover shows the install command). Click an agent to start a session with it.
- **Recent projects** — every project you've opened, with its path, last-used agent, and how long ago. Click to jump straight back in with that agent.
- **Open a project** — browse the filesystem (of the machine running the server) and register any existing folder.
- **Create a project** — the new-project wizard: pick a name, location, and template (Empty folder, Vite + React/Svelte/Vue, Next.js, Astro, Hono). Clidable runs the official scaffolder, installs dependencies, and git-inits with a first commit.

## Workspace layout

```
┌──────────────────────────────────────────────────────────────┐
│ 🏠  [project A] [project B] [+]          Team Skills … MCP   │  ← top chrome
├──────────────────────────────┬───────────────────────────────┤
│                              │                               │
│   Terminal pane(s)           │   Side pane                   │
│   (agent TUI via xterm.js)   │   Preview ⇄ Code              │
│                              │                               │
│   ┌────────────────────────┐ │                               │
│   │ composer  ⏎ send       │ │                               │
│   └────────────────────────┘ │                               │
└──────────────────────────────┴───────────────────────────────┘
```

- **Top chrome**: home button (back to welcome), project tabs, and the workspace tools (Team, Skills, Plugins, MCP, Context).
- **Left**: one or more terminal panes, each with its composer.
- **Right**: the side pane, toggling between **Preview** and **Code**. Drag the divider to resize — it snaps magnetically to hidden, ⅓, ½, ⅔, and full width. The width persists across sessions.

### Project tabs

- Open several projects at once; each gets a tab. The **+** button adds another (open or create).
- With 2+ projects open, tabs and terminals get small colored **initial badges** so you always know which project a pane belongs to.
- Close a tab with the × that appears on hover (the last project can't be closed).

## Terminals, splits, and tabs

Each terminal runs a real PTY on the server with the agent launched directly in it — what you see is the agent's genuine TUI, colors and all.

- **Click into a terminal** to type directly: slash commands, Ctrl-C, arrow keys, interactive prompts — everything a normal terminal does.
- **Split panes (tmux-style)**: the **+** menu on a terminal tile offers **New terminal (side)**, **New terminal (bottom)**, and **New tab**. Drag the dividers to resize (with snap detents at ⅓ / ½ / ⅔).
- **Tabs within a pane**: each pane can hold multiple terminal tabs — switch by clicking the pills in the tile header.
- **Mix agents and projects freely**: run Claude on project A next to Codex on project B.
- **Sessions survive disconnects**: refresh the browser, switch networks, let your phone sleep — the session keeps running on the server and replays its recent output (256 KB scrollback) when you reattach. Sessions left with no client for 10+ minutes are reaped.

## The composer

The text box under each terminal — the primary way to talk to an agent.

| Key | Action |
|---|---|
| **Enter** | Send |
| **Shift+Enter** | Newline |
| **⌘/Ctrl+Enter** | Send (alias) |

What happens on send:

1. A **checkpoint** of your project is snapshotted (see [Checkpoints](./checkpoints.md)) — the rewind button pulses "Checkpointed" on success; a small error chip appears if it failed.
2. Your message is delivered to the agent's TUI as a single **bracketed paste** (multi-line text arrives as one message, not one submit per line), then submitted.

The composer footer shows the rewind button and a "Checkpoints · 2m ago" label; the header shows the agent chip (and project name when several projects are open). The left stripe and caret are tinted with the agent's brand color.

## Checkpoints in the workspace

- **Rewind popover** (rewind icon in the composer): lists checkpoints newest-first — thumbnail (desktop app), time, agent, your message. Scope it to **This terminal** or **All** checkpoints in the project.
- **Restore** rolls your working tree back to that snapshot (with a confirmation step).
- **Compare** doesn't restore — it jumps the Code pane to the Changes view, diffing your current files against that checkpoint.

Deep dive: [Checkpoints](./checkpoints.md).

## The Code pane

Toggle the side pane to **Code** for a real editor and diff viewer.

### Files view

- **File explorer** — lazy-loading tree of your project (noise like `node_modules` and `.git` is hidden).
- **Editor** — CodeMirror 6 with the **VS Code keymap** (⌘D multi-select, ⌘X cut-line, and friends), syntax highlighting for all major languages (lazy-loaded per file type), and line wrapping.
- **Tabs** — multiple open files, dirty-dot for unsaved changes.
- **⌘/Ctrl+S** saves; **⌘/Ctrl+W** closes the tab (with an unsaved-changes confirm).
- **Live reload** — when an agent (or a checkpoint restore) writes files on disk, open editors, the tree, and the changes list refresh automatically.

### Changes view

- Every changed file with its git status (M/A/D/R/untracked); click a file for a unified diff.
- The **"Since:" picker** sets the comparison base: your repo's **HEAD** (default) or **any checkpoint** — "show me everything the agent did since my message three turns ago" is two clicks.

## The Preview pane

A live browser view of whatever you're building, with a hardened iframe.

### The address bar

One capsule, left to right:

1. **Run/Stop dot** — for supported projects, starts or stops a managed dev server (see below). Gray = stopped, green = running, spinner = working.
2. **Reload** — remounts the iframe (works cross-origin).
3. **URL field** — type a URL, a `host:port`, or just a port number (`3000` → `http://localhost:3000`). Enter loads; Escape reverts.
4. **Ports menu (▾)** —
   - **Detected**: URLs Clidable noticed by scanning terminal output *and* by inspecting your agents' processes for listening ports — when your agent runs `npm run dev`, the URL shows up here by itself.
   - **Dev-server terminal**: opens the log panel for the managed dev server.
   - **Common ports**: one-click presets — Vite 5173, Next.js 3000/3001, Astro 4321, Angular 4200, Webpack/Vue 8080, Metro 8081, Django/FastAPI 8000, Flask 5000, Storybook 6006, Gradio 7860, Ollama 11434. Each is liveness-probed before navigating, so you don't land on a blank page.
5. **Open externally** — the current URL in your system browser.

### The managed dev server

For recognized project types, the Run dot starts the dev server for you — in a real shell you can inspect (the **dev-server terminal** in the ports menu shows its live output):

- **Vite / SvelteKit / Astro** — `bun run dev` with an explicit `--port`.
- **Next.js / Nuxt / Remix / Hono / Node** — `bun run dev` with a `PORT` env var.
- Clidable picks a free port automatically and navigates the preview when the server is up.
- For everything else (Python, Rust, Go, Expo, …), just run your dev server in the agent terminal — the **Detected** list will pick it up.

### Viewport & behavior

- **Viewport switcher**: Desktop (full) / Tablet (768px) / Mobile (390px) for responsive testing.
- **Memory suspension**: an invisible preview is torn down after ~30 s (background dev pages can hold hundreds of MB); a "Suspended — Reload" card brings it back.
- **Security**: the iframe is sandboxed without top-navigation rights, so a compromised dev page can't hijack the app window. External (non-localhost) sites often refuse to embed (X-Frame-Options) — Clidable warns you instead of showing a mystery blank pane.
- **Remote use**: when your browser is on a different machine than the server, `localhost` URLs are automatically tunneled through Clidable's own port (`/proxy/<port>/…`) — preview "just works" from a phone. Per-project preview URLs are remembered.

## Workspace tools

Buttons in the top chrome (behind the tools menu on mobile). Each opens a manager — full documentation in [Skills, MCP, Plugins & AI Team](./agent-toolkit.md):

- **Team** — enable AI-team roles (Architect, Reviewer, Debugger, …) so your lead agent can delegate to other agents.
- **Skills** — browse/search the skills.sh catalog, install skills per-agent, add custom ones.
- **Plugins** — manage Claude Code / Codex plugins and marketplaces.
- **MCP** — add/remove MCP servers (npx package, raw command, or HTTP/SSE endpoint) across agents.
- **Context** — edit your project's `AGENTS.md` (the canonical instructions file) and wire up pointer files so every agent reads the same instructions.

## Mobile

Open the same server URL from a phone (see [Remote & VPS Setup](./remote-vps.md)) and Clidable adapts:

- **Bottom view bar** switches between **CLI**, **Preview**, and **Code** — one full-screen view at a time. It tucks away while the keyboard is open.
- **Top pills**: project switcher (left), tools menu (right).
- Terminal splits flatten into a single pane with all sessions as tabs.
- The composer is the primary input; the terminal is a readable scrolling log.
- The file explorer becomes a slide-over drawer in the Code view.

## Keyboard shortcuts

| Shortcut | Where | Action |
|---|---|---|
| **Enter** | Composer | Send message (checkpoint + deliver) |
| **Shift+Enter** | Composer | Newline |
| **⌘/Ctrl+Enter** | Composer | Send (alias) |
| **⌘/Ctrl+S** | Editor | Save file |
| **⌘/Ctrl+W** | Editor | Close tab (confirms if unsaved) |
| **Escape** | Everywhere | Close popover/modal/lightbox; in the URL bar, revert |
| VS Code keymap | Editor | ⌘D add-next-occurrence, ⌘X cut line, etc. |
