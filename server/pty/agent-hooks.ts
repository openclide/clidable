/**
 * Agent hook installers — write a small hook into each agent's own config so a
 * Clidable-spawned session reports its lifecycle back: the SessionStart session
 * id (for resume, `claude --resume <id>`) AND coarse status transitions
 * (working / idle / blocked) for the live status indicator.
 *
 * One hook script per agent, registered on several of that agent's events, each
 * carrying a state as its argument (`<script> working`). The script forwards
 * the raw event payload to /api/agent-hook, which pulls out the session id and
 * records the state.
 *
 * Design invariants:
 *   • Managed + reversible — our files carry a header; we only ever touch OUR
 *     entries, never the user's other settings/hooks.
 *   • Non-destructive — if an existing config won't parse, we ABORT.
 *   • Env-gated inert — the script early-exits unless CLIDABLE=1, so it does
 *     nothing during the user's normal (non-Clidable) agent use.
 *   • Dependency-light — pure sh + curl; no jq/python.
 *
 * Note: herdr's *current* hooks are capture-only (it derives status from
 * screen-scraping). Hook-based status is coarser but avoids that machinery.
 * Technique is prior art from herdr (AGPL); this is an independent implementation.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TerminalAgentId, TerminalAgentState } from "../../shared/types";

const SCRIPT_NAME = "clidable-agent-state.sh";
export const MANAGED_MARKER = "managed by Clidable";

export type AgentState = TerminalAgentState;

interface HookEvent {
  /** The agent's hook event name (e.g. "UserPromptSubmit"). */
  event: string;
  /** The state this event maps to. */
  state: AgentState;
}

// --- the hook script (our code; sh + curl) ---------------------------------

/** State is passed as $1; the raw event payload arrives on stdin (SessionStart
 *  carries session_id, which the server extracts). Inert unless CLIDABLE=1. */
function hookScript(agent: string): string {
  return [
    "#!/bin/sh",
    `# ${MANAGED_MARKER} — do not edit; reinstalling overwrites this file.`,
    "# Reports agent lifecycle (state + SessionStart session id) to Clidable for",
    "# durable-session resume and the live status indicator. Inert unless the",
    "# session was launched by Clidable (CLIDABLE=1).",
    'state="${1:-}"',
    'if [ "${CLIDABLE:-}" != "1" ]; then exit 0; fi',
    'if [ -z "${CLIDABLE_TERMINAL_ID:-}" ] || [ -z "${CLIDABLE_REPORT_URL:-}" ]; then exit 0; fi',
    "command -v curl >/dev/null 2>&1 || exit 0",
    'payload="$(cat 2>/dev/null)"',
    '[ -n "$payload" ] || payload="{}"',
    'curl -sS -m 2 -X POST "$CLIDABLE_REPORT_URL" \\',
    "  -H 'Content-Type: application/json' \\",
    '  --data-binary "{\\"terminalId\\":\\"$CLIDABLE_TERMINAL_ID\\",\\"agent\\":\\"' +
      agent +
      '\\",\\"state\\":\\"$state\\",\\"raw\\":$payload}" \\',
    "  >/dev/null 2>&1",
    "exit 0",
    "",
  ].join("\n");
}

// --- shared JSON "hooks object" manipulation (claude & codex both use it) ---

type Json = Record<string, any>;

/** Two hook-entry shapes across agents:
 *   • nested  — {matcher?, hooks:[{type:"command", command}]}  (claude/codex/copilot)
 *   • simple  — {command}                                       (cursor)  */
type HookSchema = "nested" | "simple";

function commandFor(spec: AgentHookSpec, scriptPath: string, state: string): string {
  return `${spec.commandPrefix ?? ""}${scriptPath} ${state}`;
}

/** Every command string referenced by a hook entry (either shape). */
function entryCommands(entry: unknown): string[] {
  const e = entry as Json;
  if (!e) return [];
  if (Array.isArray(e.hooks)) {
    return e.hooks.map((h: Json) => h?.command).filter((c: unknown): c is string => typeof c === "string");
  }
  return typeof e.command === "string" ? [e.command] : [];
}

