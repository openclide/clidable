# CLI Reference

Clidable ships a CLI: `clidable <command> …`. It's the same code that powers the GUI buttons — one implementation, two surfaces.

## How to invoke it

**Inside Clidable terminals — it just works.** Every terminal Clidable spawns (agent sessions, dev-server shells) has `clidable` on PATH automatically. This is how AI-team skills call `clidable team delegate …` from within an agent.

**Outside Clidable**, any of these are equivalent:

```bash
# The installed command (Homebrew / npm / install script put it on PATH):
clidable skills list

# Via the shim Clidable writes on startup (path varies by OS — see Configuration):
~/Library/Application\ Support/Clidable/bin/clidable skills list     # macOS

# From a source checkout:
bun server/index.ts skills list
```

`clidable --version` prints the bare version; `clidable --help` prints the full usage. An unknown command errors instead of silently starting the server.

The server binary doubles as the CLI: if the first recognized token is a subcommand (`open`, `stop`, `skills`, `mcp`, `plugins`, `instructions`, `team`), it runs that and exits instead of starting the server.

**Scope:** commands that read or write project files operate on the **current working directory** — `cd` into your project first. Running any command group with no (or an unknown) verb prints its usage.

---

## `clidable open`

Open a directory in Clidable — the native app if installed (macOS; other
platforms open the browser), else the browser. It never becomes a server
itself: on the browser path it starts a background server and health-checks
it before opening the deep link; on the app path it hands the directory to
the app — which boots and owns its own server — and returns immediately,
without waiting for that server to be up.

```
clidable open [dir] [--new] [--no-launch] [--print]
```

- `[dir]` — the folder to open; defaults to the current directory (that cwd
  capture is the reason this lives in the CLI — a GUI app launched from
  Finder can't see your terminal's cwd). Use `-- <dir>` for a path starting
  with `-`.
- `--new` — always open a fresh workspace instead of resuming the latest one
  containing this folder.
- `--no-launch` — ensure the background server is running and print the
  deep-link URL, but don't open a UI (for scripts and CI).
- `--print` (alias `--url`) — just print the deep-link URL and exit; starts
  nothing.

```bash
clidable open              # this folder, app or browser
clidable open ~/code/app --new
clidable open --no-launch  # warm the server, open nothing
```

## `clidable stop`

Stop the background server (the one `open` starts, or one you launched
yourself).

```
clidable stop [--force]
```

If the running server belongs to the **desktop app** (its sidecar backend),
`stop` refuses and exits non-zero — the app can't restart its server, so
killing it would leave every open window dead until you relaunch. Quit the
app from its tray instead, or pass `--force` if you really mean it. Prints
what it did — stopped it, refused, cleared a stale lock, or found nothing
running.

---

## `clidable skills`

