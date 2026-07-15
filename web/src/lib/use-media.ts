import { useEffect, useState, useSyncExternalStore } from "react";

const MOBILE_QUERY = "(max-width: 767px)";

// One shared MediaQueryList — getSnapshot runs on every render, so allocating a
// fresh MQL per call (and a separate one in subscribe) would be wasteful churn.
let _mql: MediaQueryList | null = null;
function mobileMql(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  if (!_mql) _mql = window.matchMedia(MOBILE_QUERY);
  return _mql;
}

function subscribeMobile(onChange: () => void): () => void {
  const mql = mobileMql();
  if (!mql) return () => {};
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function mobileSnapshot(): boolean {
  return mobileMql()?.matches ?? false;
}

/**
 * True on phone-width viewports (<768px). Drives the single-view mobile shell
 * (bottom CLI/Preview/Code bar + collapsed top menus) vs the desktop split.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, mobileSnapshot, () => false);
}

/**
 * True when the on-screen keyboard is (probably) open — the visual viewport
 * shrinks well below the layout viewport. Used to slide the floating view bar
 * out of the way so it doesn't sit on top of the keyboard while typing.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const update = () => setOpen(window.innerHeight - vv.height > 120);
    // iOS sometimes reports the keyboard geometry change via `scroll`, not
    // `resize` — listen to both so the bar reliably gets out of the way.
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return open;
}
