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
 *   • Dependency-light — POSIX sh + curl, or Windows PowerShell; no jq/python.
 *   • Interpreter named explicitly — see `hookCommand`.
 *
 * Note: herdr's *current* hooks are capture-only (it derives status from
 * screen-scraping). Hook-based status is coarser but avoids that machinery.
 * Technique is prior art from herdr (AGPL); this is an independent implementation.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TerminalAgentId, TerminalAgentState } from "../../shared/types";

const IS_WINDOWS = process.platform === "win32";

/** The part of our script's filename that is the same on every platform. It is
 *  how we recognise OUR hook entries (see `isOursEntry`) — matching the full
 *  path instead would make each platform blind to the other's entries. */
const SCRIPT_STEM = "clidable-agent-state";

/** Our hook script's filename. Windows can't run a `#!/bin/sh` file — there is
 *  no shebang and no exec bit — so it gets a PowerShell twin instead. Exported
 *  so tests name the file the same way the installer does. */
export const SCRIPT_NAME = IS_WINDOWS ? `${SCRIPT_STEM}.ps1` : `${SCRIPT_STEM}.sh`;
export const MANAGED_MARKER = "managed by Clidable";

export type AgentState = TerminalAgentState;

interface HookEvent {
  /** The agent's hook event name (e.g. "UserPromptSubmit"). */
  event: string;
  /** The state this event maps to. */
  state: AgentState;
}

// --- the command an agent runs ---------------------------------------------

/** Quote a script path for the shell the agent hands the command to. A hook
 *  config stores ONE command string, so an unquoted path containing a space
 *  splits into two arguments and the hook silently never runs. That's routine
 *  on Windows (`C:\Users\First Last\…`) and reachable on POSIX through the
 *  config-dir env overrides (CLAUDE_CONFIG_DIR, COPILOT_HOME, …).
 *
 *  Only the POSIX branch escapes: a Windows filename cannot contain `"` at all,
 *  so there is nothing to escape there — and cmd.exe wouldn't honour backslash
 *  escaping if there were. Don't reuse this for arbitrary arguments. */
function quoteForShell(path: string): string {
  return IS_WINDOWS ? `"${path}"` : `'${path.replace(/'/g, `'"'"'`)}'`;
}

/**
 * The command string registered for one event. The interpreter is ALWAYS named
 * explicitly rather than relying on the shebang + exec bit, on both platforms —
 * that's the only form that works on Windows, and it costs POSIX nothing.
 *
 * `-ExecutionPolicy Bypass` is load-bearing: Windows' default policy refuses to
 * run an unsigned local .ps1, so without it the hook installs cleanly and then
 * silently never fires. `-NoProfile` skips the user's profile (faster, and no
 * inherited state). `powershell` (5.1) rather than `pwsh` (7) because only the
 * former is guaranteed present.
 *
 * Known cost, accepted: Windows pays a whole powershell.exe start per event.
 * Measured end-to-end in a Windows 11 VM (PS 5.1, ARM64): 251-350ms per hook
 * invocation, versus ~5ms for `sh`. PreToolUse fires on every tool call, so a
 * 100-call session spends ~30s of wall-clock in hook startup. Trimming the
 * Windows event set would cut it, at the price of coarser status; a compiled
 * reporter would fix it properly.
 */
export function hookCommand(scriptPath: string, state: string): string {
  const interpreter = IS_WINDOWS
    ? "powershell -NoProfile -ExecutionPolicy Bypass -File"
    : "sh";
  return `${interpreter} ${quoteForShell(scriptPath)} ${state}`;
}

const BOM = "\uFEFF";

/**
 * Write a hook script and make it runnable.
 *
 * chmod is POSIX-only: Windows has no exec bit (Node's chmod there only toggles
 * read-only) and `hookCommand` names the interpreter anyway.
 *
 * The BOM is not decoration. Windows PowerShell 5.1 — the one guaranteed to be
 * present, and the one `hookCommand` invokes — decodes a BOM-less .ps1 as the
 * system ANSI codepage, not UTF-8. Our managed header carries an em dash, so
 * without this the script is mis-decoded on any non-UTF-8 codepage.
 */
function writeScript(path: string, contents: string): void {
  writeFileSync(path, IS_WINDOWS ? BOM + contents : contents);
  if (!IS_WINDOWS) chmodSync(path, 0o755);
}

// --- the hook script (our code; sh + curl, or PowerShell) -------------------

