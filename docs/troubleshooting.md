# Troubleshooting & FAQ

## Starting up

**`clidable: command not found` right after installing**
The install script puts it in `~/.local/bin` — make sure that's on your PATH (`export PATH="$HOME/.local/bin:$PATH"`). Homebrew and npm installs land wherever those tools normally put binaries; `hash -r` (or a new shell) refreshes the lookup.

**The server refuses to start: "refusing to start: Clidable is localhost-only by default — `--bind 0.0.0.0` would expose unauthenticated remote code execution (PTY spawn) to the network…"**
Working as intended — *any* non-loopback `--bind`/`CLIDABLE_BIND` (a LAN IP, `0.0.0.0`, `::`, a hostname) is refused by default, because it would let anyone who can reach the port spawn terminals on your machine. Bind a loopback address (`127.0.0.1` is the default); see [Remote & VPS Setup](./remote-vps.md) for safe remote access. If you control the network and accept the risk, `--allow-lan` (or `CLIDABLE_ALLOW_LAN=1`) is the intended way to opt in and bind a non-loopback address — the server then starts unauthenticated and prints a loud network-exposed warning.

**The server refuses to start: "refusing to start: Clidable has no built-in auth/TLS by design…"**
Also as intended — Clidable has no request-time auth or TLS by design (that's your access layer's job), so the server refuses those flags rather than silently ignore them. Remove `--auth`/`--tls`, keep the loopback bind, and use the access layers in [Remote & VPS Setup](./remote-vps.md) for remote use.

**Port 7878 is already in use**
Run on another port: `clidable --port 8900` (or `CLIDABLE_PORT=8900`). Check whether the thing on 7878 is an old Clidable: `clidable stop` shuts down a background server cleanly.

**`clidable stop` says the server belongs to the desktop app**
Intentional. The app's windows can't outlive their server, so `stop` refuses to strand them. Quit the app from its menu-bar tray instead — or `clidable stop --force` if you really mean it.

**`bun: command not found`**
Only matters if you run from source, use the new-project templates (scaffolding runs `bun create …`), or click the preview's Run button on a project with no lockfile (Bun is the assumed package manager then). Install Bun ≥ 1.3.14: `curl -fsSL https://bun.sh/install | bash` (Windows: `powershell -c "irm bun.sh/install.ps1 | iex"`), then restart your shell. The desktop app and the installed `clidable` binary run without Bun.

## Agents

**An agent is dimmed on the welcome screen**
Its binary isn't on the server's PATH. Hover the icon for a link to that agent's install docs (also listed in the [supported-agents table](./configuration.md#supported-agents)). If you installed it but it's still dimmed, the *server process* can't see it — restart Clidable from a shell where `which claude` works. For systemd, set the `PATH` in the unit file (see the [VPS guide](./remote-vps.md#step-3--keep-it-running-systemd)).

**The agent starts but asks me to log in**
Expected — agents own their auth. Complete the login once inside the Clidable terminal (it's a real terminal; the flow works), or run the agent once in any terminal on the same machine/user.

**My message arrived as several separate submissions**
Use the composer rather than pasting multi-line text directly into the terminal — the composer wraps your message in a bracketed paste so the TUI treats it as one block.

## Sessions & terminals

**The UI loads but terminals are blank (especially behind a reverse proxy)**
Terminals are WebSockets. Your proxy must forward upgrade headers (`Upgrade`/`Connection`) and allow long-lived connections — config snippets in the [VPS guide](./remote-vps.md#option-d--reverse-proxy-with-real-auth-public-url). (Cloudflare Tunnel proxies WebSockets by default.)

**The UI loads but every API call fails with 403 "cross-site request refused" (behind a proxy or tunnel)**
Your proxy is forwarding the public hostname as the `Host` header. Clidable refuses non-loopback `Host` values on `/api` (a DNS-rebinding defense), so the proxy must send a loopback `Host` upstream — nginx: `proxy_set_header Host $proxy_host;` (or delete your `proxy_set_header Host` line; the default is already right); Caddy: `header_up Host {upstream_hostport}` inside the `reverse_proxy` block; Cloudflare Tunnel: `originRequest.httpHostHeader: 127.0.0.1:7878` (config file) or *HTTP Host Header* under the public hostname's settings (dashboard). This is also why bare `tailscale serve` doesn't work — it can't rewrite the Host header.

**I refreshed and my terminal history is short**
Reconnects replay the last 256 KB per session — older scrollback isn't kept. The agent process itself was unaffected.

**My session was "parked" / the terminal restarted after I left**
A session with **no client attached at all** for over 10 minutes is parked: its process stops, but the session stays in your workspace. Reopening it relaunches the agent with its own resume feature, continuing the same conversation (Claude Code, Codex, Antigravity; best-effort for Cursor, Copilot, OpenCode, Kimi — not Qwen, and plain shells restart fresh). To keep a session hot instead, keep any tab attached — backgrounded or minimized counts.

**I restarted the server (or rebooted) — is everything gone?**
No. Workspaces, projects, and checkpoints are on disk; reopen a workspace and each agent terminal resumes its conversation via the agent's own resume (same support matrix as above). Terminal scrollback starts fresh — the resumed agent redraws its own screen — and dev servers Clidable started need one click to restart.

## Checkpoints

**"Checkpointed" never appears / checkpoint errors**
Checkpoints need `git` on the server's PATH. Also check the server log for the underlying error.

**I restored a checkpoint but the agent seems confused**
Restore rewinds files, not the agent's conversation memory. Tell it: "I restored the project to the state before my last message."

**Restored, but `git status` in my repo shows changes**
Normal — checkpoints rewind the *files*; your own git history is untouched. The diff you see is your real HEAD vs. the restored tree.

**Do checkpoints bloat my repo?**
No — they live in a shadow repo in Clidable's data directory, not in your project. They respect `.gitignore` and skip `node_modules`-style folders. Retention is currently unlimited; you can delete `<data>/projects/<uuid>/checkpoints.git` to reclaim space (loses that project's rewind history only).

## Preview

**Blank preview / "Nothing listening on :3000"**
The dev server isn't up (or is on another port). Use the Run dot for supported frameworks, or start it in the terminal and pick it from the **Detected** list in the ports menu (▾).

**The Run dot fails or does nothing for my project**
The managed dev server covers Vite / SvelteKit / Astro / Expo / Next / Nuxt / Remix / Hono / Node projects with a matching `package.json` script, run with your project's own package manager (no lockfile → Bun, which then needs to be installed). When a start fails you get a banner saying why, with a shortcut to **Configure dev server…** — set the exact command, port, or preview URL there (saved to `.clidable/launch.json`, see [Configuration](./configuration.md#per-project-dev-server-config-clidablelaunchjson)). Anything else (Python, Rust, Go, …): configure a command, or start the server in a terminal and detection takes over.

**Preview is blank for an external website**
Most public sites send `X-Frame-Options`/CSP that forbids embedding — Clidable shows a warning when it suspects this. Use the open-externally button instead.

**"Preview suspended"**
Intentional: previews invisible for ~30 s are torn down to free memory. Click Reload.

**Preview works on the server's own browser but not from my phone**
The phone can't reach `localhost` *on the server* directly. Clidable normally rewrites such URLs through its `/proxy/<port>/…` tunnel automatically — make sure the URL in the address bar is a localhost/127.0.0.1 one (not the server's LAN IP). Alternatively, set a directly reachable **Preview URL** in *Configure dev server…* (e.g. a Tailscale hostname).

