/**
 * Output-mode dev-server URL detection (M-C). The portable, all-OS half of
 * VS Code's two-mode model (this is the `output` source — see its
 * remoteExplorer.ts `UrlFinder`). We own every PTY byte server-side, so we
 * scan the stream for the "server is up" banner that virtually every dev tool
 * prints (Vite `Local: …`, Next `http://localhost:3000`, uvicorn, etc.).
 *
 * Loopback only — we never auto-surface an external origin from terminal text.
 * Detected hosts are normalized to `localhost` (most clickable) keeping the
 * scheme + port.
 */

// CSI escape sequences (SGR colors, cursor moves) dev servers wrap their
// banners in: ESC `[`, params, intermediates, final byte. Hex-escaped so
// there are no literal control bytes in source.
const ANSI_RE = /\x1b\[[0-9;?]*[\x20-\x2f]*[\x40-\x7e]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

// scheme :// loopback-host [ : port ]
const URL_RE =
  /(https?):\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::(\d{2,5}))?/gi;

/**
 * Extract normalized loopback dev-server URLs from a chunk of terminal text.
 * Returns `http://localhost:<port>` form, de-duplicated, in first-seen order.
 */
export function findDevServerUrls(text: string): string[] {
  const clean = stripAnsi(text);
  const out: string[] = [];
  const seen = new Set<string>();
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(clean)) !== null) {
    const scheme = (m[1] ?? "http").toLowerCase();
    const port = m[3] ?? (scheme === "https" ? "443" : "80");
    const url = `${scheme}://localhost:${port}`;
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}