/**
 * Read stdin into `$stdin`, capped at 3s. The POSIX scripts get this from
 * `timeout 3 cat`; PowerShell has no such wrapper, so we build the equivalent.
 *
 * The cap is the point: a hook invoked without a redirected stdin would
 * otherwise block on EOF that never comes, hanging whichever agent called it —
 * for agents that run hooks synchronously in their loop, on every event.
 *
 * Both lines below are load-bearing, and MEASURED on Windows 11 / PS 5.1
 * (5.1.26100.7019, ARM64) — the obvious
 * `[Console]::In.ReadToEndAsync().Wait(3000)` does NOT work:
 *
 *   • `[Console]::In` is a *SyncTextReader*, which overrides the async methods
 *     to run synchronously. `ReadToEndAsync()` therefore blocks BEFORE it ever
 *     returns a Task, so `.Wait(3000)` never gets to time anything out — a VM
 *     probe of that version sat at 15.0s (harness kill), not 3s. Opening a
 *     fresh StreamReader over the raw stdin stream gets a genuinely async
 *     ReadToEndAsync, so the budget is real: with the pipe held open, measured
 *     3.31s.
 *   • `IsInputRedirected` short-circuits the no-pipe case entirely rather than
 *     waiting out the budget for a read that can never produce anything:
 *     measured 0.32s, and the report still goes out with `raw` = {}.
 */
const PS_READ_STDIN = [
  '$stdin = ""',
  "if ([Console]::IsInputRedirected) {",
  "  $reader = $null",
  "  try {",
  "    $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())",
  "    $read = $reader.ReadToEndAsync()",
  "    if ($read.Wait(3000)) { $stdin = $read.Result }",
  "  } catch { }",
  "  finally { if ($null -ne $reader) { $reader.Dispose() } }",
  "}",
];

/** The lifecycle-reporting hook, in whichever language this platform can run. */
function hookScript(agent: string): string {
  return IS_WINDOWS ? hookScriptPs1(agent) : hookScriptSh(agent);
}

/** State is passed as $1; the raw event payload arrives on stdin (SessionStart
 *  carries session_id, which the server extracts). Inert unless CLIDABLE=1. */
