/**
 * Types shared between the Bun server and the React frontend.
 * Keep this layer thin — it's the wire format, not domain logic.
 */

export interface HealthResponse {
  ok: true;
  version: string;
  uptimeMs: number;
  shell: "server" | "tauri-sidecar";
}

export interface ErrorResponse {
  ok: false;
  error: string;
}

/* ---------------------------------------------------------------------------
 * Terminal WebSocket protocol — `/api/terminal`.
 *
 * Multiplexed: one connection per browser, many sessions multiplexed by `id`.
 * Sessions outlive the WS — reconnect replays the ring buffer.
 *
 * Binary frames carry I/O payloads to avoid base64 overhead on busy PTYs.
 * Control frames are JSON text.
 *
 * Binary frame layout (8-bit kind + 36-byte ASCII id + payload):
 *   [0]      uint8     kind   0 = input (C→S), 1 = output (S→C)
 *   [1..36]  ASCII     id     fixed-width session id (right-padded with NULs)
 *   [37..]   bytes     data   raw PTY bytes
 * ------------------------------------------------------------------------- */

export type TerminalAgentId =
  | "claude"
  | "codex"
  | "antigravity"
  | "cursor"
  | "qwen"
  | "kimi"
  | "opencode"
  | "copilot"
  // Not an AI agent — a plain login shell. Always "installed", no hooks / resume
  // / status; the tile hides its composer since you type in the terminal.
  | "terminal";

/** Agent ids that were RENAMED over the product's life → their current id.
 *  Persisted values (a project's last-used agent in localStorage, ai-team.json
 *  role handlers/leads, etc.) may hold an old id; map it through this so a stored
 *  id resolves to the current agent instead of an unknown one that would throw. */
export const LEGACY_AGENT_ID_ALIASES: Readonly<Record<string, TerminalAgentId>> = {
  gemini: "antigravity", // Gemini CLI → Antigravity CLI (`agy`)
};

/** Migrate a possibly-legacy stored agent id to the current one (identity if
 *  it isn't a known alias). Cheap and safe to call on any read of a stored id. */
export function migrateAgentId(id: string): string {
  return LEGACY_AGENT_ID_ALIASES[id] ?? id;
}

/** Client → Server (text JSON). */
export type TerminalClientMessage =
  | {
      type: "open";
      id: string;
      agent: TerminalAgentId;
      projectPath: string;
      cols: number;
      rows: number;
    }
  | { type: "unsubscribe"; id: string }
  | { type: "resize"; id: string; cols: number; rows: number }
  | { type: "close"; id: string }
  /** Mirror a tab's user-given name to the server so the desktop tray can show
   *  it (the tray reads the server, which otherwise only knows the agent type).
   *  `null` clears it back to the default. */
  | { type: "label"; id: string; title: string | null }
  /** Full set of session ids this client still owns (open tabs + minimized
   *  terminals). Retained sessions are exempt from the server's idle-session
   *  reaper even with no output subscriber — a minimized or backgrounded
   *  terminal must survive past the detach grace period. Idempotent: the
   *  server diffs against the previous set from this connection. */
  | { type: "retain"; ids: string[] };

/** Server → Client (text JSON). I/O bytes use binary frames. */
export type TerminalServerMessage =
  | {
      type: "ready";
      id: string;
      agent: TerminalAgentId;
      replayLength: number;
    }
  | { type: "exit"; id: string; code: number; signal: string | null }
  | { type: "status"; id: string; state: TerminalAgentState | null }
  | { type: "error"; id?: string; code: string; message: string };

/** Coarse per-agent lifecycle state, derived from the agent's own hooks
 *  (working / idle / blocked). Drives the live status indicator. */
export type TerminalAgentState = "working" | "idle" | "blocked";

/**
 * Tray/menubar view of a live agent's state. Extends the runtime
 * `TerminalAgentState` with a derived `"done"` — an agent that finished a turn
 * (went working → idle) and hasn't been re-prompted yet. Priority for the tray
 * icon's corner pip is blocked ▸ done ▸ working ▸ idle.
 */
export type TrayAgentState = "working" | "idle" | "blocked" | "done";

/** One live PTY session as the tray sees it (see GET /api/agents/live). */
export interface LiveAgent {
  /** PTY session id (== terminal instanceId). */
  id: string;
  agent: TerminalAgentId;
  /** Display name, e.g. "Claude Code". */
  name: string;
  state: TrayAgentState;
}

/** GET /api/agents/live — every live session across the whole server, for the
 *  desktop tray's agent roster + corner-pip status. */
export interface LiveAgentsResponse {
  agents: LiveAgent[];
}

/**
 * Fixed-width session id used in binary frame headers. 64 ASCII bytes
 * is enough for any combination of mock-project ULID (26) + agent name
 * (≤8) + nonce (≤24) + separators. Overflow truncated the id on the
 * wire and dropped output frames silently.
 */
export const TERMINAL_ID_BYTES = 64;
export const TERMINAL_FRAME_KIND_INPUT = 0;
export const TERMINAL_FRAME_KIND_OUTPUT = 1;

/* ---------------------------------------------------------------------------
 * /api/agents — install detection per agent.
 *
 * The server probes PATH for each agent's binary at startup (cached). The
 * welcome screen uses this to dim agents that aren't installed and to
 * show an install hint inline instead of failing only when the user
 * tries to launch one.
 * ------------------------------------------------------------------------- */

export interface AgentInstallStatus {
  id: TerminalAgentId;
  name: string;
  /** True if the binary was found on PATH. */
  installed: boolean;
  /** Resolved absolute path if installed; null otherwise. */
  binPath: string | null;
  /** Command / pointer for the user to install this agent. */
  installHint: string;
}

