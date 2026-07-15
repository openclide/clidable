/**
 * `clidable plugins …` — the terminal surface for plugins (PLAN.md §4, slice 5).
 * Calls the SAME managers the GUI's /api/plugins routes use. Dispatched from
 * server/index.ts before the server boots.
 *
 *   • install  → vercel `plugins` CLI (re-exec)
 *   • discover/list → read native state files directly
 *   • remove   → native `claude plugin uninstall` / `codex plugin remove`
 */
import { listInstalledPlugins } from "./installed";
import { listAvailablePlugins } from "./discover";
import { addPlugin, installMarketplacePlugin, removePlugin } from "./manager";
import { PLUGIN_STORE_AGENTS } from "../../shared/types";
import type { PluginScope, PluginStore } from "../../shared/types";

const HELP = `clidable plugins — manage agent plugins

  list
  discover [-q <query>]
  add <source> [--store claude|codex|antigravity]… [--scope user|project|local]
  install <name@marketplace> [--store claude|codex] [--scope user|project|local]
  remove <name> [--store claude|codex|antigravity]…

  --store <s>    claude (= Claude Code + Cursor) | codex | antigravity   (repeatable)
                 (antigravity installs via \`agy plugin\`; --scope doesn't apply)
  --scope <s>    user (default) | project | local
  -q <query>     filter discover results

'add' installs EVERY plugin found at <source>; 'install' picks one from a
marketplace. Runs against the current working directory's project.`;

const STORES = new Set(Object.keys(PLUGIN_STORE_AGENTS) as PluginStore[]);
const SCOPES = new Set<PluginScope>(["user", "project", "local"]);
const isStore = (s: string): s is PluginStore => STORES.has(s as PluginStore);

const VALUE_FLAGS = new Set(["--store", "--scope", "-q"]);

interface Parsed {
  positionals: string[];
  opt: (name: string) => string[];
}

function parse(args: string[]): Parsed {
  const positionals: string[] = [];
  const opts = new Map<string, string[]>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (VALUE_FLAGS.has(a)) {
      const v = args[++i];
      if (v !== undefined) opts.set(a, [...(opts.get(a) ?? []), v]);
    } else if (a.startsWith("-")) {
      // unknown flag — ignore rather than mistaking it for a positional
    } else {
      positionals.push(a);
    }
  }
  return { positionals, opt: (n) => opts.get(n) ?? [] };
}

// `--scope` is already validated up-front in runPluginsCommand, so here it's
// known-good-or-absent.
function scopeOf(p: Parsed, fallback: PluginScope): PluginScope {
  return (p.opt("--scope")[0] as PluginScope) ?? fallback;
}

export async function runPluginsCommand(args: string[]): Promise<number> {
  const sub = args[0];
  const p = parse(args.slice(1));
  const cwd = process.cwd();
  // Reject mistyped flag values rather than silently falling back — for
  // `remove --store codx`, a silent fallback would remove from EVERY store.
  const storeArgs = p.opt("--store");
  const stores = storeArgs.filter(isStore);
  if (storeArgs.length > 0 && stores.length === 0) {
    return usage("--store must be claude | codex");
  }
  const scopeArg = p.opt("--scope")[0];
  if (scopeArg !== undefined && !SCOPES.has(scopeArg as PluginScope)) {
    return usage("--scope must be user | project | local");
  }

  try {
    switch (sub) {
      case "list":
      case "ls": {
        const plugins = await listInstalledPlugins(cwd);
        if (!plugins.length) {
          console.log("No plugins installed.");
          return 0;
        }
        for (const pl of plugins) {
          const flags = [pl.scope, pl.enabled ? null : "disabled"].filter(Boolean).join(" · ");
          console.log(
            `${pl.name}  [${pl.stores.join(", ")}]  (${flags})  ${pl.components.length} components`,
          );
        }
        return 0;
      }
      case "discover":
      case "search": {
        const q = (p.opt("-q")[0] ?? "").toLowerCase();
        let plugins = await listAvailablePlugins();
        if (q) {
          plugins = plugins.filter(
            (pl) =>
              pl.name.toLowerCase().includes(q) ||
              pl.description.toLowerCase().includes(q),
          );
        }
        if (!plugins.length) {
          console.log(q ? "No plugins match." : "No marketplaces configured.");
          return 0;
        }
        const shown = plugins.slice(0, 30);
        for (const pl of shown) {
          console.log(
            `${pl.name}  ${pl.installs.toLocaleString()} installs  ${pl.category || "—"}  @${pl.marketplace}`,
          );
        }
        if (plugins.length > shown.length) {
          console.log(
            `… +${plugins.length - shown.length} more${q ? "" : " (use -q to filter)"}`,
          );
        }
        return 0;
      }
      case "add": {
        const source = p.positionals[0];
        if (!source) return usage("add <source> [--store …] [--scope …]");
        const targets = stores.length ? stores : (["claude"] as PluginStore[]);
        await addPlugin({ projectPath: cwd, source, scope: scopeOf(p, "project"), stores: targets });
        console.log(`Installed from ${source} into ${targets.join(", ")}.`);
        return 0;
      }
      case "install":
      case "i": {
        const ref = p.positionals[0];
        const at = ref ? ref.lastIndexOf("@") : -1;
        if (!ref || at <= 0 || at === ref.length - 1) {
          return usage("install <name@marketplace> [--store claude|codex] [--scope …]");
        }
        await installMarketplacePlugin({
          projectPath: cwd,
          name: ref.slice(0, at),
          marketplace: ref.slice(at + 1),
          store: stores[0] ?? "claude",
          scope: scopeOf(p, "user"),
        });
        console.log(`Installed ${ref}.`);
        return 0;
      }
      case "remove":
      case "rm": {
        const name = p.positionals[0];
        if (!name) return usage("remove <name> [--store …]");
        await removePlugin({
          projectPath: cwd,
          name,
          stores: stores.length ? stores : undefined,
        });
        console.log(`Removed ${name} from ${stores.length ? stores.join(", ") : "all stores"}.`);
        return 0;
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

function usage(line: string): number {
  console.error(`usage: clidable plugins ${line}`);
  return 1;
}
