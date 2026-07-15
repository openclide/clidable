/**
 * Shared HTTP response helpers for the JSON API routes.
 *
 * `jsonError` is the one error-envelope used across the skills / mcp / plugins /
 * context / projects / checkpoints routes — `{ ok: false, error }` at a given
 * status, with an optional server-log prefix. Extracted so the envelope shape
 * lives in exactly one place. (fs.ts / git.ts keep their own typed
 * `satisfies …ErrorResponse` variants.)
 */
export function jsonError(
  status: number,
  error: string,
  logPrefix?: string,
): Response {
  if (logPrefix) console.error(logPrefix, error);
  return Response.json({ ok: false, error }, { status });
}
