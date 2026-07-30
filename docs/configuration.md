# Configuration Reference

Everything tunable: flags, environment variables, file locations, and the supported-agents matrix.

## Launch flags & environment variables

| Flag | Env var | Default | Description |
|---|---|---|---|
| `--port <n>` | `CLIDABLE_PORT` | `7878` | Port for the UI, API, and terminals (1–65535) |
| `--bind <addr>` | `CLIDABLE_BIND` | `127.0.0.1` | Interface to listen on. **Loopback by default** — `127.0.0.0/8`, `::1`, or `localhost`; a non-loopback bind refuses to start unless you add `--allow-lan` (see below) |
| `--allow-lan` | `CLIDABLE_ALLOW_LAN` | off | Opt in to a non-loopback `--bind`, exposing the **unauthenticated** server to the network. Prints a loud startup warning; adds no auth. Env value accepts `1`/`true`/`yes`/`on` (see below) |
| `--auth <mode>` | — | `none` | Only `none` is accepted — `token` / `oauth` refuse to start *(no built-in auth by design, see below)* |
| `--tls <cert>` | — | — | Refuses to start *(no built-in TLS by design — terminate TLS in your tunnel or reverse proxy)* |
| `--dev` | `NODE_ENV` | dev unless `NODE_ENV=production` | Dev conveniences: frontend hot reload, browser console streamed to the server log |

Flags beat environment variables. Bun also auto-loads `.env` files from the working directory, so a `.env` with `CLIDABLE_PORT=9000` works.

### The safety guard

Clidable is **localhost-only by default**. The server refuses to start with *any* non-loopback `--bind` — a LAN IP, `0.0.0.0`, `::`, a hostname, anything — unless you explicitly opt in:

```
refusing to start: Clidable is localhost-only by default — `--bind 0.0.0.0`
would expose unauthenticated remote code execution (PTY spawn) to the
network. Bind a loopback address (127.0.0.1, the default) and use a tunnel
or authenticating reverse proxy for remote access. If you control this
network and accept the risk, re-run with `--allow-lan` (or
CLIDABLE_ALLOW_LAN=1).
```

**The `--allow-lan` escape hatch.** If you control the network (firewall/VPN) and accept the risk, `--allow-lan` (or `CLIDABLE_ALLOW_LAN=1`) permits the non-loopback bind. It does **not** add authentication — it's an informed "I accept unauthenticated exposure on a network I control" choice. The server starts and prints a loud red banner at the top of the log:

```
 ⚠  NETWORK-EXPOSED  --allow-lan is on.
Clidable is bound to 0.0.0.0:7878 — anyone who can reach this
address can spawn terminals on this machine. There is NO authentication.
Only do this on a network you control (firewall/VPN). To lock it back down,
drop --allow-lan / CLIDABLE_ALLOW_LAN and bind 127.0.0.1 (the default).
```

