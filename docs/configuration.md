# Configuration Reference

Everything tunable: flags, environment variables, file locations, and the supported-agents matrix.

## Launch flags & environment variables

| Flag | Env var | Default | Description |
|---|---|---|---|
| `--port <n>` | `CLIDABLE_PORT` | `7878` | Port for the UI, API, and terminals (1–65535) |
| `--bind <addr>` | `CLIDABLE_BIND` | `127.0.0.1` | Interface to listen on. **Loopback only** — `127.0.0.0/8`, `::1`, or `localhost`; anything else refuses to start (see below) |
| `--token <secret>` | `CLIDABLE_TOKEN` | — | Shared secret, reserved for a future server mode *(parsed, currently unused)* |
| `--auth <mode>` | — | `none` | Only `none` is accepted — `token` / `oauth` refuse to start *(not implemented yet, see below)* |
| `--tls <cert>` | — | — | Refuses to start *(not implemented — terminate TLS in a reverse proxy)* |
| `--dev` | `NODE_ENV` | dev unless `NODE_ENV=production` | Dev conveniences: frontend hot reload, browser console streamed to the server log |

Flags beat environment variables. Bun also auto-loads `.env` files from the working directory, so a `.env` with `CLIDABLE_PORT=9000` works.

### The safety guard

Clidable is **localhost-only**. The server refuses to start with *any* non-loopback `--bind` — a LAN IP, `0.0.0.0`, `::`, a hostname, anything:

```
refusing to start: Clidable is localhost-only — `--bind 0.0.0.0` would
expose unauthenticated remote code execution (PTY spawn) to the network.
Bind a loopback address (127.0.0.1, the default); for remote access, put
Clidable behind a VPN or authenticating reverse proxy you control.
```

It refuses `--auth token`, `--auth oauth`, and `--tls` the same way — neither is implemented yet, and silently accepting them would be false assurance:

```
refusing to start: --auth / --tls are not implemented yet — Clidable is
localhost-only. Remove them and bind a loopback address.
```

> ⚠️ **Honest limitation:** there is no request-time auth and no TLS — that's *why* those flags are refused rather than ignored. `--token` / `CLIDABLE_TOKEN` is still parsed (the seam for a future server mode) but **no incoming request is checked against it**. For remote access, keep the loopback bind and use an SSH tunnel, Tailscale, or an authenticating reverse proxy — full recipes in [Remote & VPS Setup](./remote-vps.md).

`CLIDABLE_PORT` is also read by the `clidable team` CLI to find the server.

## Data, cache, and log locations

Clidable follows each OS's conventions (via `env-paths`):

| | macOS | Linux | Windows |
|---|---|---|---|
| **Data** | `~/Library/Application Support/Clidable/` | `$XDG_DATA_HOME/clidable` (default `~/.local/share/clidable`) | `%APPDATA%\Clidable\Data\` |
| **Cache** | `~/Library/Caches/Clidable/` | `$XDG_CACHE_HOME/clidable` (default `~/.cache/clidable`) | `%LOCALAPPDATA%\Clidable\Cache\` |
| **Logs** | `~/Library/Logs/Clidable/` | `$XDG_STATE_HOME/clidable` (default `~/.local/state/clidable`) | `%LOCALAPPDATA%\Clidable\Logs\` |

The exact paths for your machine are printed at startup.

Inside the **data** directory:

```
clidable.db                       # SQLite: projects registry, checkpoint metadata, settings
projects/<uuid>/checkpoints.git   # per-project shadow git repo (checkpoint snapshots)
projects/<uuid>/screenshots/      # checkpoint thumbnails (desktop app)
bin/clidable                      # CLI shim, auto-added to PATH in spawned terminals
```

**Back up the data directory** to keep your checkpoint history and project list. Cache and logs are disposable.

Inside each **project**, Clidable creates at most:

```
.clidable/project-id       # UUID — the project's stable identity (survives rename/move)
.clidable/.gitignore       # keeps the above out of your repo
.clidable/ai-team.json     # AI-team role config (only if you use the Team feature)
AGENTS.md, CLAUDE.md, …    # only if you use the Instructions feature
.claude/skills/ etc.       # only if you install skills / team roles
```

## Supported agents

| Agent | Binary on PATH | Install | Notes |
|---|---|---|---|
| Claude Code | `claude` | `npm i -g @anthropic-ai/claude-code` | Plugin-sync env enabled automatically |
| Codex CLI | `codex` | `npm i -g @openai/codex` | |
| Antigravity CLI | `agy` | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` | Windows: `irm https://antigravity.google/cli/install.ps1 \| iex` |
| Cursor | `cursor-agent` | Install Cursor; enable the CLI | |
| Qwen Code | `qwen` | `npm i -g @qwen-code/qwen-code` | |
| Kimi CLI | `kimi` | Moonshot AI docs | |
| OpenCode | `opencode` | `npm i -g opencode` | |
| GitHub Copilot | `copilot` | `npm i -g @github/copilot` | No read-only mode for AI-team delegation |

