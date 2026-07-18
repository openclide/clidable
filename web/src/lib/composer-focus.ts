/**
 * A tiny signal so picking a terminal (e.g. from the dock) can move keyboard
 * focus into that terminal's composer input.
 *
 * The target composer may not be mounted yet — a background tab only mounts its
 * composer once it becomes active. So a request for an unmounted session is
 * remembered and honored the moment that composer registers.
 */

let pending: string | null = null;
const focusers = new Map<string, () => void>();

/** Ask the composer for `sessionId` to focus. Focuses immediately if it's
 *  mounted, otherwise as soon as it mounts. */
export function requestComposerFocus(sessionId: string): void {
  const fn = focusers.get(sessionId);
  if (fn) fn();
  else pending = sessionId;
}

/** A composer registers how to focus itself for its session; honors a request
 *  that arrived before it mounted. Returns an unregister. */
export function registerComposerFocus(
  sessionId: string,
  focus: () => void,
): () => void {
  focusers.set(sessionId, focus);
  if (pending === sessionId) {
    pending = null;
    focus();
  }
  return () => {
    if (focusers.get(sessionId) === focus) focusers.delete(sessionId);
    if (pending === sessionId) pending = null;
  };
}
