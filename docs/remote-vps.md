# Remote & VPS Setup

Run Clidable on a server — a VPS, a home server, your office workstation — and use it from a browser or phone anywhere. This is the model for "code from my iPad", "drive Claude on the big machine", and team-of-one remote dev.

Everything (projects, agents, terminals, checkpoints) lives on the **server**. Your browser is just the screen and keyboard.

## Security model — read this first

> ⚠️ **Clidable has no working authentication yet, and anyone who can reach it can spawn a terminal on your server.** That is, by design, remote code execution for whoever connects.
>
> Concretely, in the current version:
> - The server is **localhost-only**. It refuses to start on any non-loopback `--bind` — a LAN IP, `0.0.0.0`, even a Tailscale address — with: `refusing to start: Clidable is localhost-only — --bind … would expose unauthenticated remote code execution (PTY spawn) to the network`.
> - `--auth` (any value other than `none`) and `--tls` are also **refused at startup** — `refusing to start: --auth / --tls are not implemented yet` — because request-time auth and TLS don't exist yet. `--token` / `CLIDABLE_TOKEN` is parsed but currently unused.
> - A same-site gate shields `/api` and `/proxy` from *browsers*: any request whose `Host` header isn't loopback, or that the browser marks cross-site, gets a 403 `cross-site request refused` (anti drive-by-RCE / CSRF / DNS-rebinding). Non-browser clients (curl, the CLI) pass — this is **not** authentication.
>
> **Therefore: anything that can reach port 7878 can spawn terminals.** Clidable stays on `127.0.0.1` (the default, and the only bind it will accept); put one of the access layers below in front of it. All three are battle-tested patterns; pick the one that matches your comfort level.

## Step 1 — Install on the server

On a fresh Ubuntu/Debian VPS (adapt for your distro):

```bash
# Essentials
sudo apt update && sudo apt install -y git curl unzip

# Bun
curl -fsSL https://bun.sh/install | bash
exec $SHELL   # reload PATH

# Node (for the agent CLIs, which install via npm)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs

# The agents you use — log into each one once
npm i -g @anthropic-ai/claude-code   # then run `claude` and authenticate
npm i -g @openai/codex               # then run `codex` and authenticate

# Clidable
git clone https://github.com/openclide/clidable.git
cd clidable
bun install
```

Then either run from source:

```bash
bun run dev               # quick start
```

or build the self-contained binary (recommended for a long-lived server):

```bash
bun run build:compile
./dist/clidable-server    # listens on 127.0.0.1:7878
```

> Build the binary **on the server** (or an identical OS/arch) — compiled Bun binaries are platform-specific.

Run it as the user whose home directory holds the agent logins (`~/.claude`, `~/.codex`, …) and your projects. Don't run it as root.

## Step 2 — Pick an access layer

### Option A — SSH tunnel (zero setup, per-session)

If you can SSH to the server, you already have secure access:

```bash
# On your laptop:
ssh -N -L 7878:127.0.0.1:7878 you@your-server
```

Now open **http://127.0.0.1:7878** on your laptop — the tunnel forwards it to the server. Clidable itself stays loopback-only.

