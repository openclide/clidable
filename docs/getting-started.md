# Getting Started

This guide takes you from zero to chatting with a coding agent in Clidable, in about 5 minutes.

## 1. Install Clidable

Pick **one** of these — they all end in the same UI.

### The desktop app (recommended on your own machine)

A native window with OS-level glass, a menu-bar tray showing each agent's live status, and a background server — closing the window keeps your agents running.

- **macOS** — `brew install --cask openclide/tap/clidable-desktop`, or download the `.dmg` (Apple silicon or Intel) from the [Releases page](https://github.com/openclide/clidable/releases).
- **Windows** — download and run the `Clidable_…-setup.exe` (or `.msi`) installer.
- **Linux** — grab the AppImage, `.deb`, or `.rpm`.

The app carries its own server — nothing else to install.

### The `clidable` command (browser UI, servers, scripting)

One binary that is both the server and the CLI. Install it with whichever tool you already use:

```bash
brew install openclide/tap/clidable          # Homebrew (macOS / Linux)
```

```bash
npm install -g clidable                      # npm (any OS with Node)
```

```bash
# Install script (macOS / Linux) — detects OS/arch, verifies checksums, installs to ~/.local/bin
curl -fsSL https://raw.githubusercontent.com/openclide/clidable/main/install.sh | bash
```

On Windows you can also download `clidable-server-windows-x64.exe` (or `-windows-arm64.exe` on Snapdragon-X / ARM machines) from the [Releases page](https://github.com/openclide/clidable/releases) — rename it to `clidable.exe` and that's the `clidable` command.

### From source (contributors)

Needs [Bun](https://bun.sh) ≥ 1.3.14:

```bash
git clone https://github.com/openclide/clidable.git
cd clidable && bun install && bun run dev
```

See [Running Clidable](./running-clidable.md#option-3--from-source) for the details.

## 2. Install the prerequisites

### Git (required)

Checkpoints, project scaffolding, and the diff viewer all use your system `git`. Almost every dev machine already has it; verify with `git --version`.

### At least one CLI coding agent (required to do anything useful)

Clidable is a GUI *for* CLI agents — install whichever ones you use:

| Agent | Install |
|---|---|
| **Claude Code** | `npm i -g @anthropic-ai/claude-code` |
| **Codex CLI** | `npm i -g @openai/codex` |
| **Antigravity CLI** | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` (Windows: `irm https://antigravity.google/cli/install.ps1 \| iex`) |
| **Cursor** | Install Cursor and enable the `cursor-agent` CLI |
| **Qwen Code** | `npm i -g @qwen-code/qwen-code` |
| **Kimi CLI** | See Moonshot AI's docs |
| **OpenCode** | `npm i -g opencode` |
| **GitHub Copilot** | `npm i -g @github/copilot` |

> **Log in first.** Each agent manages its own authentication. Run the agent once in a plain terminal (e.g. `claude`, then `/login`) before using it in Clidable — Clidable never handles your API keys or credentials; the agents do, exactly as they would standalone.

On the welcome screen, agents that aren't found on your `PATH` appear dimmed with an amber dot — hover for the install hint.

### Bun (only for some features)

The app and the installed `clidable` binary don't need Bun to run. You only need [Bun](https://bun.sh) on the machine if you:

- **scaffold new projects from templates** (the wizard runs `bun create …` / `bunx …`),
- **use the preview's Run button on a project with no lockfile** (Bun is the assumed package manager when there's none to detect), or
- **run Clidable from source**.

```bash
curl -fsSL https://bun.sh/install | bash          # macOS / Linux
powershell -c "irm bun.sh/install.ps1 | iex"      # Windows
```

## 3. Run it

- **Desktop app** — just open it.
- **CLI** — run `clidable` and open **http://127.0.0.1:7878** in any browser. You'll see:

```
[clidable] listening on http://127.0.0.1:7878 (prod)
[clidable] data:  ~/Library/Application Support/Clidable   (macOS; varies by OS)
[clidable] cache: ~/Library/Caches/Clidable
[clidable] log:   ~/Library/Logs/Clidable
```

Either way you land on the same welcome screen. (For remote servers and phones, see [Remote & VPS Setup](./remote-vps.md).)

## 4. Open your first project

On the welcome screen you have three paths:

1. **Click an agent icon** (Claude Code, Codex, …) → pick a recent project, **open a folder**, or **create a new project** for that agent.
2. **"Open a project"** → browse to any existing folder on the machine running Clidable.
3. **"Create a project"** → scaffold a fresh one from a template:

   | Template | What you get |
   |---|---|
   | Empty folder | Just a git repo + README. No toolchain. |
   | Vite + React | React + TypeScript via Vite |
   | Vite + Svelte | Svelte + TypeScript via Vite |
   | Vite + Vue | Vue + TypeScript via Vite |
   | Next.js | App Router + Tailwind + TypeScript |
   | Astro | Static-first content site |
   | Hono | Minimal Bun web server |
   | Expo | React Native + expo-router + TypeScript |

   Scaffolding runs the official generator (`bun create vite`, `create-next-app`, `create-expo-app`, …), installs dependencies, and initializes a git repo with a first commit. It needs network access (and Bun) and can take a minute or two.

When the project opens you land in the **workspace**: the agent is already running in a terminal, ready for input.

## 5. Send your first message

At the bottom of the terminal pane is the **composer** — a proper text box instead of raw terminal input.

- Type your request and press **Enter** to send (**Shift+Enter** for a newline).
- Just before each message is delivered, Clidable snapshots your entire project as a **checkpoint** — you'll see a brief "Checkpointed" pulse on the rewind button.
- Multi-line messages are pasted into the agent's TUI as a single block (bracketed paste), so they arrive as one message, not many.

You can also click directly into the terminal and type there — slash commands, Ctrl-C, arrow keys, everything works as in a normal terminal.

## 6. The safety net: rewind anytime

Made the agent break something? Click the **rewind icon** in the composer footer:

- A popover lists every checkpoint (newest first) with timestamp, the agent that triggered it, and your message.
- **Restore** reverts your whole working tree to that moment.
- **Compare** shows what changed since that checkpoint in the Code pane, without restoring anything.

Checkpoints live in a *shadow* git repository in Clidable's data folder — your project's own `.git` is never touched. Full details: [Checkpoints](./checkpoints.md).

## 7. Walk away — it keeps working

Sessions are durable. Close the tab (or the desktop window) while an agent is mid-task and it **keeps running on the server**; come back and the terminal reattaches with its recent output replayed. The welcome screen lists your **workspaces** — click one to restore the whole layout: every project, terminal, and pane exactly where you left it.

One caveat: a session with **no client attached at all** is parked after ~10 minutes — its process stops, and reopening it resumes the agent's conversation (with a fresh screen). For a long-running task, keep a tab attached; backgrounded or minimized counts.

Even across a server restart or reboot, reopening a workspace resumes each agent's *conversation* via the agent's own resume feature (Claude Code, Codex, Antigravity, and others) — details in [Running Clidable](./running-clidable.md#stopping-and-what-survives).

## 8. Explore from here

- **Preview your app** — start your dev server (Clidable can do it for you) and watch it live in the right-hand pane: [Workspace Guide → Preview](./workspace-guide.md#the-preview-pane).
- **Edit code** — a full CodeMirror editor with VS Code keybindings and a git diff view: [Workspace Guide → Code pane](./workspace-guide.md#the-code-pane).
- **Run multiple agents** — split the terminal area, open more tabs, work several projects side by side: [Workspace Guide → Terminals](./workspace-guide.md#terminals-splits-and-tabs).
- **Give your agents superpowers** — install skills, MCP servers, plugins, and set up an AI team where one agent delegates to others: [Skills, MCP, Plugins & AI Team](./agent-toolkit.md).
- **Use it from your phone or another machine** — [Remote & VPS Setup](./remote-vps.md).
