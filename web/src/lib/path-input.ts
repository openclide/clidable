/**
 * Turning what a user TYPES into a path the server can browse.
 *
 * Lives here rather than inside FolderPickerModal so it can be unit-tested:
 * this is the fiddliest logic in the picker (quote stripping, `~` expansion,
 * separator inference, four kinds of "absolute"), and every bug found in it so
 * far was one a table-driven test would have caught immediately.
 */

/** A path that already names its own root and needs no base to make sense. */
export function isAbsolutePath(p: string): boolean {
  return (
    p.startsWith("/") || // posix
    p.startsWith("\\\\") || // UNC: \\server\share
    /^[A-Za-z]:[\\/]/.test(p) // C:\x or C:/x
  );
}

/** `C:foo` — a path relative to the CURRENT directory of drive C, which only
 *  the OS knows. Passed through for the server to resolve rather than guessed. */
const isDriveRelative = (p: string): boolean => /^[A-Za-z]:(?![\\/])/.test(p);

/** `\Users\me` — absolute on the CURRENT drive. Needs a drive letter bolted on,
 *  which is why it can't just be treated as absolute. */
const isRootRelative = (p: string): boolean => p.startsWith("\\") && !p.startsWith("\\\\");

/**
 * Strip ONE surrounding quote pair.
 *
 * Windows Explorer's "Copy as path" wraps in double quotes, and pasting that is
 * the likeliest way someone reaches another drive. Deliberately not greedy: a
 * path may legally contain a quote, and `"a" b "c"` is one string with two
 * quoted runs, not a quoted `a" b "c`.
 */
function unquote(s: string): string {
  const q = s[0];
  if ((q === '"' || q === "'") && s.length > 1 && s.endsWith(q)) {
    const inner = s.slice(1, -1);
    if (!inner.includes(q)) return inner;
  }
  return s;
}

export interface ResolveTypedOptions {
  /** Directory currently shown — the base for relative input. */
  currentDir: string | null | undefined;
  /** The SERVER's home directory, for `~`. */
  home: string | null | undefined;
}

/**
 * Resolve typed input against where the picker is, or null when it can't be
 * resolved safely.
 *
 * Returning null for relative input with no base is deliberate: passing it
 * through would make the SERVER resolve it against its own cwd — the launch
 * dir, or `/` for a Dock-launched app — silently landing somewhere unrelated.
 */
export function resolveTypedPath(
  input: string,
  { currentDir, home }: ResolveTypedOptions,
): string | null {
  const raw = unquote(input.trim()).trim();
  if (!raw) return null;

  // `~` expands against the SERVER's home — that's whose filesystem this
  // browses, which matters in remote/VPS mode.
  if (home && (raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\"))) {
    return home + raw.slice(1);
  }
  if (isAbsolutePath(raw) || isDriveRelative(raw)) return raw;

  if (!currentDir) return null; // nothing to resolve against — refuse

  // Windows separators only when the base is clearly a Windows path; a posix
  // path can legally contain a backslash in a filename.
  const windows = /^[A-Za-z]:[\\/]/.test(currentDir) || currentDir.startsWith("\\\\");
  const base = currentDir.replace(/[\\/]+$/, "");

  // `\Users\me` is absolute on the CURRENT drive — keep the drive, replace the
  // rest, rather than appending it to the current directory.
  if (isRootRelative(raw)) {
    const drive = currentDir.match(/^[A-Za-z]:/)?.[0];
    return drive ? drive + raw : raw;
  }
  return base + (windows ? "\\" : "/") + raw;
}

/**
 * The separator `dir` itself uses. Inferred, because the browser has no idea
 * what the SERVER's platform is — and this UI drives a filesystem that may be
 * on another machine entirely (remote/VPS mode).
 */
export function pathSeparator(dir: string): "\\" | "/" {
  return /^[A-Za-z]:[\\/]/.test(dir) || dir.startsWith("\\\\") ? "\\" : "/";
}

/**
 * Join a child name onto a directory using that directory's own separator.
 *
 * Hardcoding "/" renders `C:\Users\me/my-app` on Windows — which is not just
 * ugly in a preview, it's the string a user copies and pastes back.
 */
export function joinPath(dir: string, child: string): string {
  const sep = pathSeparator(dir);
  return dir.replace(/[\\/]+$/, "") + sep + child;
}