Even on an `--allow-lan` public bind, the [same-site gate](#network-behavior) still runs: cross-site browser requests are refused with `403`, while same-origin requests and non-browser clients (`curl`, the `clidable` CLI) pass.

`--auth token`, `--auth oauth`, and `--tls` are refused **unconditionally** — even with `--allow-lan` — because Clidable has no built-in auth or TLS by design (that's your access layer's job), and silently accepting them would be false assurance:

```
refusing to start: Clidable has no built-in auth/TLS by design — remote
access is your access layer's job (Tailscale, Cloudflare Tunnel, or an
authenticating reverse proxy). Remove --auth/--tls and bind a loopback
address; see docs/remote-vps.md.
```

> ⚠️ **By design:** Clidable has no request-time auth and no TLS, and won't — authenticating remote access is your *access layer's* job. That's *why* those flags are refused rather than ignored, and why `--allow-lan` only *permits* network exposure without securing it. For remote access, keep the loopback bind and use an SSH tunnel, Tailscale, or an authenticating reverse proxy — full recipes in [Remote & VPS Setup](./remote-vps.md).

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
.clidable/launch.json      # dev-server overrides (only if you saved any — see below)
.clidable/ai-team.json     # AI-team role config (only if you use the Team feature)
AGENTS.md, CLAUDE.md, …    # only if you use the Instructions feature
.claude/skills/ etc.       # only if you install skills / team roles
```

## Per-project dev-server config (`.clidable/launch.json`)

How the preview's Run dot starts *this* project's dev server. Normally you never touch it — detection covers the common stacks — but every part can be overridden from the UI (▾ ports menu → **Configure dev server…**), which saves this file:

```json
{
  "command": "npm run dev",
  "port": 3000,
  "url": "http://myserver.tail1234.ts.net:3000"
}
```

| Field | Meaning | When omitted |
|---|---|---|
| `command` | Shell command that starts the dev server | Auto-built: lockfile picks the package manager (bun / pnpm / yarn / npm; Bun assumed when there's no lockfile), `package.json` scripts pick the script, the framework decides port passing |
| `port` | Local port the server binds; also exported as `$PORT` to the command | The framework's default (Vite 5173, Next 3000, Astro 4321, Expo 8081, …), free-scanned upward if taken. With a custom `command` there's no scan — the default is used as-is, so set `port` explicitly if it might be busy |
| `url` | The URL the preview iframe loads — the remote/Tailscale escape hatch | `http://localhost:<port>` |

Rules worth knowing:

- **Every field is optional** — set only what detection gets wrong. Saving the form with everything blank deletes the file (back to pure auto).
- An explicit port **in the `url`** (e.g. `…:3000`) also pins the local bind port; a port-less `url` (e.g. `https://box.ts.net`) deliberately doesn't — Clidable won't try to bind 443.
- The file is plain JSON, safe to hand-edit and commit; invalid values are ignored rather than breaking startup.
- Detected frameworks with a launch plan: Vite, SvelteKit, Astro, Expo (port as a flag) and Next.js, Nuxt, Remix, Hono, generic Node (port as `PORT`). Python / Rust / Go projects have no auto plan — set a `command` here, or start the server in a terminal and let detection pick it up.

## Supported agents

| Agent | Binary on PATH | Install docs | Notes |
|---|---|---|---|
| Claude Code | `claude` | [setup](https://code.claude.com/docs/en/setup) | Plugin-sync env enabled automatically |
| Codex CLI | `codex` | [codex/cli](https://developers.openai.com/codex/cli/) | |
| Antigravity CLI | `agy` | [cli/install](https://antigravity.google/docs/cli/install) | Windows install differs — the linked page covers it |
| Cursor Agent | `cursor-agent` | [cli/installation](https://cursor.com/docs/cli/installation) | |
| Qwen Code | `qwen` | [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) | |
| Kimi CLI | `kimi` | [getting started](https://moonshotai.github.io/kimi-cli/en/guides/getting-started.html) | A Python tool, installed with `uv` |
| OpenCode | `opencode` | [opencode.ai/docs](https://opencode.ai/docs/) | |
| GitHub Copilot | `copilot` | [install Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) | No read-only mode for AI-team delegation |

Every linked page covers all platforms, which is the other reason Clidable links rather than prints a command: install steps differ per OS and change often. The links live in exactly one place, `AGENT_INSTALL_DOCS` in `shared/types.ts`, which both the server and the UI read.

Detection is by PATH lookup — the agent must be on the PATH of the *server* process. Successful lookups are cached for the server's lifetime; misses are re-probed, so an agent you install while Clidable is running is picked up on the next launch (returning to the window refreshes the welcome screen). Each agent handles its own login/credentials (`~/.claude`, `~/.codex`, …); Clidable stores no API keys.

Terminals are spawned with the agent launched directly (not a wrapper shell), with `TERM=xterm-256color`, `COLORTERM=truecolor`, your full environment, and Clidable's `bin/` prepended to PATH so the `clidable` CLI resolves inside.

## Project templates & framework detection

**Templates** (new-project wizard): Empty folder, Vite + React, Vite + Svelte, Vite + Vue, Next.js, Astro, Hono, Expo. Scaffolding uses the official generators via Bun (`bun create vite …`, `bunx create-next-app@latest …`, `bunx create-expo-app@latest …`), runs non-interactively with a 4-minute timeout, installs dependencies, and git-inits with a first commit.

**Detection** (opening an existing project): Next.js, Remix, Expo, SvelteKit, Nuxt, Astro, Vite, Hono, generic Node (from `package.json`); Rust (`Cargo.toml`); Python (`pyproject.toml` / `requirements.txt` / `manage.py`); Go (`go.mod`).

**Managed dev server** (the Run dot in the preview address bar): supported for Vite, SvelteKit, Astro, Expo (port passed as `--port`) and Next.js, Nuxt, Remix, Hono, Node (port passed as `PORT` env), run with your project's own package manager (bun / pnpm / yarn / npm, detected from the lockfile; Bun assumed when there's none). A free port is picked starting from the framework's default (Vite 5173, Next 3000, Astro 4321, Expo 8081, …). Everything is overridable per project — see [`.clidable/launch.json`](#per-project-dev-server-config-clidablelaunchjson). Other stacks: set a command there, or run your dev server in the terminal; the preview auto-detects it.

## Network behavior

- **One port serves everything**: UI, JSON API (`/api/*`), terminal WebSockets, file watching, and the preview proxy.
- **Preview proxy** (`/proxy/<port>/…`): lets a browser reach dev servers that listen on the Clidable host's loopback — useful when you access Clidable through a tunnel or reverse proxy ([Remote & VPS Setup](./remote-vps.md)). The proxy only ever targets `127.0.0.1` on the host (it cannot be aimed at other machines) and refuses to proxy the server's own port.
- **Same-site gate**: every `/api/*` route (terminal WebSockets included) and the preview proxy refuse cross-site browser requests with `403 cross-site request refused`, so a random web page you visit can't drive the loopback server. A request whose `Host` header isn't loopback is refused too (DNS-rebinding defense) — a reverse proxy in front of Clidable must send a loopback `Host` upstream. Non-browser clients (`curl`, the `clidable` CLI) pass through.
- **Port auto-detection** runs two ways: scanning terminal output for `localhost:…` URLs, and scanning the agents' process trees for listening sockets every few seconds (`lsof` on macOS, `/proc` on Linux, `Get-NetTCPConnection` on Windows).
- **Health check**: `GET /api/health` → `{"ok":true,"version":…,"uptimeMs":…}`.

## Platform support

- **macOS** — fully exercised; the development platform. Desktop app (`.dmg`, Apple silicon + Intel) has native vibrancy blur.
- **Linux** — supported, both headless (a VPS behind your own access layer) and as a desktop app (`.deb` / `.rpm`; the shell falls back to a CSS gradient — no compositor blur API on Linux).
- **Windows** — supported (ConPTY terminals, PowerShell-based port scan, Acrylic/Mica in the desktop app; setup `.exe` / `.msi` installers), but less battle-tested than macOS/Linux.

Runtime requirements recap: **git** and your agent CLIs, everywhere. **Bun ≥ 1.3.14** only to run from source, to use the new-project templates (scaffolding runs `bun create …`), or when the Run dot starts a project with no lockfile (Bun is the assumed package manager).
