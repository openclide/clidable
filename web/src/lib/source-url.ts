/**
 * Turn a catalog entry's `source` string into something linkable.
 *
 * `source` is a display field with several shapes depending on where the entry
 * came from: an `owner/repo` slug (skills, plugins, GitHub-backed MCP servers),
 * a full URL (a remote MCP endpoint), or neither — an npm package name, a bare
 * command, or an id. Only the first two can be opened, so this returns null for
 * the rest and callers render no link at all.
 *
 * Returning null matters: the MCP and Skills panels used to render a "View
 * source" button unconditionally, with no href and no handler, so it looked
 * clickable and did nothing.
 */

/** `owner/repo` — the slug shape npm/GitHub catalogs use. Deliberately strict:
 *  no spaces, exactly one slash, no leading dash. */
const REPO_SLUG = /^[\w.-]+\/[\w.-]+$/;

export function sourceUrl(source: string): string | null {
  const s = source.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (REPO_SLUG.test(s)) return `https://github.com/${s}`;
  return null;
}