Great for: occasional use, trying it out. Less great for: phones (mobile SSH clients can do it — e.g. Termius port forwarding — but it's fiddly).

### Option B — Tailscale / WireGuard (recommended)

Put the server and your devices on a private mesh network:

```bash
# On the server
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Install Tailscale on your laptop/phone. Clidable itself stays on `127.0.0.1` — the server refuses to bind the Tailscale IP (or anything else non-loopback) — so you reach it *over* the tailnet rather than binding *to* it. Two ways:

**SSH tunnel over the tailnet** (works today, no caveats):

```bash
# On your laptop — the MagicDNS name or the server's 100.x.y.z address:
ssh -N -L 7878:127.0.0.1:7878 you@myserver
```

Then open **http://127.0.0.1:7878** — same as Option A, but SSH rides the tailnet, so it works from anywhere with port 22 closed to the internet. Tailscale's own auth and WireGuard encryption are the security boundary.

**`tailscale serve`** (`sudo tailscale serve --bg 7878`) proxies tailnet HTTPS traffic to your loopback port without exposing anything else — but note the Host-header caveat: `tailscale serve` forwards the original tailnet `Host` (e.g. `myserver.your-tailnet.ts.net`) to the upstream, with no option to rewrite it. Clidable's same-site gate requires a loopback `Host`, so the UI shell loads but every API request and terminal 403s with `cross-site request refused`. For now, use the SSH tunnel above — or put a Host-rewriting reverse proxy (Option C's config, minus the public exposure) between `tailscale serve` and Clidable.

Great for: daily use from anywhere, phones (Tailscale's mobile apps are excellent), zero open ports on the internet.

### Option C — Reverse proxy with real auth (public URL)

If you genuinely need a public `https://clidable.example.com`, terminate TLS and enforce authentication in a reverse proxy. Clidable stays on `127.0.0.1`; the proxy is the wall.

**Caddy** (automatic HTTPS, simplest config) with basic auth:

```caddyfile
clidable.example.com {
    basic_auth {
        # caddy hash-password to generate
        you JDJhJDE0JE...hashed...
    }
    reverse_proxy 127.0.0.1:7878 {
        # Clidable only accepts a loopback Host (DNS-rebinding defense) —
        # without this rewrite, every API request 403s:
        header_up Host {upstream_hostport}
    }
}
```

**nginx** equivalent:

```nginx
server {
    listen 443 ssl;
    server_name clidable.example.com;
    # ssl_certificate ...; ssl_certificate_key ...;

    auth_basic "Clidable";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:7878;
        # WebSockets (terminals!) need upgrade headers:
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # Loopback Host — Clidable 403s a public Host header (see Notes).
        # ($proxy_host is nginx's default; never use $host here.)
        proxy_set_header Host $proxy_host;
        proxy_read_timeout 1d;   # terminals are long-lived connections
    }
}
```

Notes:

- **WebSocket upgrade headers are mandatory** — terminals, file watching, and the preview proxy are all WebSockets. If the UI loads but terminals stay blank, this is the first thing to check.
- **UI loads but every request 403s with `cross-site request refused`?** Your proxy is forwarding the public `Host` header upstream. Clidable only accepts a loopback `Host` (DNS-rebinding defense) — rewrite it as in the configs above (`header_up Host {upstream_hostport}` in Caddy, `proxy_set_header Host $proxy_host;` in nginx).
- Long `proxy_read_timeout` (nginx) keeps idle terminal connections alive.
- Basic auth in front of a terminal-spawning app is the *minimum*. For anything serious, prefer an identity-aware proxy (Cloudflare Access, Tailscale Funnel + ACLs, oauth2-proxy, Authelia).
- Remember the whole machine is what you're exposing: an authenticated user can run arbitrary commands as the Clidable user.

## Step 3 — Keep it running (systemd)

Create `/etc/systemd/system/clidable.service`:

```ini
[Unit]
Description=Clidable — GUI for CLI coding agents
After=network.target

[Service]
Type=simple
User=you
WorkingDirectory=/home/you
ExecStart=/home/you/clidable/dist/clidable-server --port 7878 --bind 127.0.0.1
Restart=on-failure
Environment=NODE_ENV=production
# Agents and tooling need a sane PATH (bun, node, npm globals, git):
Environment=PATH=/home/you/.bun/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now clidable
systemctl status clidable          # should be active (running)
curl http://127.0.0.1:7878/api/health
```

If you run from source instead of the binary, use:

```ini
ExecStart=/home/you/.bun/bin/bun run dev
WorkingDirectory=/home/you/clidable
```

## Using it remotely: what to expect

- **Everything is server-side.** "Open a folder" browses the *server's* filesystem; new projects are created on the server; agents read the server's `~/.claude` etc.
- **The preview pane works remotely.** When your project's dev server runs on the VPS (`localhost:3000` *on the VPS*), your browser can't reach it directly — so Clidable tunnels it through its own port at `/proxy/3000/…` automatically. Note the flip side: on the (always-loopback) bind, `/proxy/<port>` forwards to *any* loopback port on the server — whoever gets past your access layer can reach other localhost-only services through it. One more reason the access layer, not Clidable, is the security boundary.
- **Disconnects are fine.** Terminal sessions live on the server; your phone sleeping or the train tunnel doesn't kill the agent. Reconnect and the terminal replays its recent output. Sessions with no client attached for over 10 minutes are cleaned up.
- **Phones get the mobile layout** — CLI / Preview / Code views via the bottom bar, composer-first input. See the [Workspace Guide](./workspace-guide.md#mobile).

## VPS checklist

- [ ] Bun, git, Node installed; agent CLIs installed **and logged in** as the service user
- [ ] `clidable-server` binary built on the server (`bun run build:compile`)
- [ ] Service bound to `127.0.0.1` (the default — the server refuses any other bind)
- [ ] Access via SSH tunnel / Tailscale / authenticated reverse proxy
- [ ] WebSocket upgrade headers **and loopback `Host` rewrite** configured if proxying
- [ ] systemd unit enabled
- [ ] Firewall (`ufw`/security groups): only 22 (SSH) and, if proxying, 80/443 open — port 7878 closed to the world