/** An entry is ours if any of its commands references our script path (matches
 *  both the bare and the `bash <path>`-prefixed forms). */
function isOursEntry(entry: unknown, scriptPath: string): boolean {
  return entryCommands(entry).some((c) => c.includes(scriptPath));
}

function buildEntry(spec: AgentHookSpec, command: string): Json {
  if (spec.schema === "simple") return { command };
  const e: Json = { hooks: [{ type: "command", command }] };
  if (spec.matcher !== undefined) e.matcher = spec.matcher;
  return e;
}

function mergeEvents(root: Json, spec: AgentHookSpec, scriptPath: string): void {
  if (typeof root.hooks !== "object" || root.hooks === null) root.hooks = {};
  const hooks = root.hooks as Json;
  for (const { event, state } of spec.events) {
    const arr: Json[] = Array.isArray(hooks[event]) ? hooks[event] : [];
    const entry = buildEntry(spec, commandFor(spec, scriptPath, state));
    hooks[event] = [...arr.filter((e) => !isOursEntry(e, scriptPath)), entry];
  }
}

function removeEvents(root: Json, scriptPath: string): void {
  const hooks = root.hooks;
  if (!hooks || typeof hooks !== "object") return;
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const kept = hooks[event].filter((e: Json) => !isOursEntry(e, scriptPath));
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
}

/** Read a JSON config. {} when missing; THROWS when present but unparseable —
 *  we must never clobber a config we can't read. */
function readConfigOrThrow(path: string): Json {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as Json;
  } catch (e) {
    throw new Error(
      `refusing to modify ${path}: existing file is not valid JSON (${(e as Error).message})`,
    );
  }
}

/** Ensure `[features] hooks = true` in a codex config.toml (enables its hooks).
 *  Simplified line editor — idempotent, preserves the rest of the file. */
function enableCodexHooksToml(path: string): void {
  let content = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (/^\s*hooks\s*=\s*true/m.test(content)) return; // already enabled
  if (/^\s*\[features\]/m.test(content)) {
    content = content.replace(/^(\s*\[features\][^\n]*)$/m, "$1\nhooks = true");
  } else {
    const base = content.replace(/\n*$/, "");
    content = base + (base ? "\n\n" : "") + "[features]\nhooks = true\n";
  }
  writeFileSync(path, content);
}

// --- per-agent specs -------------------------------------------------------

interface AgentHookSpec {
  agent: TerminalAgentId;
  /** The agent's config dir (respects its env override → tests can sandbox). */
  dir: () => string;
  /** Sub-dir under `dir` for our script ("hooks" for claude; "" for codex). */
  scriptSubdir: string;
  /** JSON file (relative to `dir`) holding the hooks object. */
  hooksFile: string;
  /** Entry shape: nested (claude/codex/copilot) or simple (cursor). */
  schema: HookSchema;
  /** Some agents (claude) want a matcher on each nested entry; codex omits it. */
  matcher?: string;
  /** Prefix on the command (cursor needs `bash `; others none). */
  commandPrefix?: string;
  /** A top-level version the agent's hooks file requires (cursor: 1). */
  version?: number;
  events: HookEvent[];
  /** Codex also needs `[features] hooks = true` in config.toml. */
  enableCodexToml?: boolean;
}

// Claude Code hook events → coarse status. SessionStart also carries session_id.
const CLAUDE_SPEC: AgentHookSpec = {
  agent: "claude",
  dir: () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
  scriptSubdir: "hooks",
  hooksFile: "settings.json",
  schema: "nested",
  matcher: "*",
  events: [
    { event: "SessionStart", state: "idle" },
    { event: "UserPromptSubmit", state: "working" },
    { event: "PreToolUse", state: "working" },
    { event: "Stop", state: "idle" },
    { event: "Notification", state: "blocked" }, // fires when Claude awaits input
  ],
};