## Desktop app

**macOS won't open the app: "Apple could not verify Clidable is free of malware"**
The desktop bundles aren't code-signed yet. Open **System Settings → Privacy & Security**, scroll to the blocked-app notice, and click **Open Anyway** — the right-click → Open override was removed in macOS 15. Or clear the quarantine flag directly: `xattr -cr /Applications/Clidable.app`. This affects the Homebrew cask as well, since Homebrew quarantines casks by default. Signing is on the roadmap; the `clidable` CLI is unaffected.

**Windows SmartScreen says "Windows protected your PC"**
Same cause — the installer isn't signed yet. Click **More info → Run anyway**.

**I closed the window and the app is "gone" but agents are still running**
By design — closing the window hides it; the server and your agents keep going. Reopen from the menu-bar tray (**Show Clidable**) or the Dock. **Quit Clidable** in the tray is the real off-switch.

**No thumbnails on my checkpoints**
Screenshots require the desktop app with the preview pane visible at send time. In browsers, checkpoints work but without thumbnails.

**`bun run tauri:dev` fails to compile** *(source builds only)*
You need the Rust toolchain (`rustup`) plus platform prerequisites (Xcode CLT / WebView2 / webkit2gtk). None of this applies to the released app — the installers are self-contained.

## Building from source

**`bun run build` broke my checkout (`web/index.html` modified)**
Fixed — the build now goes through `scripts/build.ts`, which keeps all output inside `dist/` and *fails the build* if any source HTML changes. If you see this on an old checkout, restore with `git checkout web/index.html` and update.

**`bun dist/index.js` fails with "Bundled file … not found"**
Run the bundle from inside the output directory: `cd dist && bun index.js`. Or use the compiled binary, which runs from anywhere.

**Startup error mentioning the npm `bun` package / postinstall**
If `bun install` warned about blocked postinstall scripts, run `bun pm trust --all` (the repo's `trustedDependencies` should normally handle this).

## AI Team

**`clidable: command not found` (outside a Clidable terminal)**
Install the CLI (Homebrew / npm / install script — [Getting Started](./getting-started.md#1-install-clidable)). Inside Clidable-spawned terminals it's always available; there's also a shim at `<data>/bin/clidable` (see [Configuration](./configuration.md#data-cache-and-log-locations)).

**`Cannot reach the Clidable server on port 7878`**
`team delegate/status/result/cancel` need the server running. Start Clidable; if it's on a custom port, set `CLIDABLE_PORT` to match.

**My lead agent doesn't use the roles**
Run a **Sync** (Team panel or `clidable team sync`) so enabled roles are installed as skills, then start a *new* agent session — agents pick up skills at startup. You can always be explicit: "delegate this to the reviewer."

**Background jobs vanished**
Jobs live in server memory; a server restart clears them.

## Where do I look when something's wrong?

1. **The server log** — errors and the data/cache/log paths land there (the terminal you ran `clidable` in; for the desktop app, the app's log directory; for systemd, `journalctl -u clidable`).
2. `curl http://127.0.0.1:7878/api/health` — is the server even up?
3. The data directory (printed at startup) — database and shadow repos live there.

Still stuck? Open an issue: https://github.com/openclide/clidable/issues
