# Remote & VPS Setup

Run Clidable on a server — a VPS, a home server, your office workstation — and use it from a browser or phone anywhere. This is the model for "code from my iPad", "drive Claude on the big machine", and team-of-one remote dev.

Everything (projects, agents, terminals, checkpoints) lives on the **server**. Your browser is just the screen and keyboard.

## Security model — read this first

> ⚠️ **Clidable has no built-in authentication by design, and anyone who can reach it can spawn a terminal on your server.** That is, by design, remote code execution for whoever connects — authenticating access is *your* job (an access layer below).
>
> Concretely:
> - The server is **localhost-only by default**. It refuses to start on any non-loopback `--bind` — a LAN IP, `0.0.0.0`, even a Tailscale address — with: `refusing to start: Clidable is localhost-only by default — --bind … would expose unauthenticated remote code execution (PTY spawn) to the network`. You *can* override this with `--allow-lan` (or `CLIDABLE_ALLOW_LAN=1`) if you accept the risk on a network you control — but that binds an **unauthenticated** server directly to the network and only makes sense behind a firewall/VPN. The access layers below are the recommended path and keep the bind on loopback.
> - `--auth` (any value other than `none`) and `--tls` are **refused at startup** — `refusing to start: Clidable has no built-in auth/TLS by design …` — because Clidable has no request-time auth or TLS by design (that's the access layer's job). `--allow-lan` does **not** add authentication; it only lifts the bind restriction.
> - A same-site gate shields `/api` and `/proxy` from *browsers* (even on an `--allow-lan` bind): any request the browser marks cross-site — or, on a loopback bind, whose `Host` header isn't loopback — gets a 403 `cross-site request refused` (anti drive-by-RCE / CSRF / DNS-rebinding). Same-origin and non-browser clients (curl, the CLI) pass — this is **not** authentication.
>
> **Therefore: anything that can reach port 7878 can spawn terminals.** The safe default keeps Clidable on `127.0.0.1`; put one of the access layers below in front of it. All four are battle-tested patterns; pick the one that matches your comfort level.

## Step 1 — Install on the server

On a fresh Ubuntu/Debian VPS, start with the essentials (`unzip` is only
needed if you install Bun later for the project templates):

```bash
sudo apt update && sudo apt install -y git curl unzip
```

Install the `clidable` binary — no Bun or Node needed to *run* it:

```bash
# Install script (verifies checksums, installs to ~/.local/bin —
# CLIDABLE_INSTALL=/path overrides the dir, CLIDABLE_VERSION=vX.Y.Z pins a release):
curl -fsSL https://raw.githubusercontent.com/openclide/clidable/main/install.sh | bash

# …or Homebrew (macOS / Linux):
brew install openclide/tap/clidable

# …or npm (needs Node — installed with the agents below):
npm i -g clidable
```

Then Node and the agents:

```bash
# Node (for the agent CLIs, which install via npm)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs

# The agents you use — log into each one once
npm i -g @anthropic-ai/claude-code   # then run `claude` and authenticate
npm i -g @openai/codex               # then run `codex` and authenticate
```

Try it:

```bash
clidable            # listens on 127.0.0.1:7878, as always
```

Run it as the user whose home directory holds the agent logins (`~/.claude`, `~/.codex`, …) and your projects. Don't run it as root.

