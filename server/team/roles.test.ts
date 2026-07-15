import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUILTIN_ROLES,
  bucketsForRole,
  coerceRoles,
  mergeWithBuiltins,
  renderRoleSkill,
  roleInstalledBuckets,
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

describe("renderRoleSkill", () => {
  const role = BUILTIN_ROLES.find((r) => r.id === "reviewer")!;
  const md = renderRoleSkill(role);

  test("frontmatter: name = id, description = triggerHint (quoted YAML scalars)", () => {
    expect(md).toContain(`name: "${role.id}"`);
    expect(md).toContain(`description: "${role.triggerHint}"`);
  });

  test("every built-in trigger names its role (so the lead matches it)", () => {
    for (const r of BUILTIN_ROLES) expect(r.triggerHint).toContain(r.name);
  });

  test("body carries the persona and delegates to the handler agent", () => {
    expect(md).toContain(role.promptTemplate);
    expect(md).toContain(`clidable team delegate ${role.handlerAgent} `);
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
