# Clidable Documentation

**Clidable is a GUI for CLI coding agents.** It wraps Claude Code, Codex CLI, Antigravity CLI, and friends in a beautiful, modern interface — with checkpoints before every message, live project preview, a built-in code editor, multi-agent terminals, and one-click management of skills, MCP servers, plugins, and AI teams.

The agents still run in their real terminals (their native TUI, full fidelity) — Clidable adds everything around them: a message composer, automatic snapshots you can rewind to, a browser preview of your dev server, a VS-Code-feel editor, and tools to wire multiple agents together.

## Where to start

| Guide | What it covers |
|---|---|
| [Getting Started](./getting-started.md) | Install and run Clidable in 5 minutes, open your first project |
| [Running Clidable](./running-clidable.md) | Every way to run it: dev mode, production binary, desktop app, browser, phone |
| [Remote & VPS Setup](./remote-vps.md) | Run Clidable on a server and use it from anywhere — **read the security section** |
| [Workspace Guide](./workspace-guide.md) | Full tour of the UI: terminals, composer, code editor, preview, mobile |
| [Checkpoints](./checkpoints.md) | Automatic snapshots before every message — restore, compare, how it works |
| [Skills, MCP, Plugins & AI Team](./agent-toolkit.md) | The agent-configuration tools and multi-agent delegation |
| [CLI Reference](./cli-reference.md) | The `clidable` command: `skills`, `mcp`, `plugins`, `instructions`, `team` |
| [Configuration Reference](./configuration.md) | Flags, environment variables, data locations, supported agents |
| [Troubleshooting & FAQ](./troubleshooting.md) | Common problems and answers |

## The 60-second version

```bash
# 1. Install Bun (the runtime Clidable is built on)
curl -fsSL https://bun.sh/install | bash

# 2. Get Clidable
git clone https://github.com/openclide/clidable.git
cd clidable
bun install

# 3. Run it
bun run dev
# → open http://127.0.0.1:7878 in your browser
```

Pick an agent on the welcome screen (Claude Code, Codex, Antigravity, …), open or create a project, and start typing. Every message you send automatically creates a checkpoint you can rewind to.

## What Clidable is (and isn't)

**It is:**

- A workspace where CLI coding agents run in real PTY terminals, rendered with xterm.js — what you see is exactly what the agent's TUI shows.
- Agent-agnostic: Claude Code, Codex CLI, Antigravity CLI, Cursor, Qwen Code, Kimi CLI, OpenCode, and GitHub Copilot CLI are all supported.
- A safety net: a shadow git repository snapshots your project before every message, without touching your real git history.
- A single process: one Bun server hosts the frontend, the API, and the terminals on one port. The same binary runs on your laptop, in a browser tab, on a VPS, or inside the desktop app.

**It is not:**

- An agent itself — it doesn't talk to any AI APIs. The agents bring their own auth (you log into Claude Code, Codex, etc. exactly as you would in a plain terminal).
- A replacement for your terminal — you can always click into the terminal pane and type directly, use slash commands, press Ctrl-C, everything.

## Project status

Clidable is pre-1.0 and under active development. The core experience — terminals, composer, checkpoints, code editor, preview, projects, skills/MCP/plugins/instructions managers, and AI team delegation — is built and working. Some rough edges remain and are called out honestly throughout these docs (see especially the [security notes](./remote-vps.md#security-model--read-this-first) for remote setups).
