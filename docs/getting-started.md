# Getting Started

This guide takes you from zero to chatting with a coding agent in Clidable, in about 5 minutes.

## 1. Prerequisites

You need three things on the machine that will run Clidable:

### Bun (required)

Clidable is built on [Bun](https://bun.sh) — it's the runtime, the web server, and the bundler. Version **1.3.14 or newer** is required (older Bun has no Windows terminal support).

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"

# Or via Homebrew
brew install oven-sh/bun/bun
```

Verify: `bun --version`

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

## 2. Install Clidable

```bash
git clone https://github.com/openclide/clidable.git
cd clidable
bun install
```

## 3. Run it

```bash
bun run dev
```

You'll see:

```
[clidable] listening on http://127.0.0.1:7878 (dev, HMR)
[clidable] data:  ~/Library/Application Support/Clidable   (macOS; varies by OS)
```

Open **http://127.0.0.1:7878** in any browser. That's it — Clidable is a web app served by its own built-in server. (For the native desktop window, production builds, and remote setups, see [Running Clidable](./running-clidable.md).)

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

   Scaffolding runs the official generator (`bun create vite`, `create-next-app`, …), installs dependencies, and initializes a git repo with a first commit. It needs network access and can take a minute or two.

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

## 7. Explore from here

- **Preview your app** — start your dev server (Clidable can do it for you) and watch it live in the right-hand pane: [Workspace Guide → Preview](./workspace-guide.md#the-preview-pane).
- **Edit code** — a full CodeMirror editor with VS Code keybindings and a git diff view: [Workspace Guide → Code pane](./workspace-guide.md#the-code-pane).
- **Run multiple agents** — split the terminal area, open more tabs, work several projects side by side: [Workspace Guide → Terminals](./workspace-guide.md#terminals-splits-and-tabs).
- **Give your agents superpowers** — install skills, MCP servers, plugins, and set up an AI team where one agent delegates to others: [Skills, MCP, Plugins & AI Team](./agent-toolkit.md).
- **Use it from your phone or another machine** — [Remote & VPS Setup](./remote-vps.md).