> Optional: install [Bun](https://bun.sh) too if you want the new-project templates to work on the server (scaffolding runs `bun create …`). Prefer building from source instead of the released binary? See [Running Clidable](./running-clidable.md#option-3--from-source).

## Step 2 — Pick an access layer

### Option A — SSH tunnel (zero setup, per-session)

If you can SSH to the server, you already have secure access:

```bash
# On your laptop:
ssh -N -L 7878:127.0.0.1:7878 you@your-server
```

Now open **http://127.0.0.1:7878** on your laptop — the tunnel forwards it to the server. Clidable itself stays loopback-only.

Great for: occasional use, trying it out. Less great for: phones (mobile SSH clients can do it — e.g. Termius port forwarding — but it's fiddly).

### Option B — Tailscale (recommended)

Put the server and your devices on a private mesh network — zero ports open to the internet, and Tailscale's authentication + WireGuard encryption are the security boundary:

```bash
# On the server
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Install Tailscale on your laptop/phone and log into the same tailnet. Keep Clidable on `127.0.0.1` (the default) and reach it *over* the tailnet rather than binding *to* it — that way the encryption and access control live in Tailscale, not in an unauthenticated open port:

```bash
# On your laptop — the MagicDNS name or the server's 100.x.y.z address:
ssh -N -L 7878:127.0.0.1:7878 you@myserver
```

Then open **http://127.0.0.1:7878** — same as Option A, but SSH rides the tailnet, so it works from anywhere with port 22 closed to the internet. On a phone, an SSH client that forwards ports (e.g. Termius) does the same job.

**About `tailscale serve`** (`sudo tailscale serve --bg 7878`): it proxies tailnet HTTPS traffic to your loopback port without exposing anything else — but note the Host-header caveat: `tailscale serve` forwards the original tailnet `Host` (e.g. `myserver.your-tailnet.ts.net`) to the upstream, with no option to rewrite it. Clidable's same-site gate requires a loopback `Host`, so the UI shell loads but every API request and terminal 403s with `cross-site request refused`. Use the SSH tunnel above — or put a Host-rewriting reverse proxy (Option D's config, minus the public exposure) between `tailscale serve` and Clidable.

Great for: daily use from anywhere, phones (Tailscale's mobile apps are excellent), zero open ports on the internet.

### Option C — Cloudflare Tunnel + Access (public URL, no open ports)

`cloudflared` makes an **outbound-only** connection from your server to Cloudflare — no inbound ports, TLS handled for you — and **Cloudflare Access** puts real authentication (SSO, email OTP) in front of the hostname. You need a domain on Cloudflare.

> ⚠️ **The tunnel alone is not security.** Without an Access policy, `https://clidable.example.com` is a public, unauthenticated door to a terminal spawner. Create the Access application **before** you share the URL — and never use quick tunnels (`trycloudflare.com`) for Clidable; they can't be protected by Access at all.

**1. Install `cloudflared` on the server and create the tunnel:**

```bash
# Debian/Ubuntu (arm64 VPS: swap in cloudflared-linux-arm64.deb):
curl -fsSL -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
# (macOS: brew install cloudflared)

cloudflared tunnel login
cloudflared tunnel create clidable      # note the tunnel UUID it prints
cloudflared tunnel route dns clidable clidable.example.com
```

**2. Configure it** — `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL-ID>          # the UUID `tunnel create` printed — not the name
credentials-file: /home/you/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: clidable.example.com
    service: http://127.0.0.1:7878
    originRequest:
      # Clidable only accepts a loopback Host header (DNS-rebinding
      # defense) — without this rewrite, every API request 403s with
      # "cross-site request refused":
      httpHostHeader: 127.0.0.1:7878
  - service: http_status:404
```

WebSockets (terminals) are proxied by default — nothing extra to configure.

**3. Lock it behind Cloudflare Access** (Zero Trust dashboard → **Access → Applications → Add an application → Self-hosted**): set the application domain to `clidable.example.com` and add an Allow policy matching *you* (your email, or your identity provider). Now every visitor authenticates with Cloudflare before a single byte reaches the tunnel.

**4. Run it, then make it permanent:**

```bash
cloudflared tunnel run clidable      # try it (Ctrl-C once it works)

# Install as a systemd service. sudo resets $HOME, so a bare
# `sudo cloudflared service install` looks in /root/.cloudflared and finds
# nothing — pass your config explicitly:
sudo cloudflared --config /home/you/.cloudflared/config.yml service install
```

> The install **copies** your config to `/etc/cloudflared/config.yml`, and the
> service reads only that copy. To change the ingress later, edit
> `/etc/cloudflared/config.yml` — not the file in your home directory — then
> `sudo systemctl restart cloudflared`.

> Managing the tunnel from the Zero Trust **dashboard** instead of a config file? The Host rewrite lives at *Public Hostname → Additional application settings → HTTP Settings → HTTP Host Header* — set it to `127.0.0.1:7878`.

Great for: a stable HTTPS URL on any device with zero open ports and real SSO auth. Phones just work — it's a normal URL.

### Option D — Reverse proxy with real auth (public URL)

If you'd rather own the front door yourself, terminate TLS and enforce authentication in a reverse proxy. Clidable stays on `127.0.0.1`; the proxy is the wall.

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
    # Clickjacking defense on the app shell. Bun's native HTML bundling can't
    # attach this to the document, so add it at the proxy (Clidable itself
    # ships a frame-buster as a fallback).
    header X-Frame-Options DENY
    header Content-Security-Policy "frame-ancestors 'none'"
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
        # Clickjacking defense on the app shell (Bun can't attach it to the
        # bundled HTML; Clidable also ships a frame-buster as a fallback).
        add_header X-Frame-Options DENY;
        add_header Content-Security-Policy "frame-ancestors 'none'";
    }
}
```

Notes:

- **WebSocket upgrade headers are mandatory** — terminals, file watching, and the preview proxy are all WebSockets. If the UI loads but terminals stay blank, this is the first thing to check.
- **UI loads but every request 403s with `cross-site request refused`?** Your proxy is forwarding the public `Host` header upstream. Clidable only accepts a loopback `Host` (DNS-rebinding defense) — rewrite it as in the configs above (`header_up Host {upstream_hostport}` in Caddy, `proxy_set_header Host $proxy_host;` in nginx, `httpHostHeader` in cloudflared).
- Long `proxy_read_timeout` (nginx) keeps idle terminal connections alive.
- Basic auth in front of a terminal-spawning app is the *minimum*. For anything serious, prefer an identity-aware proxy (Cloudflare Access as in Option C, oauth2-proxy, Authelia).
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
ExecStart=/home/you/.local/bin/clidable --port 7878 --bind 127.0.0.1
Restart=on-failure
Environment=NODE_ENV=production
# Agents and tooling need a sane PATH (node, npm globals, git — plus bun if
# you use the project templates):
Environment=PATH=/home/you/.local/bin:/home/you/.bun/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
```

