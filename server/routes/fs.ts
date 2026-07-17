/**
 * Filesystem routes scoped to a project root.
 *
 *   GET  /api/fs/list?root=<abs>&path=<rel>     directory entries
 *   GET  /api/fs/read?root=<abs>&path=<rel>     file contents (text + size)
 *   PUT  /api/fs/write?root=<abs>&path=<rel>    body = raw text to write
 *
 * Path safety: the resolved absolute path must stay within realpath(root).
 * Symlinks that escape are rejected. No mkdir; write requires the parent
 * directory to exist (we don't create folders behind the user's back).
 *
 * Size caps: read returns {kind:"binary"} for files with a null byte in
 * the first 8 KB, {kind:"toolarge"} for >1 MiB. Both keep the editor
 * from trying to syntax-highlight a 500 MiB log.
 */
import { realpath, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import type { FsBrowseEntry, FsBrowseResponse } from "../../shared/types";

const MAX_READ_BYTES = 1024 * 1024; // 1 MiB
const BINARY_PROBE_BYTES = 8 * 1024;

// Default exclusions for `list` — git/build/dependency dirs that bloat the
// tree and never need editing. Users can still navigate into them via path
// hint if we expose that later.
const HIDDEN_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  ".turbo",
  ".cache",
  ".DS_Store",
]);

interface FsListEntry {
  name: string;
  kind: "file" | "dir" | "symlink" | "other";
  /** Bytes for files; null for dirs/symlinks. */
  size: number | null;
}

export interface FsListResponse {
  path: string;
  entries: FsListEntry[];
}

export type FsReadResponse =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export interface FsErrorResponse {
  ok: false;
  error: string;
}

/**
 * Resolve `root` + relative `path` into an absolute path, verifying it
 * stays inside the project root after realpath resolution.
 *
 * Returns the resolved absolute path on success, or a Response with the
 * appropriate error status on failure.
 */
async function resolveInsideRoot(
  rootRaw: string | null,
  rel: string | null,
): Promise<{ ok: true; abs: string; rootAbs: string } | Response> {
  if (!rootRaw) return badRequest("missing 'root' query param");
  if (rel === null) return badRequest("missing 'path' query param");

  // Normalize the relative input. Absolute paths are rejected — root is
  // the only place that takes an absolute path on the wire.
  const normRel = normalize(rel === "" ? "." : rel);
  if (normRel.startsWith("..") || normRel.startsWith(sep)) {
    return forbidden("path escapes project root");
  }

  let rootAbs: string;
  try {
    rootAbs = await realpath(resolve(rootRaw));
  } catch {
    return notFound("project root not found");
  }

  const absCandidate = resolve(rootAbs, normRel);
  let abs: string;
  try {
    abs = await realpath(absCandidate);
  } catch {
    // Target doesn't exist yet (e.g. saving a brand-new file). Use the
    // candidate as-is and verify its parent stays inside root.
    abs = absCandidate;
    let parent: string;
    try {
      parent = await realpath(dirname(absCandidate));
    } catch {
      return notFound("parent directory not found");
    }
    if (!isInside(parent, rootAbs)) {
      return forbidden("path escapes project root");
    }
    return { ok: true, abs, rootAbs };
  }

  if (!isInside(abs, rootAbs)) {
    return forbidden("path escapes project root");
  }
  return { ok: true, abs, rootAbs };
}

function isInside(abs: string, root: string): boolean {
  if (abs === root) return true;
  // Append separator so /foo/barx doesn't match /foo/bar.
  return abs.startsWith(root.endsWith(sep) ? root : root + sep);
}

function badRequest(msg: string): Response {
  return Response.json({ ok: false, error: msg } satisfies FsErrorResponse, {
    status: 400,
  });
}
function forbidden(msg: string): Response {
  return Response.json({ ok: false, error: msg } satisfies FsErrorResponse, {
    status: 403,
  });
}
function notFound(msg: string): Response {
  return Response.json({ ok: false, error: msg } satisfies FsErrorResponse, {
    status: 404,
  });
}
function serverError(msg: string): Response {
  return Response.json({ ok: false, error: msg } satisfies FsErrorResponse, {
    status: 500,
  });
}

