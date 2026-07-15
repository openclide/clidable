/**
 * Client wrapper for /api/context (PLAN.md §4 — Instructions). Returns the raw
 * server shape; the modal renders coverage from it directly.
 */
import { getJson, postJson } from "../../../lib/http";
import type { ContextResponse, SaveContextRequest } from "@shared/types";

export async function fetchContext(projectPath: string): Promise<ContextResponse> {
  const qs = new URLSearchParams({ projectPath });
  return getJson<ContextResponse>(`/api/context?${qs}`, "context scan failed");
}

/** Write AGENTS.md + the requested holdout pointers; returns the refreshed scan. */
export async function saveContext(req: SaveContextRequest): Promise<ContextResponse> {
  return postJson<ContextResponse>("/api/context/save", req, "context save failed");
}

/** A framework-detected starter AGENTS.md for an empty project. The user
 *  reviews it in the editor and saves through the normal path. */
export async function fetchStarter(projectPath: string): Promise<string> {
  const qs = new URLSearchParams({ projectPath });
  const data = await getJson<{ content: string }>(
    `/api/context/starter?${qs}`,
    "starter failed",
  );
  return data.content;
}

/** Read a holdout's current file (via the shared fs route) so its hand-written
 *  content can be folded into AGENTS.md before converting it to a pointer. */
export async function readInstructionFile(
  projectPath: string,
  path: string,
): Promise<string> {
  const qs = new URLSearchParams({ root: projectPath, path });
  const data = await getJson<{ kind: string; content?: string }>(
    `/api/fs/read?${qs}`,
    "read failed",
  );
  if (data.kind !== "text" || typeof data.content !== "string") {
    // Never return "" silently — folding nothing then converting would replace
    // the holdout with a pointer and lose its (large/binary) content.
    const why =
      data.kind === "toolarge"
        ? "is too large"
        : data.kind === "binary"
          ? "looks binary"
          : "could not be read as text";
    throw new Error(`can't fold ${path}: it ${why}`);
  }
  return data.content;
}