// Codex hook events (registered in hooks.json; enabled via config.toml).
const CODEX_SPEC: AgentHookSpec = {
  agent: "codex",
  dir: () => process.env.CODEX_HOME || join(homedir(), ".codex"),
  scriptSubdir: "",
  hooksFile: "hooks.json",
  schema: "nested",
  events: [
    { event: "SessionStart", state: "idle" },
    { event: "UserPromptSubmit", state: "working" },
    { event: "PreToolUse", state: "working" },
    { event: "Stop", state: "idle" },
    { event: "PermissionRequest", state: "blocked" },
  ],
  enableCodexToml: true,
};

// GitHub Copilot CLI — same settings.json hooks object as Claude (~/.copilot).
const COPILOT_SPEC: AgentHookSpec = {
  agent: "copilot",
  dir: () => process.env.COPILOT_HOME || join(homedir(), ".copilot"),
  scriptSubdir: "hooks",
  hooksFile: "settings.json",
  schema: "nested",
  matcher: "*",
  events: [
    { event: "SessionStart", state: "idle" },
    { event: "UserPromptSubmit", state: "working" },
    { event: "PreToolUse", state: "working" },
    { event: "Stop", state: "idle" },
  ],
};

// Cursor Agent — hooks.json with a `version` field and a SIMPLE `{command}`
// entry shape; events are lowercase and the command is `bash <script> <state>`.
const CURSOR_SPEC: AgentHookSpec = {
  agent: "cursor",
  dir: () => process.env.CURSOR_CONFIG_DIR || join(homedir(), ".cursor"),
  scriptSubdir: "",
  hooksFile: "hooks.json",
  schema: "simple",
  commandPrefix: "bash ",
  version: 1,
  events: [
    { event: "sessionStart", state: "idle" },
    { event: "beforeSubmitPrompt", state: "working" },
    { event: "beforeShellExecution", state: "working" },
    { event: "stop", state: "idle" },
  ],
};

// --- adapter (install / uninstall / isInstalled) ---------------------------

export interface HookAdapter {
  agent: TerminalAgentId;
  configDir(): string;
  install(): void;
  uninstall(): void;
  isInstalled(): boolean;
}

function scriptPathFor(spec: AgentHookSpec): string {
  return join(spec.dir(), spec.scriptSubdir, SCRIPT_NAME);
}

function makeAdapter(spec: AgentHookSpec): HookAdapter {
  return {
    agent: spec.agent,
    configDir: spec.dir,

    install() {
      const scriptPath = scriptPathFor(spec);
      const hooksPath = join(spec.dir(), spec.hooksFile);
      // Parse the existing config BEFORE writing anything, so a parse failure
      // aborts the install instead of leaving an orphan script behind.
      const root = readConfigOrThrow(hooksPath);

      mkdirSync(join(spec.dir(), spec.scriptSubdir), { recursive: true });
      writeFileSync(scriptPath, hookScript(spec.agent));
      chmodSync(scriptPath, 0o755);

      // Some hooks files carry a required top-level version (cursor).
      if (spec.version !== undefined && root.version === undefined) {
        root.version = spec.version;
      }
      mergeEvents(root, spec, scriptPath);
      writeFileSync(hooksPath, JSON.stringify(root, null, 2) + "\n");

      if (spec.enableCodexToml) enableCodexHooksToml(join(spec.dir(), "config.toml"));
    },

    uninstall() {
      const scriptPath = scriptPathFor(spec);
      const hooksPath = join(spec.dir(), spec.hooksFile);
      if (existsSync(hooksPath)) {
        const root = readConfigOrThrow(hooksPath);
        removeEvents(root, scriptPath);
        writeFileSync(hooksPath, JSON.stringify(root, null, 2) + "\n");
      }
      if (existsSync(scriptPath)) {
        try {
          rmSync(scriptPath);
        } catch {
          // already gone
        }
      }
    },

    isInstalled() {
      const scriptPath = scriptPathFor(spec);
      if (!existsSync(scriptPath)) return false;
      const hooksPath = join(spec.dir(), spec.hooksFile);
      if (!existsSync(hooksPath)) return false;
      let root: Json;
      try {
        root = readConfigOrThrow(hooksPath);
      } catch {
        return false;
      }
      const first = spec.events[0]?.event;
      const arr = first ? root.hooks?.[first] : undefined;
      return Array.isArray(arr) && arr.some((e: Json) => isOursEntry(e, scriptPath));
    },
  };
}