Detection is by `which <binary>` — the agent must be on the PATH of the *server* process. Each agent handles its own login/credentials (`~/.claude`, `~/.codex`, …); Clidable stores no API keys.

Terminals are spawned with the agent launched directly (not a wrapper shell), with `TERM=xterm-256color`, `COLORTERM=truecolor`, your full environment, and Clidable's `bin/` prepended to PATH so the `clidable` CLI resolves inside.

## Project templates & framework detection

**Templates** (new-project wizard): Empty folder, Vite + React, Vite + Svelte, Vite + Vue, Next.js, Astro, Hono. Scaffolding uses the official generators via Bun (`bun create vite …`, `bunx create-next-app@latest …`), runs non-interactively with a 4-minute timeout, installs dependencies, and git-inits with a first commit.

**Detection** (opening an existing project): Next.js, Remix, Expo, SvelteKit, Nuxt, Astro, Vite, Hono, generic Node (from `package.json`); Rust (`Cargo.toml`); Python (`pyproject.toml` / `requirements.txt` / `manage.py`); Go (`go.mod`).

**Managed dev server** (the Run dot in the preview address bar): supported for Vite, SvelteKit, Astro (port passed as `--port`) and Next.js, Nuxt, Remix, Hono, Node (port passed as `PORT` env). A free port is picked starting from the framework's default (Vite 5173, Next 3000, Astro 4321, …). Other stacks: run your dev server in the terminal; the preview auto-detects it.

## Network behavior

- **One port serves everything**: UI, JSON API (`/api/*`), terminal WebSockets, file watching, and the preview proxy.
- **Preview proxy** (`/proxy/<port>/…`): lets a browser reach dev servers that listen on the Clidable host's loopback — useful when you access Clidable through a tunnel or reverse proxy ([Remote & VPS Setup](./remote-vps.md)). The proxy only ever targets `127.0.0.1` on the host (it cannot be aimed at other machines) and refuses to proxy the server's own port.
- **Same-site gate**: every `/api/*` route (terminal WebSockets included) and the preview proxy refuse cross-site browser requests with `403 cross-site request refused`, so a random web page you visit can't drive the loopback server. A request whose `Host` header isn't loopback is refused too (DNS-rebinding defense) — a reverse proxy in front of Clidable must send a loopback `Host` upstream. Non-browser clients (`curl`, the `clidable` CLI) pass through.
- **Port auto-detection** runs two ways: scanning terminal output for `localhost:…` URLs, and scanning the agents' process trees for listening sockets every few seconds (`lsof` on macOS, `/proc` on Linux, `Get-NetTCPConnection` on Windows).
- **Health check**: `GET /api/health` → `{"ok":true,"version":…,"uptimeMs":…}`.

## Platform support

- **macOS** — fully exercised; the development platform. Desktop shell has native vibrancy blur.
- **Linux** — supported (server mode is the primary use). Desktop shell falls back to a CSS gradient (no compositor blur).
- **Windows** — supported by design (ConPTY via Bun ≥ 1.3.14, PowerShell-based port scan, Mica/Acrylic in the shell), but less battle-tested than macOS/Linux.

Runtime requirements recap: **Bun ≥ 1.3.13** (to run from source; also needed for scaffolding and managed dev servers even with the compiled binary), **git**, and your agent CLIs.
