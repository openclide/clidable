/**
 * `clidable instructions …` — the terminal surface for Context (PLAN.md §4).
 * Calls the SAME managers the GUI's /api/context routes use. Dispatched from
 * server/index.ts before the server boots; runs against the cwd's project.
 *
 *   list   read path — who reads AGENTS.md + pointer status
 *   init   auto-init — write a framework-detected starter AGENTS.md
 *   sync   write path — create/repair the Claude @import pointer
 *   edit   open AGENTS.md in $EDITOR (creating a starter first if absent)
 */
import { join } from "node:path";
import { scanContext } from "./scan";
import { saveContext } from "./manager";
import { buildStarter } from "./starter";
import { INSTRUCTION_CANONICAL_FILE } from "../../shared/types";
import type { InstructionAgentInfo } from "../../shared/types";

const HELP = `clidable instructions — manage AGENTS.md (project instructions)

  list                show which agents read AGENTS.md + pointer status
  init [--force]      write a framework-detected starter AGENTS.md
  sync                create/repair the Claude @import pointer
  edit                open AGENTS.md in $EDITOR (creates a starter if absent)

AGENTS.md is canonical; most agents read it directly. Claude gets a one-line
import pointer. Runs against the current working directory's project.`;

const pointerLabel = (a: InstructionAgentInfo): string =>
  a.pointerOk ? "wired" : a.hasOwnContent ? "own content" : "not set";

export async function runContextCommand(args: string[]): Promise<number> {
  const sub = args[0];
  const cwd = process.cwd();
  const force = args.includes("--force");

  try {
    switch (sub) {
      case "list":
      case "ls": {
        const scan = await scanContext(cwd);
        console.log(scan.exists ? `AGENTS.md (${byteLabel(scan.content)})` : "No AGENTS.md yet — run `clidable instructions init`.");
        const native = scan.agents.filter((a) => a.coverage === "native");
        const pointers = scan.agents.filter((a) => a.coverage === "pointer");
        const none = scan.agents.filter((a) => a.coverage === "none");
        if (native.length) {
          console.log(`  reads directly:  ${native.map((a) => a.agent).join(", ")}`);
        }
        for (const a of pointers) {
          console.log(`  ${a.agent} → ${a.file}: ${pointerLabel(a)}`);
        }
        if (none.length) {
          console.log(`  not auto-loaded: ${none.map((a) => a.agent).join(", ")}`);
        }
        return 0;
      }

      case "init": {
        const scan = await scanContext(cwd);
        if (scan.exists && !force) {
          console.error("AGENTS.md already exists — pass --force to overwrite.");
          return 1;
        }
        await saveContext({ projectPath: cwd, content: await buildStarter(cwd), pointers: [] });
        console.log("Wrote AGENTS.md. Run `clidable instructions sync` to wire Claude.");
        return 0;
      }

      case "sync": {
        const scan = await scanContext(cwd);
        if (!scan.exists) {
          console.error("No AGENTS.md — run `clidable instructions init` first.");
          return 1;
        }
        const holdouts = scan.agents.filter((a) => a.coverage === "pointer");
        // Wire everything except files with their own content — never clobber.
        const toWire = holdouts.filter((a) => !a.hasOwnContent).map((a) => a.agent);
        const edited = holdouts.filter((a) => a.hasOwnContent);
        await saveContext({ projectPath: cwd, content: scan.content, pointers: toWire });
        console.log(toWire.length ? `Wired: ${toWire.join(", ")}.` : "All pointers already wired.");
        if (edited.length) {
          console.log(
            `Skipped (own content — convert in the GUI to keep it): ${edited.map((a) => a.file).join(", ")}`,
          );
        }
        return 0;
      }

      case "edit": {
        const scan = await scanContext(cwd);
        if (!scan.exists) {
          await saveContext({ projectPath: cwd, content: await buildStarter(cwd), pointers: [] });
        }
        const path = join(cwd, INSTRUCTION_CANONICAL_FILE);
        const editor = process.env.EDITOR || process.env.VISUAL;
        if (!editor || !process.stdin.isTTY) {
          console.log(path);
          return 0;
        }
        const [bin, ...editorArgs] = editor.split(" ");
        const proc = Bun.spawn([bin!, ...editorArgs, path], {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        });
        return await proc.exited;
      }

      default:
        console.log(HELP);
        return sub ? 1 : 0;
    }
  } catch (e) {
    console.error(`error: ${(e as Error)?.message ?? String(e)}`);
    return 1;
  }
}

function byteLabel(s: string): string {
  const n = Buffer.byteLength(s, "utf8");
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}
