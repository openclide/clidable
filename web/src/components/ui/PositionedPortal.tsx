/**
 * Anchored popover that renders in a portal at document.body.
 *
 * Why a portal: an `absolute`/`fixed` popover gets clipped by any
 * ancestor with `overflow-hidden` (every glass panel uses it for
 * rounded corners) and `fixed` additionally can't escape an ancestor
 * `backdrop-filter` (which establishes a containing block). Portaling
 * to <body> sidesteps both — the popover positions itself against the
 * anchor's viewport rect instead.
 *
 * Owns: portal rendering, viewport-clamped positioning (placement
 * top/bottom, align left/right), re-measure on scroll/resize, and
 * outside-click + Escape dismissal. Consumers supply the anchor ref,
 * open/close state, a width, and the content.
 *
 * Replaces three hand-rolled copies (SincePicker, RewindPopover,
 * SidePane's project selector).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_MARGIN = 8;

interface Props {
  /** The trigger element the popover positions against. */
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  /** Fired on outside-click or Escape. */
  onClose: () => void;
  /** Fixed popover width in px (used for viewport clamping too). */
  width: number;
  /** Which side of the anchor the popover opens toward. Default "bottom". */
  placement?: "bottom" | "top";
  /** Which edges align. "left" = left edges; "right" = right edges. Default "left". */
  align?: "left" | "right";
  /** Gap between anchor and popover in px. Default 6. */
  gap?: number;
  /** Classes for the popover card (glass, rounding, shadow, layout). */
  className?: string;
  role?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}

type Position =
  | { left: number; top: number }
  | { left: number; bottom: number };

export function PositionedPortal({
  anchorRef,
  open,
  onClose,
  width,
  placement = "bottom",
  align = "left",
  gap = 6,
  className = "",
  role = "dialog",
  ariaLabel,
  children,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(null);

  // Stable onClose so the listener effect doesn't re-bind every render
  // when the parent passes a fresh inline closure.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Measure + keep in sync while open.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const measure = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const rawLeft = align === "right" ? r.right - width : r.left;
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(rawLeft, window.innerWidth - width - VIEWPORT_MARGIN),
      );
      if (placement === "top") {
        setPos({ left, bottom: window.innerHeight - r.top + gap });
      } else {
        setPos({ left, top: r.bottom + gap });
      }
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, placement, align, width, gap, anchorRef]);

  // Outside-click (mousedown) + Escape. Clicks on the anchor are
  // ignored so its own toggle handler runs without us double-closing.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (contentRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchorRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={contentRef}
      role={role}
      aria-label={ariaLabel}
      className={`fixed z-50 ${className}`}
      style={{ width, ...pos }}
    >
      {children}
    </div>,
    document.body,
  );
}
