/**
 * Safety gate for the dev-server reverse-proxy (M-E3).
 *
 * Scope note vs. terax-ai's net.rs: that guard hardens proxying of *arbitrary
 * URLs* (IP classification, DNS-rebind pinning, scheme allowlist) — none of
 * which applies here, because this proxy's target host is **hard-coded
 * loopback** (`127.0.0.1`) and the only client-controlled input is the port.
 * The genuinely-relevant subset is implemented below:
 *
 *   • numeric-only port (CRLF-injection-safe by construction)
 *   • never proxy our own listening port (no self-loops)
 *   • on a public bind, restrict to *detected* dev-server ports so a remote
 *     client can't reach arbitrary localhost services (DB, redis, …). On a
 *     loopback bind the client is the same trusted machine, so any port is
 *     allowed (the user could hit it directly anyway).
 *   • hop-by-hop request/response headers stripped on forward.
 *
 * The full arbitrary-URL SSRF guard (net.rs port) only becomes necessary if a
 * future feature proxies user-supplied *hosts*; this one never does.
 */
import type { ServerConfig } from "../cli";
import { isPortDetected } from "../preview/detector";

// RFC 2616 §13.5.1 hop-by-hop headers — must not be forwarded by a proxy.
export const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** True for a hostname (no port; IPv6 brackets and a trailing FQDN dot
 *  tolerated) that refers to the local machine — the 127.0.0.0/8 range, IPv6
 *  ::1, or the "localhost" name. Case-insensitive. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname
    .replace(/^\[|\]$/g, "") // IPv6 brackets
    .replace(/\.$/, "") // trailing FQDN dot ("localhost.")
    .toLowerCase();
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** True when a `--bind` address is loopback (any of 127.0.0.0/8, ::1,
 *  localhost) — NOT 0.0.0.0 / :: (all-interfaces) or a LAN IP. Same predicate
 *  as `isLoopbackHost`, so the startup bind guard and the per-request Host
 *  rebind check can never disagree (e.g. `--bind 127.0.0.2` counts as loopback
 *  for both, closing the gap where one accepted an address the other didn't). */
export function isLoopbackBind(bind: string): boolean {
  return isLoopbackHost(bind);
}

export interface ProxyTarget {
  port: number;
  /** Path + query to forward (always starts with "/"). */
  rest: string;
}

/**
 * Parse `/proxy/<port>/<rest...>` from a pathname. Returns null if it isn't a
 * proxy path or the port segment isn't purely numeric (which also rules out
 * any CRLF / header-injection payload in the forwarded request line).
 */
export function parseProxyPath(pathname: string): ProxyTarget | null {
  const m = pathname.match(/^\/proxy\/(\d{1,5})(\/.*)?$/);
  if (!m) return null;
  const port = Number(m[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { port, rest: m[2] ?? "/" };
}

export type ProxyDecision =
  | { ok: true }
  | { ok: false; status: number; message: string };

/** Decide whether a proxy request to `port` is allowed under `config`. */
export function checkProxyAllowed(
  port: number,
  config: ServerConfig,
): ProxyDecision {
  if (port === config.port) {
    return { ok: false, status: 400, message: "refusing to proxy the server's own port" };
  }
  // Public bind: only forward to ports we've actually detected as *listening*
  // dev servers (process scan / own-spawn) — never a port merely echoed in
  // terminal output, which an agent could be coaxed into printing.
  if (
    !isLoopbackBind(config.bind) &&
    !isPortDetected(port, { trustedOnly: true })
  ) {
    return {
      ok: false,
      status: 403,
      message:
        "on a public bind, only detected dev-server ports may be proxied",
    };
  }
  return { ok: true };
}

/** Copy headers, dropping hop-by-hop + (for requests) the inbound Host. */
export function filterHeaders(src: Headers, isRequest: boolean): Headers {
  const out = new Headers();
  src.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k)) return;
    if (isRequest && k === "host") return; // let fetch set the target Host
    out.set(key, value);
  });
  return out;
}
