/**
 * Shared filesystem read helpers. The contract every caller relies on: a
 * missing or unreadable path resolves to null / false rather than throwing.
 */
import { readFile, stat } from "node:fs/promises";

/** File contents as text, or null if missing/unreadable. Uses node readFile
 *  (not Bun.file().text(), which silently strips a leading UTF-8 BOM) so the
 *  bytes round-trip verbatim. */
export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Parsed JSON, or null if missing/malformed. */
export async function readJson<T>(path: string): Promise<T | null> {
  try {
    const f = Bun.file(path);
    return (await f.exists()) ? ((await f.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Whether a file exists (false on any error). */
export async function pathExists(path: string): Promise<boolean> {
  try {
    return await Bun.file(path).exists();
  } catch {
    return false;
  }
}

/** Give up on a single probe after this long. A mapped-but-offline SMB share
 *  blocks in the redirector for tens of seconds before ERROR_NOT_READY, and
 *  `Promise.all` waits for the slowest — so without a bound, one dead network
 *  drive stalls the whole folder picker. A local `stat` answers in microseconds,
 *  so anything this slow is not a drive we want to offer anyway. */
const PROBE_TIMEOUT_MS = 1_500;

/** {@link isDirectory}, but resolves false if it hasn't answered in `ms`. The
 *  syscall itself can't be cancelled; we just stop waiting on it. The timer is
 *  cleared when the probe wins, so the fast path (every local drive) leaves
 *  nothing scheduled. */
async function isDirectoryWithin(path: string, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      isDirectory(path),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Every drive letter Windows can assign, as a root path. Exported so a test
 *  can assert the candidate set without a Windows host. */
export const WINDOWS_DRIVE_ROOTS: string[] = Array.from(
  { length: 26 },
  (_, i) => `${String.fromCharCode(65 + i)}:\\`,
);

/**
 * Mounted drive roots (`C:\`, `D:\`, …) on Windows; empty everywhere else.
 *
 * Windows has one filesystem root PER DRIVE, and no directory lists them —
 * `dirname("C:\\")` is `"C:\\"`, so a picker that only walks up and down can
 * never leave the drive it started on. That was the bug: projects on D: were
 * unreachable, with no way to type a path either.
 *
 * Probing beats the alternatives rather than being a hack. The npm packages
 * that do this are either native (node-gyp — a `bun build --compile` binary
 * can't load a `.node` addon) or shell out to `wmic`, which Microsoft REMOVED
 * in Windows 11 24H2, so they fail on exactly the machines that hit this.
 * PowerShell's `Get-CimInstance` is the blessed replacement but costs a
 * subprocess every time the picker opens. 26 parallel `stat`s cost neither.
 *
 * Probes with {@link isDirectory}, NOT `pathExists`: the latter wraps
 * `Bun.file().exists()`, which is false for EVERY directory (verified on Bun
 * 1.3.14). Using it here made the whole feature a silent no-op on the only
 * platform it targets, while mocked tests stayed green.
 *
 * Reports drives that are mounted and readable — which is what a folder picker
 * wants. An assigned-but-not-ready letter is omitted rather than offered and
 * then failing. Two UNVERIFIED risks on real Windows, neither reproducible from
 * macOS, both self-healing within the cache TTL:
 *   - A dead network drive can occupy fs-threadpool slots; PROBE_TIMEOUT_MS
 *     bounds each promise but not its wait for a slot, so a healthy drive
 *     queued behind several dead ones could be reported absent for one cycle.
 *   - An empty optical drive may raise the Win32 hard-error dialog, since
 *     Node/libuv don't set SEM_FAILCRITICALERRORS and JS can't. If that shows
 *     up in the wild, the fix is dropping to a PowerShell Get-CimInstance probe
 *     (which asks the OS what's mounted instead of touching each letter).
 *
 * `roots` is injectable — DATA, not the probe itself, so a test off Windows
 * still exercises the real `isDirectory`. Production callers pass nothing, and
 * get a cached answer: see {@link cachedDrives}.
 */
export async function listDrives(
  opts: { platform?: NodeJS.Platform; roots?: string[] } = {},
): Promise<string[]> {
  const { platform = process.platform, roots = WINDOWS_DRIVE_ROOTS } = opts;
  if (platform !== "win32") return [];
  const probed = await Promise.all(
    roots.map(async (root) => ((await isDirectoryWithin(root, PROBE_TIMEOUT_MS)) ? root : null)),
  );
  return probed.filter((d): d is string => d !== null);
}

/** Whether `path` exists AND is a directory. Distinct from {@link pathExists},
 *  which answers "is there a readable FILE here" — `Bun.file(dir).exists()` is
 *  false for directories, so that helper cannot be used to test one. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** How long a drive listing stays fresh. Long enough that clicking through the
 *  picker never re-probes, short enough that plugging a USB disk shows up
 *  without restarting Clidable. */
const DRIVE_CACHE_MS = 30_000;

let driveCache: { at: number; drives: string[] } | null = null;
let driveInFlight: Promise<string[]> | null = null;

/**
 * {@link listDrives}, memoized — what request handlers should call.
 *
 * The uncached version probes 26 roots on every call. A mapped-but-offline SMB
 * share or an empty optical drive blocks for seconds per probe, and `Promise.all`
 * waits for the slowest, so an uncached call on each browse request would freeze
 * the picker on every click, not just on open. The set of mounted drives is
 * effectively static, so serve it from cache and coalesce concurrent callers
 * onto one in-flight probe.
 */
export async function cachedDrives(): Promise<string[]> {
  if (driveCache && Date.now() - driveCache.at < DRIVE_CACHE_MS) return driveCache.drives;
  // Coalesce: several browse requests in flight must not each start 26 probes.
  driveInFlight ??= listDrives()
    .then((drives) => {
      driveCache = { at: Date.now(), drives };
      return drives;
    })
    .finally(() => {
      driveInFlight = null;
    });
  return driveInFlight;
}
