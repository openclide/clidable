/**
 * Context mutations (PLAN.md §4 — Instructions, write path / slice 2).
 *
 * Writes the canonical `AGENTS.md` and the holdouts' one-line `@import` pointer
 * files. The load-bearing safety rule: a holdout file that carries its own
 * hand-written content is NEVER overwritten unless the caller explicitly lists
 * it in `convert` (having first folded that content into `content`). Everything
 * else is idempotent — re-saving produces byte-identical pointer files.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  INSTRUCTION_CANONICAL_FILE,
  INSTRUCTION_POINTER_FILES,
  INSTRUCTION_POINTER_IMPORT,
} from "../../shared/types";
import type {
  ContextResponse,
  SaveContextRequest,
  TerminalAgentId,
} from "../../shared/types";
import { scanContext } from "./scan";

/** A pointer file: a human-readable note + the agent's import directive. The
 *  comment has no `@` so it never trips the canonical-import detector. */
function pointerContent(directive: string): string {
  return `<!-- Managed by Clidable: imports AGENTS.md. Edit AGENTS.md, not this file. -->\n${directive}\n`;
}

function withTrailingNewline(s: string): string {
  return s.length === 0 || s.endsWith("\n") ? s : `${s}\n`;
}

export async function saveContext(
  args: SaveContextRequest,
): Promise<ContextResponse> {
  const { projectPath, content } = args;
  const convert = new Set(args.convert ?? []);
  const wanted = new Set<TerminalAgentId>([...args.pointers, ...convert]);

  // Read current state first so we know which holdouts carry their own content
  // and must not be clobbered without an explicit convert.
  const before = await scanContext(projectPath);
  const isEdited = new Map(
    before.agents.map((a) => [a.agent, !!a.hasOwnContent] as const),
  );

  await writeFile(
    join(projectPath, INSTRUCTION_CANONICAL_FILE),
    withTrailingNewline(content),
    "utf8",
  );

  for (const agent of wanted) {
    const file = INSTRUCTION_POINTER_FILES[agent];
    const directive = INSTRUCTION_POINTER_IMPORT[agent];
    if (!file || !directive) continue; // not a pointer-capable agent
    if (isEdited.get(agent) && !convert.has(agent)) continue; // guard: don't clobber
    await writeFile(join(projectPath, file), pointerContent(directive), "utf8");
  }

  return scanContext(projectPath);
}
