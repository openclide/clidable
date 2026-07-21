import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOOK_ADAPTERS, MANAGED_MARKER, SCRIPT_NAME, hookCommand } from "./agent-hooks";

const IS_WINDOWS = process.platform === "win32";

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

const claudeScript = () => join(dir, "hooks", SCRIPT_NAME);
const claudeSettings = () => join(dir, "settings.json");
const readClaude = () => JSON.parse(readFileSync(claudeSettings(), "utf8"));
/** [event, state] for every one of our entries in claude settings. The state is
 *  recovered by matching the whole command against `hookCommand` rather than by
 *  splitting on spaces — the command's shape is the contract under test, and a
 *  quoted path can itself contain spaces. */
const STATES = ["idle", "working", "blocked"] as const;
const claudeOurEvents = () => {
  const hooks = readClaude().hooks as Record<string, any[]>;
  const out: Array<[string, string]> = [];
  for (const [event, entries] of Object.entries(hooks)) {
    for (const e of entries) {
      for (const h of e.hooks) {
        if (typeof h.command !== "string") continue;
        const state = STATES.find((st) => h.command === hookCommand(claudeScript(), st));
        if (state) out.push([event, state]);
      }
    }
  }
  return out;
};

// --- the command shape (the cross-platform contract) -----------------------

describe("hookCommand", () => {
  it("names an interpreter rather than relying on the shebang + exec bit", () => {
    const cmd = hookCommand("/tmp/h.sh", "idle");
    if (IS_WINDOWS) {
      // Without -ExecutionPolicy Bypass, Windows' default policy refuses an
      // unsigned local .ps1 and the hook silently never fires.
      expect(cmd).toContain("powershell -NoProfile -ExecutionPolicy Bypass -File");
    } else {
      expect(cmd.startsWith("sh ")).toBe(true);
    }
    expect(cmd.endsWith(" idle")).toBe(true);
  });

  it("quotes a path containing a space so it stays one argument", () => {
    const cmd = hookCommand(join("/tmp", "First Last", "h.sh"), "working");
    // The path must not appear bare — that's the bug: an unquoted space splits
    // the command into two arguments and the hook never runs.
    const quote = IS_WINDOWS ? '"' : "'";
    expect(cmd).toContain(`${quote}${join("/tmp", "First Last", "h.sh")}${quote}`);
  });
});

describe("upgrading an install written by an older Clidable", () => {
  it("reports not-installed for a legacy bare-path entry, then replaces it", () => {
    claude.install(); // lays down the script file, so isInstalled reaches the entry check
    // Rewrite our entry to the pre-fix shape: bare, unquoted, no interpreter.
    const settings = readClaude();
    settings.hooks.SessionStart = [
      { matcher: "*", hooks: [{ type: "command", command: `${claudeScript()} idle` }] },
    ];
    writeFileSync(claudeSettings(), JSON.stringify(settings));

    // This is what makes the fix reach existing users: ensureHookInstalled skips
    // when installed, so a legacy entry MUST report false or it never upgrades.
    expect(claude.isInstalled()).toBe(false);

    claude.install();
    expect(claude.isInstalled()).toBe(true);
    // Upgraded in place — the legacy entry is replaced, not duplicated.
    const ours = readClaude()
      .hooks.SessionStart.flatMap((e: any) => e.hooks.map((h: any) => h.command))
      .filter((c: string) => c.includes(claudeScript()));
    expect(ours).toEqual([hookCommand(claudeScript(), "idle")]);
  });

  it("recognises (and replaces) an entry written on the OTHER platform", () => {
    claude.install();
    // What a Windows install leaves behind, seen from a POSIX host: different
    // extension, different path separators, different interpreter. A settings
    // file shared across machines (dotfiles sync, shared CLAUDE_CONFIG_DIR)
    // hits this — and a foreign entry left in place fails to exec on EVERY
    // event, so it has to be recognised as ours and swapped, not accumulated.
    const foreign =
      'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\\Users\\a\\.claude\\hooks\\clidable-agent-state.ps1" idle';
    const settings = readClaude();
    settings.hooks.SessionStart = [
      { matcher: "*", hooks: [{ type: "command", command: foreign }] },
    ];
    writeFileSync(claudeSettings(), JSON.stringify(settings));

    expect(claude.isInstalled()).toBe(false);
    claude.install();

    const cmds = readClaude().hooks.SessionStart.flatMap((e: any) =>
      e.hooks.map((h: any) => h.command),
    );
    expect(cmds).toEqual([hookCommand(claudeScript(), "idle")]); // swapped, not appended
  });

  it("reports not-installed when a NON-first event was dropped", () => {
    claude.install();
    // Only SessionStart used to be checked, so losing Stop went unnoticed
    // forever and the agent silently never reported going idle again.
    const settings = readClaude();
    delete settings.hooks.Stop;
    writeFileSync(claudeSettings(), JSON.stringify(settings));

    expect(claude.isInstalled()).toBe(false);
    claude.install();
    expect(claude.isInstalled()).toBe(true);
    expect(Object.fromEntries(claudeOurEvents()).Stop).toBe("idle");
  });

  it("reports not-installed when our matcher was stripped", () => {
    claude.install();
    const settings = readClaude();
    settings.hooks.SessionStart[0].matcher = undefined;
    writeFileSync(claudeSettings(), JSON.stringify(settings));

    expect(claude.isInstalled()).toBe(false);
  });

  it("codex: reports not-installed when the hooks feature flag is reverted", () => {
    codex.install();
    expect(codex.isInstalled()).toBe(true);
    // hooks.json is untouched and current — but codex ignores it entirely
    // without the feature flag, so entries alone must not count as installed.
    writeFileSync(join(dir, "config.toml"), "[features]\nhooks = false\n");
    expect(codex.isInstalled()).toBe(false);

    codex.install();
    expect(codex.isInstalled()).toBe(true);
    const toml = readFileSync(join(dir, "config.toml"), "utf8");
    expect(toml).toMatch(/hooks\s*=\s*true/);
    // Flipped in place, not shadowed — TOML forbids duplicate keys, so leaving
    // the old `hooks = false` behind would make codex fail to parse the file
    // at all: a worse outcome than the disabled flag we came to repair.
    expect(toml).not.toMatch(/hooks\s*=\s*false/);
    expect(toml.match(/^\s*hooks\s*=/gm) ?? []).toHaveLength(1);
  });
});

