/**
 * Dev-server reverse-proxy (M-E2). Forwards `/proxy/<port>/<rest>` to
 * `http://127.0.0.1:<port>/<rest>` so a browser/phone talking to a *remote*
 * Clidable host can still reach a dev server bound to the host's localhost
 * (code-server's model). In local Tauri mode the iframe hits localhost
 * directly and never touches this path (see lib/preview-url.ts / E1).
 *
 * Loopback-only target → the SSRF surface is just "which local port", gated by
 * server/net/ssrf.ts. Redirects are rewritten to stay inside /proxy/<port>/.
 */
import type { ServerConfig } from "../cli";
import {
  checkProxyAllowed,
  filterHeaders,
  type ProxyTarget,
} from "../net/ssrf";

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
]);

export async function proxyHttp(
  req: Request,
  config: ServerConfig,
  target: ProxyTarget,
): Promise<Response> {
  const decision = checkProxyAllowed(target.port, config);
  if (!decision.ok) {
    return new Response(decision.message, { status: decision.status });
  }

  const search = new URL(req.url).search;
  const targetUrl = `http://127.0.0.1:${target.port}${target.rest}${search}`;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers: filterHeaders(req.headers, true),
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      // Streaming request bodies require half-duplex (Bun supports it).
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (e) {
    return new Response(`proxy connect failed: ${(e as Error).message}`, {
      status: 502,
    });
  }

  const headers = filterHeaders(upstream.headers, false);
  const loc = upstream.headers.get("location");
  if (loc) headers.set("location", rewriteLocation(loc, target.port));

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

/** Keep redirects inside the proxy: loopback-absolute and root-relative
 *  Locations are rewritten to `/proxy/<port>/…`; external ones pass through. */
function rewriteLocation(loc: string, port: number): string {
  // Protocol-relative ("//host/path") parses only with a scheme; give it a
  // dummy one so it isn't mistaken for a root-relative path and turned into
  // a broken "/proxy/<port>//host/path".
  const probe = loc.startsWith("//") ? `http:${loc}` : loc;
  try {
    const u = new URL(probe);
    if (LOOPBACK_HOSTS.has(u.hostname)) {
      const p = u.port || (u.protocol === "https:" ? "443" : "80");
      return `/proxy/${p}${u.pathname}${u.search}${u.hash}`;
    }
    return loc; // external (incl. protocol-relative to another host) — leave alone
  } catch {
    // Root-relative path (no scheme/host).
    if (loc.startsWith("/")) return `/proxy/${port}${loc}`;
    return loc;
  }
}

/** ws:// target for a proxied WebSocket upgrade. */
export function proxyWsTarget(target: ProxyTarget, search: string): string {
  return `ws://127.0.0.1:${target.port}${target.rest}${search}`;
}
