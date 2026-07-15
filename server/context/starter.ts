/**
 * Auto-init starter (PLAN.md §4 — Instructions, slice 3). Builds a sensible
 * skeleton AGENTS.md from whatever the project actually is: real package.json
 * scripts + the detected package manager for Node projects, or a per-language
 * skeleton (Rust / Go / Python) otherwise. The user reviews it in the editor
 * and saves through the normal slice-2 path — nothing is written here.
 */
import { basename, join } from "node:path";
import { readJson, pathExists } from "../util/fs";

type Pm = "bun" | "pnpm" | "yarn" | "npm";

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function buildStarter(projectPath: string): Promise<string> {
  const dirName = basename(projectPath) || "project";

  const pkg = await readJson<PackageJson>(join(projectPath, "package.json"));
  if (pkg) return nodeStarter(projectPath, pkg.name || dirName, pkg);
  if (await pathExists(join(projectPath, "Cargo.toml"))) return rustStarter(dirName);
  if (await pathExists(join(projectPath, "go.mod"))) return goStarter(dirName);
  if (
    (await pathExists(join(projectPath, "pyproject.toml"))) ||
    (await pathExists(join(projectPath, "requirements.txt"))) ||
    (await pathExists(join(projectPath, "setup.py")))
  ) {
    return pythonStarter(projectPath, dirName);
  }
  return genericStarter(dirName);
}

/* -------------------------------------------------------------------------- */

async function detectPm(projectPath: string): Promise<Pm> {
  if (
    (await pathExists(join(projectPath, "bun.lock"))) ||
    (await pathExists(join(projectPath, "bun.lockb")))
  ) {
    return "bun";
  }
  if (await pathExists(join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (await pathExists(join(projectPath, "yarn.lock"))) return "yarn";
  return "npm";
}

function nodeStack(deps: Record<string, string>): string {
  const has = (n: string) => n in deps;
  if (has("next")) return "Next.js (App Router) + React + TypeScript.";
  if (has("astro")) return "Astro.";
  if (has("@remix-run/react") || has("@remix-run/node")) return "Remix.";
  if (has("vite") && has("react")) return "Vite + React + TypeScript.";
  if (has("vite") && has("vue")) return "Vite + Vue + TypeScript.";
  if (has("vite") && (has("svelte") || has("@sveltejs/kit")))
    return "Vite + Svelte + TypeScript.";
  if (has("hono")) return "Hono.";
  if (has("express")) return "Express.";
  if (has("fastify")) return "Fastify.";
  if (has("react")) return "React + TypeScript.";
  return "Node.js + TypeScript.";
}

async function nodeStarter(
  projectPath: string,
  name: string,
  pkg: PackageJson,
): Promise<string> {
  const pm = await detectPm(projectPath);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts ?? {};
  // Surface the real scripts the project defines, in a useful order.
  const order: [string, string][] = [
    ["dev", "Dev"],
    ["start", "Start"],
    ["build", "Build"],
    ["test", "Test"],
    ["lint", "Lint"],
    ["typecheck", "Typecheck"],
  ];
  const lines = [`- Install: ${pm} install`];
  for (const [script, label] of order) {
    if (scripts[script]) lines.push(`- ${label}: ${pm} run ${script}`);
  }
  return template(name, nodeStack(deps), lines);
}

function rustStarter(name: string): string {
  return template(name, "Rust project.", [
    "- Build: cargo build",
    "- Run: cargo run",
    "- Test: cargo test",
    "- Lint: cargo clippy",
  ]);
}

function goStarter(name: string): string {
  return template(name, "Go project.", [
    "- Build: go build ./...",
    "- Run: go run .",
    "- Test: go test ./...",
    "- Vet: go vet ./...",
  ]);
}

async function pythonStarter(projectPath: string, name: string): Promise<string> {
  let install = "pip install -r requirements.txt";
  if (await pathExists(join(projectPath, "uv.lock"))) install = "uv sync";
  else if (await pathExists(join(projectPath, "poetry.lock"))) install = "poetry install";
  return template(name, "Python project.", [
    `- Install: ${install}`,
    "- Test: pytest",
  ]);
}

function genericStarter(name: string): string {
  return template(name, "Describe the stack in one line.", [
    "- Install: …",
    "- Build: …",
    "- Test: …",
  ]);
}

/** Shared skeleton so every stack lands the same shape. */
function template(name: string, stack: string, commandLines: string[]): string {
  return `# ${name}

${stack}

## Commands

${commandLines.join("\n")}

## Conventions

- Match the existing code style and project structure.
- Run the test/lint commands above before considering a change done.
- (Add project-specific rules agents should follow here.)
`;
}
