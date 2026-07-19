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
import { isAbsolute } from "node:path";
import { migrateAgentId } from "../shared/types";
import type { TerminalAgentId } from "../shared/types";

export interface AgentSpec {
  id: TerminalAgentId;
  name: string;
  bin: string;
  args: string[];
  /** Extra env to inject on top of process.env. */
  env: Record<string, string>;
  /** Install hint shown when the binary isn't on PATH. */
  installHint: string;
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
    installHint: "npm i -g @anthropic-ai/claude-code",
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
    installHint: "npm i -g @openai/codex",
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity CLI",
    bin: "agy",
    args: [],
    env: {},
    installHint: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
  },
  cursor: {
    id: "cursor",
    name: "Cursor Agent",
    bin: "cursor-agent",
    args: [],
    env: {},
    installHint: "Install Cursor and enable the `cursor-agent` CLI.",
  },
  qwen: {
    id: "qwen",
    name: "Qwen Code",
    bin: "qwen",
    args: [],
    env: {},
    installHint: "npm i -g @qwen-code/qwen-code",
  },
  kimi: {
    id: "kimi",
    name: "Kimi CLI",
    bin: "kimi",
    args: [],
    env: {},
    installHint: "Install the Kimi CLI from Moonshot AI's docs.",
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    bin: "opencode",
    args: [],
    env: {},
    installHint: "npm i -g opencode",
  },
  copilot: {
    id: "copilot",
    name: "GitHub Copilot CLI",
    bin: "copilot",
    args: [],
    env: {},
    installHint: "npm i -g @github/copilot",
  },
};

// Keyed by bin NAME (not agent id) so custom-agent recipes that name an
// arbitrary binary share the same cache as the built-ins.
const detectionCache = new Map<string, string | null>();

/**
 * Resolve a binary to an absolute path: an absolute/relative path that exists
 * is used directly; otherwise it's looked up on PATH (`which`). Returns null if
 * not found. Results are cached for the lifetime of the process. This is the
 * generic resolver custom-agent recipes use (any `bin`), not just the built-ins.
 */
export async function resolveBin(bin: string): Promise<string | null> {
  if (detectionCache.has(bin)) return detectionCache.get(bin)!;
  let resolved: string | null = null;
  if (isAbsolute(bin) && existsSync(bin)) {
    // An absolute path is used as-is; a bare/relative name (even one with a
    // slash) goes through `which` so it resolves against PATH, not the server's
    // cwd — which differs from the delegate's project dir.
    resolved = bin;
  } else {
    const proc = Bun.spawn(["which", bin], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    if (code === 0) {
      // `which` prints one path per match; take the first line.
      resolved = (await new Response(proc.stdout).text()).split("\n")[0]!.trim() || null;
    }
  }
  detectionCache.set(bin, resolved);
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
