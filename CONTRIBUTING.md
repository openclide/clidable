# Contributing to Clidable

Thanks for your interest! Clidable is early and moving fast — issues, ideas, and
PRs are all welcome.

## Getting set up

You need [Bun](https://bun.sh) ≥ 1.3.14. For the desktop shell you also need the
Rust toolchain ([rustup](https://rustup.rs)) and your platform's WebView deps
(Xcode CLT on macOS, WebView2 on Windows, `webkit2gtk` on Linux).

```bash
git clone https://github.com/openclide/clidable
cd clidable
bun install
bun run dev          # http://127.0.0.1:7878, HMR on
```

## Before you open a PR

Run the same checks CI runs:

```bash
bun run typecheck                       # tsc --noEmit, whole tree
bun run test                            # server + shared + web unit tests
bun run build                           # production bundle (self-verifying)
cd src-tauri && cargo check             # if you touched the Rust shell
```

All four must be green. `bun run build` self-verifies that Tailwind compiled and
that the source tree wasn't mutated, so a passing build means a runnable
artifact.

## Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`, `chore:`, …) — it's how the changelog is generated.
- **Match the surrounding code.** Clidable leans on a few load-bearing
  decisions (Bun does everything, Tauri is a ~50-LOC shell, agents run PTY-first
  in their real TUIs). [`CLAUDE.md`](CLAUDE.md) documents these and the hard-won
  gotchas — worth a read before a substantial change.
- **Keep the server localhost-only.** The trust boundary in
  [SECURITY.md](SECURITY.md) is deliberate; changes that widen network exposure
  need request-time auth to land first.

## Reporting bugs & security issues

- Regular bugs → [open an issue](https://github.com/openclide/clidable/issues/new/choose).
- Anything exploitable → **private disclosure** per [SECURITY.md](SECURITY.md),
  not a public issue.

## License

By contributing, you agree that your contributions are licensed under the
project's [Apache-2.0 License](LICENSE).
