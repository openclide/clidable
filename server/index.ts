/**
 * Clidable server entry.
 *
 * Single Bun process serves:
 *   • The React frontend bundle (HTML import; Bun bundles TSX + Tailwind v4
 *     in dev with HMR, and ahead-of-time with `bun run build`).
 *   • The JSON API (/api/*).
 *   • The terminal WebSocket (/api/terminal) — multiplexed PTY sessions.
 *
 * The same binary runs in three shells (Tauri sidecar, plain web mode, server
 * mode). See PLAN.md §11–§12.
 */
import { serve, type Server, type WebSocketHandler } from "bun";
import homepage from "../web/index.html";
import landing from "../web/landing.html";
import { parseConfig } from "./cli";
import { ensureDirs, paths } from "./paths";
import { ensureClidableShim } from "./cli-shim";
import { runOpenCommand, runStopCommand } from "./launch/command";
import { clearLock, serverPort, writeLock } from "./launch/daemon";
import { openDb } from "./db";
import { setReportPort } from "./pty/hook-report";
import { agentsHandler } from "./routes/agents";
import { agentHookHandler } from "./routes/agent-hook";
import { attachmentUploadHandler } from "./routes/attachments";
import {
  checkpointScreenshotHandler,
  checkpointsCreateHandler,
  checkpointsListHandler,
  checkpointsRestoreHandler,
} from "./routes/checkpoints";
import {
  fsBrowseHandler,
  fsListHandler,
  fsReadHandler,
  fsWriteHandler,
} from "./routes/fs";
import {
  contextGetHandler,
  contextSaveHandler,
  contextStarterHandler,
} from "./routes/context";
import { gitDiffHandler, gitStatusHandler } from "./routes/git";
import {
  workspaceCreateHandler,
  workspaceGetHandler,
  workspaceRemoveHandler,
  workspaceSaveHandler,
  workspaceTouchHandler,
  workspacesListHandler,
} from "./routes/workspaces";
import { healthHandler } from "./routes/health";
import {
  mcpAddHandler,
  mcpDiscoverHandler,
  mcpListHandler,
  mcpRemoveHandler,
} from "./routes/mcp";
import {
  pluginsAddHandler,
  pluginsDiscoverHandler,
  pluginsInstallHandler,
  pluginsListHandler,
  pluginsRemoveHandler,
} from "./routes/plugins";
import {
  skillsAddHandler,
  skillsListHandler,
  skillsRemoveHandler,
  skillsSearchHandler,
} from "./routes/skills";
import {
  projectCreateHandler,
  projectDevStartHandler,
  projectDevStatusHandler,
  projectDevStopHandler,
  projectsListHandler,
  projectsOpenHandler,
  projectRemoveHandler,
  projectTouchHandler,
} from "./routes/projects";
import { checkProxyAllowed, isLoopbackHost, parseProxyPath } from "./net/ssrf";
import { guardApiRoutes, isSameSiteRequest } from "./net/origin";
import { startPortScanner } from "./preview/port-scan";
import { devTerminalWebSocketHandler } from "./routes/dev-terminal-ws";
import { previewEventsWebSocketHandler } from "./routes/preview-events-ws";
import { proxyHttp, proxyWsTarget } from "./routes/proxy";
import { proxyWsHandler } from "./routes/proxy-ws";
import { terminalWebSocketHandler } from "./routes/terminal-ws";
import { watchWebSocketHandler } from "./routes/watch-ws";
import { runBundledSkills } from "./skills/cli";
import { runSkillsCommand } from "./skills/command";
import { runMcpCommand } from "./mcp/command";
import { runBundledPlugins } from "./plugins/cli";
import { runPluginsCommand } from "./plugins/command";
import { runContextCommand } from "./context/command";
import { runTeamCommand } from "./team/command";
import {
  teamCancelHandler,
  teamDelegateHandler,
  teamJobHandler,
  teamJobsHandler,
  teamRolesHandler,
  teamRolesSaveHandler,
  teamSyncHandler,
  teamUninstallHandler,
} from "./routes/team";

