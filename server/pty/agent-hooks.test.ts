import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOOK_ADAPTERS, MANAGED_MARKER } from "./agent-hooks";

const claude = HOOK_ADAPTERS.claude!;
const codex = HOOK_ADAPTERS.codex!;
const copilot = HOOK_ADAPTERS.copilot!;
const cursor = HOOK_ADAPTERS.cursor!;
const kimi = HOOK_ADAPTERS.kimi!;
const opencode = HOOK_ADAPTERS.opencode!;
const antigravity = HOOK_ADAPTERS.antigravity!;

// Every agent's config-dir env var, pointed at the sandbox so no real config is
// touched. Saved/restored around each test. (opencode uses XDG_CONFIG_HOME.)
const ENV_VARS = [
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "COPILOT_HOME",
  "CURSOR_CONFIG_DIR",
  "KIMI_CODE_HOME",
  "XDG_CONFIG_HOME",
  "CLIDABLE_AGY_CONFIG_DIR",
] as const;
let dir: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  dir = mkdtempSync(join(tmpdir(), "clidable-hooks-"));
  for (const k of ENV_VARS) {
    saved[k] = process.env[k];
    process.env[k] = dir;
  }
});

afterEach(() => {
  for (const k of ENV_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

// --- Claude (settings.json, script under hooks/) ---------------------------

const claudeScript = () => join(dir, "hooks", "clidable-agent-state.sh");
const claudeSettings = () => join(dir, "settings.json");
const readClaude = () => JSON.parse(readFileSync(claudeSettings(), "utf8"));
/** [event, state] for every one of our entries in claude settings. */
const claudeOurEvents = () => {
  const hooks = readClaude().hooks as Record<string, any[]>;
  const out: Array<[string, string]> = [];
  for (const [event, entries] of Object.entries(hooks)) {
    for (const e of entries) {
      for (const h of e.hooks) {
        if (typeof h.command === "string" && h.command.startsWith(claudeScript())) {
          out.push([event, h.command.slice(claudeScript().length + 1)]); // trailing " <state>"
        }
      }
    }
  }
  return out;
};

describe("claude hook install (multi-event: capture + status)", () => {
  it("writes an executable env-gated script and registers status events", () => {
    claude.install();
    const script = readFileSync(claudeScript(), "utf8");
    expect(script).toContain(MANAGED_MARKER);
    expect(script).toContain('[ "${CLIDABLE:-}" != "1" ]'); // inert without CLIDABLE
    expect(script).toContain('state="${1:-}"'); // takes a state arg
    expect(script).toContain("curl");
    expect(statSync(claudeScript()).mode & 0o111).toBeGreaterThan(0);

    const events = Object.fromEntries(claudeOurEvents());
    expect(events.SessionStart).toBe("idle");
    expect(events.UserPromptSubmit).toBe("working");
    expect(events.Stop).toBe("idle");
    expect(events.Notification).toBe("blocked");
    expect(claude.isInstalled()).toBe(true);
  });

  it("preserves the user's other settings and hooks", () => {
    writeFileSync(
      claudeSettings(),
      JSON.stringify({
        model: "opus",
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "mine.sh" }] }] },
      }),
    );
    claude.install();
    const s = readClaude();
    expect(s.model).toBe("opus"); // untouched
    const preCmds = s.hooks.PreToolUse.flatMap((e: any) => e.hooks.map((h: any) => h.command));
    expect(preCmds).toContain("mine.sh"); // user's PreToolUse hook survives ours
    expect(preCmds.some((c: string) => c.startsWith(claudeScript()))).toBe(true); // ours added
  });

  it("is idempotent — installing twice leaves one of our entries per event", () => {
    claude.install();
    claude.install();
    const counts = claudeOurEvents().map(([e]) => e);
    expect(counts.filter((e) => e === "SessionStart")).toHaveLength(1);
    expect(counts.filter((e) => e === "Stop")).toHaveLength(1);
  });

  it("REFUSES to clobber an unparseable settings.json (no orphan script)", () => {
    writeFileSync(claudeSettings(), "{ not valid json");
    expect(() => claude.install()).toThrow(/not valid JSON/);
    expect(readFileSync(claudeSettings(), "utf8")).toBe("{ not valid json");
    expect(existsSync(claudeScript())).toBe(false);
  });

  it("uninstall removes all our entries + the script, leaving user settings", () => {
    writeFileSync(claudeSettings(), JSON.stringify({ model: "opus" }));
    claude.install();
    claude.uninstall();
    expect(existsSync(claudeScript())).toBe(false);
    expect(claude.isInstalled()).toBe(false);
    expect(readClaude().model).toBe("opus");
    expect(claudeOurEvents()).toHaveLength(0);
  });
});

