import type { InstructionAgentInfo, InstructionCoverage } from "@shared/types";

/**
 * Display metadata + ordering for each coverage bucket shown in the Context
 * modal. AGENTS.md is the one canonical file; this just explains *how* each
 * agent ends up reading it.
 */
const COVERAGE_GROUPS: {
  coverage: InstructionCoverage;
  label: string;
  hint: string;
}[] = [
  {
    coverage: "native",
    label: "Reads AGENTS.md directly",
    hint: "No extra file — these agents load the canonical file natively.",
  },
  {
    coverage: "pointer",
    label: "Points to AGENTS.md",
    hint: "Their own file imports AGENTS.md, so there's a single source of truth.",
  },
  {
    coverage: "none",
    label: "Not auto-loaded",
    hint: "No file-based instruction mechanism yet — reference @AGENTS.md manually.",
  },
];

export interface CoverageGroup {
  coverage: InstructionCoverage;
  label: string;
  hint: string;
  agents: InstructionAgentInfo[];
}

/** Bucket the server's per-agent coverage into display groups, dropping any
 *  empty bucket so the modal only renders rows that apply. */
export function groupByCoverage(agents: InstructionAgentInfo[]): CoverageGroup[] {
  return COVERAGE_GROUPS.map((g) => ({
    ...g,
    agents: agents.filter((a) => a.coverage === g.coverage),
  })).filter((g) => g.agents.length > 0);
}
