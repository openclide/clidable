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

/**
 * Baseline security headers for the API surface. Applied to every `/api/*`
 * response (see guardApiRoutes). These responses are JSON/data — never framed,
 * never a sniff target — so the values are unconditionally safe here:
 *   - frame-ancestors 'none' + X-Frame-Options: DENY — belt-and-suspenders
 *     clickjacking defense; a defense-in-depth guard if a route ever returns
 *     HTML. (The app-shell HTML itself can't carry these under Bun's native
 *     bundling, so index.html ships an OWASP frame-buster instead.)
 *   - nosniff — no MIME sniffing.
 *   - no-referrer — never leak the loopback URL/path to a navigated origin.
 * NOT applied to the /proxy bridge: that content is meant to be framed by the
 * preview pane and is the user's own dev server, which sets its own headers.
 */
export function applySecurityHeaders(headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Content-Security-Policy", "frame-ancestors 'none'");
}