export interface AgentsStatusResponse {
  agents: AgentInstallStatus[];
}

/* ---------------------------------------------------------------------------
 * /api/checkpoints — shadow-git snapshot per composer Send.
 *
 * Wire shape is camelCase because the React side already uses camelCase
 * everywhere; the SQLite row's snake_case is mapped in
 * server/checkpoints/index.ts so the conversion is a single boundary.
 * ------------------------------------------------------------------------- */

export interface Checkpoint {
  /** UUID. */
  id: string;
  projectUuid: string;
  /** Shadow-git commit SHA. Null when the working tree was unchanged. */
  sha: string | null;
  /** ms since epoch. */
  createdAt: number;
  /** Agent that fired the Send (`claude`, `codex`, ...). Free-form because
   *  custom agents are coming in §5; not pinned to `TerminalAgentId`. */
  agentId: string;
  /** PTY session id at trigger time. */
  terminalId: string;
  /** Composer text at the moment of Send. */
  message: string;
  /** True when this is the seed checkpoint taken on first activity. */
  isInitial: boolean;
  /** True when no working-tree changes since the previous checkpoint. */
  noop: boolean;
  /** Relative path under the project's screenshotsDir, or null. */
  screenshot: string | null;
}

export interface CreateCheckpointRequest {
  projectPath: string;
  agentId: string;
  terminalId: string;
  message: string;
  /**
   * Optional base64-encoded PNG of the preview pane at capture time
   * (no `data:` prefix). Desktop-only; omitted in browser/PWA. The
   * server writes it under the project's screenshots dir and records
   * the relative path on the checkpoint.
   */
  screenshot?: string;
}

export interface ListCheckpointsResponse {
  checkpoints: Checkpoint[];
}

export interface RestoreCheckpointRequest {
  projectPath: string;
  checkpointId: string;
}

export interface RestoreCheckpointResponse {
  ok: true;
  /** The SHA actually restored to. For noop checkpoints this is the
   *  nearest prior non-null SHA, which differs from the row's own. */
  sha: string;
  /** Echoes the requested checkpoint id so clients can correlate. */
  resolvedFromCheckpointId: string;
}

/* ---------------------------------------------------------------------------
 * /api/watch — file system change notifications.
 *
 * One WebSocket per project. The client opens with `?projectPath=...`
 * and reads server-pushed events; no client→server frames are needed.
 *
 *   { type: "ready" }           — handshake, sent on connect
 *   { type: "changed", paths }  — debounced batch of changed paths,
 *                                  relative to the project root,
 *                                  forward-slash separated
 *   { type: "error", message }  — fatal; client should retry connect
 * ------------------------------------------------------------------------- */

export type WatchServerMessage =
  | { type: "ready" }
  | { type: "changed"; paths: string[] }
  | { type: "error"; message: string };

/* ---------------------------------------------------------------------------
 * /api/preview-events — dev-server URL auto-detection (M-C).
 *
 * One WebSocket per project (`?projectPath=...`). The server scans each PTY's
 * output for dev-server banners (Vite/Next/etc.) and pushes a `detected`
 * frame the instant a new loopback URL appears. On connect it replays any
 * already-detected servers so a late-opening preview pane still sees them.
 * ------------------------------------------------------------------------- */

export type PreviewEventMessage =
  | { type: "ready" }
  | { type: "detected"; terminalId: string; url: string }
  | { type: "error"; message: string };

/* ---------------------------------------------------------------------------
 * /api/projects — the project registry.
 *
 * A "project" is any directory with a `.clidable/project-id` UUID. Opening a
 * folder mints/reads that UUID, detects a framework hint, and upserts a row.
 * `framework` is a best-effort guess used by the preview dev-server features
 * (§3) and the New-Project wizard (§7) — never load-bearing for correctness.
 * ------------------------------------------------------------------------- */

export type ProjectFramework =
  | "nextjs"
  | "vite"
  | "astro"
  | "remix"
  | "sveltekit"
  | "nuxt"
  | "expo"
  | "hono"
  | "node"
  | "python"
  | "rust"
  | "go"
  | "unknown";

export interface Project {
  /** UUID from <project>/.clidable/project-id. */
  id: string;
  /** Display name — package.json/Cargo name, else directory basename. */
  name: string;
  /** Absolute path to the project root. */
  path: string;
  /** ms since epoch — first time Clidable opened it. */
  createdAt: number;
  /** ms since epoch — most recent open (drives recents ordering). */
  lastOpened: number;
  /** Best-effort framework hint. `"unknown"` when nothing matched. */
  framework: ProjectFramework;
}

export interface ListProjectsResponse {
  projects: Project[];
}

export interface OpenProjectRequest {
  /** Absolute path to the directory to open/register. */
  projectPath: string;
}

/* --- New-Project wizard (§7) --- */

export type ProjectTemplateId =
  | "blank"
  | "vite-react"
  | "vite-svelte"
  | "vite-vue"
  | "nextjs"
  | "astro"
  | "hono";

export interface ProjectTemplateInfo {
  id: ProjectTemplateId;
  label: string;
  description: string;
  /** True if scaffolding needs network + a package manager (vs. pure local). */
  needsNetwork: boolean;
}

/** UI-facing template catalog. The actual scaffold commands live server-side
 *  (server/projects/scaffold.ts) — never trust the client for those. */
