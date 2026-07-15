/**
 * E1 — shell-aware preview URL resolution (PLAN_PREVIEW.md).
 *
 * The single seam every preview surface routes through (address bar, the
 * detection chip, screenshots). It decides what the iframe should *actually*
 * load given the shell:
 *
 *   • Tauri desktop, or a browser served from localhost → the dev server is on
 *     the same machine, so a loopback URL (localhost:3000) loads directly.
 *   • A browser served from a *remote* Clidable host → the host's localhost is
 *     not reachable from the client, so loopback URLs are tunneled through the
 *     host reverse-proxy at `/proxy/<port>/` (built in M-E2/E3).
 *   • External (non-loopback) URLs always load directly.
 *
 * Building the seam now (even before the proxy exists) means M-E drops in
 * without touching any call site.
 */
import { isTauri } from "./shell";

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
}

/** True when the dev server's loopback address is reachable from the client
 *  directly (same machine as the browser/webview). */
function isDirectContext(): boolean {
  if (isTauri()) return true;
  if (typeof window === "undefined") return true;
  return isLoopbackHost(window.location.hostname);
}

/** Resolve a (normalized) URL to what the iframe should load. */
export function resolvePreviewUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  if (!isLoopbackHost(u.hostname)) return raw; // external site → direct
  if (isDirectContext()) return raw; // same machine → direct

  // Remote host: tunnel the loopback dev server through the proxy.
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  const tail = `${u.pathname}${u.search}${u.hash}`;
  return `${window.location.origin}/proxy/${port}${tail}`;
}

/**
 * Coerce loose user input into a full URL.
 *   "3000"            → http://localhost:3000
 *   "localhost:5173"  → http://localhost:5173
 *   "127.0.0.1:8000"  → http://127.0.0.1:8000
 *   "example.com"     → https://example.com
 * Returns null for empty input.
 */
export function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^\d{1,5}$/.test(t)) {
    const n = Number(t); // bare port — reject 0 / out-of-range
    return n >= 1 && n <= 65535 ? `http://localhost:${n}` : null;
  }
  if (/^localhost(:|\/|$)/i.test(t)) return `http://${t}`;
  if (/^\d{1,3}(\.\d{1,3}){3}(:|\/|$)/.test(t)) return `http://${t}`;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(t)) return `https://${t}`;
  return `http://${t}`;
}

/** No-cors liveness probe — true if *something* answered on that URL. */
export async function probeUrl(url: string, timeoutMs = 1200): Promise<boolean> {
  try {
    await fetch(url, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    return false;
  }
}

/* --- per-project URL persistence (localStorage) --- */

const URL_KEY = "clidable:preview-url";

function readMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(URL_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function getStoredPreviewUrl(projectId: string): string {
  return readMap()[projectId] ?? "";
}

export function setStoredPreviewUrl(projectId: string, url: string): void {
  try {
    const m = readMap();
    m[projectId] = url;
    localStorage.setItem(URL_KEY, JSON.stringify(m));
  } catch {
    // best-effort
  }
}