// Subcommand dispatch — handled before the server boots. `Bun.argv` is scanned
// (offset-agnostic) so this works whether launched as `bun server/index.ts …`,
// the Tauri sidecar, or a compiled binary. We dispatch the EARLIEST matching
// token, so a subcommand's OWN args can't be hijacked by a later token (e.g.
// `plugins discover -q mcp` must run plugins, not mcp). `__run-*` are internal
// re-exec targets (server/<x>/cli.ts); the bare words are the `clidable <x>` CLI.
{
  // Re-exec targets call process.exit themselves (return never); CLI surfaces
  // return an exit code we forward.
  const REEXEC: Record<string, (a: string[]) => Promise<never>> = {
    "__run-skills": runBundledSkills,
    "__run-plugins": runBundledPlugins,
  };
  const COMMANDS: Record<string, (a: string[]) => Promise<number>> = {
    skills: runSkillsCommand,
    mcp: runMcpCommand,
    plugins: runPluginsCommand,
    instructions: runContextCommand,
    team: runTeamCommand,
    // Launch a UI for a directory (app if installed, else browser) / stop the
    // background server. These ensure-or-attach to the singleton server and exit
    // WITHOUT booting one themselves.
    open: runOpenCommand,
    stop: runStopCommand,
  };
  let hit: { idx: number; tok: string } | null = null;
  for (const tok of [...Object.keys(REEXEC), ...Object.keys(COMMANDS)]) {
    const i = Bun.argv.indexOf(tok);
    if (i !== -1 && (hit === null || i < hit.idx)) hit = { idx: i, tok };
  }
  if (hit) {
    const rest = Bun.argv.slice(hit.idx + 1);
    const reexec = REEXEC[hit.tok];
    if (reexec) await reexec(rest);
    else process.exit(await COMMANDS[hit.tok]!(rest));
  }
}

// parseConfig throws on a misconfig (e.g. a non-loopback --bind). Exit fast and
// cleanly: an uncaught throw here would only PRINT — the HTML-import bundler
// loaded above keeps the event loop alive, so the process would hang looking
// frozen instead of failing.
let config: ReturnType<typeof parseConfig>;
try {
  config = parseConfig();
} catch (e) {
  console.error((e as Error)?.message ?? String(e));
  process.exit(1);
}

ensureDirs();
openDb(); // run migrations on start
await ensureClidableShim(); // make `clidable …` resolvable inside spawned agents
setReportPort(config.port); // where spawned-agent hooks report their session id

/**
 * Discriminated union of every shape we attach to a ServerWebSocket.
 * The dispatcher below switches on `kind` and calls into the
 * per-endpoint handler. New WS endpoints add a variant here and a
 * branch in `websocketDispatcher`.
 */
type WSSocketData =
  | { kind: "terminal"; subs: Map<string, unknown> }
  | {
      kind: "watch";
      projectPath: string;
      unsubscribe: (() => void) | null;
    }
  | {
      kind: "preview-events";
      projectPath: string;
      unsubscribe: (() => void) | null;
    }
  | { kind: "dev-terminal"; projectPath: string; detach: (() => void) | null }
  | {
      kind: "proxy-ws";
      target: string;
      upstream: WebSocket | null;
      queue: (string | Uint8Array)[];
    };

const websocketDispatcher: WebSocketHandler<WSSocketData> = {
  open(ws) {
    if (ws.data.kind === "watch") return watchWebSocketHandler.open(ws as never);
    if (ws.data.kind === "preview-events") {
      return previewEventsWebSocketHandler.open(ws as never);
    }
    if (ws.data.kind === "proxy-ws") return proxyWsHandler.open(ws as never);
    if (ws.data.kind === "dev-terminal") {
      return devTerminalWebSocketHandler.open(ws as never);
    }
    return terminalWebSocketHandler.open(ws as never);
  },
  message(ws, raw) {
    if (ws.data.kind === "watch") {
      return watchWebSocketHandler.message(ws as never, raw);
    }
    if (ws.data.kind === "preview-events") {
      return previewEventsWebSocketHandler.message(ws as never, raw);
    }
    if (ws.data.kind === "proxy-ws") {
      return proxyWsHandler.message(ws as never, raw);
    }
    if (ws.data.kind === "dev-terminal") {
      return devTerminalWebSocketHandler.message(ws as never, raw);
    }
    return terminalWebSocketHandler.message(ws as never, raw);
  },
  close(ws) {
    if (ws.data.kind === "watch") return watchWebSocketHandler.close(ws as never);
    if (ws.data.kind === "preview-events") {
      return previewEventsWebSocketHandler.close(ws as never);
    }
    if (ws.data.kind === "proxy-ws") return proxyWsHandler.close(ws as never);
    if (ws.data.kind === "dev-terminal") {
      return devTerminalWebSocketHandler.close(ws as never);
    }
    // Terminal handler doesn't currently define a close; sessions
    // self-clean via PTY exit + ring-buffer GC.
  },
};

