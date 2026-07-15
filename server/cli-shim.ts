/**
 * `clidable` CLI shim (AI Team — PLAN.md §5).
 *
 * The role skills tell a lead agent to run `clidable team delegate …`, so that
 * command must resolve inside the agent's terminal. Rather than require a global
 * install, the server writes a tiny `clidable` shim into `paths.bin` on startup
 * and prepends that dir to the PATH of every PTY/delegate it spawns (see
 * pty/session.ts and team/run.ts). The shim just re-invokes THIS server's own
 * CLI dispatch (the COMMANDS table in index.ts), so it works in dev (bun +
 * index.ts) and in a compiled binary alike.
 */
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { basename, delimiter, join } from "node:path";
import { paths } from "./paths";

/** Dir prepended to spawned-agent PATHs; holds the `clidable` shim. */
export const CLIDABLE_BIN_DIR = paths.bin;

/** Prepend the shim dir to a PATH so spawned agents resolve `clidable`. Guards
 *  the empty/undefined case so we never emit a trailing delimiter (which would
 *  add the cwd to PATH). Shared by the PTY session and delegate spawns. */
export function pathWithClidableBin(base = process.env.PATH): string {
  return base ? `${CLIDABLE_BIN_DIR}${delimiter}${base}` : CLIDABLE_BIN_DIR;
}

/** How to re-invoke this process's CLI dispatch. In dev the runtime is `bun`
 *  and the entry is a script (`Bun.main`); a compiled standalone binary IS the
 *  executable and embeds its entry, so no script arg. */
function invocation(): string {
  const exe = process.execPath;
  const isBunRuntime = basename(exe).toLowerCase().startsWith("bun");
  return isBunRuntime ? `"${exe}" "${Bun.main}"` : `"${exe}"`;
}

/**
 * Write the `clidable` shim (POSIX + Windows) into CLIDABLE_BIN_DIR. Regenerated
 * each startup so the embedded runtime/entry paths stay current. Best-effort:
 * never throws into the boot path.
 */
export async function ensureClidableShim(): Promise<void> {
  try {
    await mkdir(CLIDABLE_BIN_DIR, { recursive: true });
    const inv = invocation();

    const posix = join(CLIDABLE_BIN_DIR, "clidable");
    await writeFile(posix, `#!/bin/sh\nexec ${inv} "$@"\n`, "utf8");
    await chmod(posix, 0o755);

    // Windows resolves bare `clidable` to clidable.cmd on PATH.
    await writeFile(join(CLIDABLE_BIN_DIR, "clidable.cmd"), `@echo off\r\n${inv} %*\r\n`, "utf8");
  } catch (e) {
    console.error("[clidable] could not write the CLI shim:", (e as Error)?.message ?? e);
  }
}
