/**
 * Agent registry — one entry per CLI coding agent we know how to spawn.
 *
 * `bin` is the command name we look up on PATH. `args` is the default
 * launch argv. `env` is per-agent environment additions on top of the
 * inherited process env.
 *
 * Detection is cached (which-style) so subsequent spawns don't re-run the
 * lookup (cache lives for the process lifetime).
 */
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { isAbsolute } from "node:path";
import { migrateAgentId } from "../shared/types";
import type { TerminalAgentId } from "../shared/types";

/**
 * The user's login shell for the plain-terminal agent. `$SHELL` when set; else
 * the account's shell from the passwd entry (`userInfo().shell`) — critical for
 * a Finder/Dock-launched desktop app, whose sidecar inherits the launchd env
 * that usually has NO `$SHELL`, so we'd otherwise fall back to bash instead of
 * the user's real shell (zsh on modern macOS). Last resort: a platform default.
 */
function loginShell(): string {
  if (process.env.SHELL) return process.env.SHELL;
  try {
    const s = userInfo().shell; // getpwuid → the account's login shell
    if (s) return s;
  } catch {
    // userInfo can throw in some sandboxes/containers
  }
  return process.platform === "win32" ? "powershell.exe" : "/bin/zsh";
}

export interface AgentSpec {
  id: TerminalAgentId;
  name: string;
  bin: string;
  args: string[];
  /** Extra env to inject on top of process.env. */
  env: Record<string, string>;
}

export const AGENTS: Record<TerminalAgentId, AgentSpec> = {
  claude: {
    id: "claude",
    name: "Claude Code",
    bin: "claude",
    args: [],
    env: {
      // Make Claude render its richest output to xterm.js.
      CLAUDE_CODE_SYNC_PLUGIN_INSTALL: "1",
    },
  },
  codex: {
    id: "codex",
    name: "Codex CLI",
    bin: "codex",
    // Codex gates hooks behind a per-source "hook trust" prompt; without this
    // our installed session-id hook is silently skipped (no capture → no
    // resume). The flag runs the hooks Clidable itself installed — the
    // documented "automation that already vets its hook sources" case.
    args: ["--dangerously-bypass-hook-trust"],
    env: {},
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity CLI",
    bin: "agy",
    args: [],
    env: {},
  },
  cursor: {
    id: "cursor",
    name: "Cursor Agent",
    bin: "cursor-agent",
    args: [],
    env: {},
  },
  qwen: {
    id: "qwen",
    name: "Qwen Code",
    bin: "qwen",
    args: [],
    env: {},
  },
  kimi: {
    id: "kimi",
    name: "Kimi CLI",
    bin: "kimi",
    args: [],
    env: {},
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    bin: "opencode",
    args: [],
    env: {},
  },
  copilot: {
    id: "copilot",
    name: "GitHub Copilot CLI",
    bin: "copilot",
    args: [],
    env: {},
  },
  // A plain terminal — the user's login shell, not an AI agent. `bin` resolves
  // to their real shell (see loginShell). On POSIX that's an absolute path, used
  // as-is, so it always counts as "installed"; on Windows it's the bare
  // `powershell.exe`, which goes through the PATH lookup like any other bin.
  // `-l` runs it as an interactive login
  // shell — the Terminal.app convention: for zsh (the macOS default) that sources
  // .zprofile (PATH) AND .zshrc (aliases); it's needed so the packaged app's
  // sidecar — which has a minimal env — picks up the user's PATH. No hook
  // adapter, so no hooks/resume/status are wired for it.
  terminal: {
    id: "terminal",
    name: "Terminal",
    bin: loginShell(),
    args: process.platform === "win32" ? [] : ["-l"],
    env: {},
  },
};

// Keyed by bin NAME (not agent id) so custom-agent recipes that name an
// arbitrary binary share the same cache as the built-ins. Holds resolved paths
// only — misses are never cached (see resolveBin).
const detectionCache = new Map<string, string>();

/**
 * Resolve a binary to an absolute path: an absolute/relative path that exists
 * is used directly; otherwise it's looked up on PATH. Returns null if not found.
 * This is the generic resolver custom-agent recipes use (any `bin`), not just
 * the built-ins.
 *
 * Only SUCCESSES are cached. A miss is re-probed every time, because "not
 * installed" is a state the user actively fixes: the UI hands them their
 * agent's install docs, and caching the miss for the process lifetime meant
 * coming back from a successful install to the same "not installed" error until
 * the whole server was restarted. Re-probing costs one `Bun.which` on a path
 * that is already failing.
 *
 * Uses `Bun.which` rather than shelling out, which matters on two counts:
 *
 *   • Portability. This used to exec `which`, which does not exist on Windows —
 *     and since we exec directly with no shell, that was a hard ENOENT rather
 *     than a "not found" answer, so EVERY spawn failed there, agents and the
 *     plain terminal alike.
 *   • PATH-only resolution. `where.exe`, the obvious Windows swap, searches the
 *     CURRENT DIRECTORY before PATH — so a stray `claude.exe` in whatever
 *     directory the server happened to launch from would win over the real
 *     agent. `Bun.which` searches PATH only (verified: a bare name matching a
 *     file in cwd resolves to null), which is the semantics the callers assume.
 *
 * It also drops a subprocess per lookup. Note the explicit `PATH` option — see
 * the call site for why a bare `Bun.which(bin)` is not equivalent.
 */
export async function resolveBin(bin: string): Promise<string | null> {
  if (detectionCache.has(bin)) return detectionCache.get(bin)!;
  let resolved: string | null = null;
  if (isAbsolute(bin) && existsSync(bin)) {
    // An absolute path is used as-is; a bare/relative name (even one with a
    // slash) goes through the PATH lookup so it resolves against PATH, not the
    // server's cwd — which differs from the delegate's project dir.
    resolved = bin;
  } else {
    try {
      // PATH is passed explicitly: bare `Bun.which(bin)` searches the PATH the
      // process was STARTED with and ignores `process.env.PATH` afterwards, so
      // it can't see a directory added since boot (and can't be tested).
      resolved = Bun.which(bin, process.env.PATH ? { PATH: process.env.PATH } : undefined);
    } catch {
      // Never let a lookup failure take down the spawn: "not installed" is the
      // honest answer and the one every caller already handles.
      resolved = null;
    }
  }
  if (resolved !== null) detectionCache.set(bin, resolved);
  return resolved;
}

/**
 * Resolve a built-in agent's binary on PATH. Returns the absolute path, or null
 * if not found.
 */
export async function detectAgent(id: string): Promise<string | null> {
  // Migrate a renamed/stale id (e.g. a reconnecting client still asking for
  // "gemini") before lookup — mirrors getAgentSpec so neither the render nor the
  // spawn path throws on a legacy id. An unknown id resolves to null ("not
  // installed"), the same signal callers already handle.
  const spec = AGENTS[migrateAgentId(id) as TerminalAgentId];
  return spec ? resolveBin(spec.bin) : null;
}

export function getAgentSpec(id: string): AgentSpec {
  // Migrate a renamed/stale id (e.g. a reconnecting client still asking for
  // "gemini") to the current one before lookup, so a stored id can't throw and
  // kill the PTY spawn.
  const spec = AGENTS[migrateAgentId(id) as TerminalAgentId];
  if (!spec) throw new Error(`Unknown agent id: ${id}`);
  return spec;
}
