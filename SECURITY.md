# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for
anything exploitable.

- Use GitHub's [**Report a vulnerability**](https://github.com/openclide/clidable/security/advisories/new)
  (Security → Advisories), which keeps the report private until a fix ships.

We aim to acknowledge reports within a few days and will keep you updated as we
work on a fix. Coordinated disclosure is appreciated.

## Threat model — what Clidable is and isn't

Clidable is a **localhost-first developer tool**. Understanding its trust
boundary helps you deploy it safely and helps us triage reports.

- **It spawns terminals.** The core feature is running coding agents in real
  PTYs. Anyone who can reach the API can spawn a shell — so **network exposure
  is remote code execution by design**. This is why the server is
  **localhost-only**: it refuses to start on any non-loopback `--bind`, and
  refuses `--auth`/`--tls` (request-time auth and TLS are not implemented yet)
  rather than give false assurance.
- **Same-site gate.** Because a loopback bind still doesn't stop a *web page the
  user visits* from reaching `127.0.0.1`, every `/api` route (and the terminal
  WebSocket) is guarded: cross-site browser requests are refused, and a
  non-loopback `Host` header is rejected (DNS-rebind defense). Non-browser
  clients (the CLI, curl) pass. See [`server/net/origin.ts`](server/net/origin.ts).
- **Remote access** is expected to go through a tunnel/VPN or an authenticating
  reverse proxy you control — see [docs/remote-vps.md](docs/remote-vps.md).

### In scope

Bugs that let an attacker cross the intended boundary, e.g.: bypassing the
same-site gate, a cross-site request reaching the API or terminal, SSRF through
the dev-server proxy, path traversal, or a checkpoint/shadow-git operation
escaping its data directory.

### Out of scope

The documented, intended behavior that anyone with local access to the server
can spawn terminals and read/write project files — that is the tool working as
designed, not a vulnerability.

## Supported versions

Clidable is pre-1.0. Security fixes land on `main` and in the next tagged
release; there is no long-term-support branch yet.
