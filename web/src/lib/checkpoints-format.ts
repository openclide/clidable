/**
 * Pure display helpers for checkpoint UI. Lives in /lib/ so the
 * components don't grow extras when we extend display logic
 * (truncation rules, locale-aware time, etc.).
 */

/** "2m ago", "1h ago", "just now", etc. Matches the project list's relative-time strings. */
export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 30) return "just now";
  const min = Math.floor(s / 60);
  if (min < 1) return "moments ago";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Collapse whitespace + truncate composer messages for the one-line
 * preview slot in checkpoint rows. Empty strings (e.g. the initial
 * checkpoint, where the user hadn't sent anything yet) become `—`.
 */
export function previewMessage(message: string, max = 64): string {
  if (!message) return "—";
  const oneLine = message.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1).trimEnd() + "…";
}
