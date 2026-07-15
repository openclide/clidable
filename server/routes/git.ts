/**
 * Git routes for the diff view.
 *
 *   GET /api/git/status?root=<abs|cwd-rel>
 *   GET /api/git/diff?root=<abs|cwd-rel>&path=<project-rel>
 *
 * Both shell out via `Bun.spawn(["git", "-C", <repoTop>, ...])`. We
 * resolve the repo toplevel once per request — if `root` is nested
 * inside a larger repo (e.g. the `examples/acme-saas` mock projects
 * live inside Clidable's own repo), we scope all status / diff output
 * to the subtree at `root` by translating between repo-toplevel paths
 * (what git emits and `git show :path` requires) and project-root
 * paths (what the UI uses everywhere else).
 *
 * Path safety: `path` must resolve inside `root` after normalization.
 * No `..` escapes, no absolute paths on the wire.
 */
import { realpath } from "node:fs/promises";
import { join, normalize, relative, resolve, sep } from "node:path";
import { runGit } from "../git-exec";
import { readProjectUuid } from "../checkpoints/project";
import { shadowGitDir } from "../checkpoints/paths";
import { git as shadowGit } from "../checkpoints/shadow";

const MAX_DIFF_BYTES = 1024 * 1024; // 1 MiB — beyond this we fall back to patch view.

export interface GitStatusEntry {
  /** Path relative to the project root passed in `root=`. */
  path: string;
  /** First column of `git status --porcelain=v1`. Space when clean. */
  indexStatus: string;
  /** Second column of `git status --porcelain=v1`. Space when clean. */
  workingStatus: string;
  /** For renames/copies, the path before the rename. Project-relative. */
  origPath: string | null;
}

export interface GitStatusResponse {
  isRepo: boolean;
  toplevel: string | null;
  branch: string | null;
  entries: GitStatusEntry[];
}

export interface GitDiffResponse {
  /** File content at HEAD; empty for additions / untracked. */
  originalContent: string;
  /** File content in the working tree; empty for deletions. */
  modifiedContent: string;
  /** True when either side trips the null-byte probe. */
  isBinary: boolean;
  /** Unified patch text — used as the fallback render for binary/oversize files. */
  fallbackPatch: string;
}

export interface GitErrorResponse {
  ok: false;
  error: string;
}

function err(status: number, msg: string): Response {
  return Response.json({ ok: false, error: msg } satisfies GitErrorResponse, {
    status,
  });
}

/** Run a git command scoped to `cwd` via `-C`. */
function git(cwd: string, args: string[]) {
  return runGit(["-C", cwd, ...args]);
}

/** Resolve `root` to an absolute path, fail with a `Response` if it can't. */
async function resolveRoot(
  rootRaw: string | null,
): Promise<{ rootAbs: string } | Response> {
  if (!rootRaw) return err(400, "missing 'root' query param");
  try {
    const rootAbs = await realpath(resolve(rootRaw));
    return { rootAbs };
  } catch {
    return err(404, "project root not found");
  }
}

interface RepoInfo {
  toplevel: string;
  /** project root path relative to repo toplevel (e.g. "examples/acme-saas"). May be empty when project IS the toplevel. */
  prefix: string;
  branch: string | null;
}

/**
 * Discover the repo toplevel for a project root and compute the
 * project's path relative to that toplevel — used everywhere we need
 * to translate between repo-relative paths (what git emits) and
 * project-relative paths (what the UI uses).
 */