// Singleton guard: exactly one server owns the port. If it's already taken,
// another Clidable server is running — attach to THAT instead of double-booting.
// serve() throws synchronously on EADDRINUSE; an UNcaught throw here would only
// print while the HTML-import bundler keeps the loop alive, so the process would
// hang looking frozen (same hazard parseConfig guards above). Exit cleanly.
let server: Server<WSSocketData>;
try {
  server = serve({
  port: config.port,
  hostname: config.bind,

  // Dev-time conveniences: HMR for the frontend bundle + browser console
  // streamed to the server terminal. Disabled in production.
  development: config.dev
    ? { hmr: true, console: true }
    : false,

  // Every `/api/*` route (and the WS upgrades under it) is wrapped so a
  // cross-site request — a web page the user visits reaching this loopback
  // server, incl. the terminal-WS RCE surface — is refused before its handler.
  routes: guardApiRoutes({
    "/": homepage,
    "/home": landing,
    "/api/health": { GET: healthHandler },
    "/api/agents": { GET: agentsHandler },
    "/api/agent-hook": { POST: agentHookHandler },
    "/api/projects": {
      GET: projectsListHandler,
      POST: projectsOpenHandler,
    },
    "/api/projects/create": { POST: projectCreateHandler },
    "/api/projects/touch": { POST: projectTouchHandler },
    "/api/projects/remove": { POST: projectRemoveHandler },
    "/api/projects/dev-server": { GET: projectDevStatusHandler },
    "/api/projects/dev-server/start": { POST: projectDevStartHandler },
    "/api/projects/dev-server/stop": { POST: projectDevStopHandler },
    "/api/workspaces": { GET: workspacesListHandler, POST: workspaceCreateHandler },
    "/api/workspaces/get": { GET: workspaceGetHandler },
    "/api/workspaces/save": { PUT: workspaceSaveHandler },
    "/api/workspaces/touch": { POST: workspaceTouchHandler },
    "/api/workspaces/remove": { POST: workspaceRemoveHandler },
    "/api/attachments": { POST: attachmentUploadHandler },
    "/api/fs/list": { GET: fsListHandler },
    "/api/fs/browse": { GET: fsBrowseHandler },
    "/api/fs/read": { GET: fsReadHandler },
    "/api/fs/write": { PUT: fsWriteHandler },
    "/api/git/status": { GET: gitStatusHandler },
    "/api/git/diff": { GET: gitDiffHandler },
    "/api/skills": { GET: skillsListHandler },
    "/api/skills/search": { GET: skillsSearchHandler },
    "/api/skills/add": { POST: skillsAddHandler },
    "/api/skills/remove": { POST: skillsRemoveHandler },
    "/api/mcp": { GET: mcpListHandler },
    "/api/mcp/discover": { GET: mcpDiscoverHandler },
    "/api/mcp/add": { POST: mcpAddHandler },
    "/api/mcp/remove": { POST: mcpRemoveHandler },
    "/api/plugins": { GET: pluginsListHandler },
    "/api/plugins/discover": { GET: pluginsDiscoverHandler },
    "/api/plugins/add": { POST: pluginsAddHandler },
    "/api/plugins/install": { POST: pluginsInstallHandler },
    "/api/plugins/remove": { POST: pluginsRemoveHandler },
    "/api/context": { GET: contextGetHandler },
    "/api/context/starter": { GET: contextStarterHandler },
    "/api/context/save": { POST: contextSaveHandler },
    "/api/team/delegate": { POST: teamDelegateHandler },
    "/api/team/jobs": { GET: teamJobsHandler },
    "/api/team/job": { GET: teamJobHandler },
    "/api/team/cancel": { POST: teamCancelHandler },
    "/api/team/roles": { GET: teamRolesHandler, POST: teamRolesSaveHandler },
    "/api/team/sync": { POST: teamSyncHandler },
    "/api/team/uninstall": { POST: teamUninstallHandler },
    "/api/checkpoints": {
      POST: checkpointsCreateHandler,
      GET: checkpointsListHandler,
    },
    "/api/checkpoints/restore": { POST: checkpointsRestoreHandler },
    "/api/checkpoints/screenshot": { GET: checkpointScreenshotHandler },
    "/api/terminal": (req: Request, srv: Server<unknown>) => {
      if (srv.upgrade(req, { data: { kind: "terminal", subs: new Map() } })) {
        return;
      }
      return new Response("Expected WebSocket upgrade", { status: 426 });
    },
    "/api/watch": (req: Request, srv: Server<unknown>) => {
      const url = new URL(req.url);
      const projectPath = url.searchParams.get("projectPath");
      if (!projectPath) {
        return new Response("missing 'projectPath' query param", {
          status: 400,
        });
      }
      if (
        srv.upgrade(req, {
          data: { kind: "watch", projectPath, unsubscribe: null },
        })
      ) {
        return;
      }
      return new Response("Expected WebSocket upgrade", { status: 426 });
    },
    "/api/preview-events": (req: Request, srv: Server<unknown>) => {
      const url = new URL(req.url);
      const projectPath = url.searchParams.get("projectPath");
      if (!projectPath) {
        return new Response("missing 'projectPath' query param", {
          status: 400,
        });
      }
      if (
        srv.upgrade(req, {
          data: { kind: "preview-events", projectPath, unsubscribe: null },
        })
      ) {
        return;
      }
      return new Response("Expected WebSocket upgrade", { status: 426 });
    },
    "/api/dev-terminal": (req: Request, srv: Server<unknown>) => {
      const url = new URL(req.url);
      const projectPath = url.searchParams.get("projectPath");
      if (!projectPath) {
        return new Response("missing 'projectPath' query param", {
          status: 400,
        });
      }
      if (
        srv.upgrade(req, {
          data: { kind: "dev-terminal", projectPath, detach: null },
        })
      ) {
        return;
      }
      return new Response("Expected WebSocket upgrade", { status: 426 });
    },
  }, config),

  // Single WS dispatcher — Bun.serve only takes one handler, so we
  // route to the per-endpoint handler based on the discriminator that
  // the upgrade call stashed in `ws.data`.
  websocket: websocketDispatcher,

  // Anything not matched above. Handles the dev-server reverse-proxy
  // (/proxy/<port>/…, M-E2) — HTTP forward + WebSocket-upgrade bridge — then
  // falls through to 404.
  fetch(req, srv) {
    const url = new URL(req.url);
    const target = parseProxyPath(url.pathname);
    if (target) {
      // Same-site gate as the /api routes: a foreign page must not use the
      // proxy to reach the user's other localhost services (DB, redis, …).
      // Legit iframe traffic is same-origin (loopback) or Origin-less GETs.
      if (!isSameSiteRequest(req, config)) {
        return new Response("cross-site request refused", { status: 403 });
      }
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const decision = checkProxyAllowed(target.port, config);
        if (!decision.ok) {
          return new Response(decision.message, { status: decision.status });
        }
        const wsTarget = proxyWsTarget(target, url.search);
        if (
          srv.upgrade(req, {
            data: { kind: "proxy-ws", target: wsTarget, upstream: null, queue: [] },
          })
        ) {
          return;
        }
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      return proxyHttp(req, config, target);
    }
    return new Response("Not found", { status: 404 });
  },

  error(err) {
    console.error("[server] unhandled error:", err);
    return new Response("Internal error", { status: 500 });
  },
  });
} catch (e) {
  const code = (e as { code?: string })?.code;
  if (code === "EADDRINUSE" || /EADDRINUSE|address already in use|in use/i.test(String((e as Error)?.message ?? e))) {
    console.log(
      `[clidable] port ${config.port} is already serving Clidable — attaching to it (not starting a second server).`,
    );
    process.exit(0);
  }
  throw e;
}

