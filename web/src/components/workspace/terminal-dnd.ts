/**
 * Drag & drop plumbing for moving terminal tabs between panes (and onto the
 * minimized dock). Uses a custom MIME type so terminal drags can't be
 * confused with text/file drags, and so drop targets can accept the drag
 * (via `types`) before the payload is readable on drop.
 */

export const TERMINAL_DRAG_MIME = "application/x-clidable-terminal";

export interface TerminalDragPayload {
  paneId: string;
  tabIndex: number;
}

// The drag in progress, tracked window-locally. Pane ids are a per-window
// counter (pane-1, pane-2, …), so a payload from ANOTHER Clidable window
// would name this window's unrelated panes — HTML5 DnD happily delivers
// cross-window drops, and accepting one would teleport the wrong terminal.
// A drag is only honored while this module (same window) saw its dragstart.
let activeDrag: TerminalDragPayload | null = null;

export function setTerminalDragData(
  e: React.DragEvent,
  payload: TerminalDragPayload,
): void {
  e.dataTransfer.setData(TERMINAL_DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "move";
  activeDrag = payload;
}

/** Call from the drag source's onDragEnd — fires after drop AND cancel. */
export function clearTerminalDrag(): void {
  activeDrag = null;
}

/** Payload of the drag in progress, if it started in this window. Readable
 *  during dragover (unlike dataTransfer data, which the spec hides until
 *  drop) — lets targets refuse e.g. same-pane drops while hovering. */
export function currentTerminalDrag(): TerminalDragPayload | null {
  return activeDrag;
}

/** True while a terminal-tab drag from THIS window is over the target. */
export function hasTerminalDrag(e: React.DragEvent): boolean {
  return activeDrag !== null && e.dataTransfer.types.includes(TERMINAL_DRAG_MIME);
}

export function readTerminalDrag(
  e: React.DragEvent,
): TerminalDragPayload | null {
  if (activeDrag === null) return null; // foreign-window or stale drag
  const raw = e.dataTransfer.getData(TERMINAL_DRAG_MIME);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<TerminalDragPayload>;
    if (typeof p.paneId === "string" && typeof p.tabIndex === "number") {
      return { paneId: p.paneId, tabIndex: p.tabIndex };
    }
  } catch {
    // Malformed payload from a stale/foreign drag — ignore.
  }
  return null;
}

/** True when a dragleave means the pointer actually left `currentTarget`.
 *  Native dragleave also fires when crossing onto a child, which strobes
 *  hover highlights off/on — targets should ignore those. */
export function isLeavingTarget(e: React.DragEvent): boolean {
  const related = e.relatedTarget as Node | null;
  return !related || !e.currentTarget.contains(related);
}
