# Skills, MCP, Plugins, Instructions & AI Team

CLI agents get their power from configuration: skills, MCP servers, plugins, and instruction files. Normally each agent has its own formats, folders, and CLIs — Clidable gives you **one surface that manages all of them, across all your agents**, from the GUI (workspace tool buttons) or the [`clidable` CLI](./cli-reference.md).

Everything below writes to the agents' **native** config files and folders — nothing is locked into Clidable. Uninstall Clidable and your skills, MCP servers, and instructions keep working.

## Skills

Skills are reusable instruction packs (the `SKILL.md` convention) that agents load when relevant — "how to write Postgres migrations", "this team's React conventions", etc.

**In the GUI** (Skills button in the top chrome):

- **Installed** — every skill in the project, with which agents have it.
- **Discover** — live search of the public [skills.sh](https://skills.sh) catalog (try "react", "postgres", "testing", "security").
- **Add custom** — register your own.

Install/remove is per-agent: skills land in the right folder per agent family — `.claude/skills/` (Claude Code), `.agents/skills/` (the cross-agent "universal" location used by Codex and others), `.qwen/skills/`, `.aider-desk/skills/`. Installing one skill for several agents shares a single download.

**CLI:** `clidable skills list | search <query> | add <owner/repo> --skill <id> | remove <name>` — see the [CLI Reference](./cli-reference.md#clidable-skills).

## MCP servers

MCP (Model Context Protocol) servers give agents tools — databases, browsers, APIs. Clidable can register a server with **multiple agents at once**, writing each agent's own config format (Claude's JSON, Codex's TOML, …).

**In the GUI** (MCP button): list what's installed (per project and global scope), discover curated servers, or add a custom one. Three transport types are supported:

- **npx package** — e.g. `@modelcontextprotocol/server-postgres` (needs Node on the machine at runtime).
- **Command** — any executable + args.
- **HTTP / SSE** — a remote endpoint, with optional headers.

Environment variables (API keys etc.) are set per server and written into the agent's MCP config.

**CLI:** `clidable mcp add <name> --npx <pkg> | --command <cmd> | --url <url>` with `-a claude -a codex …` — see the [CLI Reference](./cli-reference.md#clidable-mcp).

## Plugins

Plugins (slash commands, hooks, sub-agents) are managed through the agents' native plugin systems — Claude Code's marketplaces (shared with Cursor) and Codex's plugin registry.

**In the GUI** (Plugins button): see installed plugins per store, browse marketplaces (with install counts for Claude; OpenAI's curated catalog for Codex), install/remove, or add from a custom source.

**CLI:** `clidable plugins list | discover | add <source> | install <name@marketplace> | remove <name>` — see the [CLI Reference](./cli-reference.md#clidable-plugins).

## Instructions (AGENTS.md)

Every agent reads a project instructions file, but they disagree on the filename: `AGENTS.md`, `CLAUDE.md`… Clidable's approach:

- **`AGENTS.md` is canonical** — one file, one source of truth, the cross-agent convention most agents (Codex, Cursor, Qwen, Copilot, Kimi, OpenCode, Antigravity CLI) already read natively.
- For the one agent that doesn't read it (Claude Code), Clidable maintains a tiny **pointer file** (`CLAUDE.md`) that imports `AGENTS.md` — managed, clearly marked, and never overwriting hand-written content without your explicit say-so.

**In the GUI** (Context button): edit `AGENTS.md` in a markdown editor, see a per-agent coverage table (native / pointer / not wired), and fix gaps with one click. If the project has no instructions yet, Clidable generates a sensible starter based on your detected stack (package manager, scripts, language).

**CLI:** `clidable instructions list | init | sync | edit` — see the [CLI Reference](./cli-reference.md#clidable-instructions).

## AI Team

The headline feature for multi-agent work: **your lead agent delegates to other agents**, each playing a role.

### The idea

You enable roles for a project — say **Reviewer** (handled by Codex) and **UI Designer** (handled by Claude). Clidable installs each enabled role as a *skill* in your lead agent's skill folder. Now, when you ask your lead agent (e.g. Claude Code) to "get the architecture reviewed", it recognizes the Reviewer skill and runs:

```bash
clidable team delegate codex --role reviewer "«the full review prompt»"
```

…which spawns Codex non-interactively (read-only sandbox), captures its answer, and returns it to the lead agent's context. One conversation, several specialized minds.

`--role` is what makes the teammate a *specialist*: the server looks that role up in the project's config and prepends its instructions to the prompt, so a Reviewer and an Architect running on the same Codex binary behave differently. The installed skills pass it automatically.

### Built-in roles

| Role | Default handler | Specialty |
|---|---|---|
| Architect | Codex | System design, data models, API structure |
| Reviewer | Codex | Code review, second-opinion critique |
| Debugger | Codex | Root-cause analysis of tricky bugs |
| UI/UX Designer | Claude | Frontend layout, interactions, accessibility |
| Tester | Codex | Test coverage, edge cases, fixtures |
| Security Auditor | Antigravity | Vulnerability scanning, threat modeling |
| Performance | Codex | Bottleneck analysis, profiling, optimization |
| Documenter | Claude | Docs, comments, READMEs, API descriptions |
| Image Creator | Codex | PNG/image assets — icons, illustrations, social images |

All roles start disabled; you can change any role's handler agent, edit it, or add **custom roles** of your own.

### Setting it up

1. Open the **Team** tool in the workspace (or run `clidable team roles` to see the library).
2. Enable the roles you want and pick handlers.
3. **Sync** (button in the GUI, or `clidable team sync`) — this reconciles the project's skill folders: enabled roles are installed as skills, disabled ones removed. Config lives at `<project>/.clidable/ai-team.json`.
4. Talk to your lead agent normally. Mention review/design/debugging-type work and it delegates by itself — or be explicit: "use the reviewer to check this".

### How delegation behaves

- **Delegate targets:** codex, claude, antigravity, opencode, copilot, kimi, cursor, qwen. Each uses a validated non-interactive recipe (e.g. Codex runs with `--sandbox read-only`; Antigravity CLI runs headless with `agy -p … --mode plan`). Delegates default to read-only — they advise, your lead agent applies changes. (Exception: Copilot's CLI has no read-only mode.)
- **Background jobs:** `clidable team delegate codex "…" --background` returns a job ID immediately; check on it with `clidable team status`, fetch the answer with `clidable team result`, stop it with `clidable team cancel`. The GUI's Team panel shows running jobs too.
- **Requirements:** the Clidable server must be running (delegation routes through it), and the handler agents must be installed and logged in. Inside Clidable-spawned terminals, the `clidable` command is automatically on PATH — no global install needed.
- **Guard rails:** delegation depth is capped at 3 (an agent's delegate can delegate, but chains can't recurse forever), and jobs are capped at 50 concurrent. Background jobs live in server memory — they don't survive a server restart.
