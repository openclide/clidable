/**
 * Process-mode dev-server detection (M-D) — the precision upgrade that catches
 * servers which print no banner for the output scanner (M-C) to find.
 *
 * Mirrors VS Code's `process` source (extHostTunnelService.ts) but per-OS and
 * scoped to *our* PTY sessions: for each session we enumerate the listening
 * sockets owned by that session's descendant process tree (we hold the agent
 * pid), so detections attribute cleanly to a project and our own server (the
 * agents' *parent*, never a descendant) is naturally excluded — no global diff
 * ambiguity.
 *
 * Per-OS socket enumeration:
 *   • Linux  — /proc/net/tcp{,6} (st 0A = LISTEN) joined to pids via /proc/<pid>/fd
 *   • macOS  — lsof -nP -iTCP -sTCP:LISTEN -p <pids>
 *   • Windows— Get-NetTCPConnection -State Listen (OwningProcess)
 *
 * Everything is best-effort: any spawn/parse/permission failure degrades to
 * "found nothing", never throws. Detections feed the same pipeline as M-C
 * (detector.recordDetectedUrl), which dedupes per project.
 */
import { readdir, readFile, readlink } from "node:fs/promises";
import { sessionManager } from "../pty/manager";
import { recordDetectedUrl } from "./detector";

interface PidPort {
  pid: number;
  port: number;
}

/* --- small spawn helper: capture stdout, swallow every failure --- */

async function run(cmd: string[]): Promise<string> {
  try {
    const proc = Bun.spawn({
      cmd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out;
  } catch {
    return "";
  }
}

/* --- process tree (pid → children) --- */

export async function processTree(): Promise<Map<number, number[]>> {
  const out =
    process.platform === "win32"
      ? await run([
          "powershell",
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }",
        ])
      : await run(["ps", "-Ao", "pid=,ppid="]);

  const tree = new Map<number, number[]>();
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const kids = tree.get(ppid);
    if (kids) kids.push(pid);
    else tree.set(ppid, [pid]);
  }
  return tree;
}

export function descendantsOf(roots: number[], tree: Map<number, number[]>): Set<number> {
  const out = new Set<number>();
  const stack = [...roots];
  while (stack.length) {
    const pid = stack.pop()!;
    if (out.has(pid)) continue;
    out.add(pid);
    for (const c of tree.get(pid) ?? []) stack.push(c);
  }
  return out;
}

/* --- per-OS listening-socket enumeration --- */

export async function listeningPorts(pids: Set<number>): Promise<PidPort[]> {
  if (pids.size === 0) return [];
  if (process.platform === "linux") return linuxListeners(pids);
  if (process.platform === "win32") return windowsListeners(pids);
  return macListeners(pids); // darwin + BSDs (lsof)
}

async function macListeners(pids: Set<number>): Promise<PidPort[]> {
  const out = await run([
    "lsof",
    "-nP",
    "-iTCP",
    "-sTCP:LISTEN",
    "-a",
    "-p",
    [...pids].join(","),
  ]);
  const res: PidPort[] = [];
  for (const line of out.split("\n")) {
    if (!line.includes("(LISTEN)")) continue;
    const cols = line.trim().split(/\s+/);
    const pid = Number(cols[1]);
    const addr = cols[cols.length - 2] ?? ""; // token before "(LISTEN)"
    const m = addr.match(/:(\d{1,5})$/);
    if (pid && m) res.push({ pid, port: Number(m[1]) });
  }
  return res;
}

async function windowsListeners(pids: Set<number>): Promise<PidPort[]> {
  const out = await run([
    "powershell",
    "-NoProfile",
    "-Command",
    "Get-NetTCPConnection -State Listen | ForEach-Object { \"$($_.OwningProcess) $($_.LocalPort)\" }",
  ]);
  const res: PidPort[] = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pids.has(pid)) res.push({ pid, port: Number(m[2]) });
  }
  return res;
}

async function linuxListeners(pids: Set<number>): Promise<PidPort[]> {
  // 1. socket inode → listening port, from the kernel tables.
  const inodePort = new Map<string, number>();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const txt = await readFile(file, "utf8").catch(() => "");
    for (const line of txt.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10) continue;
      if (cols[3] !== "0A") continue; // 0A = TCP_LISTEN
      const portHex = (cols[1] ?? "").split(":")[1];
      const inode = cols[9];
      if (!portHex || !inode) continue;
      inodePort.set(inode, parseInt(portHex, 16));
    }
  }
  if (inodePort.size === 0) return [];

  // 2. join inodes to pids via /proc/<pid>/fd symlinks — fan the I/O out
  // (independent per pid + per fd) rather than awaiting each syscall serially.
  const perPid = await Promise.all(
    [...pids].map(async (pid) => {
      const fds = await readdir(`/proc/${pid}/fd`).catch(() => [] as string[]);
      const links = await Promise.all(
        fds.map((fd) => readlink(`/proc/${pid}/fd/${fd}`).catch(() => "")),
      );
      const out: PidPort[] = [];
      for (const link of links) {
        const m = link.match(/^socket:\[(\d+)\]$/);
        if (!m) continue;
        const port = inodePort.get(m[1]!);
        if (port !== undefined) out.push({ pid, port });
      }
      return out;
    }),
  );
  return perPid.flat();
}

/* --- poller --- */

let timer: ReturnType<typeof setInterval> | null = null;
let scanning = false;

/** Start the periodic scan. Idempotent. */
export function startPortScanner(intervalMs = 3500): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  // Don't keep the event loop alive just for scanning.
  (timer as { unref?: () => void }).unref?.();
}

export function stopPortScanner(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  if (scanning) return; // skip if a slow scan is still running
  scanning = true;
  try {
    const sessions = sessionManager
      .list()
      .filter((s) => !s.isExited() && s.pid != null);
    if (sessions.length === 0) return;

    const tree = await processTree();
    const pidToSession = new Map<number, { projectPath: string; id: string }>();
    const allPids = new Set<number>();
    for (const s of sessions) {
      for (const p of descendantsOf([s.pid!], tree)) {
        allPids.add(p);
        if (!pidToSession.has(p)) {
          pidToSession.set(p, { projectPath: s.projectPath, id: s.id });
        }
      }
    }

    for (const { pid, port } of await listeningPorts(allPids)) {
      const sess = pidToSession.get(pid);
      if (sess) {
        recordDetectedUrl(
          sess.projectPath,
          sess.id,
          `http://localhost:${port}`,
          "process",
        );
      }
    }
  } catch (e) {
    console.error("[port-scan] tick failed:", (e as Error).message);
  } finally {
    scanning = false;
  }
}