export const PROJECT_TEMPLATES: readonly ProjectTemplateInfo[] = [
  {
    id: "blank",
    label: "Empty folder",
    description: "Just a git repo + README. No toolchain.",
    needsNetwork: false,
  },
  {
    id: "vite-react",
    label: "Vite + React",
    description: "React + TypeScript via Vite.",
    needsNetwork: true,
  },
  {
    id: "vite-svelte",
    label: "Vite + Svelte",
    description: "Svelte + TypeScript via Vite.",
    needsNetwork: true,
  },
  {
    id: "vite-vue",
    label: "Vite + Vue",
    description: "Vue + TypeScript via Vite.",
    needsNetwork: true,
  },
  {
    id: "nextjs",
    label: "Next.js",
    description: "App Router + Tailwind + TypeScript.",
    needsNetwork: true,
  },
  {
    id: "astro",
    label: "Astro",
    description: "Static-first content site.",
    needsNetwork: true,
  },
  {
    id: "hono",
    label: "Hono",
    description: "Minimal Bun web server.",
    needsNetwork: true,
  },
] as const;

export interface CreateProjectRequest {
  /** Absolute path to the parent directory the new project folder goes in. */
  parentDir: string;
  /** Folder name for the new project (sanitized server-side). */
  name: string;
  template: ProjectTemplateId;
}

/* --- Own-the-spawn dev server (§3 / M-F) --- */

export interface DevServerRequest {
  projectPath: string;
}

export interface StartDevServerResponse {
  /** The port the dev server was assigned (free-scanned, or the configured fixed port). */
  port: number;
  /** The URL to drop into the preview — the configured `url` override when set,
   *  else `http://localhost:<port>`. */
  url: string;
}

export interface DevServerStatusResponse {
  running: boolean;
  port: number | null;
  url: string | null;
  /** Recent stdout/stderr lines (most-recent last), for a lightweight log peek. */
  logs: string[];
}

/* --- Per-project launch config (.clidable/launch.json) --- */

/**
 * User overrides for how a project's dev server starts and is previewed.
 * All fields optional; a blank/missing field falls back to auto-detection.
 * Persisted to `<project>/.clidable/launch.json` so it travels with the repo
 * and applies across browsers/machines — unlike the per-browser address bar.
 */
export interface LaunchConfig {
  /** Shell command to launch the dev server, e.g. "npm run dev". Blank → detected. */
  command?: string;
  /** Port the dev server listens on. Blank → detected framework default (free-scanned). */
  port?: number;
  /** URL the preview loads, e.g. a Tailscale/remote host. Blank → http://localhost:<port>. */
  url?: string;
}

/**
 * Auto-detected launch defaults — what runs when launch.json leaves a field
 * blank. Drives the config form's placeholders and the "just works" path.
 */
export interface LaunchPlan {
  /** Detected command, or "" when we don't know how to run this project. */
  command: string;
  /** Detected default port (framework convention). */
  port: number;
  /** Detected preview URL (`http://localhost:<port>`), or "" when not runnable. */
  url: string;
  /** True when a command was detected (has a dev script + a known framework). */
  runnable: boolean;
}

export interface LaunchConfigResponse {
  /** The saved overrides (possibly all-blank when no file exists yet). */
  config: LaunchConfig;
  /** Auto-detected defaults, for the form's placeholders. */
  detected: LaunchPlan;
}

export interface SaveLaunchConfigRequest {
  projectPath: string;
  config: LaunchConfig;
}

export interface TouchProjectRequest {
  id: string;
}

export interface RemoveProjectRequest {
  id: string;
}

/* ---------------------------------------------------------------------------
 * /api/workspaces — the persisted unit of work.
 *
 * A workspace is the whole multi-project session snapshot: its ordered open
 * projects, the pane tree, the minimized-terminals dock, and the active
 * project. `tree` and `minimized` are opaque client-owned JSON (Pane /
 * MinimizedTerminal[]) the server round-trips. Projects are referenced by their
 * stable UUID and resolved to Project records on read (in tab order, dropping
 * any since removed).
 * ------------------------------------------------------------------------- */

export interface WorkspaceSummary {
  id: string;
  /** User override, or null → the client derives the label from `projects`. */
  name: string | null;
  /** Open projects in tab order (removed projects dropped). Never empty — a
   *  workspace with no surviving projects is omitted from listings. */
  projects: Project[];
  createdAt: number;
  lastOpened: number;
}

export interface WorkspaceFull extends WorkspaceSummary {
  /** Stored open-project id order, verbatim (may include ids that resolved out
   *  of `projects`, so the client can preserve the exact tab order). */
  openProjects: string[];
  activeProjectId: string | null;
  /** JSON pane tree (Pane) | null for a fresh workspace the client seeds. */
  tree: unknown | null;
  /** JSON MinimizedTerminal[] | null. */
  minimized: unknown | null;
}

export interface ListWorkspacesResponse {
  workspaces: WorkspaceSummary[];
}

export interface CreateWorkspaceRequest {
  projectIds: string[];
  name?: string;
}

export interface SaveWorkspaceRequest {
  id: string;
  name?: string | null;
  tree: unknown;
  openProjects: string[];
  activeProjectId: string | null;
  minimized: unknown;
}

export interface TouchWorkspaceRequest {
  id: string;
}

export interface RemoveWorkspaceRequest {
  id: string;
}

/* ---------------------------------------------------------------------------
 * /api/fs/browse — server-side directory browser for the folder picker.
 *
 * Lists only sub-directories of an absolute `path` (defaults to the server's
 * home dir), so the universal "Open a folder" picker works in every shell.
 * Distinct from /api/fs/list (which is project-root-sandboxed for the editor);
 * this one navigates the host filesystem to *choose* a project root.
 * ------------------------------------------------------------------------- */

export interface FsBrowseEntry {
  name: string;
  /** Absolute path of the sub-directory. */
  path: string;
}

export interface FsBrowseResponse {
  /** The (realpath-resolved) absolute directory being listed. */
  path: string;
  /** Parent directory, or null at the filesystem root. */
  parent: string | null;
  /** The server's home directory — drives the "⌂ Home" shortcut. */
  home: string;
  /** Sub-directories, alphabetical, hidden/build dirs excluded. */
  dirs: FsBrowseEntry[];
}

