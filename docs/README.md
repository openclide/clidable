# Clidable Documentation

**Clidable is a GUI for CLI coding agents.** It wraps Claude Code, Codex CLI, Antigravity CLI, and friends in a beautiful, modern interface — with checkpoints before every message, live project preview, a built-in code editor, durable multi-agent sessions, and one-click management of skills, MCP servers, plugins, and AI teams.

The agents still run in their real terminals (their native TUI, full fidelity) — Clidable adds everything around them: a message composer, automatic snapshots you can rewind to, a browser preview of your dev server, a VS-Code-feel editor, and tools to wire multiple agents together.

## Install in 60 seconds

**The desktop app** — the nicest way to use Clidable on your own machine:

```bash
# macOS
brew install --cask openclide/tap/clidable-desktop
```

…or download the installer for macOS (`.dmg`), Windows (setup `.exe` / `.msi`), or Linux (AppImage / `.deb` / `.rpm`) from the [Releases page](https://github.com/openclide/clidable/releases). The app carries its own server — there is nothing else to install.

**The `clidable` command** — for the browser UI, a VPS, or scripting. Any one of:

```bash
brew install openclide/tap/clidable          # Homebrew (macOS / Linux)
```

```bash
npm install -g clidable                      # npm (any OS with Node)
```

```bash
curl -fsSL https://raw.githubusercontent.com/openclide/clidable/main/install.sh | bash
```

Then run it and open the UI:

```bash
clidable
# → http://127.0.0.1:7878
```

Pick an agent on the welcome screen (Claude Code, Codex, Antigravity, …), open or create a project, and start typing. Every message you send automatically creates a checkpoint you can rewind to.

## Where to start

| Guide | What it covers |
|---|---|
| [Getting Started](./getting-started.md) | Install and run Clidable in 5 minutes, open your first project |
| [Running Clidable](./running-clidable.md) | Every way to run it: desktop app, the `clidable` command, source, browser, phone |
| [Remote & VPS Setup](./remote-vps.md) | Run Clidable on a server and use it from anywhere — Tailscale, Cloudflare Tunnel, reverse proxy. **Read the security section** |
| [Workspace Guide](./workspace-guide.md) | Full tour of the UI: workspaces, terminals, composer, code editor, preview, mobile |
| [Checkpoints](./checkpoints.md) | Automatic snapshots before every message — restore, compare, how it works |
| [Skills, MCP, Plugins & AI Team](./agent-toolkit.md) | The agent-configuration tools and multi-agent delegation |
| [CLI Reference](./cli-reference.md) | The `clidable` command: `open`, `stop`, `skills`, `mcp`, `plugins`, `instructions`, `team` |
| [Configuration Reference](./configuration.md) | Flags, environment variables, data locations, per-project config, supported agents |
| [Troubleshooting & FAQ](./troubleshooting.md) | Common problems and answers |

## What Clidable is (and isn't)

**It is:**

- A workspace where CLI coding agents run in real PTY terminals, rendered with xterm.js — what you see is exactly what the agent's TUI shows.
- Agent-agnostic: Claude Code, Codex CLI, Antigravity CLI, Cursor, Qwen Code, Kimi CLI, OpenCode, and GitHub Copilot CLI are all supported.
- A safety net: a shadow git repository snapshots your project before every message, without touching your real git history.
- Durable: close the tab, close the window, even restart the server — your workspaces come back, and agent sessions pick their conversation back up.
- A single process: one Bun server hosts the frontend, the API, and the terminals on one port. The same server runs on your laptop, on a VPS, or inside the desktop app.

**It is not:**

- An agent itself — it doesn't talk to any AI APIs. The agents bring their own auth (you log into Claude Code, Codex, etc. exactly as you would in a plain terminal).
- A replacement for your terminal — you can always click into the terminal pane and type directly, use slash commands, press Ctrl-C, everything.

## Project status

Clidable is released and under active development (pre-1.0). The core experience — terminals, composer, durable sessions, checkpoints, code editor, preview, projects, skills/MCP/plugins/instructions managers, AI team delegation, and the desktop app for macOS/Windows/Linux — is built and shipping. Rough edges are called out honestly throughout these docs (see especially the [security notes](./remote-vps.md#security-model--read-this-first) for remote setups).
