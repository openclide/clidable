/**
 * Context scan (PLAN.md §4 — Instructions, read path / slice 1).
 *
 * Reads the canonical project-root `AGENTS.md` and reports, per agent, how it's
 * covered: read natively, served via a managed `@import` pointer file, or not
 * auto-loadable at all. State comes straight from disk — never from parsing CLI
 * output. Scope is project-root only for now (nested + user-global is later).
 */
import { join } from "node:path";
import { readText } from "../util/fs";
import {
  INSTRUCTION_CANONICAL_FILE,
  INSTRUCTION_NATIVE_AGENTS,
  INSTRUCTION_POINTER_FILES,
  INSTRUCTION_UNSUPPORTED_AGENTS,
} from "../../shared/types";
import type {
  ContextResponse,
  InstructionAgentInfo,
  TerminalAgentId,
} from "../../shared/types";

/**
 * A file is a *managed pointer* only if its sole meaningful line is the
 * AGENTS.md import directive — our sentinel HTML comment and blank lines aside.
 *
 * This is deliberately strict: a file that merely MENTIONS `@AGENTS.md` in
 * prose, OR imports it but also carries hand-written content, is NOT a pointer.
 * That keeps `hasOwnContent` true for those files so saveContext never
 * overwrites them. (A loose "contains @AGENTS.md anywhere" test would silently
 * clobber a real CLAUDE.md that happens to reference the canonical file.)
 */
function isManagedPointer(content: string): boolean {
  const meaningful = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("<!--"));
  return meaningful.length === 1 && /^@(?:\.\/)?AGENTS\.md$/.test(meaningful[0]!);
}

export async function scanContext(projectPath: string): Promise<ContextResponse> {
  const canonical = await readText(
    join(projectPath, INSTRUCTION_CANONICAL_FILE),
  );

  const agents: InstructionAgentInfo[] = [];

  // Native readers — covered as long as AGENTS.md exists.
  for (const agent of INSTRUCTION_NATIVE_AGENTS) {
    agents.push({ agent, coverage: "native" });
  }

  // Pointer holdouts — read each file in parallel and classify it.
  const pointerEntries = Object.entries(INSTRUCTION_POINTER_FILES) as [
    TerminalAgentId,
    string,
  ][];
  const pointerInfos = await Promise.all(
    pointerEntries.map(async ([agent, file]) => {
      const content = await readText(join(projectPath, file));
      const pointerOk = content !== null && isManagedPointer(content);
      const hasOwnContent =
        content !== null && !pointerOk && content.trim().length > 0;
      return { agent, coverage: "pointer", file, pointerOk, hasOwnContent } satisfies InstructionAgentInfo;
    }),
  );
  agents.push(...pointerInfos);

  // No file-based instruction mechanism today.
  for (const agent of INSTRUCTION_UNSUPPORTED_AGENTS) {
    agents.push({ agent, coverage: "none" });
  }

  return {
    content: canonical ?? "",
    exists: canonical !== null,
    agents,
  };
}