/* ---------------------------------------------------------------------------
 * /api/skills — Agent Skills management, backed by skills.sh (the `skills`
 * CLI / vercel-labs). See PLAN.md §4.
 *
 * skills.sh is the cross-agent projection engine: it installs a skill folder
 * into each agent's expected location. At PROJECT scope those locations
 * collapse into three physical "buckets" we can scan:
 *
 *   • claude    → <project>/.claude/skills/<name>/   (Claude's own dir)
 *   • universal → <project>/.agents/skills/<name>/   (read by Codex, Cursor,
 *                                                     Antigravity CLI, OpenCode,
 *                                                     GitHub Copilot, …)
 *   • aider     → <project>/.aider-desk/skills/<name>/
 *
 * Because the universal bucket is one shared directory, those agents can't be
 * toggled independently at project scope — they move as a group. State is read
 * directly from disk (+ skills-lock.json), never by parsing CLI output.
 * ------------------------------------------------------------------------- */

export type SkillBucket = "claude" | "universal" | "aider" | "qwen";

/** "project" = committed in the repo; "global" = ~/.<agent>/skills (all
 *  projects). Mirrors skills.sh's `-g/--global` flag. */
export type SkillScope = "project" | "global";

/** Which of our agents read each bucket's directory. Drives the per-agent
 *  dots/matrix. `aider` maps to nothing because Clidable's agent set has no
 *  Aider entry yet. */
export const SKILL_BUCKET_AGENTS: Record<SkillBucket, TerminalAgentId[]> = {
  claude: ["claude"],
  // Kimi reads `.agents/skills` too (verified: `skills add -a kimi-cli` writes
  // the same dir as codex), so it rides the universal bucket. Antigravity CLI
  // (`agy`) reads the same `.agents/skills` Agent Skills dir.
  universal: ["codex", "cursor", "antigravity", "opencode", "copilot", "kimi"],
  // Qwen Code reads ONLY its own `.qwen/skills`, so it's a bucket of its own.
  qwen: ["qwen"],
  aider: [],
};

/** Map our agent ids → skills.sh `--agent` ids (for `skills add/remove -a`). */
export const SKILLS_SH_AGENT_ID: Partial<Record<TerminalAgentId, string>> = {
  claude: "claude-code",
  codex: "codex",
  cursor: "cursor",
  // `skills`' Antigravity id: project skills land in `.agents/skills` (the
  // universal bucket), global in ~/.gemini/antigravity/skills.
  antigravity: "antigravity",
  opencode: "opencode",
  copilot: "github-copilot",
  qwen: "qwen-code",
  kimi: "kimi-cli",
};

/** Buckets → the agents that read them (for dots / deriving install state). */
export function agentsForBuckets(buckets: SkillBucket[]): TerminalAgentId[] {
  const set = new Set<TerminalAgentId>();
  for (const b of buckets) for (const a of SKILL_BUCKET_AGENTS[b]) set.add(a);
  return [...set];
}

/** Agents → the buckets they imply (the inverse; for the install matrix). */
export function bucketsForAgents(agents: TerminalAgentId[]): SkillBucket[] {
  return (Object.keys(SKILL_BUCKET_AGENTS) as SkillBucket[]).filter((b) =>
    SKILL_BUCKET_AGENTS[b].some((a) => agents.includes(a)),
  );
}

/** True when `source` is a real "owner/repo" we can install from — not an
 *  unknown-source sentinel ("local" = no lockfile, "skills.sh" = no repo). */
export function hasSkillSource(source: string | null | undefined): boolean {
  return !!source && source !== "local" && source !== "skills.sh";
}

export interface SkillFileInfo {
  /** Path relative to the skill folder root (e.g. "SKILL.md", "rules/x.md"). */
  path: string;
  /** Bytes. */
  size: number;
}

/** A skill found installed on disk, enriched with skills-lock.json metadata. */
export interface InstalledSkillInfo {
  /** Folder name = skill id (skills-lock.json key). */
  name: string;
  /** "owner/repo" from the lockfile, or null if not tracked there. */
  source: string | null;
  sourceType: "github" | "well-known" | null;
  /** SKILL.md frontmatter `description` (the agent's load trigger). "" if absent. */
  description: string;
  /** metadata.json / frontmatter `version`, or null. */
  version: string | null;
  /** Full SKILL.md body (frontmatter included) for the detail view. */
  content: string;
  /** Files in the skill folder (recursive), SKILL.md first. */
  files: SkillFileInfo[];
  /** Physical buckets the skill is present in. */
  buckets: SkillBucket[];
  /** Agents served, derived from `buckets`. */
  agents: TerminalAgentId[];
  scope: SkillScope;
}

export interface ListSkillsResponse {
  skills: InstalledSkillInfo[];
}

/** A search hit from the public skills.sh registry (`/api/search`). Carries
 *  only lightweight metadata — no SKILL.md body until installed. */
export interface DiscoverSkillInfo {
  /** Full id "owner/repo/skillId" — stable, unique. */
  id: string;
  /** The folder name it installs as (last path segment); matches an installed
   *  skill's `name`, so the UI can flag already-installed results. */
  skillId: string;
  name: string;
  source: string;
  installs: number;
}

export interface SearchSkillsResponse {
  skills: DiscoverSkillInfo[];
  /** "fuzzy" (single word) | "semantic" (multi-word), echoed from skills.sh. */
  searchType?: string;
}

export interface AddSkillRequest {
  projectPath: string;
  /** "owner/repo" the skill comes from. */
  source: string;
  /** The skill's folder name within that repo. */
  skillId: string;
  /** "project" (in the repo) or "global" (~, all projects). */
  scope: SkillScope;
  /** Buckets to install into. */
  buckets: SkillBucket[];
}