// --- Kimi: a managed [[hooks]] block in config.toml (reuses our shell hook) --

function kimiConfigDir(): string {
  return process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
}

const KIMI_BLOCK_BEGIN = "# >>> clidable hooks (managed) >>>";
const KIMI_BLOCK_END = "# <<< clidable hooks (managed) <<<";
// Kimi STRICTLY validates event names against its own enum and refuses to start
// on an unknown one — so these must all be real. Verified against kimi-code's
// schema: valid names are PreToolUse, PostToolUse, PostToolUseFailure,
// UserPromptSubmit, Stop, StopFailure, SessionStart, SessionEnd, SubagentStart,
// SubagentStop, PreCompact, PostCompact, Notification. (herdr's list included
// PermissionRequest/PermissionResult/Interrupt, which this kimi rejects.)
const KIMI_EVENTS: HookEvent[] = [
  { event: "SessionStart", state: "idle" },
  { event: "UserPromptSubmit", state: "working" },
  { event: "PreToolUse", state: "working" },
  { event: "SubagentStart", state: "working" },
  { event: "PreCompact", state: "working" },
  { event: "Notification", state: "blocked" }, // kimi's await-input signal
  { event: "Stop", state: "idle" },
];

function tomlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Strip our managed block (between the markers) from a config.toml. */
function removeKimiBlock(content: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of content.split("\n")) {
    if (line.trim() === KIMI_BLOCK_BEGIN) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line.trim() === KIMI_BLOCK_END) inBlock = false;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function buildKimiConfig(content: string, scriptPath: string): string {
  let result = removeKimiBlock(content).replace(/\n+$/, "");
  if (result) result += "\n\n";
  result += KIMI_BLOCK_BEGIN + "\n";
  for (const { event, state } of KIMI_EVENTS) {
    result +=
      `[[hooks]]\nevent = ${tomlString(event)}\n` +
      `command = ${tomlString(`${scriptPath} ${state}`)}\ntimeout = 10\n\n`;
  }
  result += KIMI_BLOCK_END + "\n";
  return result;
}

const kimiAdapter: HookAdapter = {
  agent: "kimi",
  configDir: kimiConfigDir,
  install() {
    const dir = kimiConfigDir();
    mkdirSync(join(dir, "hooks"), { recursive: true });
    const scriptPath = join(dir, "hooks", SCRIPT_NAME);
    writeFileSync(scriptPath, hookScript("kimi"));
    chmodSync(scriptPath, 0o755);
    const configPath = join(dir, "config.toml");
    const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    writeFileSync(configPath, buildKimiConfig(existing, scriptPath));
  },
  uninstall() {
    const dir = kimiConfigDir();
    const configPath = join(dir, "config.toml");
    if (existsSync(configPath)) {
      const cleaned = removeKimiBlock(readFileSync(configPath, "utf8")).replace(/\n+$/, "");
      writeFileSync(configPath, cleaned ? cleaned + "\n" : "");
    }
    const scriptPath = join(dir, "hooks", SCRIPT_NAME);
    if (existsSync(scriptPath)) {
      try {
        rmSync(scriptPath);
      } catch {
        // already gone
      }
    }
  },
  isInstalled() {
    const dir = kimiConfigDir();
    if (!existsSync(join(dir, "hooks", SCRIPT_NAME))) return false;
    const configPath = join(dir, "config.toml");
    return existsSync(configPath) && readFileSync(configPath, "utf8").includes(KIMI_BLOCK_BEGIN);
  },
};

// --- OpenCode: a JS plugin (not a shell hook) --------------------------------

function opencodeDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "opencode");
}

const OPENCODE_PLUGIN_NAME = "clidable-agent-state.js";

/** Our OpenCode plugin (authored fresh; opencode's plugin API is the reference,
 *  herdr's asset is not copied). ESM module exporting an async factory that
 *  returns event handlers; reports via fetch to our loopback endpoint. Inert
 *  unless launched by Clidable (CLIDABLE=1). */