Manage [skills](./agent-toolkit.md#skills) — reusable SKILL.md instruction packs.

```
clidable skills list   [-g]                       (alias: ls)
clidable skills search <query>                    (alias: find)
clidable skills add    <owner/repo> --skill <id> [-a <bucket>]... [-g]
clidable skills remove <name> [-a <bucket>] [-g]  (alias: rm)
```

| Flag | Meaning |
|---|---|
| `-g, --global` | Global scope (home directory) instead of the current project |
| `-a <bucket>` | Target agent bucket, repeatable. Buckets: `claude`, `universal`, `qwen`, `aider`. Default on add: `claude`, `universal`, `qwen` |
| `-s, --skill <id>` | Which skill inside the source repo |

- `search` queries the public skills.sh registry (minimum 2 characters; multi-word queries use semantic search).
- `add` installs from a GitHub repo (`owner/repo` format) into each bucket's folder: `.claude/skills/`, `.agents/skills/` (shared "universal" location), `.qwen/skills/`, `.aider-desk/skills/`. Already-installed skills are copied between buckets rather than re-downloaded.
- `remove` deletes the skill from the given bucket (or all buckets if `-a` is omitted).

```bash
clidable skills search postgres
clidable skills add vercel-labs/skills --skill react-best-practices
clidable skills remove react-best-practices
```

---

## `clidable mcp`

Manage [MCP servers](./agent-toolkit.md#mcp-servers) across agents.

```
clidable mcp list   [-g]                                            (alias: ls)
clidable mcp add    <name> --npx <pkg>        [options]
clidable mcp add    <name> --command <cmd> [--arg <a>]... [options]
clidable mcp add    <name> --url <url> [--sse] [--header K=V]... [options]
clidable mcp remove <name> [-a <agent>]... [-g]                     (alias: rm)
```

| Flag | Meaning |
|---|---|
| `-a <agent>` | Target agent, repeatable. Agents: `claude`, `codex`, `cursor`, `opencode`, `copilot`. Default on add: `claude` |
| `-g, --global` | Global scope instead of the current project |
| `--npx <pkg>` | Server is an npx package (requires Node at runtime) |
| `--command <cmd>` + `--arg <a>` | Server is an arbitrary command |
| `--url <url>` [`--sse`] | Server is a remote HTTP (or SSE) endpoint |
| `--env K=V` | Environment variable for the server, repeatable |
| `--header K=V` | HTTP header (with `--url`), repeatable |

Each agent's **own** config file is written (Claude's JSON, Codex's TOML, …) via the bundled `add-mcp` library. `remove` with no `-a` removes from all supported agents.

```bash
clidable mcp add postgres --npx @modelcontextprotocol/server-postgres \
  --env DATABASE_URL=postgres://localhost/dev -a claude -a codex
clidable mcp list
clidable mcp remove postgres
```

---

## `clidable plugins`

Manage [plugins](./agent-toolkit.md#plugins) for Claude Code (shared with Cursor) and Codex.

```
clidable plugins list                                               (alias: ls)
clidable plugins discover [-q <query>]                              (alias: search)
clidable plugins add     <source> [--store <s>]... [--scope <scope>]
clidable plugins install <name@marketplace> [--store <s>] [--scope <scope>]  (alias: i)
clidable plugins remove  <name> [--store <s>]...                    (alias: rm)
```

| Flag | Meaning |
|---|---|
| `--store <s>` | `claude` (default; also covers Cursor) or `codex`, repeatable |
| `--scope <s>` | `user`, `project`, or `local` (default: `project` for add, `user` for install) |
| `-q <query>` | Filter discover results |

- `discover` lists plugins from your Claude marketplaces (with install counts) and OpenAI's curated Codex catalog.
- `add` installs every plugin from a source (directory/repo); `install` installs a single named marketplace plugin via the agent's own plugin command.

```bash
clidable plugins discover -q review
clidable plugins install code-review@anthropics --store claude
```

---

## `clidable instructions`

Manage the project's canonical [`AGENTS.md`](./agent-toolkit.md#instructions-agentsmd). Run from the project directory.

```
clidable instructions list             (alias: ls)
clidable instructions init [--force]
clidable instructions sync
clidable instructions edit
```

- `list` — shows whether `AGENTS.md` exists and how each agent is covered: **native** (reads AGENTS.md directly: codex, cursor, qwen, copilot, kimi, opencode, antigravity), **pointer** (via a managed `CLAUDE.md` import), or not wired.
- `init` — writes a starter `AGENTS.md` tailored to your detected stack (package manager, real `package.json` scripts, language conventions). Refuses to overwrite unless `--force`.
- `sync` — creates or repairs the Claude pointer file. Never clobbers a pointer file that carries its own hand-written content.
- `edit` — opens `AGENTS.md` in `$EDITOR` (creates a starter first if missing).

---

## `clidable team`

[AI-team](./agent-toolkit.md#ai-team) delegation and roles.

```
clidable team delegate <agent> [--role <id>] <prompt...> [--background] [--write]
clidable team status   [<job-id>]
clidable team result   [<job-id>]
clidable team cancel   [<job-id>]
clidable team roles
clidable team sync
```

**Delegate agents:** `codex`, `claude`, `antigravity`, `opencode`, `copilot`, `kimi`, `cursor`, `qwen`.

- `delegate` runs the agent non-interactively on the prompt (read-only sandbox where the agent supports one) and prints its answer. With `--background` it returns a job ID immediately.
- `--role <id>` gives the delegate that role's instructions: the server looks the role up in this project's config and prepends its prompt to yours, so a `reviewer` and an `architect` running on the same agent behave differently. The skills that `sync` installs already pass it. Without it the agent gets your bare prompt. An unknown id is refused rather than ignored — run `clidable team sync` if a skill and the config have drifted.
- `--write` gives the delegate write access to the workspace, for roles that save files (e.g. Image Creator). Agents that sandbox themselves by default (Codex, Antigravity) switch to a write-capable invocation; the rest already write and run as normal.
- `status` lists all jobs (or details one), `result` prints a finished job's answer, `cancel` stops a running one. With no job ID, `result`/`cancel` target the most relevant job.
- `roles` prints the role library and what's enabled for this project; `sync` reconciles enabled roles into the project's skill folders (installs enabled, prunes disabled/removed).

**Server requirement:** `delegate`/`status`/`result`/`cancel` talk to the running Clidable server on `127.0.0.1:${CLIDABLE_PORT:-7878}` — start Clidable first. `roles` and `sync` work directly on project files, no server needed.

```bash
clidable team delegate codex "Review server/routes/*.ts for SSRF issues"
clidable team delegate antigravity "Threat-model the preview proxy" --background
clidable team status
clidable team result
```

---

## Server launch flags

When no subcommand is given, the binary starts the server:

```
clidable [--port <n>] [--bind <addr>] [--allow-lan] [--dev]
```

See [Running Clidable](./running-clidable.md#quick-reference-launch-flags) and the [Configuration Reference](./configuration.md) — including the important caveat that Clidable is **localhost-only by default**: a non-loopback `--bind` makes the server refuse to start unless you add `--allow-lan` (or `CLIDABLE_ALLOW_LAN=1`), which permits the exposure but adds no authentication and prints a loud startup warning. `--auth` / `--tls` refuse to start unconditionally — Clidable has no built-in auth or TLS by design (that's your access layer's job: a tunnel or an authenticating reverse proxy).
