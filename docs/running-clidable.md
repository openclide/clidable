# Running Clidable

Clidable is one Bun server that serves the UI, the API, and the terminals on a single port (default **7878**). Everything below is a different way of launching that same server.

> **The golden rule:** Clidable runs *where your code and your agents live*. A browser tab (or phone) is just a window into it. If your projects are on your laptop, run Clidable on your laptop; if they're on a VPS, run it there (see [Remote & VPS Setup](./remote-vps.md)).

## Option 1 — Dev mode (recommended today)

The simplest and most battle-tested way to run Clidable:

```bash
cd clidable
bun run dev
# → http://127.0.0.1:7878
```

- Serves the React frontend with hot reload and the full API in one process.
- Binds to `127.0.0.1` — only reachable from the same machine (safe default).
- Keep the terminal open; Ctrl-C stops everything (running agent sessions die with it).

Despite the name, "dev mode" is a perfectly good way to *use* Clidable daily — it's the mode the project itself is developed and verified in.

## Option 2 — Single-file production binary

Compile everything (server + frontend + bundled tooling) into one self-contained executable:

```bash
bun run build:compile
# → dist/clidable-server (~65 MB)
```

Run it from anywhere — it does not need Bun, Node, or the source tree:

```bash
./dist/clidable-server                     # http://127.0.0.1:7878
./dist/clidable-server --port 9000         # custom port
```

This is the artifact to copy to a VPS or a second machine.

**What the binary still needs on the host:**

- `git` on PATH (checkpoints, diffs, scaffolding).
- The agent CLIs you want to use (`claude`, `codex`, …), logged in.
- **Bun on PATH if you use project templates or the managed dev-server button** — scaffolding runs `bun create …` / `bunx …`, and the managed dev server types `bun run dev` into its shell. Everything else works without Bun installed.

> The binary is compiled for the platform that built it. Build on the same OS/architecture you'll run it on (e.g. build on your Linux VPS for the VPS).

## Option 3 — Production bundle (advanced)

```bash
bun run build        # bundles server + frontend into dist/
bun run start        # runs it (cd dist && bun index.js)
```

One caveat with this mode:

1. **You must launch it from inside `dist/`** — the bundle resolves its chunks relative to the working directory (`bun run start` handles this; a bare `bun dist/index.js` from the repo root fails with `Bundled file "./chunk-*.js" not found`).

The build is **self-verifying**: it fails loudly if the source HTML would be mutated or the CSS ships without Tailwind processing (both historical bugs), so a green `bun run build` means `dist/` is complete and the source tree is untouched.

## Option 4 — Desktop app (Tauri)

Clidable ships a thin native shell (Tauri 2) that gives you a real window with OS-level glass: true desktop-behind blur on macOS (vibrancy), Mica/Acrylic on Windows.

**Requirements:** the Rust toolchain (`rustup`), plus the platform's Tauri prerequisites (Xcode CLT on macOS; WebView2 on Windows; `webkit2gtk` & friends on Linux).

```bash
bun run tauri:dev
```

This starts the Bun server (`bun run dev`) and opens a native window pointed at it. Functionally identical to the browser — same frontend, same server — plus:

- Translucent, vibrancy-blurred window chrome.
- A native folder picker for opening projects.
- **Checkpoint screenshots**: the desktop shell can capture the preview pane (permission-free — it snapshots the webview, not your screen), so checkpoints get visual thumbnails in the rewind list.

> **Current limitation:** the production desktop bundle (`bun run tauri:build`) does not yet embed the Bun server as a sidecar — the installable app is not self-contained yet. For now, use `bun run tauri:dev` for the desktop experience, or just use the browser.

## Option 5 — Browser, phone, and tablet

Any browser pointed at the server gets the full app:

- **Same machine:** `http://127.0.0.1:7878`.
- **Phone / another machine:** the server must be reachable from that device — see [Remote & VPS Setup](./remote-vps.md) for the safe ways to do that (SSH tunnel, Tailscale, reverse proxy).

On small screens Clidable switches to a dedicated **mobile layout**: a bottom bar toggles between **CLI**, **Preview**, and **Code** views, terminals flatten into swipeable tabs, and the composer becomes the primary input (the terminal acts as a scrollable log). Phones are *clients* — they drive agents running on the server, they don't run agents themselves.

## Verifying the server is up

```bash
curl http://127.0.0.1:7878/api/health
# {"ok":true,"version":"0.0.1","uptimeMs":1234,"shell":"server"}
```

## Stopping, and what survives a restart

- Stop with **Ctrl-C** (or your service manager — see the VPS guide for systemd).
- **Survives restarts:** projects list, checkpoints (SQLite + shadow git repos in the [data directory](./configuration.md#data-cache-and-log-locations)), skills/MCP/plugin installs (written to the agents' own config files), AGENTS.md and AI-team config (in your project).
- **Does not survive:** running terminal sessions and their scrollback, in-flight AI-team background jobs, dev servers Clidable started.

Terminal sessions *do* survive browser disconnects while the server stays up — close the tab, reopen it, and the session replays its recent output (up to 256 KB per terminal). Sessions with no connected client are reaped after 10 minutes of inactivity.

## Quick reference: launch flags

```bash
clidable-server [--port 7878] [--bind 127.0.0.1] [--allow-lan] [--dev]
```

| Flag | Env var | Default | Meaning |
|---|---|---|---|
| `--port` | `CLIDABLE_PORT` | `7878` | HTTP/WS port |
| `--bind` | `CLIDABLE_BIND` | `127.0.0.1` | Address to listen on — loopback by default; a non-loopback value (`0.0.0.0`, `::`, a LAN IP, a hostname) refuses to start unless you also pass `--allow-lan` (see warning below) |
| `--allow-lan` | `CLIDABLE_ALLOW_LAN` | off | Opt in to a non-loopback `--bind`. Permits the bind and starts an **unauthenticated, network-exposed** server (loud startup warning). No auth is added — for informed use on a network you control |
| `--token` | `CLIDABLE_TOKEN` | — | Parsed but unused — reserved for future server mode |
| `--auth` | — | `none` | Only `none` is accepted — `token` / `oauth` refuse to start |
| `--tls` | — | — | Refuses to start — TLS is not implemented |
| `--dev` | `NODE_ENV` | dev unless `NODE_ENV=production` | HMR + console streaming |

> ⚠️ **Clidable is localhost-only by default.** A non-loopback `--bind` (`0.0.0.0`, `::`, a LAN IP, a hostname) refuses to start (``refusing to start: Clidable is localhost-only by default — `--bind …` would expose unauthenticated remote code execution (PTY spawn) to the network``) unless you explicitly opt in with **`--allow-lan`** (or `CLIDABLE_ALLOW_LAN=1`). That opt-in is the informed "I control this network" escape hatch — and it starts a server with **no authentication**, so anyone who can reach the address can spawn terminals on the host. Only do it behind a firewall/VPN you trust. `--auth token|oauth` and `--tls` still refuse to start unconditionally (`refusing to start: --auth / --tls are not implemented yet`) — request-time auth and TLS don't exist, and `--allow-lan` adds neither, so silently accepting those flags would be false assurance. Never expose Clidable directly to the internet without a tunnel or an authenticating reverse proxy — see [Remote & VPS Setup](./remote-vps.md).

Full details in the [Configuration Reference](./configuration.md).
