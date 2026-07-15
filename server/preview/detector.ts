/**
 * Dev-server detection registry (M-C). Sits between the PTY output fan-out
 * (server/pty/session.ts calls `recordOutput`) and the `/api/preview-events`
 * WebSocket (which subscribes per project + replays).
 *
 * Always-on, like VS Code's auto-forward: detection runs for every session
 * regardless of whether a preview pane is open, and results are remembered
 * per project so a late-opening pane still sees them.
 *
 * Cheap by construction: we keep only a short rolling tail per terminal and
 * scan `tail + newChunk`, so per-chunk work is bounded no matter how chatty
 * the PTY is. URLs are de-duplicated per project.
 */
import { findDevServerUrls } from "./url-finder";

export type DetectionSource = "output" | "process" | "spawn";

export interface DetectedDevServer {
  terminalId: string;
  url: string;
  /** How it was found. "output" (a URL seen in terminal text) is the
   *  spoofable one — on a public bind the proxy only trusts "process"/"spawn"
   *  (actually-listening) ports, never an arbitrary echoed URL. */
  source: DetectionSource;
}

type Listener = (d: DetectedDevServer) => void;

const TAIL_CHARS = 512; // overlap kept to catch a URL split across chunks
const MAX_PER_PROJECT = 16; // bound the remembered set per project
const MAX_PROJECTS = 64; // bound the number of tracked project buckets

const tails = new Map<string, string>(); // terminalId -> trailing text
const detected = new Map<string, Map<string, DetectedDevServer>>(); // projectPath -> url -> d
const listeners = new Map<string, Set<Listener>>(); // projectPath -> listeners
const decoder = new TextDecoder();

/** Feed a chunk of a terminal's output. Emits on each newly-seen loopback URL. */
export function recordOutput(
  projectPath: string,
  terminalId: string,
  chunk: Uint8Array,
): void {
  const prev = tails.get(terminalId) ?? "";
  const text = prev + decoder.decode(chunk);
  tails.set(terminalId, text.slice(-TAIL_CHARS));

  // Fast path: findDevServerUrls allocates (ANSI-strip + global regex). The
  // overwhelming majority of output chunks contain no URL, so a cheap
  // substring test skips that work entirely.
  if (!text.includes("://")) return;
  for (const url of findDevServerUrls(text)) {
    recordDetectedUrl(projectPath, terminalId, url, "output");
  }
}

/**
 * Record a single detected dev-server URL (deduped per project, emitted to
 * subscribers on first sight). Shared by the output scanner (recordOutput)
 * and the process-mode port scanner (M-D, server/preview/port-scan.ts).
 */
export function recordDetectedUrl(
  projectPath: string,
  terminalId: string,
  url: string,
  source: DetectionSource,
): void {
  let bucket = detected.get(projectPath);
  if (!bucket) {
    bucket = new Map();
    detected.set(projectPath, bucket);
    // Buckets are never cleared on project close; bound the count so
    // `detected` can't grow unbounded over a long session.
    if (detected.size > MAX_PROJECTS) {
      const oldestProject = detected.keys().next().value;
      if (oldestProject !== undefined && oldestProject !== projectPath) {
        detected.delete(oldestProject);
      }
    }
  }
  if (bucket.has(url)) return;
  const d: DetectedDevServer = { terminalId, url, source };
  bucket.set(url, d);
  if (bucket.size > MAX_PER_PROJECT) {
    const oldest = bucket.keys().next().value;
    if (oldest !== undefined) bucket.delete(oldest);
  }
  emit(projectPath, d);
}

/** Already-detected servers for a project (for WS replay on connect). */
export function getDetections(projectPath: string): DetectedDevServer[] {
  return [...(detected.get(projectPath)?.values() ?? [])];
}

/** Drop a previously-recorded detection — e.g. when an own-spawn dev server is
 *  stopped — so it stops counting toward the proxy allowlist (isPortDetected)
 *  and the detection list. */
export function removeDetectedUrl(projectPath: string, url: string): void {
  detected.get(projectPath)?.delete(url);
}

/**
 * Whether any project has a detected dev server on `port`. The reverse-proxy
 * (M-E) uses this on a public bind to restrict forwarding to real dev servers
 * (so a remote client can't port-scan the host's localhost). URLs are
 * normalized to `http://localhost:<port>`, so an endsWith check is exact.
 */
export function isPortDetected(
  port: number,
  opts: { trustedOnly?: boolean } = {},
): boolean {
  const suffix = `:${port}`;
  for (const bucket of detected.values()) {
    for (const d of bucket.values()) {
      if (!d.url.endsWith(suffix)) continue;
      // On a public bind we only trust actually-listening detections
      // (process scan / own-spawn), never a URL merely echoed in terminal
      // output (which an agent could be coaxed into printing for, e.g., :6379).
      if (opts.trustedOnly && d.source === "output") continue;
      return true;
    }
  }
  return false;
}

export function subscribeDetections(
  projectPath: string,
  cb: Listener,
): () => void {
  let set = listeners.get(projectPath);
  if (!set) {
    set = new Set();
    listeners.set(projectPath, set);
  }
  set.add(cb);
  return () => {
    const s = listeners.get(projectPath);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) listeners.delete(projectPath);
  };
}

/** Drop a terminal's rolling buffer when its session exits. */
export function clearTerminal(terminalId: string): void {
  tails.delete(terminalId);
}

function emit(projectPath: string, d: DetectedDevServer): void {
  for (const cb of listeners.get(projectPath) ?? []) {
    try {
      cb(d);
    } catch (e) {
      console.error("[detector] listener threw", e);
    }
  }
}