describe("claude hook install (multi-event: capture + status)", () => {
  it("writes an executable env-gated script and registers status events", () => {
    claude.install();
    const script = readFileSync(claudeScript(), "utf8");
    expect(script).toContain(MANAGED_MARKER);
    if (IS_WINDOWS) {
      expect(script).toContain('$env:CLIDABLE -ne "1"'); // inert without CLIDABLE
      expect(script).toContain('param([string]$State = "")'); // takes a state arg
      expect(script).toContain("Invoke-RestMethod");
    } else {
      expect(script).toContain('[ "${CLIDABLE:-}" != "1" ]'); // inert without CLIDABLE
      expect(script).toContain('state="${1:-}"'); // takes a state arg
      expect(script).toContain("curl");
      // No exec bit on Windows — the command names the interpreter instead.
      expect(statSync(claudeScript()).mode & 0o111).toBeGreaterThan(0);
    }

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
    expect(preCmds.some((c: string) => c.includes(claudeScript()))).toBe(true); // ours added
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
    expect(existsSync(join(dir, SCRIPT_NAME))).toBe(true); // script at root
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
    expect(existsSync(join(dir, "hooks", SCRIPT_NAME))).toBe(true);
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
  it("adds version:1, lowercase events, and interpreter-prefixed simple commands", () => {
    cursor.install();
    const script = join(dir, SCRIPT_NAME); // at dir root
    expect(existsSync(script)).toBe(true);
    const cfg = JSON.parse(readFileSync(join(dir, "hooks.json"), "utf8"));
    expect(cfg.version).toBe(1);
    // simple schema: entries are { command }, not { hooks: [...] }
    const entry = cfg.hooks.sessionStart[0];
    expect(entry.hooks).toBeUndefined();
    expect(entry.command).toBe(hookCommand(script, "idle"));
    expect(cfg.hooks.beforeSubmitPrompt[0].command).toBe(hookCommand(script, "working"));
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
    expect(cmds.some((c: string) => c.includes(SCRIPT_NAME))).toBe(true);

    cursor.uninstall();
    const after = JSON.parse(readFileSync(join(dir, "hooks.json"), "utf8"));
    expect(after.hooks.sessionStart.map((e: any) => e.command)).toEqual(["theirs.sh"]);
  });
});

// --- Kimi (managed [[hooks]] block in config.toml) -------------------------

describe("kimi hook install (config.toml block)", () => {
  it("adds a managed [[hooks]] block and installs the shell hook", () => {
    kimi.install();
    const script = join(dir, "hooks", SCRIPT_NAME);
    expect(existsSync(script)).toBe(true);
    const toml = readFileSync(join(dir, "config.toml"), "utf8");
    expect(toml).toContain("[[hooks]]");
    expect(toml).toContain('event = "SessionStart"');
    expect(toml).toContain('event = "Notification"'); // blocked signal (valid kimi event)
    // TOML basic strings escape \ and " exactly as JSON does, so this is the
    // same serialisation the installer writes (backslashes matter on Windows).
    expect(toml).toContain(`command = ${JSON.stringify(hookCommand(script, "idle"))}`);
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
    expect(toml).not.toContain(SCRIPT_NAME); // ours removed
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
  const script = () => join(dir, SCRIPT_NAME);

  it("adds a 'clidable' named hook with PreInvocation + Stop and an event-aware script", () => {
    antigravity.install();
    expect(existsSync(script())).toBe(true);
    const src = readFileSync(script(), "utf8");
    expect(src).toContain('{"decision":"stop"}'); // Stop must return a decision
    expect(src).toContain("conversationId");

    const root = JSON.parse(readFileSync(hooksPath(), "utf8"));
    expect(root.clidable.PreInvocation[0].command).toBe(hookCommand(script(), "working"));
    expect(root.clidable.Stop[0].command).toBe(hookCommand(script(), "idle"));
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