// --- Codex (hooks.json at root + config.toml enable) -----------------------

describe("codex hook install (hooks.json + config.toml enable)", () => {
  it("writes hooks.json entries and flips [features] hooks = true", () => {
    codex.install();
    expect(existsSync(join(dir, "clidable-agent-state.sh"))).toBe(true); // script at root
    const hooks = JSON.parse(readFileSync(join(dir, "hooks.json"), "utf8")).hooks;
    expect(Array.isArray(hooks.SessionStart)).toBe(true);
    expect(Array.isArray(hooks.PermissionRequest)).toBe(true); // blocked signal
    const toml = readFileSync(join(dir, "config.toml"), "utf8");
    expect(toml).toContain("[features]");
    expect(toml).toMatch(/hooks\s*=\s*true/);
    expect(codex.isInstalled()).toBe(true);
  });

  it("config.toml enable is idempotent and preserves existing content", () => {
    writeFileSync(join(dir, "config.toml"), 'model = "o3"\n\n[features]\nother = true\n');
    codex.install();
    codex.install();
    const toml = readFileSync(join(dir, "config.toml"), "utf8");
    expect(toml).toContain('model = "o3"'); // preserved
    expect(toml).toContain("other = true"); // preserved
    expect((toml.match(/hooks\s*=\s*true/g) || [])).toHaveLength(1); // not duplicated
  });
});

// --- Copilot (settings.json under ~/.copilot, Claude-style) ----------------

describe("copilot hook install", () => {
  it("registers status events in settings.json and installs/uninstalls cleanly", () => {
    copilot.install();
    expect(existsSync(join(dir, "hooks", "clidable-agent-state.sh"))).toBe(true);
    const hooks = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).hooks;
    expect(Array.isArray(hooks.SessionStart)).toBe(true);
    expect(Array.isArray(hooks.UserPromptSubmit)).toBe(true);
    expect(copilot.isInstalled()).toBe(true);
    copilot.uninstall();
    expect(copilot.isInstalled()).toBe(false);
  });
});

// --- Cursor (hooks.json, simple {command} schema + version) ----------------

describe("cursor hook install (simple schema + version)", () => {
  it("adds version:1, lowercase events, and bash-prefixed simple commands", () => {
    cursor.install();
    const script = join(dir, "clidable-agent-state.sh"); // at dir root
    expect(existsSync(script)).toBe(true);
    const cfg = JSON.parse(readFileSync(join(dir, "hooks.json"), "utf8"));
    expect(cfg.version).toBe(1);
    // simple schema: entries are { command }, not { hooks: [...] }
    const entry = cfg.hooks.sessionStart[0];
    expect(entry.hooks).toBeUndefined();
    expect(entry.command).toBe(`bash ${script} idle`);
    expect(cfg.hooks.beforeSubmitPrompt[0].command).toBe(`bash ${script} working`);
    expect(cursor.isInstalled()).toBe(true);
  });

  it("preserves a pre-existing version and other hooks; uninstall removes ours", () => {
    writeFileSync(
      join(dir, "hooks.json"),
      JSON.stringify({ version: 2, hooks: { sessionStart: [{ command: "theirs.sh" }] } }),
    );
    cursor.install();
    const cfg = JSON.parse(readFileSync(join(dir, "hooks.json"), "utf8"));
    expect(cfg.version).toBe(2); // not overwritten
    const cmds = cfg.hooks.sessionStart.map((e: any) => e.command);
    expect(cmds).toContain("theirs.sh"); // their hook survives
    expect(cmds.some((c: string) => c.includes("clidable-agent-state.sh"))).toBe(true);

    cursor.uninstall();
    const after = JSON.parse(readFileSync(join(dir, "hooks.json"), "utf8"));
    expect(after.hooks.sessionStart.map((e: any) => e.command)).toEqual(["theirs.sh"]);
  });
});

// --- Kimi (managed [[hooks]] block in config.toml) -------------------------