export interface RemoveSkillRequest {
  projectPath: string;
  /** Installed skill's folder name. */
  name: string;
  /** Scope to remove from (must match where it's installed). */
  scope: SkillScope;
  /** Omit to remove from every bucket ("remove everywhere"). */
  bucket?: SkillBucket;
}

/* ---------------------------------------------------------------------------
 * /api/mcp — MCP server management, backed by the `add-mcp` library (PLAN.md
 * §4). Unlike skills, add-mcp exposes a typed in-process API and edits each
 * agent's own config file directly (~/.claude.json, ~/.codex/config.toml,
 * ~/.cursor/mcp.json, …) — so MCP is genuinely PER-AGENT (no shared dir),
 * and it's config management, not a runtime (no live tool list / status).
 * ------------------------------------------------------------------------- */

/** Our agent ids → add-mcp `AgentType` ids. Agents add-mcp doesn't support
 *  (qwen, kimi) are omitted. */
export const MCP_AGENT_TYPE: Partial<Record<TerminalAgentId, string>> = {
  claude: "claude-code",
  codex: "codex",
  // add-mcp has a native `antigravity` target — but it is GLOBAL-ONLY (writes
  // `~/.gemini/antigravity/mcp_config.json`, no project-local path), so it's
  // listed in MCP_GLOBAL_ONLY_AGENTS below.
  antigravity: "antigravity",
  cursor: "cursor",
  opencode: "opencode",
  copilot: "github-copilot-cli",
};

/** MCP agents whose add-mcp target has no project-local config path: they can
 *  only be configured globally, and a project-scope write would silently land
 *  in their single global file. The MCP UI restricts these to Global scope and
 *  the server refuses project-scope writes for them. Mirrors add-mcp's
 *  `agents[type].localConfigPath === undefined`; server/mcp/manager.ts asserts
 *  the two stay in sync (warns on drift from an add-mcp bump). The frontend
 *  can't import add-mcp, so this declaration is the browser-side source. */
export const MCP_GLOBAL_ONLY_AGENTS: ReadonlySet<TerminalAgentId> = new Set([
  "antigravity",
]);

export type McpScope = "project" | "global";
export type McpTransportType = "stdio" | "http" | "sse";

/** An MCP server as configured across one or more agents (config-level —
 *  secret values are never returned, only key names). */
export interface McpServerInfo {
  name: string;
  transport: McpTransportType;
  /** stdio: launch command + args. */
  command: string | null;
  args: string[];
  /** http/sse: endpoint url. */
  url: string | null;
  /** Header names only (values redacted). */
  headerNames: string[];
  /** Env var names only (values redacted). */
  envNames: string[];
  /** Our agent ids that have this server configured. */
  agents: TerminalAgentId[];
  scope: McpScope;
}

export interface ListMcpResponse {
  servers: McpServerInfo[];
}

/** Full server config (incl. secret values) — used when adding a server the
 *  caller defines (add-custom / discover catalog). */
