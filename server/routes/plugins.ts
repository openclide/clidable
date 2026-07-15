/**
 * /api/plugins — Plugin management (PLAN.md §4). Mirrors the skills/mcp routes.
 *
 *   GET  /api/plugins?projectPath=   → installed plugins across both stores
 *   GET  /api/plugins/discover       → available plugins: Claude marketplaces (local) + Codex catalog (fetched)
 *   POST /api/plugins/add            → install a source via the vercel CLI
 *   POST /api/plugins/install        → install one plugin from a marketplace
 *   POST /api/plugins/remove         → uninstall from given stores (native CLIs)
 */
import { jsonError as err } from "../http";
import { listInstalledPlugins } from "../plugins/installed";
import { listAvailablePlugins } from "../plugins/discover";
import { addPlugin, installMarketplacePlugin, removePlugin } from "../plugins/manager";
import { PLUGIN_STORE_AGENTS } from "../../shared/types";
import type {
  AddPluginRequest,
  DiscoverPluginsResponse,
  ListPluginsResponse,
  PluginScope,
  PluginStore,
  RemovePluginRequest,
} from "../../shared/types";

const STORES = new Set(Object.keys(PLUGIN_STORE_AGENTS) as PluginStore[]);
const SCOPES: ReadonlySet<PluginScope> = new Set(["user", "project", "local"]);

export async function pluginsListHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get("projectPath");
  if (!projectPath) return err(400, "missing 'projectPath' query param");
  try {
    const body: ListPluginsResponse = {
      plugins: await listInstalledPlugins(projectPath),
    };
    return Response.json(body);
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[plugins] list failed:");
  }
}

export async function pluginsAddHandler(req: Request): Promise<Response> {
  let body: AddPluginRequest;
  try {
    body = (await req.json()) as AddPluginRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (!body.projectPath) return err(400, "missing 'projectPath'");
  if (!body.source) return err(400, "missing 'source'");
  const stores = Array.isArray(body.stores)
    ? body.stores.filter((s) => STORES.has(s))
    : [];
  if (stores.length === 0) return err(400, "no valid 'stores'");
  const scope: PluginScope = SCOPES.has(body.scope) ? body.scope : "user";
  try {
    const plugins = await addPlugin({
      projectPath: body.projectPath,
      source: body.source,
      scope,
      stores,
    });
    return Response.json({ plugins } satisfies ListPluginsResponse);
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[plugins] add failed:");
  }
}

export async function pluginsDiscoverHandler(): Promise<Response> {
  try {
    const body: DiscoverPluginsResponse = { plugins: await listAvailablePlugins() };
    return Response.json(body);
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[plugins] discover failed:");
  }
}

/** Install a specific plugin from a marketplace (Discover). */
export async function pluginsInstallHandler(req: Request): Promise<Response> {
  let body: {
    projectPath?: string;
    name?: string;
    marketplace?: string;
    store?: string;
    scope?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (!body.projectPath) return err(400, "missing 'projectPath'");
  if (!body.name) return err(400, "missing 'name'");
  if (!body.marketplace) return err(400, "missing 'marketplace'");
  if (!STORES.has(body.store as PluginStore)) return err(400, "missing or invalid 'store'");
  const scope: PluginScope = SCOPES.has(body.scope as PluginScope)
    ? (body.scope as PluginScope)
    : "user";
  try {
    const plugins = await installMarketplacePlugin({
      projectPath: body.projectPath,
      name: body.name,
      marketplace: body.marketplace,
      store: body.store as PluginStore,
      scope,
    });
    return Response.json({ plugins } satisfies ListPluginsResponse);
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[plugins] install failed:");
  }
}

export async function pluginsRemoveHandler(req: Request): Promise<Response> {
  let body: RemovePluginRequest;
  try {
    body = (await req.json()) as RemovePluginRequest;
  } catch {
    return err(400, "invalid JSON body");
  }
  if (!body.projectPath) return err(400, "missing 'projectPath'");
  if (!body.name) return err(400, "missing 'name'");
  // Require explicit stores — omitting them would remove from every store.
  const stores = Array.isArray(body.stores)
    ? body.stores.filter((s) => STORES.has(s))
    : [];
  if (stores.length === 0) return err(400, "missing or invalid 'stores'");
  try {
    const plugins = await removePlugin({ projectPath: body.projectPath, name: body.name, stores });
    return Response.json({ plugins } satisfies ListPluginsResponse);
  } catch (e) {
    return err(500, (e as Error)?.message ?? String(e), "[plugins] remove failed:");
  }
}