describe("kimi hook install (config.toml block)", () => {
  it("adds a managed [[hooks]] block and installs the shell hook", () => {
    kimi.install();
    const script = join(dir, "hooks", "clidable-agent-state.sh");
    expect(existsSync(script)).toBe(true);
    const toml = readFileSync(join(dir, "config.toml"), "utf8");
    expect(toml).toContain("[[hooks]]");
    expect(toml).toContain('event = "SessionStart"');
    expect(toml).toContain('event = "Notification"'); // blocked signal (valid kimi event)
    expect(toml).toContain(`command = "${script} idle"`);
    expect(kimi.isInstalled()).toBe(true);
  });

  it("preserves the user's existing config and cleanly uninstalls the block", () => {
    writeFileSync(join(dir, "config.toml"), 'model = "kimi-k2"\n[[hooks]]\nevent = "mine"\ncommand = "x"\n');
    kimi.install();
    let toml = readFileSync(join(dir, "config.toml"), "utf8");
    expect(toml).toContain('model = "kimi-k2"'); // preserved
    expect(toml).toContain('event = "mine"'); // user's own hook preserved

    kimi.uninstall();
    toml = readFileSync(join(dir, "config.toml"), "utf8");
    expect(toml).toContain('model = "kimi-k2"'); // still there
    expect(toml).toContain('event = "mine"'); // still there
    expect(toml).not.toContain("clidable-agent-state.sh"); // ours removed
    expect(kimi.isInstalled()).toBe(false);
  });
});

// --- OpenCode (a JS plugin, not a shell hook) ------------------------------

describe("opencode plugin install", () => {
  it("writes an env-gated ESM plugin and installs/uninstalls cleanly", () => {
    opencode.install();
    const pluginPath = join(dir, "opencode", "plugins", "clidable-agent-state.js");
    expect(existsSync(pluginPath)).toBe(true);
    const src = readFileSync(pluginPath, "utf8");
    expect(src).toContain(MANAGED_MARKER);
    expect(src).toContain('process.env.CLIDABLE !== "1"'); // inert without CLIDABLE
    expect(src).toContain("export const ClidableAgentStatePlugin");
    expect(src).toContain("fetch(REPORT_URL"); // reports via loopback, no socket
    expect(opencode.isInstalled()).toBe(true);

    opencode.uninstall();
    expect(existsSync(pluginPath)).toBe(false);
    expect(opencode.isInstalled()).toBe(false);
  });
});

// --- Antigravity (named-hook map in ~/.gemini/config/hooks.json) ------------

describe("antigravity hook install (named-hook map)", () => {
  const hooksPath = () => join(dir, "hooks.json");
  const script = () => join(dir, "clidable-agent-state.sh");

  it("adds a 'clidable' named hook with PreInvocation + Stop and an event-aware script", () => {
    antigravity.install();
    expect(existsSync(script())).toBe(true);
    const src = readFileSync(script(), "utf8");
    expect(src).toContain('{"decision":"stop"}'); // Stop must return a decision
    expect(src).toContain("conversationId");

    const root = JSON.parse(readFileSync(hooksPath(), "utf8"));
    expect(root.clidable.PreInvocation[0].command).toBe(`${script()} working`);
    expect(root.clidable.Stop[0].command).toBe(`${script()} idle`);
    expect(antigravity.isInstalled()).toBe(true);
  });

  it("merges alongside the user's own named hooks (e.g. 'test')", () => {
    writeFileSync(
      hooksPath(),
      JSON.stringify({ test: { PreToolUse: [{ matcher: "Write", hooks: [{ command: "test" }] }] } }),
    );
    antigravity.install();
    const root = JSON.parse(readFileSync(hooksPath(), "utf8"));
    expect(root.test).toBeDefined(); // user's hook preserved
    expect(root.clidable).toBeDefined(); // ours added

    antigravity.uninstall();
    const after = JSON.parse(readFileSync(hooksPath(), "utf8"));
    expect(after.test).toBeDefined(); // still there
    expect(after.clidable).toBeUndefined(); // ours removed
    expect(existsSync(script())).toBe(false);
  });

  it("refuses to clobber an unparseable hooks.json", () => {
    writeFileSync(hooksPath(), "{ broken");
    expect(() => antigravity.install()).toThrow(/not valid JSON/);
    expect(existsSync(script())).toBe(false);
  });
});