export interface McpServerSpec {
  transport: McpTransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface AddMcpRequest {
  projectPath: string;
  scope: McpScope;
  name: string;
  /** Target agents (our ids). */
  agents: TerminalAgentId[];
  /** Explicit config (add-custom / discover). Omit to copy the config from an
   *  agent that already has this server (the per-agent matrix on an installed
   *  server) — keeps secret values server-side. */
  config?: McpServerSpec;
}

export interface RemoveMcpRequest {
  projectPath: string;
  scope: McpScope;
  name: string;
  /** Agents to remove from. Omit = every supported agent. */
  agents?: TerminalAgentId[];
}

/** An MCP server offered by Discover — from the bundled featured catalog or a
 *  live registry (registry.modelcontextprotocol.io / mcp.agent-tooling.dev).
 *  Carries a ready-to-install config scaffold: registry `remotes`/`packages`
 *  entries are translated into the concrete transport + secret-name lists the
 *  install flow collects values for. No install counts — no registry has them. */
export interface DiscoverMcpInfo {
  /** Registry name ("com.stripe/mcp") or the featured catalog's slug. */
  id: string;
  /** Display name (registry `title`, else the name's last path segment). */
  name: string;
  description: string;
  /** Repo / docs URL, "" when the registry has none. */
  url: string;
  transport: McpTransportType;
  /** stdio: launch command + args. */
  command: string | null;
  args: string[];
  /** http/sse: endpoint url. */
  serverUrl: string | null;
  /** Header / env-var NAMES the server needs (values collected at install). */
  headerNames: string[];
  envNames: string[];
}

export interface DiscoverMcpResponse {
  servers: DiscoverMcpInfo[];
}

/* ---------------------------------------------------------------------------
 * /api/plugins — Plugin management. A plugin is a BUNDLE: it can ship skills,
 * slash-commands, subagents, hooks, MCP servers, and LSP servers together.
 *
 * Backends (PLAN.md §4), split by capability:
 *   • INSTALL → the `plugins` CLI (vercel-labs) — re-exec'd, the one tool that
 *     does the cross-store `.plugin/` → vendor-format translation + writes.
 *   • LIST    → read native state files directly (never parse CLI output).
 *   • REMOVE / ENABLE / DISABLE → delegate to the agents' own CLIs
 *     (`claude plugin uninstall/enable/disable`, `codex plugin remove`), which
 *     stay in sync with the on-disk format by definition.
 *
 * Installs land in native stores which (empirically, plugins@1.3.x) collapse to
 * TWO physical locations:
 *
 *   • claude store → ~/.claude/plugins/  (installed_plugins.json + settings.json
 *                    `enabledPlugins`). READ BY BOTH Claude Code AND Cursor —
 *                    even `plugins add -t cursor` writes here, never ~/.cursor.
 *   • codex store  → ~/.codex/config.toml `[plugins.*]`
 *                    + ~/.agents/plugins/marketplace.json
 *
 * So Claude and Cursor can't be toggled independently — they share one store,
 * exactly like skills' `universal` bucket.
 * ------------------------------------------------------------------------- */

export type PluginStore = "claude" | "codex" | "antigravity";

/** Install scope, from Claude's install ledger. "user" = all projects (global);
 *  "project" = committed in the repo; "local" = this repo only, gitignored.
 *  Codex installs are always user-level. */
export type PluginScope = "user" | "project" | "local";

/** The artifact kinds a plugin can bundle (drives the component inventory). */
export type PluginComponentType =
  | "command"
  | "skill"
  | "agent"
  | "hook"
  | "mcp"
  | "lsp";

/** Which of our agents read each store. Claude + Cursor share the claude store;
 *  Codex has its own; Antigravity CLI (`agy`) has its own. Mirrors SKILL_BUCKET_AGENTS. */
export const PLUGIN_STORE_AGENTS: Record<PluginStore, TerminalAgentId[]> = {
  claude: ["claude", "cursor"],
  codex: ["codex"],
  antigravity: ["antigravity"],
};

/** Store → the `plugins --target` id used when installing into it. NOTE: the
 *  vercel `plugins` CLI has NO antigravity target, so the `antigravity` value
 *  here must never be passed to `plugins add` — that store installs via its own
 *  `agy plugin install` (see server/plugins/manager.ts). */
export const PLUGIN_STORE_TARGET: Record<PluginStore, string> = {
  claude: "claude-code",
  codex: "codex",
  antigravity: "antigravity",
};

/** Stores → the agents that read them (for dots / deriving install state). */
export function agentsForStores(stores: PluginStore[]): TerminalAgentId[] {
  const set = new Set<TerminalAgentId>();
  for (const s of stores) for (const a of PLUGIN_STORE_AGENTS[s]) set.add(a);
  return [...set];
}

export interface PluginComponentInfo {
  type: PluginComponentType;
  name: string;
  /** Optional sub-label, e.g. a hook's event ("PostToolUse"). */
  meta?: string;
}

export interface PluginFileInfo {
  /** Path relative to the plugin folder root. */
  path: string;
  /** Bytes. */
  size: number;
}

/** A plugin found installed in one or both stores, merged by name. */
export interface InstalledPluginInfo {
  /** Plugin name (the part before "@marketplace"). Unique per list. */
  name: string;
  /** `description` from the plugin's manifest (plugin.json), "" if absent. */
  description: string;
  /** Marketplace it was installed from; "plugins-cli" for vercel/codex. */
  marketplace: string | null;
  /** Original source: "owner/repo" or a directory path. */
  source: string | null;
  version: string | null;
  /** Stores it's present in. */
  stores: PluginStore[];
  /** Agents served, derived from `stores`. */
  agents: TerminalAgentId[];
  /** Enabled (vs installed-but-disabled) — true if enabled in ANY store. */
  enabled: boolean;
  scope: PluginScope;
  /** Bundled components (scanned from the cached plugin dir). */
  components: PluginComponentInfo[];
  /** Files in the cached plugin dir (for the detail view). */
  files: PluginFileInfo[];
}

export interface ListPluginsResponse {
  plugins: InstalledPluginInfo[];
}

/** A plugin available in a marketplace (Discover), not necessarily installed. */
export interface DiscoverPluginInfo {
  /** Stable id "marketplace/name". */
  id: string;
  name: string;
  description: string;
  /** Marketplace it lives in. */
  marketplace: string;
  /** Store it installs into → which native CLI handles it. Claude marketplaces
   *  → "claude" (also Cursor); the openai/plugins catalog → "codex". */
  store: PluginStore;
  /** "owner/repo" or path the marketplace points to. */
  source: string;
  /** Marketplace category (e.g. "development", "security"), "" if none. */
  category: string;
  /** Unique installs from the marketplace's count cache (0 if unknown). */
  installs: number;
  components: PluginComponentInfo[];
}

export interface DiscoverPluginsResponse {
  plugins: DiscoverPluginInfo[];
}

export interface AddPluginRequest {
  projectPath: string;
  /** "owner/repo", HTTPS/SSH URL, or local path — passed to `plugins add`.
   *  NOTE: `plugins add` installs EVERY plugin found at the source. */
  source: string;
  scope: PluginScope;
  /** Stores to install into → mapped to `plugins --target`. */
  stores: PluginStore[];
}

export interface RemovePluginRequest {
  projectPath: string;
  name: string;
  /** Stores to remove from. Omit = every store it's in. The exact
   *  `name@marketplace` ref + scope is resolved server-side from disk. */
  stores?: PluginStore[];
}

/* -------------------------------------------------------------------------- */
/*  /api/context — Instructions files (PLAN.md §4)                            */
/* -------------------------------------------------------------------------- */
/**
 * One canonical instructions file: **AGENTS.md** (the Linux-Foundation
 * cross-agent standard). Most agents read it natively; the one holdout gets a
 * one-line `@import` pointer file in its own format — no content duplication,
 * no settings edits, plain committed markdown that works on Windows.
 *
 * Empirically verified: codex / opencode / cursor / qwen / copilot and
 * Antigravity CLI (`agy`) read AGENTS.md natively; claude reads CLAUDE.md
 * (AGENTS.md only as a fallback when no CLAUDE.md), so it gets a pointer file;
 * kimi auto-loads no instruction file yet (kimi-cli #850), so there's nothing
 * file-based to write for it.
 */
export const INSTRUCTION_CANONICAL_FILE = "AGENTS.md";

/** Agents that read the canonical AGENTS.md natively — nothing to write. */
export const INSTRUCTION_NATIVE_AGENTS: TerminalAgentId[] = [
  "codex",
  "opencode",
  "cursor",
  "qwen",
  "copilot",
  "antigravity",
];

/** Holdouts: read their own file, which we point at AGENTS.md via an import. */
export const INSTRUCTION_POINTER_FILES: Partial<Record<TerminalAgentId, string>> = {
  claude: "CLAUDE.md",
};

/** The exact one-line import each pointer file carries. Claude resolves `@path`
 *  relative to the file. */
export const INSTRUCTION_POINTER_IMPORT: Partial<Record<TerminalAgentId, string>> = {
  claude: "@AGENTS.md",
};

/** Agents with no file-based auto-loaded instruction mechanism today. */
export const INSTRUCTION_UNSUPPORTED_AGENTS: TerminalAgentId[] = ["kimi"];

/** How an agent consumes the canonical instructions. */
export type InstructionCoverage = "native" | "pointer" | "none";

/** Per-agent coverage status at a given project. */
export interface InstructionAgentInfo {
  agent: TerminalAgentId;
  coverage: InstructionCoverage;
  /** Pointer agents: the file Clidable manages (e.g. "CLAUDE.md"). */
  file?: string;
  /** Pointer agents: file is a managed `@import` pointer (correctly wired). */
  pointerOk?: boolean;
  /** Pointer agents: file exists with hand-written content (not a pointer) —
   *  the one case saveContext must not clobber. */
  hasOwnContent?: boolean;
}

export interface ContextResponse {
  /** Canonical project-root AGENTS.md content ("" if it doesn't exist yet). */
  content: string;
  /** Whether a project-root AGENTS.md exists. */
  exists: boolean;
  /** Per-agent coverage for the project root. */
  agents: InstructionAgentInfo[];
}

export interface SaveContextRequest {
  projectPath: string;
  /** New AGENTS.md body. */
  content: string;
  /** Holdouts to create/repair as `@import` pointers — the safe set (a file
   *  that's missing or already a pointer). Never clobbers hand-written content. */
  pointers: TerminalAgentId[];
  /** Edited holdouts explicitly authorized to have their own content replaced
   *  by a pointer. The caller folds that content into `content` first; this is
   *  the only way the server will overwrite a `hasOwnContent` file. */
  convert?: TerminalAgentId[];
}

/* -------------------------------------------------------------------------- */
/*  AI Team — delegation (PLAN.md §5)                                         */
/* -------------------------------------------------------------------------- */

/** An agent that can be invoked as a delegate. Reuses the terminal agent id
 *  space; which ids are ACTUALLY wired is owned by the recipe registry
 *  (server/team/recipes.ts), not this type — Slice 1 wires codex + claude. */
export type DelegateAgentId = TerminalAgentId;

/** Lead → server: run one headless delegation and return the final answer. */
export interface DelegateRequest {
  /** Which delegate CLI to invoke. */
  agent: DelegateAgentId;
  /** The task prompt. Passed to the delegate as a single argv element (no
   *  shell), so it needs no quoting/escaping. */
  prompt: string;
  /** Project directory the delegate runs in. */
  projectPath: string;
  /** Delegation nesting depth. Propagated across the CLI→server boundary in the
   *  request body (env can't cross HTTP) so the server can refuse run-away
   *  recursion — a delegate that keeps delegating. Absent/0 at the top level. */
  depth?: number;
  /** Run detached as a background job (returns a job id immediately instead of
   *  blocking for the answer). Long tasks need this — the lead's own bash call
   *  would otherwise time out. */
  background?: boolean;
  /** Give the delegate WRITE access to the workspace (its recipe's `writeArgs`
   *  invocation). Refused when the agent's recipe has none. Needed by roles
   *  that produce files (e.g. Image Creator saving PNGs). */
  write?: boolean;
}

/** Server → lead: the delegate's clean final answer + how the run ended. */
export interface DelegateResponse {
  ok: true;
  agent: DelegateAgentId;
  /** The delegate's final message, extracted via the agent's recipe. */
  answer: string;
  /** The delegate process's exit code (0 = success). */
  exitCode: number;
  /** Wall-clock duration of the run, in milliseconds. */
  durationMs: number;
}

/** Lifecycle of a background delegation job. */
export type TeamJobStatus = "running" | "completed" | "failed" | "cancelled";

/** A delegation job's public state (server → lead). */
export interface TeamJobInfo {
  id: string;
  agent: DelegateAgentId;
  status: TeamJobStatus;
  /** Truncated prompt, for listings. */
  promptPreview: string;
  /** Epoch ms when the job started. */
  startedAt: number;
  /** Epoch ms when it finished (absent while running). */
  completedAt?: number;
  /** Wall-clock duration once finished, ms. */
  durationMs?: number;
  /** Delegate process exit code, once finished. */
  exitCode?: number;
  /** Final answer (present when completed). */
  answer?: string;
  /** Failure / cancellation message (present when failed or cancelled). */
  error?: string;
  /** Last few lines of live output — a progress preview while running. */
  progress?: string[];
}

/** Server → lead for a single job (background start, status, or cancel). */
export interface TeamJobResponse {
  ok: true;
  job: TeamJobInfo;
}

/** Server → lead listing the project's jobs (newest first). */
export interface TeamJobsResponse {
  ok: true;
  jobs: TeamJobInfo[];
}

/**
 * How to invoke a delegate agent NON-INTERACTIVELY and read back its answer.
 *
 * A pure DATA descriptor — no functions — so built-in agents and user-added
 * agents share one shape. Adding a custom CLI agent is filling this in (in the
 * GUI / `ai-team.json`), never a code change. A generic runner interprets it.
 */
export interface AgentRecipe {
  /** Agent id — a TerminalAgentId for built-ins, any slug for custom agents. */
  id: string;
  /** Display name. */
  name: string;
  /** Binary to run — looked up on PATH, or an absolute path. */
  bin: string;
  /** How the prompt reaches the agent:
   *  - "arg":   substituted into `args` at the `{prompt}` placeholder, and stdin
   *             is closed (/dev/null) — which is the `</dev/null` Codex needs.
   *  - "stdin": piped to the process's stdin; `args` carries no placeholder. */
  promptInput: "arg" | "stdin";
  /** Argv after the binary. In "arg" mode the element equal to `{prompt}` is
   *  replaced by the prompt (no shell — safe, needs no quoting). Bake any
   *  non-interactive / sandbox / auto-approve flags directly into this list. */
  args: string[];
  /** Alternative argv used when the delegation asks for WRITE access to the
   *  workspace (`clidable team delegate --write`, roles with `needsWrite`) —
   *  e.g. codex with `--sandbox workspace-write` instead of read-only. Absent
   *  means the agent has no vetted write-capable invocation: `--write`
   *  delegations to it are refused rather than silently run read-only. */
  writeArgs?: string[];
  /** Extra env for the spawned process (on top of the server's env). For
   *  agent-specific needs like a workspace-trust or telemetry-opt-out flag. */
  env?: Record<string, string>;
  /** How to pull the clean final answer out of captured stdout. */
  parse: AnswerParse;
}

/** Answer-extraction strategy for an {@link AgentRecipe}. */
export type AnswerParse =
  /** The whole stdout, trimmed. */
  | { type: "raw" }
  /** JSON.parse(stdout) then read a dotted path (e.g. "result"); falls back to
   *  raw stdout if it isn't valid JSON or the path is missing/empty. */
  | { type: "json"; path: string };

/** Sentinel marking a Clidable-managed role skill. Lives in the SKILL.md so the
 *  Team manager can reconcile its own skills (don't-clobber, prune) and the
 *  Skills manager can exclude them from its inventory. Followed by the role id. */
export const TEAM_ROLE_SKILL_MARKER = "clidable:team-role:";

/** Icon ids for the built-in role glyphs (cosmetic; chosen in the GUI). */
export type RoleGlyphId =
  | "architect"
  | "reviewer"
  | "debugger"
  | "ui-designer"
  | "tester"
  | "security"
  | "performance"
  | "documenter"
  | "marketer"
  | "pm"
  | "image-creator";

/**
 * An AI Team role (PLAN.md §5): a specialization bound to a delegate ("handler")
 * agent. Each enabled role is rendered to a SKILL.md and installed into its
 * leads' skill buckets, so the lead description-triggers it and hands the task
 * off via `clidable team delegate`. Built-ins are seed data; the project's
 * roles live in `<project>/.clidable/ai-team.json`.
 *
 * Field names mirror the GUI's editor so the modal binds to this shape directly.
 */
export interface TeamRole {
  /** Stable id; also the skill folder name. */
  id: string;
  /** Human label. */
  name: string;
  /** Short one-line summary (UI). */
  description: string;
  /** Icon glyph (UI). */
  glyph: RoleGlyphId;
  /** The SKILL.md frontmatter `description` — what the lead matches against. */
  triggerHint: string;
  /** Persona prose written into the skill body. */
  promptTemplate: string;
  /** Which delegate agent handles this role's work. */
  handlerAgent: DelegateAgentId;
  /** Lead agents this role's skill is installed for. */
  enabledForLeads: TerminalAgentId[];
  /** Whether the role is active (only enabled roles are synced). */
  enabled: boolean;
  /** User-defined (vs a built-in seed). */
  isCustom: boolean;
  /** This role's delegations need WRITE access to the workspace (the rendered
   *  skill adds `--write`, and the handler runs its write-capable recipe —
   *  e.g. codex `--sandbox workspace-write` so the Image Creator can save
   *  files). Only meaningful for handlers whose recipe defines `writeArgs`. */
  needsWrite?: boolean;
}

/** Server → GUI: the project's roles + the delegate agents available to assign. */
export interface TeamRolesResponse {
  ok: true;
  roles: TeamRole[];
  /** Delegate-capable agent ids (for the handler picker). */
  agents: DelegateAgentId[];
  /** Per role id → the buckets its skill is currently installed in (on disk),
   *  so the GUI can show install/remove diffs and apply state like Skills. */
  installed: Record<string, SkillBucket[]>;
}

/** Result of installing one role's skill into its leads' buckets. */
export interface TeamRoleSyncInfo {
  role: string;
  /** Number of bucket files written. */
  written: number;
  /** Paths skipped because a non-Clidable skill already owns them. */
  skipped: string[];
}

/** Server → GUI/CLI: outcome of `team sync`. */
export interface TeamSyncResponse {
  ok: true;
  results: TeamRoleSyncInfo[];
}

/* ---------------------------------------------------------------------------
 * /api/attachments — composer file/image uploads (PLAN.md §1).
 * ------------------------------------------------------------------------- */

/** Upload cap. Big enough for screenshots and design files, small enough that
 *  a stray video doesn't fill the disk. Shared so the client can reject an
 *  oversize file before uploading it and the server can enforce the same bound. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MiB

/** Server → GUI: a stored attachment. `path` is the absolute server-side path
 *  the composer appends to the agent message so the agent can read the file. */
export interface AttachmentUploadResponse {
  ok: true;
  path: string;
  /** Sanitized display name (basename of `path` minus the unique prefix). */
  name: string;
}