function opencodePlugin(): string {
  return `// ${MANAGED_MARKER} — do not edit; reinstalling overwrites this file.
// Reports OpenCode session lifecycle (session id + working/idle/blocked) to
// Clidable for durable-session resume and the status indicator. Inert unless
// the session was launched by Clidable (CLIDABLE=1).
const TERMINAL_ID = process.env.CLIDABLE_TERMINAL_ID;
const REPORT_URL = process.env.CLIDABLE_REPORT_URL;
const childSessions = new Set();

async function report(state, sessionID) {
  if (!TERMINAL_ID || !REPORT_URL) return;
  try {
    await fetch(REPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        terminalId: TERMINAL_ID,
        agent: "opencode",
        state: state || null,
        raw: sessionID ? { session_id: sessionID } : {},
      }),
    });
  } catch {}
}

export const ClidableAgentStatePlugin = async () => {
  if (process.env.CLIDABLE !== "1" || !TERMINAL_ID || !REPORT_URL) return {};
  return {
    "chat.message": async ({ sessionID }) => {
      if (sessionID && childSessions.has(sessionID)) return;
      await report("working", sessionID);
    },
    event: async ({ event }) => {
      const type = event && event.type;
      const props = (event && event.properties) || {};
      const sessionID = typeof props.sessionID === "string" && props.sessionID ? props.sessionID : undefined;
      const info = props.info;
      if (info && info.id && info.parentID) childSessions.add(info.id);
      if (sessionID && childSessions.has(sessionID)) {
        if (type === "permission.asked" || type === "question.asked") await report("blocked");
        else if (type === "permission.replied" || type === "question.replied") await report("working");
        return;
      }
      switch (type) {
        case "session.created":
        case "session.updated":
          await report(null, sessionID);
          break;
        case "session.status": {
          const s = props.status;
          const kind = typeof s === "string" ? s : s && s.type;
          await report(kind === "idle" ? "idle" : kind ? "working" : null, sessionID);
          break;
        }
        case "tool.execute.before":
        case "tool.execute.after":
        case "permission.replied":
        case "question.replied":
        case "session.compacted":
          await report("working", sessionID);
          break;
        case "permission.asked":
        case "question.asked":
        case "session.error":
          await report("blocked", sessionID);
          break;
        case "session.idle":
          await report("idle", sessionID);
          break;
        default:
          break;
      }
    },
  };
};
`;
}