// This process now owns the port — register the singleton {pid,port} lockfile so
// `clidable open`/`stop` (and the desktop tray's Quit) can find and stop it.
// ONLY the canonical server (the one on the machine's expected port) owns the
// lock: a secondary server explicitly bound to a different `--port` must not
// clobber the canonical server's {pid,port} — nor clear it on its own exit —
// or `stop`/Quit would lose the real target. `serverPort()` is the env-derived
// canonical port; `config.port` diverges only when `--port` overrides it.
const isCanonicalServer = config.port === serverPort();
if (isCanonicalServer) writeLock(config.port);
// Register the shutdown handlers exactly once. `bun --hot` re-evaluates this
// module on every reload within the SAME process, so an unguarded `process.on`
// would stack a new pair of listeners each time (MaxListenersExceededWarning).
// A globalThis flag persists across those re-evals.
const g = globalThis as { __clidableShutdownWired?: boolean };
if (!g.__clidableShutdownWired) {
  g.__clidableShutdownWired = true;
  const shutdown = () => {
    if (isCanonicalServer) clearLock();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

console.log(
  `[clidable] listening on http://${config.bind}:${config.port}` +
    (config.dev ? " (dev, HMR)" : " (prod)"),
);
console.log(`[clidable] data:  ${paths.data}`);
console.log(`[clidable] cache: ${paths.cache}`);
console.log(`[clidable] log:   ${paths.log}`);

// Loud, unmissable warning when bound beyond loopback (only reachable with the
// --allow-lan opt-in): this is an unauthenticated, network-exposed PTY spawner.
if (!isLoopbackHost(config.bind)) {
  console.warn(
    "\n\x1b[1;41m ⚠  NETWORK-EXPOSED \x1b[0m \x1b[1;33m--allow-lan is on.\x1b[0m\n" +
      `Clidable is bound to ${config.bind}:${config.port} — anyone who can reach this\n` +
      "address can spawn terminals on this machine. There is NO authentication.\n" +
      "Only do this on a network you control (firewall/VPN). To lock it back down,\n" +
      "drop --allow-lan / CLIDABLE_ALLOW_LAN and bind 127.0.0.1 (the default).\n",
  );
}

// M-D: periodically scan each PTY session's process tree for listening
// dev-server ports (catches servers that print no banner). Feeds the same
// detection pipeline as the output scanner.
startPortScanner();

// Make `server` reachable for tests / future graceful shutdown.
export default server;
