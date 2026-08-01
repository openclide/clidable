import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUILTIN_ROLES,
  bucketsForRole,
  coerceRoles,
  composeDelegatePrompt,
  mergeWithBuiltins,
  renderRoleSkill,
  roleInstalledBuckets,
  roleSkillState,
  syncRole,
  uninstallRole,
} from "./roles";
import { BUILTIN_RECIPES } from "./recipes";
import type { TeamRole } from "../../shared/types";

describe("built-in roles", () => {
  test("each role is well-formed and its handler is a wired delegate", () => {
    for (const r of BUILTIN_ROLES) {
      expect(r.id).toMatch(/^[a-z][a-z0-9-]*$/); // safe skill folder name
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.triggerHint.length).toBeGreaterThan(20); // a usable trigger
      expect(r.promptTemplate.length).toBeGreaterThan(20); // a real persona
      expect(r.handlerAgent in BUILTIN_RECIPES).toBe(true); // delegate must be wired
      expect(r.enabledForLeads.length).toBeGreaterThan(0);
      expect(r.isCustom).toBe(false); // built-ins aren't custom
    }
  });

  test("all seed roles are disabled by default (opt-in)", () => {
    expect(BUILTIN_ROLES.every((r) => r.enabled === false)).toBe(true);
  });
});

/**
 * The regression these guard: `promptTemplate` used to be interpolated into the
 * skill body and sent NOWHERE, so the delegate received the lead's bare task and
 * every role behaved identically. The persona reaching the specialist is the
 * whole point of a role — if these fail, roles are decoration again.
 */
describe("composeDelegatePrompt", () => {
  const role = BUILTIN_ROLES.find((r) => r.id === "architect")!;

  test("the delegate receives the role's persona AND the task", () => {
    const out = composeDelegatePrompt(role, "Design the billing schema.");
    expect(out).toContain(role.promptTemplate);
    expect(out).toContain("Design the billing schema.");
    // Persona first: the instructions have to land before the work they govern.
    expect(out.indexOf(role.promptTemplate)).toBeLessThan(out.indexOf("Design the billing"));
  });

  test("tells the delegate a peer sent this and the answer is relayed verbatim", () => {
    // Cross-agent identification (CLAUDE.md): the responder should know it's
    // answering another agent, not a human reading a chat window.
    const out = composeDelegatePrompt(role, "task");
    expect(out).toMatch(/another AI coding agent/i);
    expect(out).toMatch(/verbatim/i);
  });

  test("an empty persona degrades to the bare task, with no stray separator", () => {
    const custom: TeamRole = { ...role, promptTemplate: "   " };
    expect(composeDelegatePrompt(custom, "  just do it  ")).toBe("just do it");
  });

  test("every built-in role sends BOTH its persona and the task", () => {
    // Asserting only that the result is longer than the persona is worthless:
    // the framing paragraph alone satisfies it, so dropping the task entirely
    // would still pass. Assert both parts are actually present.
    for (const r of BUILTIN_ROLES) {
      const out = composeDelegatePrompt(r, "SENTINEL-TASK");
      expect(out).toContain(r.promptTemplate);
      expect(out).toContain("SENTINEL-TASK");
    }
  });
});

