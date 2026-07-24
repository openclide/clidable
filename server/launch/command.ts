/**
 * `clidable open [dir]` and `clidable stop` — launch a UI for a directory, or
 * stop the background server.
 *
 * These run in the subcommand dispatch (server/index.ts) and exit BEFORE the
 * server boots, so `clidable open` never itself becomes a server — it ensures
 * one is running and points a UI at it. `open` captures the launching terminal's
 * cwd (a GUI app launched from Finder can't; that's the whole reason this lives
 * in the CLI), so `clidable open` with no arg opens the current directory.
 *
 * Auto target: the native desktop app if installed, else the browser. The
 * `?cwd=` deep-link (web/src/App.tsx) turns the directory into a fresh workspace.
 */
import { resolve } from "node:path";
import { ensureServerRunning, serverPort, stopServer } from "./daemon";

/** macOS: is the Clidable.app installed? (Other platforms fall back to browser
 *  for now — the app-launch path is macOS-first.) */
async function desktopAppInstalled(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    const p = Bun.spawn(["open", "-Ra", "Clidable"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await p.exited) === 0;
  } catch {
    return false;
  }
}

/** macOS: launch the app forwarding the cwd as argv. `-n` forces a NEW instance
 *  even when one is already running — without it, `open -a` on a running app just
 *  re-activates it and DROPS `--args`, so the cwd never arrives. The new instance
 *  starts, hits the single-instance lock, forwards its argv (`--cwd <dir>`) to the
 *  running app (which opens the window), and exits. Fresh launch works the same. */
async function launchDesktopApp(dir: string, forceNew: boolean): Promise<void> {
  const args = ["open", "-n", "-a", "Clidable", "--args", "--cwd", dir];
  if (forceNew) args.push("--new");
  const p = Bun.spawn(args, { stdout: "ignore", stderr: "ignore" });
  await p.exited;
}

async function openInBrowser(url: string): Promise<void> {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    if ((await p.exited) === 0) return;
  } catch {
    // opener binary missing — fall through to printing the URL
  }
  // Also reached when the opener EXISTS but fails — the headless-box case
  // (xdg-open with no DISPLAY exits non-zero). The URL is the useful output
  // either way; silence here left VPS users with a started server and no clue.
  console.log(`clidable: open this URL in your browser:\n  ${url}`);
}

/** The target directory from the args: everything after a `--` is literal (so a
 *  path beginning with `-` still works), else the first non-flag token, else the
 *  current working directory. */
function targetDir(args: string[]): string {
  const sep = args.indexOf("--");
  const raw = sep !== -1 ? args[sep + 1] : args.find((a) => !a.startsWith("-"));
  return resolve(raw ?? process.cwd());
}

export async function runOpenCommand(args: string[]): Promise<number> {
  const dir = targetDir(args);
  // --print: just print the deep-link URL (do nothing). --no-launch: ensure the
  // background server for this dir but don't steal focus / open a UI (for
  // scripts, CI, or "start it, I'll open it myself"). --new: always open a fresh
  // workspace instead of resuming the latest one that contains this folder.
  // Flags are only read BEFORE a `--` separator — everything after it is
  // literal, so a directory named "--print" can't flip the mode it rode in on.
  const sep = args.indexOf("--");
  const flags = sep === -1 ? args : args.slice(0, sep);
  const printOnly = flags.includes("--print") || flags.includes("--url");
  const noLaunch = flags.includes("--no-launch");
  const forceNew = flags.includes("--new");
  const port = serverPort();
  const url = `http://127.0.0.1:${port}/?cwd=${encodeURIComponent(dir)}${forceNew ? "&new=1" : ""}`;

  if (printOnly) {
    console.log(url);
    return 0;
  }

  // Prefer the native app when installed (it owns its own server) — unless the
  // caller only wants the server ensured (--no-launch).
  if (!noLaunch && (await desktopAppInstalled())) {
    await launchDesktopApp(dir, forceNew);
    return 0;
  }

  // Make sure a server is running, then open the deep-link (or, for --no-launch,
  // just print the URL the caller can open).
  if (!(await ensureServerRunning(port))) {
    console.error(`clidable: could not start the server on port ${port}`);
    return 1;
  }
  if (noLaunch) {
    console.log(url);
    return 0;
  }
  await openInBrowser(url);
  return 0;
}

export async function runStopCommand(args: string[]): Promise<number> {
  const res = await stopServer(undefined, { force: args.includes("--force") });
  if (res.refusedAppOwned) {
    console.error(
      "clidable: the running server belongs to the Clidable desktop app — " +
        "killing it would strand the app's windows.\n" +
        "Quit the app from its tray instead, or re-run with --force to kill it anyway.",
    );
    return 1;
  }
  if (res.stopped) {
    console.log(`clidable: stopped the background server (pid ${res.pid})`);
  } else if (res.pid) {
    console.log(`clidable: server was not running (cleared a stale lock)`);
  } else {
    console.log("clidable: no background server is running");
  }
  return 0;
}