const opencodeAdapter: HookAdapter = {
  agent: "opencode",
  configDir: opencodeDir,
  install() {
    const pluginsDir = join(opencodeDir(), "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, OPENCODE_PLUGIN_NAME), opencodePlugin());
  },
  uninstall() {
    const p = join(opencodeDir(), "plugins", OPENCODE_PLUGIN_NAME);
    if (existsSync(p)) {
      try {
        rmSync(p);
      } catch {
        // already gone
      }
    }
  },
  isInstalled() {
    return existsSync(join(opencodeDir(), "plugins", OPENCODE_PLUGIN_NAME));
  },
};

// --- Antigravity (agy): hooks.json is a NAMED-hook map; hooks run synchronously
//     in the agent loop so the script must return fast with event-correct JSON.
//     Verified live (agy 1.1.4): PreInvocation + Stop fire with conversationId
//     on stdin. Config lives in ~/.gemini/config/hooks.json (global). ------------

function antigravityConfigDir(): string {
  // No agy env override exists; CLIDABLE_AGY_CONFIG_DIR is a test-only seam.
  return process.env.CLIDABLE_AGY_CONFIG_DIR || join(homedir(), ".gemini", "config");
}

/** Antigravity's hook script: hang-safe (agy blocks on it), reports the
 *  conversationId, and emits the JSON agy requires per event — `{}` for
 *  PreInvocation, and a non-"continue" decision for Stop (so it doesn't loop). */
function antigravityHookScript(): string {
  return [
    "#!/bin/sh",
    `# ${MANAGED_MARKER} — do not edit; reinstalling overwrites this file.`,
    "# Reports agy's conversationId to Clidable and emits the per-event JSON agy",
    "# expects. Runs synchronously in agy's loop, so it returns fast: the stdin",
    "# read is time-capped and the response is a fixed object.",
    'state="${1:-working}"',
    'payload="$(timeout 3 cat 2>/dev/null)"',
    `conv=$(printf '%s' "$payload" | sed -n 's/.*"conversationId"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')`,
    'if [ "${CLIDABLE:-}" = "1" ] && [ -n "${CLIDABLE_TERMINAL_ID:-}" ] && [ -n "${CLIDABLE_REPORT_URL:-}" ] && [ -n "$conv" ] && command -v curl >/dev/null 2>&1; then',
    "  curl -sS -m 2 -X POST \"$CLIDABLE_REPORT_URL\" -H 'Content-Type: application/json' \\",
    '    --data-binary "{\\"terminalId\\":\\"$CLIDABLE_TERMINAL_ID\\",\\"agent\\":\\"antigravity\\",\\"state\\":\\"$state\\",\\"raw\\":{\\"conversationId\\":\\"$conv\\"}}" >/dev/null 2>&1',
    "fi",
    `if [ "$state" = "idle" ]; then echo '{"decision":"stop"}'; else echo '{}'; fi`,
    "exit 0",
    "",
  ].join("\n");
}

const antigravityAdapter: HookAdapter = {
  agent: "antigravity",
  configDir: antigravityConfigDir,
  install() {
    const dir = antigravityConfigDir();
    mkdirSync(dir, { recursive: true });
    const scriptPath = join(dir, SCRIPT_NAME);
    const hooksPath = join(dir, "hooks.json");
    // Parse existing named-hook map BEFORE writing (abort on unparseable).
    const root = readConfigOrThrow(hooksPath);
    writeFileSync(scriptPath, antigravityHookScript());
    chmodSync(scriptPath, 0o755);
    // Our own named hook; preserves the user's other named hooks untouched.
    root.clidable = {
      PreInvocation: [{ type: "command", command: `${scriptPath} working`, timeout: 10 }],
      Stop: [{ type: "command", command: `${scriptPath} idle`, timeout: 10 }],
    };
    writeFileSync(hooksPath, JSON.stringify(root, null, 2) + "\n");
  },
  uninstall() {
    const dir = antigravityConfigDir();
    const hooksPath = join(dir, "hooks.json");
    if (existsSync(hooksPath)) {
      const root = readConfigOrThrow(hooksPath);
      if (root.clidable) {
        delete root.clidable;
        writeFileSync(hooksPath, JSON.stringify(root, null, 2) + "\n");
      }
    }
    const scriptPath = join(dir, SCRIPT_NAME);
    if (existsSync(scriptPath)) {
      try {
        rmSync(scriptPath);
      } catch {
        // already gone
      }
    }
  },
  isInstalled() {
    const dir = antigravityConfigDir();
    if (!existsSync(join(dir, SCRIPT_NAME))) return false;
    const hooksPath = join(dir, "hooks.json");
    if (!existsSync(hooksPath)) return false;
    try {
      return !!readConfigOrThrow(hooksPath).clidable;
    } catch {
      return false;
    }
  },
};

/** Hook adapters by agent — all 7 with a working hook mechanism (antigravity
 *  verified live on agy 1.1.4). qwen: not yet probed. */
export const HOOK_ADAPTERS: Partial<Record<TerminalAgentId, HookAdapter>> = {
  claude: makeAdapter(CLAUDE_SPEC),
  codex: makeAdapter(CODEX_SPEC),
  copilot: makeAdapter(COPILOT_SPEC),
  cursor: makeAdapter(CURSOR_SPEC),
  kimi: kimiAdapter,
  opencode: opencodeAdapter,
  antigravity: antigravityAdapter,
};

export function hasHookAdapter(agent: string): boolean {
  return agent in HOOK_ADAPTERS;
}

/**
 * Ensure the agent's hook is installed. Idempotent (skips the write when already
 * present) and best-effort — a failure must never block a spawn.
 */
export function ensureHookInstalled(agent: TerminalAgentId): void {
  const adapter = HOOK_ADAPTERS[agent];
  if (!adapter) return;
  try {
    if (!adapter.isInstalled()) adapter.install();
  } catch {
    // best-effort — resume/status simply won't be available for this agent
  }
}
