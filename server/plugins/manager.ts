/**
 * Plugin mutations (PLAN.md §4).
 *
 * INSTALL shells out to the bundled `plugins` CLI (vercel-labs) — the one tool
 * that does the cross-store `.plugin/` → vendor-format translation + native
 * writes. It installs by `--target`: `claude-code` (the store Cursor shares)
 * and `codex`. `--target` is singular, so we run one invocation per requested
 * store, always with `-y` so it never prompts.
 *
 * Remove / enable / disable (slice 3) delegate to the agents' own CLIs
 * (`claude plugin uninstall`, `codex plugin remove`).
 */
import { PLUGIN_STORE_TARGET } from "../../shared/types";
import type {
  InstalledPluginInfo,
  PluginScope,
  PluginStore,
} from "../../shared/types";
import { runPluginsCli, summarizePluginsFailure } from "./cli";
import {
  listInstalledPlugins,
  readAntigravityStore,
  readClaudeStore,
  readCodexStore,
  type PluginStoreRow,
} from "./installed";

/** Install `source` into the given stores, then return the refreshed list.
 *  `plugins add` installs every plugin discovered in `source` — fine for the
 *  single-plugin custom sources this serves (Discover picks per-plugin via the
 *  native CLIs in a later slice). */
export async function addPlugin(args: {
  projectPath: string;
  source: string;
  scope: PluginScope;
  stores: PluginStore[];
}): Promise<InstalledPluginInfo[]> {
  const { projectPath, source, scope, stores } = args;
  if (stores.length === 0) throw new Error("no target stores selected");
  for (const store of stores) {
    if (store === "antigravity") {
      // Antigravity isn't a vercel `plugins` target — install via its own CLI.
      // `agy plugin install` takes a plugin dir or a `plugin@marketplace` ref
      // and has no --scope (workspace vs global is decided by where it writes).
      const r = await runNative(["agy", "plugin", "install", source], projectPath);
      if (!r.ok) {
        throw new Error(`agy plugin install of "${source}" failed: ${firstLine(r.out)}`);
      }
      continue;
    }
    const target = PLUGIN_STORE_TARGET[store];
    const r = await runPluginsCli(
      ["add", source, "-y", "--target", target, "--scope", scope],
      projectPath,
    );
    if (!r.ok) {
      throw new Error(
        `${summarizePluginsFailure(r)} (installing ${source} → ${store})`,
      );
    }
  }
  return listInstalledPlugins(projectPath);
}

/* -------------------------------------------------------------------------- */
/*  Remove / enable / disable — delegated to the agents' own CLIs             */
/* -------------------------------------------------------------------------- */

/** Run a native agent CLI (`claude` / `codex`) and capture combined output.
 *  Bounded by a timeout so an interactive prompt (e.g. a Codex connector's
 *  OAuth on install) can't hang the HTTP request forever. */
async function runNative(
  cmd: string[],
  cwd: string,
): Promise<{ ok: boolean; out: string }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
    // Generous (Claude installs may clone a repo) but bounded.
    timeout: 120_000,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, out: `${out}\n${err}`.trim() };
}

function firstLine(s: string): string {
  return (s.split("\n").map((l) => l.trim()).find(Boolean) ?? "").slice(0, 200);
}

/** The exact `name@marketplace` ref for a plugin in a given store — resolved
 *  from disk because the two stores can carry different marketplaces. */
function refFor(row: PluginStoreRow): string {
  return row.marketplace ? `${row.name}@${row.marketplace}` : row.name;
}

/** Per-store operations, so remove stays store-agnostic (one loop, no `if
 *  (store === …)`). Claude removal also covers Cursor (shared store). */
const STORE_OPS: Record<
  PluginStore,
  {
    read: (projectPath: string) => Promise<PluginStoreRow[]>;
    uninstallCmd: (row: PluginStoreRow) => string[];
    /** Install a marketplace plugin by `name@marketplace` ref. Claude takes a
     *  scope; Codex installs are user-level (scope ignored). */
    installCmd: (ref: string, scope: PluginScope) => string[];
  }
> = {
  claude: {
    read: (projectPath) => readClaudeStore(projectPath),
    uninstallCmd: (row) => ["claude", "plugin", "uninstall", refFor(row), "-s", row.scope, "-y"],
    installCmd: (ref, scope) => ["claude", "plugin", "install", ref, "-s", scope],
  },
  codex: {
    read: () => readCodexStore(),
    uninstallCmd: (row) => ["codex", "plugin", "remove", refFor(row)],
    installCmd: (ref) => ["codex", "plugin", "add", ref],
  },
  antigravity: {
    read: (projectPath) => readAntigravityStore(projectPath),
    // `agy` uninstalls by bare name and installs a dir or `plugin@marketplace`
    // ref; neither takes a scope flag.
    uninstallCmd: (row) => ["agy", "plugin", "uninstall", row.name],
    installCmd: (ref) => ["agy", "plugin", "install", ref],
  },
};

/** Remove a plugin from the given stores (default: every store it's in), then
 *  return the refreshed list. Each store's exact ref/scope is resolved from
 *  disk and the uninstall delegated to that store's native CLI. */
export async function removePlugin(args: {
  projectPath: string;
  name: string;
  stores?: PluginStore[];
}): Promise<InstalledPluginInfo[]> {
  const { projectPath, name } = args;
  const stores = args.stores ?? (Object.keys(STORE_OPS) as PluginStore[]);
  const rows = await Promise.all(stores.map((s) => STORE_OPS[s].read(projectPath)));

  for (let i = 0; i < stores.length; i++) {
    const store = stores[i]!;
    const row = rows[i]!.find((r) => r.name === name);
    if (!row) continue; // not in this store → nothing to remove
    const r = await runNative(STORE_OPS[store].uninstallCmd(row), projectPath);
    if (!r.ok) throw new Error(`${store} remove of "${name}" failed: ${firstLine(r.out)}`);
  }
  return listInstalledPlugins(projectPath);
}

/** Install a specific plugin from a marketplace (the Discover flow). Routes by
 *  store: Claude → `claude plugin install` (Claude+Cursor, scope-aware); Codex →
 *  `codex plugin add` (user-level). Returns the refreshed list. Codex catalog
 *  plugins are OAuth connectors (auth on install) — a headless add may fail at
 *  the auth step, so the error nudges the user to finish in a terminal. */
export async function installMarketplacePlugin(args: {
  projectPath: string;
  name: string;
  marketplace: string;
  store: PluginStore;
  scope: PluginScope;
}): Promise<InstalledPluginInfo[]> {
  const { projectPath, name, marketplace, store, scope } = args;
  const ref = `${name}@${marketplace}`;
  const r = await runNative(STORE_OPS[store].installCmd(ref, scope), projectPath);
  if (!r.ok) {
    const hint =
      store === "codex"
        ? ` — connectors need auth; finish in a terminal: codex plugin add ${ref}`
        : "";
    throw new Error(`install of "${ref}" failed: ${firstLine(r.out)}${hint}`);
  }
  return listInstalledPlugins(projectPath);
}

