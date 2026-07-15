# Clidable

**CLI coding agents for everyone** — real terminals for Claude Code, Codex, Antigravity and friends, with rewindable checkpoints, live preview, one-click MCP/skills/plugins, and AI teams.

**📚 User documentation: [docs/](./docs/README.md)** — [Getting Started](./docs/getting-started.md) · [Running Clidable](./docs/running-clidable.md) · [Remote & VPS](./docs/remote-vps.md) · [Workspace Guide](./docs/workspace-guide.md) · [CLI Reference](./docs/cli-reference.md)

Browse the docs as a website: `bun run docs:serve` → http://127.0.0.1:8788 (`bun run docs:build` renders the static site to `docs-site/`, deployable to any static host).

See [IDEA.md](./IDEA.md) for the product vision and [PLAN.md](./PLAN.md) for the implementation plan.

## Stack

- **Bun** — runtime, server (`Bun.serve` with HTML imports), bundler, PTY (`Bun.Terminal`), SQLite (`bun:sqlite`)
- **React 19** — frontend, served and bundled by Bun (no Vite)
- **Tailwind v4** — via `bun-plugin-tailwind`
- **Tauri 2** — thin desktop shell with OS-level window vibrancy
- **TypeScript 6** — both sides

## Layout

```
clidable/
├── server/              # Bun backend (serves frontend + API)
│   ├── index.ts         # Bun.serve entry
│   ├── paths.ts         # env-paths layout
│   ├── db.ts            # bun:sqlite + migrations
│   ├── cli.ts           # flag parsing
│   └── routes/
├── web/                 # React frontend
│   ├── index.html       # imported by server/index.ts
│   └── src/
├── shared/              # types shared between server + web
├── src-tauri/           # Tauri 2 desktop shell
└── PLAN.md
```

## Develop

```bash
bun install              # install deps
bun run dev              # Bun server + frontend at http://127.0.0.1:7878
                         # (HMR enabled, single process)

bun run tauri:dev        # native window via Tauri (requires Rust toolchain)
bun run typecheck        # tsc --noEmit across the whole tree
```

## Build

```bash
bun run build            # bundle server + frontend → dist/
bun run build:compile    # also produces a single-file binary at dist/clidable-server

bun run tauri:build      # full Tauri installer (requires icons — see src-tauri/icons/)
```

## Project status

Pre-1.0, core experience working: terminals + composer, checkpoints, code editor + diffs, projects + preview, skills/MCP/plugins/instructions managers, AI-team delegation. See PLAN.md "Suggested build order" for what's left (retention, server-mode auth, mobile/PWA polish, desktop sidecar bundling).
