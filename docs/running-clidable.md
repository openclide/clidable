# Running Clidable

Clidable is one server that serves the UI, the API, and the terminals on a single port (default **7878**). Everything below is a different way of launching that same server.

> **The golden rule:** Clidable runs *where your code and your agents live*. A browser tab (or phone) is just a window into it. If your projects are on your laptop, run Clidable on your laptop; if they're on a VPS, run it there (see [Remote & VPS Setup](./remote-vps.md)).

## Option 1 — The desktop app

The installers from the [Releases page](https://github.com/openclide/clidable/releases) (or `brew install --cask openclide/tap/clidable-desktop` on macOS) give you a self-contained native app — it embeds its own server, so there is nothing else to install.

What the app adds over the browser:

- **A native window with OS-level glass** — true desktop-behind blur on macOS (vibrancy), Acrylic/Mica on Windows.
- **A background server** — closing the main window *hides* it; your agents keep running. The menu-bar tray's **Quit Clidable** is the real off-switch. (Extra workspace windows close like browser tabs — their sessions park after 10 unattended minutes and resume when reopened.)
- **A menu-bar tray with live agent status** — every running agent is listed with a colored dot (blue = working, amber = waiting for you, green = done, gray = idle), and the tray icon carries a status pip showing the most urgent state at a glance.
- **Native touches** — a real folder picker, checkpoint thumbnails (the app snapshots the preview pane at each checkpoint), and "Open in new window" for working across displays.
- **`clidable open .`** — if you also installed the CLI (Homebrew / npm / install script), this opens the current folder in the app on macOS, or in the browser elsewhere.

## Option 2 — The `clidable` command

One self-contained binary — the server, the CLI, and the bundled tooling in a single file. Install it with Homebrew, npm, or the install script (see [Getting Started](./getting-started.md#1-install-clidable)), then:

```bash
clidable                     # → http://127.0.0.1:7878
clidable --port 9000         # custom port
```

It binds to `127.0.0.1` — only reachable from the same machine (safe default). This is also the artifact for a VPS: install it on the server and put an access layer in front ([Remote & VPS Setup](./remote-vps.md)).

**What it still needs on the host:**

- `git` on PATH (checkpoints, diffs, scaffolding).
- The agent CLIs you want to use (`claude`, `codex`, …), logged in.
- **Bun on PATH for two features** — the project templates (scaffolding runs `bun create …` / `bunx …`), and the preview's Run button on a project **without a lockfile** (managed dev servers run with your project's own package manager, and Bun is the assumed default when there's no lockfile to detect one from). Everything else works without Bun.

## Option 3 — From source

For contributors, or if you just like running from a checkout. Needs [Bun](https://bun.sh) ≥ 1.3.14:

```bash
git clone https://github.com/openclide/clidable.git
cd clidable && bun install
bun run dev                  # dev server with hot reload → http://127.0.0.1:7878
```

To produce the same single-file binary the releases ship:

```bash
bun run build:compile        # → dist/clidable-server (~65 MB, no Bun needed to run it)
```

(There's also `bun run build` + `bun run start` for a non-compiled production bundle — note the bundle must be launched from inside `dist/`, which `bun run start` handles. The build is self-verifying: it fails loudly if the source HTML would be mutated or the CSS ships unprocessed.)

> A compiled binary targets the platform that built it. Build on the same OS/architecture you'll run it on — or skip the whole step and use the released binaries.

For the native desktop shell from source (`bun run tauri:dev` / `bun run tauri:build`) you additionally need the Rust toolchain — see [CONTRIBUTING.md](https://github.com/openclide/clidable/blob/main/CONTRIBUTING.md).

## Option 4 — Browser, phone, and tablet

Any browser pointed at the server gets the full app:

- **Same machine:** `http://127.0.0.1:7878`.
- **Phone / another machine:** the server must be reachable from that device — see [Remote & VPS Setup](./remote-vps.md) for the safe ways to do that (SSH tunnel, Tailscale, Cloudflare Tunnel, reverse proxy).

On small screens Clidable switches to a dedicated **mobile layout**: a bottom bar toggles between **CLI**, **Preview**, and **Code** views, terminals flatten into swipeable tabs, and the composer becomes the primary input (the terminal acts as a scrollable log). Phones are *clients* — they drive agents running on the server, they don't run agents themselves.

## Verifying the server is up

```bash
curl http://127.0.0.1:7878/api/health
# {"ok":true,"version":"0.1.0","uptimeMs":1234,"shell":"server"}
```

## Stopping, and what survives

**Stopping:**

- CLI server in a terminal: **Ctrl-C**.
- Background server (the one `clidable open` starts): `clidable stop`.
- Desktop app: tray → **Quit Clidable**. (`clidable stop` deliberately refuses to kill the app's own server — it would strand the app's windows; use the tray, or `--force` if you really mean it.)
- On a VPS: your service manager — see the [VPS guide](./remote-vps.md#step-3--keep-it-running-systemd).

**Survives a browser disconnect (server keeps running):** everything. Terminal sessions live on the server — close the tab, switch networks, let your phone sleep; reattach and the terminal replays its recent output (up to 256 KB per terminal). A session with **no client at all** for over 10 minutes is *parked*: its process stops, but the session stays in your workspace and **reopening it resumes the agent's conversation** (see below). Keeping a tab attached — even backgrounded or minimized — keeps the session hot.

**Survives a server restart / reboot:**

- Projects, **workspaces** (the full layout — open projects, panes, tabs), checkpoints, and settings (SQLite + shadow git repos in the [data directory](./configuration.md#data-cache-and-log-locations)).
- Skills / MCP / plugin installs and `AGENTS.md` (written to the agents' own config files and your project).
- **Agent conversations.** Reopen a workspace and each agent terminal relaunches with the agent's own resume feature (`claude --resume`, `codex resume`, …) pointed at the conversation it was in. Supported for Claude Code, Codex, and Antigravity; best-effort for Cursor, Copilot, OpenCode, and Kimi; not available for Qwen. Plain (non-agent) terminals restart as a fresh shell.

**Does not survive a restart:** terminal *scrollback* (the resumed agent redraws its own screen), in-flight AI-team background jobs, and dev servers Clidable started (one click restarts them).

## Quick reference: launch flags

`clidable` here is the installed command (Homebrew / npm / install script); a
source checkout takes the same flags via `bun server/index.ts`, and
`bun run dev` reads the env vars.

```bash
clidable [--port 7878] [--bind 127.0.0.1] [--allow-lan] [--dev]
clidable --version            # bare version, e.g. 0.1.1
clidable --help
```

| Flag | Env var | Default | Meaning |
|---|---|---|---|
| `--port` | `CLIDABLE_PORT` | `7878` | HTTP/WS port |
| `--bind` | `CLIDABLE_BIND` | `127.0.0.1` | Address to listen on — loopback by default; a non-loopback value (`0.0.0.0`, `::`, a LAN IP, a hostname) refuses to start unless you also pass `--allow-lan` (see warning below) |
| `--allow-lan` | `CLIDABLE_ALLOW_LAN` | off | Opt in to a non-loopback `--bind`. Permits the bind and starts an **unauthenticated, network-exposed** server (loud startup warning). No auth is added — for informed use on a network you control |
| `--auth` | — | `none` | Only `none` is accepted — `token` / `oauth` refuse to start (no built-in auth by design) |
| `--tls` | — | — | Refuses to start — no built-in TLS by design (terminate TLS in your tunnel/reverse proxy) |
| `--dev` | `NODE_ENV` | dev unless `NODE_ENV=production` | HMR + console streaming (source checkouts) |

> ⚠️ **Clidable is localhost-only by default.** A non-loopback `--bind` (`0.0.0.0`, `::`, a LAN IP, a hostname) refuses to start (``refusing to start: Clidable is localhost-only by default — `--bind …` would expose unauthenticated remote code execution (PTY spawn) to the network``) unless you explicitly opt in with **`--allow-lan`** (or `CLIDABLE_ALLOW_LAN=1`). That opt-in is the informed "I control this network" escape hatch — and it starts a server with **no authentication**, so anyone who can reach the address can spawn terminals on the host. Only do it behind a firewall/VPN you trust. `--auth token|oauth` and `--tls` still refuse to start unconditionally (`refusing to start: Clidable has no built-in auth/TLS by design …`) — Clidable has no request-time auth or TLS by design (that's your access layer's job), and `--allow-lan` adds neither, so silently accepting those flags would be false assurance. Never expose Clidable directly to the internet without a tunnel or an authenticating reverse proxy — see [Remote & VPS Setup](./remote-vps.md).

Full details in the [Configuration Reference](./configuration.md).
