/**
 * `clidable mcp …` — the terminal surface for MCP servers (PLAN.md §4, slice
 * 4). Calls the SAME manager functions the GUI's /api/mcp routes use. Dispatched
 * from server/index.ts before the server boots. No re-exec needed — add-mcp is
 * an in-process library.
 */
import { addMcpServer, listMcpServers, removeMcpServer } from "./manager";
import { MCP_AGENT_TYPE } from "../../shared/types";
import type { McpScope, McpServerSpec, TerminalAgentId } from "../../shared/types";

const HELP = `clidable mcp — manage MCP servers (add-mcp)

  list [-g]
  add <name> --npx <pkg> [--env K=V]… [-a <agent>]… [-g]
  add <name> --command <cmd> [--arg <a>]… [--env K=V]… [-a <agent>]… [-g]
  add <name> --url <url> [--sse] [--header K=V]… [-a <agent>]… [-g]
  remove <name> [-a <agent>]… [-g]

  -g, --global   global scope (~) instead of the project
  -a <agent>     claude | codex | cursor | opencode | copilot
                 (repeatable; add defaults to claude)

Runs against the current working directory's project.`;

const SUPPORTED = new Set(Object.keys(MCP_AGENT_TYPE));
const isAgent = (a: string): a is TerminalAgentId => SUPPORTED.has(a);

const VALUE_FLAGS = new Set([
  "--command", "--arg", "--env", "--url", "--header", "--npx", "-a", "--agent",
]);

interface Parsed {
  positionals: string[];
  opt: (name: string) => string[];
  bool: (name: string) => boolean;
}

function parse(args: string[]): Parsed {
  const positionals: string[] = [];
  const opts = new Map<string, string[]>();
  const bools = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (VALUE_FLAGS.has(a)) {
      const v = args[++i];
      if (v !== undefined) opts.set(a, [...(opts.get(a) ?? []), v]);
    } else if (a.startsWith("-")) {
      bools.add(a);
    } else {
      positionals.push(a);
    }
  }
  return {
    positionals,
    opt: (n) => opts.get(n) ?? [],
    bool: (n) => bools.has(n),
  };
}

function kv(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i)] = p.slice(i + 1);
  }
  return out;
}

function buildSpec(p: Parsed): McpServerSpec | null {
  const url = p.opt("--url")[0];
  if (url) {
    return { transport: p.bool("--sse") ? "sse" : "http", url, headers: kv(p.opt("--header")) };
  }
  const env = kv(p.opt("--env"));
  const npx = p.opt("--npx")[0];
  if (npx) return { transport: "stdio", command: "npx", args: ["-y", npx], env };
  const command = p.opt("--command")[0];
  if (command) return { transport: "stdio", command, args: p.opt("--arg"), env };
  return null;
}

export async function runMcpCommand(args: string[]): Promise<number> {
  const sub = args[0];
  const p = parse(args.slice(1));
  const scope: McpScope = p.bool("-g") || p.bool("--global") ? "global" : "project";
  const cwd = process.cwd();
  const agents = [...p.opt("-a"), ...p.opt("--agent")].filter(isAgent);

  try {
    switch (sub) {
      case "list":
      case "ls": {
        const servers = await listMcpServers(cwd, scope);
        if (!servers.length) {
          console.log(`No MCP servers configured (${scope}).`);
          return 0;
        }
        for (const s of servers) {
          const where =
            s.transport === "stdio"
              ? `${s.command ?? ""} ${s.args.join(" ")}`.trim()
              : s.url ?? "";
          console.log(`${s.name}  [${s.agents.join(", ")}]  (${s.transport}) ${where}`);
        }
        return 0;
      }
      case "add": {
        const name = p.positionals[0];
        if (!name) return usage("add <name> (--npx <pkg> | --command <cmd> | --url <url>)");
        const spec = buildSpec(p);
        if (!spec) return usage("add needs --npx, --command, or --url");
        const targets = agents.length ? agents : (["claude"] as TerminalAgentId[]);
        await addMcpServer({ projectPath: cwd, scope, name, agents: targets, spec });
        console.log(`Added ${name} (${scope}) for ${targets.join(", ")}.`);
        return 0;
      }
      case "remove":
      case "rm": {
        const name = p.positionals[0];
        if (!name) return usage("remove <name> [-a <agent>]");
        await removeMcpServer({
          projectPath: cwd,
          scope,
          name,
          agents: agents.length ? agents : undefined,
        });
        const where = agents.length ? agents.join(", ") : "all agents";
        console.log(`Removed ${name} from ${where} (${scope}).`);
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
  console.error(`usage: clidable mcp ${line}`);
  return 1;
}
