import { useEffect, type RefObject } from "react";

/**
 * Glass surface for a portal'd popover — painted at <body> level (outside any
 * backdrop-root ancestor, so its backdrop-filter blurs the real page content
 * beneath). Shared by the tab context menu and the split menu.
 */
export const POPOVER_GLASS_STYLE = {
  background: "color-mix(in oklch, var(--color-background) 38%, transparent)",
  backdropFilter: "blur(32px) saturate(180%)",
  WebkitBackdropFilter: "blur(32px) saturate(180%)",
  border: "1px solid var(--color-glass-edge)",
  boxShadow:
    "inset 0 1px 0 0 rgba(255,255,255,0.05), 0 18px 40px rgba(0,0,0,0.45)",
} as const;

/**
 * Dismiss a portal'd popover on outside mousedown, Escape, and (optionally)
 * scroll. `ignoreRef` is a trigger element whose clicks must NOT count as
 * "outside" (e.g. a toggle button). Pass a STABLE `onDismiss` (useCallback / a
 * ref) so the listeners subscribe once instead of on every render.
 */
export function usePopoverDismiss(
  popRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  opts?: {
    ignoreRef?: RefObject<HTMLElement | null>;
    dismissOnScroll?: boolean;
    /** Gate the listeners — pass the open state when the surface stays mounted
     *  (a toggle). Omit when the surface only mounts while open. Default true. */
    enabled?: boolean;
  },
): void {
  const ignoreRef = opts?.ignoreRef;
  const dismissOnScroll = opts?.dismissOnScroll ?? false;
  const enabled = opts?.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (ignoreRef?.current?.contains(t)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    if (dismissOnScroll) window.addEventListener("scroll", onDismiss, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      if (dismissOnScroll) window.removeEventListener("scroll", onDismiss, true);
    };
  }, [popRef, onDismiss, ignoreRef, dismissOnScroll, enabled]);
}