async function discoverRepo(rootAbs: string): Promise<RepoInfo | null> {
  const top = await git(rootAbs, ["rev-parse", "--show-toplevel"]);
  if (top.exitCode !== 0) return null;
  const toplevel = top.stdout.trim();
  if (!toplevel) return null;

  // `git rev-parse --abbrev-ref HEAD` returns "HEAD" when detached.
  const branchRes = await git(rootAbs, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch =
    branchRes.exitCode === 0
      ? branchRes.stdout.trim() === "HEAD"
        ? null
        : branchRes.stdout.trim()
      : null;

  const rel = relative(toplevel, rootAbs);
  const prefix = rel === "" ? "" : rel.split(sep).join("/");
  return { toplevel, prefix, branch };
}

/** Strip the project prefix off a repo-relative git path. Returns null if it falls outside the project. */
function stripPrefix(repoPath: string, prefix: string): string | null {
  if (!prefix) return repoPath;
  const withSep = prefix.endsWith("/") ? prefix : prefix + "/";
  if (repoPath === prefix) return "";
  if (repoPath.startsWith(withSep)) return repoPath.slice(withSep.length);
  return null;
}

/** Validate that `projectRel` stays inside `rootAbs`. */
function safeProjectPath(rootAbs: string, projectRel: string): string | null {
  const normRel = normalize(projectRel === "" ? "." : projectRel);
  if (normRel.startsWith("..") || normRel.startsWith(sep)) return null;
  const abs = resolve(rootAbs, normRel);
  // We don't realpath here — the file may have been deleted in the
  // working tree but still exist at HEAD. Lexical containment is the
  // right check.
  const rootWithSep = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;
  if (abs !== rootAbs && !abs.startsWith(rootWithSep)) return null;
  return normRel;
}

/* ---------------------------------------------------------------------------
 * Porcelain v1 parser
 *
 * Format: two-character XY status, one space, path. Renames/copies have
 * an extra `from -> to` token. We don't handle the -z null-delimited
 * variant yet — paths with literal newlines or quotes will need it, but
 * v1 default mode is fine for the M3 path-list use case.
 * ------------------------------------------------------------------------- */
function parsePorcelainV1(stdout: string, prefix: string): GitStatusEntry[] {
  const out: GitStatusEntry[] = [];
  const lines = stdout.split("\n");
  for (const raw of lines) {
    if (raw.length < 4) continue;
    const indexStatus = raw[0] ?? " ";
    const workingStatus = raw[1] ?? " ";
    const rest = raw.slice(3);

    // Rename: "old -> new"
    let path = rest;
    let origPath: string | null = null;
    if (indexStatus === "R" || indexStatus === "C") {
      const arrow = rest.indexOf(" -> ");
      if (arrow !== -1) {
        origPath = rest.slice(0, arrow);
        path = rest.slice(arrow + 4);
      }
    }

    const scopedPath = stripPrefix(path, prefix);
    if (scopedPath === null) continue;
    const scopedOrig =
      origPath !== null ? stripPrefix(origPath, prefix) : null;

    out.push({
      path: scopedPath,
      indexStatus,
      workingStatus,
      origPath: scopedOrig,
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Shadow-repo status (diff against a checkpoint SHA)
 *
 * Same response shape as the real-git status, but the comparison base
 * is a checkpoint commit in the per-project shadow repo rather than the
 * project's own HEAD. The shadow's work-tree IS the project, so every
 * path git emits is already project-relative — no prefix translation.
 *
 * Two git reads build the entry list:
 *   1. `diff --name-status <sha>` — tracked files whose working-tree
 *      content differs from the checkpoint (M / D / A-if-staged / R).
 *   2. `ls-files --others --exclude-standard` — files untracked in the
 *      shadow index (created since the last checkpoint), surfaced as
 *      additions. `--exclude-standard` honors .gitignore + the shadow's
 *      info/exclude always-ignore list.
 *
 * The diff status letter goes in `indexStatus` to match how the UI's
 * badge logic reads added/modified/deleted (it checks the index
 * column first).
 * ------------------------------------------------------------------------- */
async function shadowStatusEntries(
  shadowDir: string,
  projectAbs: string,
  sha: string,
): Promise<GitStatusEntry[]> {
  const [nameStatus, others] = await Promise.all([
    shadowGit(shadowDir, projectAbs, [
      "diff",
      "--name-status",
      "--find-renames",
      sha,
    ]),
    shadowGit(shadowDir, projectAbs, [
      "ls-files",
      "--others",
      "--exclude-standard",
    ]),
  ]);
  if (nameStatus.exitCode !== 0) {
    throw new Error(`shadow diff failed: ${nameStatus.stderr.trim()}`);
  }

  const out: GitStatusEntry[] = [];
  const seen = new Set<string>();

  for (const raw of nameStatus.stdout.split("\n")) {
    if (!raw) continue;
    const fields = raw.split("\t");
    const code = fields[0] ?? "";
    const letter = code[0] ?? "";
    if (letter === "R" || letter === "C") {
      // R<score>\t<old>\t<new>
      const origPath = fields[1] ?? "";
      const path = fields[2] ?? "";
      if (!path) continue;
      seen.add(path);
      out.push({
        path,
        indexStatus: "R",
        workingStatus: " ",
        origPath: origPath || null,
      });
    } else {
      const path = fields[1] ?? "";
      if (!path) continue;
      seen.add(path);
      out.push({
        path,
        indexStatus: letter,
        workingStatus: " ",
        origPath: null,
      });
    }
  }

  // ls-files --others lists one path per line. These are new files not
  // yet captured by any checkpoint; mark them untracked.
  if (others.exitCode === 0) {
    for (const raw of others.stdout.split("\n")) {
      if (!raw || seen.has(raw)) continue;
      out.push({
        path: raw,
        indexStatus: "?",
        workingStatus: "?",
        origPath: null,
      });
    }
  }

  return out;
}

/**
 * Resolve a project's shadow repo dir. Returns a Response error when
 * the project has no checkpoints yet (no UUID file → no shadow).
 */
async function resolveShadow(
  projectAbs: string,
): Promise<{ shadowDir: string } | Response> {
  const uuid = await readProjectUuid(projectAbs);
  if (!uuid) {
    return err(400, "project has no checkpoints yet");
  }
  return { shadowDir: shadowGitDir(uuid) };
}

export async function gitStatusHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const resolved = await resolveRoot(url.searchParams.get("root"));
  if (resolved instanceof Response) return resolved;

  // Checkpoint comparison base: status against a shadow-repo SHA.
  const checkpointSha = url.searchParams.get("checkpointSha");
  if (checkpointSha) {
    const shadow = await resolveShadow(resolved.rootAbs);
    if (shadow instanceof Response) return shadow;
    try {
      const entries = await shadowStatusEntries(
        shadow.shadowDir,
        resolved.rootAbs,
        checkpointSha,
      );
      const body: GitStatusResponse = {
        isRepo: true,
        toplevel: resolved.rootAbs,
        branch: null,
        entries,
      };
      return Response.json(body);
    } catch (e) {
      return err(500, (e as Error).message);
    }
  }

  const repo = await discoverRepo(resolved.rootAbs);
  if (!repo) {
    const body: GitStatusResponse = {
      isRepo: false,
      toplevel: null,
      branch: null,
      entries: [],
    };
    return Response.json(body);
  }

  // Run from the project root, then filter porcelain output to entries
  // inside the project. (`git -C` lets us run at the toplevel, but
  // porcelain output's paths are always toplevel-relative regardless of
  // cwd, so this saves us nothing — we filter either way.)
  const status = await git(resolved.rootAbs, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status.exitCode !== 0) {
    return err(500, `git status failed: ${status.stderr.trim()}`);
  }

  const entries = parsePorcelainV1(status.stdout, repo.prefix);
  const body: GitStatusResponse = {
    isRepo: true,
    toplevel: repo.toplevel,
    branch: repo.branch,
    entries,
  };
  return Response.json(body);
}

/* ---------------------------------------------------------------------------
 * Diff
 *
 * For each requested path we produce three things the merge view + the
 * fallback patch view need:
 *   • originalContent — `git show HEAD:<repoPath>`, "" if added/untracked
 *   • modifiedContent — Bun.file(working tree path), "" if deleted
 *   • fallbackPatch   — `git diff HEAD -- <projectRel>` (or `--no-index`
 *                       for untracked) for the binary/oversize render
 *
 * Binary detection scans the first 8 KB of each side for null bytes.
 * ------------------------------------------------------------------------- */
const BINARY_PROBE_BYTES = 8 * 1024;

function isBinaryProbe(s: string): boolean {
  const n = Math.min(s.length, BINARY_PROBE_BYTES);
  for (let i = 0; i < n; i++) {
    if (s.charCodeAt(i) === 0) return true;
  }
  return false;
}

async function readHeadContent(
  rootAbs: string,
  repoPath: string,
): Promise<string> {
  const res = await git(rootAbs, ["show", `HEAD:${repoPath}`]);
  if (res.exitCode !== 0) return ""; // file not in HEAD (added/untracked)
  return res.stdout;
}

async function readWorkingContent(absPath: string): Promise<string> {
  const f = Bun.file(absPath);
  if (!(await f.exists())) return ""; // deleted
  if (f.size > MAX_DIFF_BYTES) return ""; // caller falls back to patch
  return await f.text();
}

/**
 * Diff a single file's working-tree content against its content at a
 * shadow-repo checkpoint. Shadow paths are project-relative (work-tree
 * is the project), so `projectRel` is used directly — no prefix.
 */
async function shadowDiffContent(
  shadowDir: string,
  projectAbs: string,
  projectRel: string,
  sha: string,
): Promise<GitDiffResponse> {
  const absPath = join(projectAbs, projectRel);
  const [original, modifiedContent, patchRes] = await Promise.all([
    shadowGit(shadowDir, projectAbs, ["show", `${sha}:${projectRel}`]),
    readWorkingContent(absPath),
    shadowGit(shadowDir, projectAbs, ["diff", sha, "--", projectRel]),
  ]);
  // `git show` fails when the file didn't exist at the checkpoint
  // (added since) — that's a normal "" original.
  const originalContent = original.exitCode === 0 ? original.stdout : "";

  const isBinary =
    isBinaryProbe(originalContent) || isBinaryProbe(modifiedContent);

  let fallbackPatch = patchRes.exitCode === 0 ? patchRes.stdout : "";
  if (!fallbackPatch && !originalContent && modifiedContent) {
    const untracked = await shadowGit(shadowDir, projectAbs, [
      "diff",
      "--no-index",
      "--",
      "/dev/null",
      projectRel,
    ]);
    fallbackPatch = untracked.stdout;
  }

  return { originalContent, modifiedContent, isBinary, fallbackPatch };
}

export async function gitDiffHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const resolved = await resolveRoot(url.searchParams.get("root"));
  if (resolved instanceof Response) return resolved;

  const rawPath = url.searchParams.get("path");
  if (!rawPath) return err(400, "missing 'path' query param");
  const projectRel = safeProjectPath(resolved.rootAbs, rawPath);
  if (projectRel === null) return err(403, "path escapes project root");

  // Checkpoint comparison base: diff against a shadow-repo SHA.
  const checkpointSha = url.searchParams.get("checkpointSha");
  if (checkpointSha) {
    const shadow = await resolveShadow(resolved.rootAbs);
    if (shadow instanceof Response) return shadow;
    try {
      const body = await shadowDiffContent(
        shadow.shadowDir,
        resolved.rootAbs,
        projectRel,
        checkpointSha,
      );
      return Response.json(body);
    } catch (e) {
      return err(500, (e as Error).message);
    }
  }

  const repo = await discoverRepo(resolved.rootAbs);
  if (!repo) return err(400, "project root is not inside a git repo");

  const repoPath = repo.prefix
    ? `${repo.prefix}/${projectRel}`.replace(/\\/g, "/")
    : projectRel.replace(/\\/g, "/");
  const absPath = join(resolved.rootAbs, projectRel);

  const [originalContent, modifiedContent, patchRes] = await Promise.all([
    readHeadContent(resolved.rootAbs, repoPath),
    readWorkingContent(absPath),
    git(resolved.rootAbs, ["diff", "HEAD", "--", projectRel]),
  ]);

  const isBinary =
    isBinaryProbe(originalContent) || isBinaryProbe(modifiedContent);

  // For untracked files `git diff HEAD` returns nothing. Use --no-index
  // against /dev/null as the patch fallback so the binary/oversize view
  // still shows something useful.
  let fallbackPatch = patchRes.stdout;
  if (!fallbackPatch && !originalContent && modifiedContent) {
    const untracked = await git(resolved.rootAbs, [
      "diff",
      "--no-index",
      "--",
      "/dev/null",
      projectRel,
    ]);
    // `diff --no-index` exits 1 when files differ — that's expected.
    fallbackPatch = untracked.stdout;
  }

  const body: GitDiffResponse = {
    originalContent,
    modifiedContent,
    isBinary,
    fallbackPatch,
  };
  return Response.json(body);
}
