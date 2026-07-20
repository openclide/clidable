/**
 * User-given terminal names, keyed by session id (== the tab's instanceId).
 *
 * The custom title a user types when renaming a tab lives in the frontend pane
 * tree; the desktop tray reads the *server*, which otherwise only knows the
 * agent-type name ("Claude Code"). The frontend mirrors each title here over the
 * terminal WS (`label` message) so the tray can prefer it. Purely in-memory and
 * ephemeral — cleared when the title is removed or the session's process exits.
 */
const labels = new Map<string, string>();

/** Set (non-empty) or clear (null/blank) a session's user-given name. */
export function setSessionLabel(id: string, title: string | null): void {
  const trimmed = title?.trim();
  if (trimmed) labels.set(id, trimmed);
  else labels.delete(id);
}

/** The user-given name for this session, or null if none. */
export function getSessionLabel(id: string): string | null {
  return labels.get(id) ?? null;
}
