/**
 * Same-site gate for the localhost-only server.
 *
 * Binding to 127.0.0.1 keeps *other machines* out, but it does NOT keep out
 * code running in the user's own browser: any web page the user visits can
 * open `ws://127.0.0.1:7878/api/terminal` (WebSockets bypass the same-origin
 * policy — the browser completes the handshake and only the SERVER can refuse
 * it) and thereby spawn a PTY = drive-by RCE, or POST cross-origin to the API
 * (CSRF). This gate is that refusal.
 *
 * The rule (see `isSameSiteRequest`), in layers:
 *   1. Loopback Host — on a loopback bind (the only kind the server starts on;
 *      see cli.ts), the `Host` must resolve to loopback. Defeats DNS-rebinding
 *      (an attacker domain re-resolved to 127.0.0.1 arrives with a non-loopback
 *      Host header).
 *   2. `Sec-Fetch-Site` — the browser-attested, UNFORGEABLE (JS cannot set a
 *      `Sec-*` header) same-site signal, sent on EVERY request a modern browser
 *      makes — including the no-cors GET / `<img>` / `<script>` / navigation
 *      requests that omit `Origin`. When present it is authoritative: allow
 *      only `same-origin` or user-initiated `none`. This is what closes the
 *      Origin-less cross-site GET hole (a foreign `<img src=…/proxy/6379/>`),
 *      which the earlier "no Origin → allow" rule let through.
 *   3. `Origin` — a fallback for a client without `Sec-Fetch-Site` (a very old
 *      browser): when present it must be same-origin as the `Host` it hits.
 *   4. No `Origin` AND no `Sec-Fetch-Site` → allow: a non-browser client (the
 *      `clidable` CLI, curl, health probes). A modern browser always sends
 *      `Sec-Fetch-Site`, so it cannot reach this branch cross-site.
 *
 * Applied to every `/api/*` route and the `/proxy/*` bridge in server/index.ts.
 */
import type { ServerConfig } from "../cli";
import { applySecurityHeaders, jsonError } from "../http";
import { isLoopbackBind, isLoopbackHost } from "./ssrf";

/** Tauri custom-protocol webview origins (macOS / Windows). Clidable's webview
 *  normally loads the loopback HTTP server directly (Origin is then a loopback
 *  URL and needs no special case), but allow these in case a build serves the
 *  frontend over the custom protocol instead. */
const TAURI_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

/** Normalized hostname of a `Host`/authority value (IPv6 compressed, lowercased,
 *  brackets kept), or null when it can't be parsed. Parsing via `URL` makes the
 *  gate-1 loopback check and the gate-3 same-origin compare agree on IPv6/case
 *  forms (e.g. `[0:0:0:0:0:0:0:1]` ⇔ `[::1]`, `LOCALHOST` ⇔ `localhost`). */
function hostnameOf(authority: string): string | null {
  try {
    return new URL(`http://${authority}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Normalized authority (`host:port`, IPv6-compressed, lowercased) for the
 *  same-origin compare, or null when unparseable. */
function authorityOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Whether an inbound request may be served — see the module doc for the rule.
 *  A request that fails this should get a 403, never reach a handler. */
export function isSameSiteRequest(req: Request, config: ServerConfig): boolean {
  const host = req.headers.get("host");

  // Gate 1 — loopback Host (DNS-rebind defense). A Host-less request is a
  // non-browser client (browsers always send Host), so skip rather than block
  // it, honoring the "non-browser clients pass" contract.
  if (isLoopbackBind(config.bind) && host !== null) {
    const hostname = hostnameOf(host);
    if (hostname === null || !isLoopbackHost(hostname)) return false;
  }

  const origin = req.headers.get("origin");
  // Tauri custom-protocol webview — allow BEFORE the Sec-Fetch-Site check
  // (a custom-protocol → http request would read as `cross-site`).
  if (origin !== null && TAURI_ORIGINS.has(origin)) return true;

  // Gate 2 — Sec-Fetch-Site: browser-attested and unforgeable, present on every
  // modern-browser request incl. the Origin-less no-cors GETs. Authoritative
  // when present: only same-origin or a user-initiated navigation may pass.
  const site = req.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin" || site === "none";

  // Gate 3 — Origin same-origin fallback (client without Sec-Fetch-Site). No
  // Origin AND no Sec-Fetch-Site → a non-browser client → allow.
  if (origin === null) return true;
  const originHost = authorityOf(origin);
  const hostAuthority = host === null ? null : authorityOf(`http://${host}`);
  return originHost !== null && originHost === hostAuthority;
}

/** Handler shape Bun accepts for a custom route / WS-upgrade entry. */
type RouteHandler = (req: Request, server: unknown) => unknown;

function forbidden(): Response {
  // Same `{ ok:false, error }` envelope every other API error uses (no log
  // prefix → an attacker spamming blocked requests can't flood the log).
  const res = jsonError(403, "cross-site request refused");
  applySecurityHeaders(res.headers);
  return res;
}

/** Add the baseline security headers to a handler's result, whether it's a
 *  Response, a Promise of one, or a WS upgrade (undefined → left alone). */
function withSecurityHeaders(result: unknown): unknown {
  if (result instanceof Response) {
    applySecurityHeaders(result.headers);
    return result;
  }
  if (result instanceof Promise) {
    return result.then((r) => {
      if (r instanceof Response) applySecurityHeaders(r.headers);
      return r;
    });
  }
  return result;
}

/**
 * Wrap every `/api/*` route so a cross-site request is refused with a 403
 * BEFORE its handler runs — the terminal-WS upgrade (RCE surface) included —
 * and so every allowed response carries the baseline security headers.
 * Non-`/api` routes (the HTML app shell at "/" and "/home") pass through
 * untouched: they're top-level navigations with no Origin, and gating them
 * would only risk breaking the initial page load.
 */
export function guardApiRoutes<T extends Record<string, unknown>>(
  routes: T,
  config: ServerConfig,
): T {
  const guard =
    (inner: RouteHandler): RouteHandler =>
    (req, server) =>
      isSameSiteRequest(req, config)
        ? withSecurityHeaders(inner(req, server))
        : forbidden();

  const out: Record<string, unknown> = {};
  for (const [path, val] of Object.entries(routes)) {
    if (!path.startsWith("/api") || val == null) {
      out[path] = val;
    } else if (typeof val === "function") {
      out[path] = guard(val as RouteHandler);
    } else if (typeof val === "object") {
      // A per-method map ({ GET, POST, … }) — wrap each method function.
      const methods: Record<string, unknown> = {};
      for (const [method, h] of Object.entries(val as Record<string, unknown>)) {
        methods[method] = typeof h === "function" ? guard(h as RouteHandler) : h;
      }
      out[path] = methods;
    } else {
      out[path] = val;
    }
  }
  return out as T;
}