describe("renderRoleSkill", () => {
  const role = BUILTIN_ROLES.find((r) => r.id === "reviewer")!;
  const md = renderRoleSkill(role);

  test("frontmatter: name = id, description = triggerHint (quoted YAML scalars)", () => {
    expect(md).toContain(`name: "${role.id}"`);
    expect(md).toContain(`description: "${role.triggerHint}"`);
  });

  test("body delegates to the handler agent", () => {
    expect(md).toContain(`clidable team delegate ${role.handlerAgent} `);
  });

  test("the body does NOT carry the delegate's persona", () => {
    // promptTemplate is written for the specialist and is sent to it directly.
    // Rendering it here too would charge the LEAD's context (the body is a
    // recurring cost once loaded) for instructions addressed to someone else —
    // and reads as "you are a senior architect… now hand this to the architect".
    for (const r of BUILTIN_ROLES) {
      expect(renderRoleSkill(r)).not.toContain(r.promptTemplate);
    }
  });

  test("the body tells the lead what the teammate is for", () => {
    expect(md).toContain(role.description);
  });

  test("a leadHint is rendered for the lead; roles without one get no empty section", () => {
    const withHint = BUILTIN_ROLES.find((r) => r.leadHint)!;
    expect(renderRoleSkill(withHint)).toContain(withHint.leadHint!);
    expect(renderRoleSkill(withHint)).toContain("Writing the brief.");
    expect(md).not.toContain("Writing the brief."); // reviewer has no leadHint
  });

  test("every role's command passes --role with its OWN id", () => {
    // Without this flag the server can't look the role up, so the delegate runs
    // personaless — the exact bug this feature exists to close. A copy-paste
    // that hardcoded one id would pass a naive `toContain("--role")`.
    for (const r of BUILTIN_ROLES) {
      expect(renderRoleSkill(r)).toContain(
        `clidable team delegate ${r.handlerAgent} --role ${r.id}`,
      );
    }
  });

  test("write-capable roles keep --write alongside --role", () => {
    const writer = BUILTIN_ROLES.find((r) => r.needsWrite)!;
    expect(renderRoleSkill(writer)).toContain(
      `clidable team delegate ${writer.handlerAgent} --role ${writer.id} --write`,
    );
  });

  test("carries the managed marker (don't-clobber + reconciling removal)", () => {
    expect(md).toContain(`clidable:team-role:${role.id}`);
  });

  test("a trigger with a colon/quote/newline stays a single valid quoted scalar", () => {
    const evil: TeamRole = {
      id: "x",
      name: "X",
      description: "d",
      glyph: "reviewer",
      triggerHint: 'Use when: "review"\nsecond line',
      promptTemplate: "p",
      handlerAgent: "codex",
      enabledForLeads: ["claude"],
      enabled: true,
      isCustom: false,
    };
    const out = renderRoleSkill(evil);
    const fm = out.slice(0, out.indexOf("\n---", 3));
    expect(fm).toContain('description: "Use when: \\"review\\" second line"');
    // exactly one description line — the newline didn't break the frontmatter.
    expect(fm.split("\n").filter((l) => l.startsWith("description:")).length).toBe(1);
  });

  test("the marker carries a content fingerprint, and it tracks the content", () => {
    // Without this an old render is indistinguishable from a current one, so the
    // GUI reports "up to date" over a file holding outdated instructions.
    expect(md).toMatch(new RegExp(`clidable:team-role:${role.id}#[0-9a-f]{8} `));
    const fp = (s: string) => s.match(/#([0-9a-f]{8})/)![1];
    expect(fp(renderRoleSkill({ ...role, triggerHint: "Reviews things. Use when." }))).not.toBe(
      fp(md),
    );
    expect(fp(renderRoleSkill({ ...role }))).toBe(fp(md)); // stable for equal input
  });

  test("the placeholder never survives into the rendered file", () => {
    for (const r of BUILTIN_ROLES) expect(renderRoleSkill(r)).not.toContain("MARKER");
  });
});

/**
 * The frontmatter `description` is the ONLY text the lead sees before deciding
 * whether to load a skill, so these encode Anthropic's documented authoring
 * rules. They are mechanical proxies, not judgement — but they catch the exact
 * regressions the previous descriptions had.
 */
describe("role descriptions follow the documented triggering rules", () => {
  test("third person: states what the role DOES, never 'Use the X to…'", () => {
    for (const r of BUILTIN_ROLES) {
      // Second-person/imperative phrasing is a documented discovery problem —
      // the description is injected into the lead's system prompt, where "Use
      // the Reviewer to…" reads as an instruction rather than a capability.
      expect(r.triggerHint).not.toMatch(/^Use\b/i);
      expect(r.triggerHint).toMatch(/^[A-Z][a-z]+s\b/); // "Reviews…", "Designs…"
    }
  });

  test("every description states its triggers explicitly", () => {
    for (const r of BUILTIN_ROLES) expect(r.triggerHint).toContain("Use when");
  });

  test("every description contains its own role name", () => {
    // Users ask for roles BY NAME — "use the reviewer to check this". The name
    // is therefore one of the keywords the description has to carry, and
    // third-person capability phrasing ("Reviews code for…") drops it unless
    // it's put back deliberately. Rewriting these to third person once removed
    // the name from eight of nine, and "Security Auditor" lost the word
    // "security" altogether.
    for (const r of BUILTIN_ROLES) {
      expect(r.triggerHint.toLowerCase()).toContain(r.name.toLowerCase());
    }
  });

  test("descriptions carry the role's own subject noun", () => {
    // A guard against the same failure in a different shape: a description that
    // never says "security" or "performance" won't match a user who does.
    const mustMention: Record<string, string> = {
      security: "security",
      performance: "performance",
      documenter: "documentation",
      tester: "test",
      debugger: "bug",
      architect: "architect",
      reviewer: "review",
      "ui-designer": "accessibility",
      "image-creator": "image",
    };
    for (const r of BUILTIN_ROLES) {
      expect(r.triggerHint.toLowerCase()).toContain(mustMention[r.id]!);
    }
  });

  test("what it does comes before when to use it", () => {
    for (const r of BUILTIN_ROLES) {
      expect(r.triggerHint.indexOf("Use when")).toBeGreaterThan(20);
    }
  });

  test("each description fits the per-skill cap with room to spare", () => {
    // Hard spec limit is 1,024 chars; Claude Code truncates combined
    // description text at 1,536. Staying well under both is the point.
    for (const r of BUILTIN_ROLES) {
      expect(r.triggerHint.length).toBeLessThan(600);
      expect(r.triggerHint.length).toBeGreaterThan(80); // not a vague stub either
    }
  });

  test("all nine together fit the skill-listing budget", () => {
    // The whole listing is budgeted (~1% of context); on overflow Claude Code
    // silently DROPS the least-invoked skills' descriptions, stripping the
    // keywords they need to ever match. Nine roles must not get near that.
    const total = BUILTIN_ROLES.reduce((n, r) => n + r.triggerHint.length, 0);
    expect(total).toBeLessThan(4000);
  });

  test("no two roles open with the same capability phrase", () => {
    // Nine siblings compete for the same requests; identical openings are how a
    // lead picks the wrong teammate.
    const openers = BUILTIN_ROLES.map((r) => r.triggerHint.split(/[,.]/)[0]!.trim());
    expect(new Set(openers).size).toBe(BUILTIN_ROLES.length);
  });

});

/**
 * The upgrade path. A user who synced a role before a change to the rendered
 * skill has an outdated SKILL.md carrying the same marker as a current one — so
 * unless staleness is detectable the GUI greys out Apply and the fix reaches
 * nobody. This is how `--role` shipped to existing projects as a no-op.
 */
describe("roleSkillState (installed vs out of date)", () => {
  const role = BUILTIN_ROLES.find((r) => r.id === "reviewer")!;
  const enabled = { ...role, enabled: true };

  const write = async (dir: string, content: string): Promise<void> => {
    await mkdir(join(dir, ".claude/skills", role.id), { recursive: true });
    await writeFile(join(dir, ".claude/skills", role.id, "SKILL.md"), content, "utf8");
  };

  test("a freshly synced role is installed and NOT stale", async () => {
    const proj = await mkdtemp(join(tmpdir(), "role-state-"));
    await syncRole(proj, enabled);
    const s = await roleSkillState(proj, enabled);
    expect(s.installed).toContain("claude");
    expect(s.stale).toEqual([]);
  });

  test("a PRE-FINGERPRINT file is installed AND stale", async () => {
    const proj = await mkdtemp(join(tmpdir(), "role-state-"));
    // Exactly the old format: marker with no `#fingerprint`.
    await write(
      proj,
      `---\nname: "${role.id}"\ndescription: "old"\n---\n\n` +
        `<!-- clidable:team-role:${role.id} — managed by Clidable. -->\n\nold body\n`,
    );
    const s = await roleSkillState(proj, enabled);
    expect(s.installed).toContain("claude"); // still ours — don't clobber blindly
    expect(s.stale).toContain("claude"); // …but it must be rewritten
  });

  test("a file whose CONTENT drifted is stale even with a valid fingerprint", async () => {
    const proj = await mkdtemp(join(tmpdir(), "role-state-"));
    await syncRole(proj, enabled);
    // Same role id, different rendered text → different fingerprint.
    const s = await roleSkillState(proj, { ...enabled, triggerHint: "Reviews. Use when asked." });
    expect(s.stale).toContain("claude");
  });

  test("applying clears staleness", async () => {
    const proj = await mkdtemp(join(tmpdir(), "role-state-"));
    await write(proj, `<!-- clidable:team-role:${role.id} — old -->\n`);
    expect((await roleSkillState(proj, enabled)).stale).toContain("claude");
    await syncRole(proj, enabled);
    expect((await roleSkillState(proj, enabled)).stale).toEqual([]);
  });

  test("a hand-written skill at the same path is neither installed nor stale", async () => {
    const proj = await mkdtemp(join(tmpdir(), "role-state-"));
    await write(proj, "---\nname: reviewer\ndescription: mine\n---\n\nhand-written\n");
    const s = await roleSkillState(proj, enabled);
    expect(s.installed).toEqual([]);
    expect(s.stale).toEqual([]);
  });
});

describe("mergeWithBuiltins (living library + user choices)", () => {
  test("refreshes a built-in's curated text but keeps the user's choices", () => {
    const reviewer = BUILTIN_ROLES.find((r) => r.id === "reviewer")!;
    const stale: TeamRole = {
      ...reviewer,
      triggerHint: "OLD stale trigger",
      promptTemplate: "OLD persona",
      enabled: true, // user toggled it on
      enabledForLeads: ["antigravity"], // user changed leads
    };
    const merged = mergeWithBuiltins([stale]).find((r) => r.id === "reviewer")!;
    expect(merged.triggerHint).toBe(reviewer.triggerHint); // text from the library
    expect(merged.promptTemplate).toBe(reviewer.promptTemplate);
    expect(merged.enabled).toBe(true); // user choice preserved
    expect(merged.enabledForLeads).toEqual(["antigravity"]); // user choice preserved
  });

  test("built-ins always appear; custom roles pass through", () => {
    const custom: TeamRole = {
      id: "custom-x",
      name: "X",
      description: "",
      glyph: "reviewer",
      triggerHint: "t",
      promptTemplate: "p",
      handlerAgent: "codex",
      enabledForLeads: [],
      enabled: true,
      isCustom: true,
    };
    const merged = mergeWithBuiltins([custom]);
    expect(merged.length).toBe(BUILTIN_ROLES.length + 1);
    expect(merged.find((r) => r.id === "reviewer")).toBeDefined();
    expect(merged.find((r) => r.id === "custom-x")).toBeDefined();
  });
});

describe("coerceRoles (validation / trust boundary)", () => {
  const ok = {
    id: "ok",
    name: "Ok",
    description: "",
    glyph: "reviewer",
    triggerHint: "t",
    promptTemplate: "p",
    handlerAgent: "codex",
    enabledForLeads: ["claude"],
    enabled: true,
    isCustom: true,
  };

  test("drops path-traversal ids, unknown handlers, and duplicate ids", () => {
    const out = coerceRoles([
      ok,
      { ...ok, id: "../../evil" }, // path traversal → dropped
      { ...ok, id: "bad", handlerAgent: "aider" }, // not a wired delegate → dropped
      { ...ok, name: "Dup" }, // duplicate id "ok" → dropped
    ]);
    expect(out.map((r) => r.id)).toEqual(["ok"]);
  });

  test("non-array input → []", () => {
    expect(coerceRoles(null)).toEqual([]);
    expect(coerceRoles({})).toEqual([]);
  });

  test("defaults missing fields, filters bad leads, and expands to whole buckets", () => {
    const [r] = coerceRoles([
      { id: "r", handlerAgent: "codex", enabledForLeads: ["claude", 42, "codex"] },
    ]);
    expect(r!.name).toBe("r"); // falls back to id
    expect(r!.enabled).toBe(false); // missing → false
    // 42 dropped; claude → claude bucket; codex → the whole universal bucket.
    expect(new Set(r!.enabledForLeads)).toEqual(
      new Set(["claude", "codex", "cursor", "antigravity", "opencode", "copilot", "kimi"]),
    );
  });
});

describe("uninstallRole (delete → remove skill from disk)", () => {
  const role: TeamRole = {
    id: "custom-del",
    name: "Del",
    description: "d",
    glyph: "reviewer",
    triggerHint: "t",
    promptTemplate: "p",
    handlerAgent: "codex",
    enabledForLeads: ["claude", "codex"], // → claude + universal buckets
    enabled: true,
    isCustom: true,
  };

  test("install then uninstall leaves no managed skill on disk", async () => {
    const proj = await mkdtemp(join(tmpdir(), "clidable-team-"));
    await syncRole(proj, role);
    expect((await roleInstalledBuckets(proj, role.id)).sort()).toEqual(["claude", "universal"]);

    await uninstallRole(proj, role.id);
    expect(await roleInstalledBuckets(proj, role.id)).toEqual([]);
  });

  test("never deletes a same-named skill that isn't ours", async () => {
    const proj = await mkdtemp(join(tmpdir(), "clidable-team-"));
    const dir = join(proj, ".claude", "skills", role.id);
    await mkdir(dir, { recursive: true });
    const foreign = join(dir, "SKILL.md");
    await writeFile(foreign, "---\nname: custom-del\n---\nhand-written, not Clidable's\n");

    await uninstallRole(proj, role.id);
    expect(await readFile(foreign, "utf8")).toContain("hand-written");
  });
});

describe("bucketsForRole", () => {
  const make = (leads: TeamRole["enabledForLeads"]): TeamRole => ({
    id: "x",
    name: "X",
    description: "d",
    glyph: "reviewer",
    triggerHint: "t",
    promptTemplate: "p",
    handlerAgent: "codex",
    enabledForLeads: leads,
    enabled: true,
    isCustom: false,
  });

  test("maps enabled leads to their skill buckets", () => {
    expect(bucketsForRole(make(["claude", "codex"])).sort()).toEqual(["claude", "universal"]);
    expect(bucketsForRole(make(["kimi"]))).toEqual(["universal"]); // kimi rides universal
    expect(bucketsForRole(make(["qwen"]))).toEqual(["qwen"]);
    expect(bucketsForRole(make(["claude"]))).toEqual(["claude"]);
  });
});