function hookScriptSh(agent: string): string {
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

/**
 * The Windows twin of `hookScriptSh` — same contract (state as the first
 * argument, raw payload on stdin, inert unless CLIDABLE=1), expressed in
 * PowerShell.
 *
 * It parses and re-serialises the payload rather than splicing text like the sh
 * version, so a malformed payload degrades to `{}` instead of producing an
 * invalid body. Three PowerShell details are load-bearing:
 *
 *   • `-ErrorAction Stop` on ConvertFrom-Json. try/catch only handles
 *     TERMINATING errors, and `$ErrorActionPreference = "SilentlyContinue"`
 *     stops a parse failure from ever becoming one — so without this the catch
 *     never runs, the pipeline yields nothing, and `$raw` is overwritten with
 *     $null. The null re-check below is the belt to that braces.
 *   • `-Depth 12`. ConvertTo-Json defaults to 2 and would flatten anything
 *     deeper into "System.Object[]" strings, losing the very session_id we're
 *     here for.
 *   • The stdin read is time-capped (see `PS_READ_STDIN`) so a hook invoked
 *     without a redirected stdin can't hang the agent that called it.
 */
function hookScriptPs1(agent: string): string {
  return [
    `# ${MANAGED_MARKER} — do not edit; reinstalling overwrites this file.`,
    "# Reports agent lifecycle (state + SessionStart session id) to Clidable for",
    "# durable-session resume and the live status indicator. Inert unless the",
    "# session was launched by Clidable (CLIDABLE=1).",
    'param([string]$State = "")',
    '$ErrorActionPreference = "SilentlyContinue"',
    'if ($env:CLIDABLE -ne "1") { exit 0 }',
    "if ([string]::IsNullOrWhiteSpace($env:CLIDABLE_TERMINAL_ID)) { exit 0 }",
    "if ([string]::IsNullOrWhiteSpace($env:CLIDABLE_REPORT_URL)) { exit 0 }",
    ...PS_READ_STDIN,
    "$raw = @{}",
    "if (-not [string]::IsNullOrWhiteSpace($stdin)) {",
    "  $parsed = $null",
    "  try { $parsed = $stdin | ConvertFrom-Json -ErrorAction Stop } catch { $parsed = $null }",
    "  if ($null -ne $parsed) { $raw = $parsed }",
    "}",
    "try {",
    "  $body = @{",
    "    terminalId = $env:CLIDABLE_TERMINAL_ID",
    `    agent = ${JSON.stringify(agent)}`,
    "    state = $State",
    "    raw = $raw",
    "  } | ConvertTo-Json -Depth 12 -Compress",
    "  Invoke-RestMethod -Uri $env:CLIDABLE_REPORT_URL -Method Post `",
    '    -ContentType "application/json" -Body $body -TimeoutSec 2 | Out-Null',
    "} catch { }",
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

/** Every command string referenced by a hook entry (either shape). */
function entryCommands(entry: unknown): string[] {
  const e = entry as Json;
  if (!e) return [];
  if (Array.isArray(e.hooks)) {
    return e.hooks.map((h: Json) => h?.command).filter((c: unknown): c is string => typeof c === "string");
  }
  return typeof e.command === "string" ? [e.command] : [];
}

/**
 * An entry is ours if any of its commands references our script by NAME — in
 * any form we have ever written (bare, `bash `-prefixed, quoted) and from any
 * platform or path.
 *
 * Deliberately loose, because it drives removal. Matching the full script path
 * would make each platform blind to the other's entries, and a settings file
 * shared between machines (dotfiles sync, or CLAUDE_CONFIG_DIR pointed at a
 * shared location) would then accumulate one entry per platform — with the
 * foreign one failing to exec on every single event. `isCurrentEntry` is the
 * strict counterpart that decides whether to rewrite.
 */
function isOursEntry(entry: unknown): boolean {
  return entryCommands(entry).some((c) => c.includes(SCRIPT_STEM));
}

/** An entry is current if it carries exactly the command — and matcher — we'd
 *  write today. Strict on purpose: this is what `isInstalled` asks, so an entry
 *  written in an older format reports "not installed" and gets rewritten on the
 *  next spawn. Without it, everyone who installed before the quoting fix would
 *  keep the broken command forever, since `ensureHookInstalled` skips when
 *  installed. */
function isCurrentEntry(
  entry: unknown,
  scriptPath: string,
  state: string,
  matcher?: string,
): boolean {
  const expected = hookCommand(scriptPath, state);
  if (!entryCommands(entry).some((c) => c === expected)) return false;
  // A stripped matcher changes which events the agent actually routes to us,
  // so it has to count as "not current" and trigger a rewrite.
  return matcher === undefined || (entry as Json)?.matcher === matcher;
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
    const entry = buildEntry(spec, hookCommand(scriptPath, state));
    hooks[event] = [...arr.filter((e) => !isOursEntry(e)), entry];
  }
}

function removeEvents(root: Json, scriptPath: string): void {
  const hooks = root.hooks;
  if (!hooks || typeof hooks !== "object") return;
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const kept = hooks[event].filter((e: Json) => !isOursEntry(e));
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

/** Is codex's hooks feature switched on? Without it codex ignores hooks.json
 *  entirely, so this is half of "is the codex hook installed". */
function codexHooksEnabled(path: string): boolean {
  if (!existsSync(path)) return false;
  return /^\s*hooks\s*=\s*true/m.test(readFileSync(path, "utf8"));
}

/** Ensure `[features] hooks = true` in a codex config.toml (enables its hooks).
 *  Simplified line editor — idempotent, preserves the rest of the file.
 *
 *  Uses the same loose key match as `codexHooksEnabled` on purpose: if the two
 *  ever disagree, `isInstalled` stays false after a successful install and every
 *  spawn rewrites the user's config forever. */
function enableCodexHooksToml(path: string): void {
  if (codexHooksEnabled(path)) return; // already enabled
  let content = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (/^\s*hooks\s*=/m.test(content)) {
    // An explicit `hooks = false` must be FLIPPED, not shadowed by a second
    // line: TOML forbids duplicate keys, so appending one makes the whole file
    // unparseable — strictly worse than the disabled flag we came to fix.
    content = content.replace(/^(\s*)hooks\s*=.*$/m, "$1hooks = true");
  } else if (/^\s*\[features\]/m.test(content)) {
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
// entry shape; events are lowercase. (It used to carry its own `bash ` prefix;
// `hookCommand` now names the interpreter for every agent, so it doesn't.)
const CURSOR_SPEC: AgentHookSpec = {
  agent: "cursor",
  dir: () => process.env.CURSOR_CONFIG_DIR || join(homedir(), ".cursor"),
  scriptSubdir: "",
  hooksFile: "hooks.json",
  schema: "simple",
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
      writeScript(scriptPath, hookScript(spec.agent));

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
      // EVERY event, not just the first: a config where one entry survived but
      // the others were dropped (hand-edit, bad merge) would otherwise report
      // installed forever, and `ensureHookInstalled` would never repair it —
      // leaving the agent with no status transitions and nothing to show why.
      const current = spec.events.every(({ event, state }) => {
        const arr = root.hooks?.[event];
        return (
          Array.isArray(arr) &&
          arr.some((e: Json) => isCurrentEntry(e, scriptPath, state, spec.matcher))
        );
      });
      if (!current) return false;
      // Entries alone aren't enough for codex: install also flips the feature
      // flag that makes it read them at all, and that can be reverted
      // independently (config.toml edit, agent upgrade).
      return !spec.enableCodexToml || codexHooksEnabled(join(spec.dir(), "config.toml"));
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
      `command = ${tomlString(hookCommand(scriptPath, state))}\ntimeout = 10\n\n`;
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
    writeScript(scriptPath, hookScript("kimi"));
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
    const scriptPath = join(dir, "hooks", SCRIPT_NAME);
    if (!existsSync(scriptPath)) return false;
    const configPath = join(dir, "config.toml");
    if (!existsSync(configPath)) return false;
    const toml = readFileSync(configPath, "utf8");
    const first = KIMI_EVENTS[0]!;
    // Both the marker AND today's command shape — an older block reinstalls.
    return (
      toml.includes(KIMI_BLOCK_BEGIN) &&
      toml.includes(tomlString(hookCommand(scriptPath, first.state)))
    );
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

/** Antigravity's hook script, in whichever language this platform can run. */
function antigravityHookScript(): string {
  return IS_WINDOWS ? antigravityHookScriptPs1() : antigravityHookScriptSh();
}

/** Antigravity's hook script: hang-safe (agy blocks on it), reports the
 *  conversationId, and emits the JSON agy requires per event — `{}` for
 *  PreInvocation, and a non-"continue" decision for Stop (so it doesn't loop). */
function antigravityHookScriptSh(): string {
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

/**
 * The Windows twin of `antigravityHookScriptSh`. Same three obligations: read
 * stdin without hanging agy's loop, report the conversationId, and always print
 * the per-event JSON agy expects.
 *
 * The stdin read is time-capped by `PS_READ_STDIN` (the sh version uses
 * `timeout 3 cat`), which guarantees the decision JSON is always printed even
 * if agy never closes stdin.
 */
function antigravityHookScriptPs1(): string {
  return [
    `# ${MANAGED_MARKER} — do not edit; reinstalling overwrites this file.`,
    "# Reports agy's conversationId to Clidable and emits the per-event JSON agy",
    "# expects. Runs synchronously in agy's loop, so it returns fast: the stdin",
    "# read is time-capped and the response is a fixed object.",
    'param([string]$State = "working")',
    '$ErrorActionPreference = "SilentlyContinue"',
    ...PS_READ_STDIN,
    "$conv = $null",
    "if (-not [string]::IsNullOrWhiteSpace($stdin)) {",
    // -ErrorAction Stop: without it a parse failure is non-terminating, the
    // catch never fires, and $conv silently keeps whatever it had.
    "  try { $conv = ($stdin | ConvertFrom-Json -ErrorAction Stop).conversationId } catch { $conv = $null }",
    "}",
    'if ($env:CLIDABLE -eq "1" -and $conv -and',
    "    -not [string]::IsNullOrWhiteSpace($env:CLIDABLE_TERMINAL_ID) -and",
    "    -not [string]::IsNullOrWhiteSpace($env:CLIDABLE_REPORT_URL)) {",
    "  try {",
    "    $body = @{",
    "      terminalId = $env:CLIDABLE_TERMINAL_ID",
    '      agent = "antigravity"',
    "      state = $State",
    "      raw = @{ conversationId = $conv }",
    "    } | ConvertTo-Json -Depth 12 -Compress",
    "    Invoke-RestMethod -Uri $env:CLIDABLE_REPORT_URL -Method Post `",
    '      -ContentType "application/json" -Body $body -TimeoutSec 2 | Out-Null',
    "  } catch { }",
    "}",
    'if ($State -eq "idle") { Write-Output \'{"decision":"stop"}\' } else { Write-Output \'{}\' }',
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
    writeScript(scriptPath, antigravityHookScript());
    // Our own named hook; preserves the user's other named hooks untouched.
    root.clidable = {
      PreInvocation: [
        { type: "command", command: hookCommand(scriptPath, "working"), timeout: 10 },
      ],
      Stop: [{ type: "command", command: hookCommand(scriptPath, "idle"), timeout: 10 }],
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
    const scriptPath = join(dir, SCRIPT_NAME);
    if (!existsSync(scriptPath)) return false;
    const hooksPath = join(dir, "hooks.json");
    if (!existsSync(hooksPath)) return false;
    try {
      // Today's command shape, not just presence — an older entry reinstalls.
      const pre = readConfigOrThrow(hooksPath).clidable?.PreInvocation;
      return (
        Array.isArray(pre) &&
        pre.some((e: Json) => isCurrentEntry(e, scriptPath, "working"))
      );
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
