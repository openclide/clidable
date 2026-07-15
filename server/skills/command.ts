/**
 * `clidable skills …` — the terminal surface for Agent Skills (PLAN.md §4,
 * slice 4). Calls the SAME internal functions the GUI's /api/skills routes use,
 * so the CLI and GUI stay one implementation. Dispatched from server/index.ts
 * before the server boots.
 */
import { listInstalledSkills } from "./installed";
import { searchSkills } from "./search";
import { addSkill, removeSkill } from "./manager";
import type { SkillBucket, SkillScope } from "../../shared/types";

const HELP = `clidable skills — manage Agent Skills (skills.sh)

  list [-g]                                     installed skills (current project)
  search <query>                                search the skills.sh registry
  add <owner/repo> --skill <id> [-g] [-a <b>]   install a skill
  remove <name> [-g] [-a <b>]                   remove a skill (one bucket, or all)

  -g, --global      operate on global (~) scope instead of the project
  -a <bucket>       target bucket: claude | universal | qwen | aider
                    (repeatable on add; add defaults to claude + universal + qwen)
  --skill <id>      skill id within the repo (add)

Runs against the current working directory's project.`;

const BUCKETS = new Set<SkillBucket>(["claude", "universal", "aider", "qwen"]);
const isBucket = (b: string): b is SkillBucket => BUCKETS.has(b as SkillBucket);

const VALUE_FLAGS = new Set(["-a", "--skill", "-s"]);
const BOOL_FLAGS = new Set(["-g", "--global", "-p", "--project"]);

interface Parsed {
  positionals: string[];
  opts: Record<string, string[]>;
  bools: Set<string>;
}

function parse(args: string[]): Parsed {
  const positionals: string[] = [];
  const opts: Record<string, string[]> = {};
  const bools = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (VALUE_FLAGS.has(a)) {
      const v = args[++i];
      if (v !== undefined) (opts[a] ??= []).push(v);
    } else if (a.startsWith("-")) {
      bools.add(a);
    } else {
      positionals.push(a);
    }
  }
  return { positionals, opts, bools };
}

/** Run a `clidable skills …` subcommand. Returns the process exit code. */
export async function runSkillsCommand(args: string[]): Promise<number> {
  const sub = args[0];
  const p = parse(args.slice(1));
  const scope: SkillScope =
    p.bools.has("-g") || p.bools.has("--global") ? "global" : "project";
  const cwd = process.cwd();
  const buckets = (p.opts["-a"] ?? []).filter(isBucket);

  try {
    switch (sub) {
      case "list":
      case "ls": {
        const skills = await listInstalledSkills(cwd, scope);
        if (!skills.length) {
          console.log(`No skills installed (${scope}).`);
          return 0;
        }
        for (const s of skills) {
          const src = s.source ? `  — ${s.source}` : "";
          console.log(`${s.name}  [${s.buckets.join(", ")}]${src}`);
        }
        return 0;
      }
      case "search":
      case "find": {
        const query = p.positionals.join(" ").trim();
        if (query.length < 2) {
          console.error("usage: clidable skills search <query> (≥2 chars)");
          return 1;
        }
        const { skills, searchType } = await searchSkills(query);
        if (!skills.length) {
          console.log("No matches.");
          return 0;
        }
        console.log(`${skills.length} result(s) (${searchType ?? "fuzzy"}):`);
        for (const s of skills) {
          console.log(`  ${s.skillId}  — ${s.source}  (${s.installs} installs)`);
        }
        return 0;
      }
      case "add": {
        const source = p.positionals[0];
        const skillId = p.opts["--skill"]?.[0] ?? p.opts["-s"]?.[0];
        if (!source) return usage("add <owner/repo> --skill <id>");
        if (!skillId) return usage("add <owner/repo> --skill <id>");
        await addSkill({
          projectPath: cwd,
          source,
          skillId,
          scope,
          buckets: buckets.length ? buckets : ["claude", "universal", "qwen"],
        });
        console.log(`Installed ${skillId} (${scope}).`);
        return 0;
      }
      case "remove":
      case "rm": {
        const name = p.positionals[0];
        if (!name) return usage("remove <name> [-a <bucket>]");
        await removeSkill(cwd, name, scope, buckets[0]);
        const where = buckets[0] ? `${buckets[0]} (${scope})` : scope;
        console.log(`Removed ${name} from ${where}.`);
        return 0;
      }
      default:
        console.log(HELP);
        return sub ? 1 : 0; // unknown subcommand → error; bare `skills` → help/0
    }
  } catch (e) {
    console.error(`error: ${(e as Error)?.message ?? String(e)}`);
    return 1;
  }
}

function usage(line: string): number {
  console.error(`usage: clidable skills ${line}`);
  return 1;
}