export async function fsListHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const showHidden = url.searchParams.get("hidden") === "1";
  const resolved = await resolveInsideRoot(
    url.searchParams.get("root"),
    url.searchParams.get("path") ?? "",
  );
  if (resolved instanceof Response) return resolved;

  let entries;
  try {
    entries = await readdir(resolved.abs, { withFileTypes: true });
  } catch (err) {
    return notFound(`cannot list directory: ${(err as Error).message}`);
  }

  const out: FsListEntry[] = [];
  for (const e of entries) {
    if (!showHidden && HIDDEN_DIRS.has(e.name)) continue;
    if (!showHidden && e.name.startsWith(".") && e.name !== ".clidable") {
      continue;
    }
    let kind: FsListEntry["kind"];
    if (e.isDirectory()) kind = "dir";
    else if (e.isFile()) kind = "file";
    else if (e.isSymbolicLink()) kind = "symlink";
    else kind = "other";

    let size: number | null = null;
    if (kind === "file") {
      try {
        const s = await stat(join(resolved.abs, e.name));
        size = s.size;
      } catch {
        // Race with deletion or permission issue — surface as unknown size.
        size = null;
      }
    }
    out.push({ name: e.name, kind, size });
  }
  // Dirs first, then files; both case-insensitive alphabetical.
  out.sort((a, b) => {
    if (a.kind !== b.kind) {
      if (a.kind === "dir") return -1;
      if (b.kind === "dir") return 1;
    }
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  const body: FsListResponse = {
    path: url.searchParams.get("path") ?? "",
    entries: out,
  };
  return Response.json(body);
}

/**
 * GET /api/fs/browse?path=<abs> — list sub-directories for the folder picker.
 *
 * Unlike fsList this is NOT sandboxed to a project root: its whole job is to
 * navigate the host filesystem so the user can *pick* a project root. That's
 * acceptable because Clidable is localhost-only + single-user by default and
 * has NO built-in auth by design (PLAN §12): reaching this endpoint beyond
 * loopback requires `--allow-lan` or a tunnel/reverse proxy, so the operator's
 * access layer is what gates it. The same-site gate blocks browser drive-by
 * (server/net/origin.ts) but is not authentication.
 */
export async function fsBrowseHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const raw = url.searchParams.get("path");
  const home = homedir();
  const target = raw && raw.length > 0 ? resolve(raw) : home;

  let abs: string;
  try {
    abs = await realpath(target);
  } catch {
    return notFound(`directory not found: ${target}`);
  }

  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch (err) {
    return forbidden(`cannot list directory: ${(err as Error).message}`);
  }

  const dirs: FsBrowseEntry[] = [];
  for (const e of entries) {
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try {
        isDir = (await stat(join(abs, e.name))).isDirectory();
      } catch {
        isDir = false; // dangling symlink
      }
    }
    if (!isDir) continue;
    if (e.name.startsWith(".")) continue; // hide dotdirs from the picker
    if (HIDDEN_DIRS.has(e.name)) continue;
    dirs.push({ name: e.name, path: join(abs, e.name) });
  }
  dirs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const parent = dirname(abs);
  const body: FsBrowseResponse = {
    path: abs,
    parent: parent === abs ? null : parent, // null at filesystem root
    home,
    dirs,
  };
  return Response.json(body);
}

export async function fsReadHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const resolved = await resolveInsideRoot(
    url.searchParams.get("root"),
    url.searchParams.get("path"),
  );
  if (resolved instanceof Response) return resolved;

  const file = Bun.file(resolved.abs);
  if (!(await file.exists())) return notFound("file not found");
  const size = file.size;
  if (size > MAX_READ_BYTES) {
    return Response.json({
      kind: "toolarge",
      size,
      limit: MAX_READ_BYTES,
    } satisfies FsReadResponse);
  }

  // Probe the first chunk for null bytes — cheap binary check that
  // matches what most editors (and `git`) do.
  const probeLen = Math.min(size, BINARY_PROBE_BYTES);
  if (probeLen > 0) {
    const probe = new Uint8Array(
      await file.slice(0, probeLen).arrayBuffer(),
    );
    for (let i = 0; i < probe.length; i++) {
      if (probe[i] === 0) {
        return Response.json({
          kind: "binary",
          size,
        } satisfies FsReadResponse);
      }
    }
  }

  let content: string;
  try {
    content = await file.text();
  } catch (err) {
    return serverError(`read failed: ${(err as Error).message}`);
  }
  return Response.json({
    kind: "text",
    content,
    size,
  } satisfies FsReadResponse);
}

export async function fsWriteHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const resolved = await resolveInsideRoot(
    url.searchParams.get("root"),
    url.searchParams.get("path"),
  );
  if (resolved instanceof Response) return resolved;

  const body = await req.text();
  // Reject suspicious null-byte writes — almost certainly a bug somewhere
  // upstream, not an intentional binary save (we have no binary write UX).
  if (body.includes("\0")) {
    return badRequest("write payload contains null byte");
  }
  try {
    await Bun.write(resolved.abs, body);
  } catch (err) {
    return serverError(`write failed: ${(err as Error).message}`);
  }
  return Response.json({ ok: true, size: body.length });
}