(Adjust `ExecStart` to your install location — systemd needs the **absolute path**, so paste the output of `which clidable`; `~` and `$(…)` don't work in unit files.)

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now clidable
systemctl status clidable          # should be active (running)
curl http://127.0.0.1:7878/api/health
```

Because sessions are durable, a `systemctl restart clidable` (or a reboot) isn't a disaster: your workspaces come back, and reopening them resumes each agent's conversation — see [what survives](./running-clidable.md#stopping-and-what-survives).

## Using it remotely: what to expect

- **Everything is server-side.** "Open a folder" browses the *server's* filesystem; new projects are created on the server; agents read the server's `~/.claude` etc.
- **The preview pane works remotely.** When your project's dev server runs on the VPS (`localhost:3000` *on the VPS*), your browser can't reach it directly — so Clidable tunnels it through its own port at `/proxy/3000/…` automatically. If you'd rather point the preview at a directly reachable address (say, a dev server you exposed on your tailnet), set the **Preview URL** in *Configure dev server…* (the ▾ ports menu) — it's saved per project, for every device. Note the proxy's flip side: on the (always-loopback) bind, `/proxy/<port>` forwards to *any* loopback port on the server — whoever gets past your access layer can reach other localhost-only services through it. One more reason the access layer, not Clidable, is the security boundary.
- **Disconnects are fine.** Terminal sessions live on the server; your phone sleeping or the train tunnel doesn't kill the agent. Reconnect and the terminal replays its recent output. A session left with no client attached for over 10 minutes is parked — reopening it resumes the agent's conversation ([details](./running-clidable.md#stopping-and-what-survives)).
- **Phones get the mobile layout** — CLI / Preview / Code views via the bottom bar, composer-first input. See the [Workspace Guide](./workspace-guide.md#mobile).

## VPS checklist

- [ ] `clidable` installed (install script / Homebrew / npm); git + Node installed
- [ ] Agent CLIs installed **and logged in** as the service user
- [ ] Service bound to `127.0.0.1` (the default — don't add `--allow-lan` unless you deliberately want a direct unauthenticated bind behind your own firewall)
- [ ] Access via SSH tunnel / Tailscale / Cloudflare Tunnel **with an Access policy** / authenticated reverse proxy
- [ ] WebSocket upgrade headers **and loopback `Host` rewrite** configured if proxying (`httpHostHeader` for cloudflared)
- [ ] systemd unit enabled
- [ ] Firewall (`ufw`/security groups): only 22 (SSH) and, if reverse-proxying, 80/443 open — port 7878 closed to the world (Tailscale/Cloudflare Tunnel need **no** inbound ports at all)
