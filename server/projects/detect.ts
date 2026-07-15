/**
 * Best-effort framework + name detection for an opened project.
 *
 * Open-world by design (see PLAN_PREVIEW.md): we never *require* a match —
 * an unrecognized project is perfectly valid and just reports
 * `framework: "unknown"`. The hint feeds the preview dev-server UX and the
 * New-Project wizard; it is never load-bearing for correctness.
 *
 * Detection order matters: a Next app also depends on react, a SvelteKit app
 * also depends on vite — so check the most specific signal first.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ProjectFramework } from "../../shared/types";

export interface DetectedProject {
  name: string;
  framework: ProjectFramework;
}

export async function detectProject(
  projectPath: string,
): Promise<DetectedProject> {
  const dirName = basename(projectPath) || projectPath;

  // package.json — the JS/TS ecosystem (the common case).
  const pkg = await readJson(join(projectPath, "package.json"));
  if (pkg && typeof pkg === "object") {
    const deps: Record<string, string> = {
      ...(asRecord(pkg.dependencies)),
      ...(asRecord(pkg.devDependencies)),
    };
    const name =
      typeof pkg.name === "string" && pkg.name.length > 0 ? pkg.name : dirName;
    return { name, framework: frameworkFromDeps(deps) };
  }

  // Cargo.toml — Rust.
  const cargo = await readText(join(projectPath, "Cargo.toml"));
  if (cargo !== null) {
    return { name: tomlPackageName(cargo) ?? dirName, framework: "rust" };
  }

  // Python markers.
  for (const f of [
    "pyproject.toml",
    "requirements.txt",
    "manage.py",
    "setup.py",
  ]) {
    if (await exists(join(projectPath, f))) {
      return { name: dirName, framework: "python" };
    }
  }

  // Go.
  if (await exists(join(projectPath, "go.mod"))) {
    return { name: dirName, framework: "go" };
  }

  return { name: dirName, framework: "unknown" };
}

function frameworkFromDeps(deps: Record<string, string>): ProjectFramework {
  const has = (n: string) => Object.prototype.hasOwnProperty.call(deps, n);
  const hasPrefix = (p: string) => Object.keys(deps).some((d) => d.startsWith(p));

  if (has("next")) return "nextjs";
  if (hasPrefix("@remix-run/")) return "remix";
  if (has("expo")) return "expo";
  if (has("@sveltejs/kit")) return "sveltekit";
  if (has("nuxt") || has("nuxt3")) return "nuxt";
  if (has("astro")) return "astro";
  if (has("vite")) return "vite";
  if (has("hono")) return "hono";
  return "node";
}

/* --- tiny FS helpers (no deps; tolerate every failure as "not present") --- */

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson(path: string): Promise<any | null> {
  const text = await readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function asRecord(v: unknown): Record<string, string> {
  return v && typeof v === "object" ? (v as Record<string, string>) : {};
}

/** Pull `name = "..."` out of Cargo.toml's `[package]` table (cheap, no TOML dep). */
function tomlPackageName(toml: string): string | null {
  const pkgSection = toml.split(/^\s*\[/m); // crude split on table headers
  for (const chunk of pkgSection) {
    if (chunk.startsWith("package]")) {
      const m = chunk.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (m) return m[1] ?? null;
    }
  }
  return null;
}
