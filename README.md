<div align="center">

![Clidable — CLI coding agents for everyone](.github/social-preview.png)

# Clidable

**CLI coding agents for everyone** — real terminals for Claude Code, Codex,
Antigravity and friends, with rewindable checkpoints, live preview, one-click
MCP/skills/plugins, and AI teams.

[![CI](https://github.com/openclide/clidable/actions/workflows/ci.yml/badge.svg)](https://github.com/openclide/clidable/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/openclide/clidable?sort=semver)](https://github.com/openclide/clidable/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Made with Bun](https://img.shields.io/badge/Bun-1.3-black?logo=bun)](https://bun.sh)

[Documentation](docs/README.md) · [Getting Started](docs/getting-started.md) · [Remote & VPS](docs/remote-vps.md) · [Releases](https://github.com/openclide/clidable/releases)

</div>

---

Coding agents are brilliant on the command line and painful to live in.
Clidable keeps each agent's **real terminal (TUI over a PTY)** and wraps it in a
workspace built for actually shipping: snapshot-before-every-message checkpoints
you can rewind in a click, a live preview of your app beside the terminal, and
one place to manage MCP servers, skills, and plugins across every agent. One Bun
process, one port — on your desktop, in the browser, or from your phone.

## Install

**Homebrew (macOS / Linux):**

```sh
brew install openclide/tap/clidable-server
clidable-server            # → http://127.0.0.1:7878
```

**Or the install script** — detects your OS/arch, verifies the download against
the release checksums, installs to `~/.local/bin`:

```sh
curl -fsSL https://raw.githubusercontent.com/openclide/clidable/main/install.sh | bash
```

Binaries for every platform (incl. Windows) are on the
[Releases page](https://github.com/openclide/clidable/releases).

**From source** — needs [Bun](https://bun.sh) ≥ 1.3.13:

```sh
git clone https://github.com/openclide/clidable
cd clidable && bun install && bun run dev
```

> **Localhost-only by design.** Clidable spawns terminals, so exposing it to a
> network is remote code execution — the server refuses any non-loopback bind.
> For remote access, use a tunnel or authenticating proxy — see
> [Remote & VPS Setup](docs/remote-vps.md).

## What's inside

- **Agents in real terminals** — Claude Code, Codex, Antigravity, Kimi,
  OpenCode, GitHub Copilot and more, each in its true TUI over a PTY. Never
  headless, never a JSON stream.
- **Checkpoints you can rewind** — a snapshot before every message in a private
  shadow-git repo; rewind the whole project in one click. Your real `.git` is
  never touched.
- **Live preview** — Clidable catches your dev-server URL the moment it boots and
  renders your app beside the terminal, across desktop/tablet/phone viewports.
- **MCP, skills & plugins** — install once and Clidable projects it into every
  agent that can use it, with a shared `AGENTS.md` kept in sync.
- **AI teams** — let a lead agent delegate to specialist roles.
- **Everywhere** — native desktop (a ~50-LOC Tauri shell with OS window
  vibrancy), any browser, or an installable PWA on mobile.

## Stack

- **Bun** — runtime, server (`Bun.serve` with HTML imports), bundler, PTY, SQLite (`bun:sqlite`)
- **React 19** + **Tailwind v4** — frontend, served and bundled by Bun (no Vite)
- **Tauri 2** — thin desktop shell with OS-level window vibrancy
- **TypeScript 6** — both sides

## Develop

```sh
bun install
bun run dev              # Bun server + frontend at http://127.0.0.1:7878 (HMR)
bun run tauri:dev        # native window via Tauri (requires Rust toolchain)

bun run typecheck        # tsc --noEmit across the tree
bun run test             # unit tests (server + shared + web)
bun run build            # production bundle → dist/ (self-verifying)
bun run build:compile    # single-file binary → dist/clidable-server
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow and
[CLAUDE.md](CLAUDE.md) for the architecture decisions and hard-won gotchas.

## Project status

Pre-1.0, core experience working: terminals + composer, checkpoints, code
editor + diffs, projects + preview, skills/MCP/plugins/instructions managers,
AI-team delegation. On the roadmap: checkpoint retention, signed desktop
bundles, server-mode auth, mobile/PWA polish. See [PLAN.md](PLAN.md).

## License

[Apache-2.0](LICENSE) © 2026 — free to run, read, fork, and ship.
