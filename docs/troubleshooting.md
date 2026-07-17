# Troubleshooting & FAQ

## Starting up

**`bun: command not found`**
Install Bun (`curl -fsSL https://bun.sh/install | bash`) and restart your shell. Clidable needs Bun ≥ 1.3.13.

**The server refuses to start: "refusing to start: Clidable is localhost-only by default — `--bind 0.0.0.0` would expose unauthenticated remote code execution (PTY spawn) to the network…"**
Working as intended — *any* non-loopback `--bind`/`CLIDABLE_BIND` (a LAN IP, `0.0.0.0`, `::`, a hostname) is refused by default, because it would let anyone who can reach the port spawn terminals on your machine. Bind a loopback address (`127.0.0.1` is the default); see [Remote & VPS Setup](./remote-vps.md) for safe remote access. If you control the network and accept the risk, `--allow-lan` (or `CLIDABLE_ALLOW_LAN=1`) is the intended way to opt in and bind a non-loopback address — the server then starts unauthenticated and prints a loud network-exposed warning.

**The server refuses to start: "refusing to start: Clidable has no built-in auth/TLS by design…"**
Also as intended — Clidable has no request-time auth or TLS by design (that's your access layer's job), so the server refuses those flags rather than silently ignore them. Remove `--auth`/`--tls`, keep the loopback bind, and use the access layers in [Remote & VPS Setup](./remote-vps.md) for remote use.

**Port 7878 is already in use**
Run on another port: `bun run dev` reads `CLIDABLE_PORT`, or pass `--port`:
`CLIDABLE_PORT=8900 bun run dev` · `./dist/clidable-server --port 8900`

**Startup error mentioning the npm `bun` package / postinstall**
If `bun install` warned about blocked postinstall scripts, run `bun pm trust --all` (the repo's `trustedDependencies` should normally handle this).

## Agents

**An agent is dimmed on the welcome screen**
Its binary isn't on the server's PATH. Hover the icon for the install command (e.g. `npm i -g @anthropic-ai/claude-code`). If you installed it but it's still dimmed, the *server process* can't see it — restart Clidable from a shell where `which claude` works. For systemd, set the `PATH` in the unit file (see the [VPS guide](./remote-vps.md#step-3--keep-it-running-systemd)).

**The agent starts but asks me to log in**
Expected — agents own their auth. Complete the login once inside the Clidable terminal (it's a real terminal; the flow works), or run the agent once in any terminal on the same machine/user.

**My message arrived as several separate submissions**
Use the composer rather than pasting multi-line text directly into the terminal — the composer wraps your message in a bracketed paste so the TUI treats it as one block.

## Terminals

**The UI loads but terminals are blank (especially behind a reverse proxy)**
Terminals are WebSockets. Your proxy must forward upgrade headers (`Upgrade`/`Connection`) and allow long-lived connections — config snippets in the [VPS guide](./remote-vps.md#option-c--reverse-proxy-with-real-auth-public-url).

**The UI loads but every API call fails with 403 "cross-site request refused" (behind a reverse proxy)**
Your proxy is forwarding the public hostname as the `Host` header. Clidable refuses non-loopback `Host` values on `/api` (a DNS-rebinding defense), so the proxy must send a loopback `Host` upstream — nginx: `proxy_set_header Host $proxy_host;` (or delete your `proxy_set_header Host` line; the default is already right); Caddy: `header_up Host {upstream_hostport}` inside the `reverse_proxy` block.

**I refreshed and my terminal history is short**
Reconnects replay the last 256 KB per session — older scrollback isn't kept. The agent process itself was unaffected.

**My session disappeared after I left for a while**
Sessions with no connected client for over 10 minutes are cleaned up. Keep a tab attached (even backgrounded) for long-running work.

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

**Preview is blank for an external website**
Most public sites send `X-Frame-Options`/CSP that forbids embedding — Clidable shows a warning when it suspects this. Use the open-externally button instead.

**"Preview suspended"**
Intentional: previews invisible for ~30 s are torn down to free memory. Click Reload.

**Preview works on the server's own browser but not from my phone**
The phone can't reach `localhost` *on the server* directly. Clidable normally rewrites such URLs through its `/proxy/<port>/…` tunnel automatically — make sure the URL in the address bar is a localhost/127.0.0.1 one (not the server's LAN IP).

**The Run dot does nothing for my project**
Managed dev servers cover Vite/SvelteKit/Astro/Next/Nuxt/Remix/Hono/Node projects with a `dev` script, and the host needs Bun (it runs `bun run dev`). Anything else: start the server in a terminal; detection takes over.

## Building & desktop

**`bun run build` broke my checkout (`web/index.html` modified)**
Fixed — the build now goes through `scripts/build.ts`, which keeps all output inside `dist/` and *fails the build* if any source HTML changes. If you see this on an old checkout, restore with `git checkout web/index.html` and update.

**`bun dist/index.js` fails with "Bundled file … not found"**
Run the bundle from inside the output directory: `cd dist && bun index.js`. Or use the compiled binary, which runs from anywhere.

**`bun run tauri:dev` fails to compile**
You need the Rust toolchain (`rustup`) plus platform prerequisites (Xcode CLT / WebView2 / webkit2gtk). Note the installable desktop bundle isn't self-contained yet — use `tauri:dev`, or the browser.

**No thumbnails on my checkpoints**
Screenshots require the desktop (Tauri) shell with the preview pane visible at send time. In browsers, checkpoints work but without thumbnails.

## AI Team

**`clidable: command not found` (outside a Clidable terminal)**
The shim lives at `<data>/bin/clidable` (see [Configuration](./configuration.md#data-cache-and-log-locations)); add that to your PATH, or use `bun server/index.ts <cmd>` / the compiled binary. Inside Clidable-spawned terminals it's always available.

**`Cannot reach the Clidable server on port 7878`**
`team delegate/status/result/cancel` need the server running. Start Clidable; if it's on a custom port, set `CLIDABLE_PORT` to match.

**My lead agent doesn't use the roles**
Run a **Sync** (Team panel or `clidable team sync`) so enabled roles are installed as skills, then start a *new* agent session — agents pick up skills at startup. You can always be explicit: "delegate this to the reviewer."

**Background jobs vanished**
Jobs live in server memory; a server restart clears them.

## Where do I look when something's wrong?

1. **The server terminal** — errors, the data/cache/log paths, and (in dev mode) the browser console stream all land there.
2. `curl http://127.0.0.1:7878/api/health` — is the server even up?
3. The data directory (printed at startup) — database and shadow repos live there.

Still stuck? Open an issue: https://github.com/openclide/clidable/issues
