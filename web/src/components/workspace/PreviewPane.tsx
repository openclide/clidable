/**
 * Real dev-server preview iframe. Ported from terax-ai's PreviewPane with the
 * security rigor kept verbatim and the chrome adapted to Clidable's toolbar
 * (the address bar + viewport switcher live in SidePane, not here).
 *
 * Load-bearing details (do not loosen without reading PreviewPane.test.ts):
 *  - The sandbox grants the minimum for a dev preview and CRITICALLY OMITS
 *    `allow-top-navigation*`, so a compromised dev server can't navigate the
 *    parent Tauri webview to an attacker origin and reach `window.__TAURI__`.
 *  - Cross-origin reload is a *remount* (bump the `nonce` in the iframe key):
 *    `contentWindow.location.reload()` throws on cross-origin frames.
 *  - The iframe is torn down after SUSPEND_AFTER_MS of invisibility — a
 *    backgrounded dev page can hold hundreds of MB in the webview.
 */
import { useEffect, useState } from "react";

export const VIEWPORTS = ["Desktop", "Tablet", "Mobile"] as const;
export type Viewport = (typeof VIEWPORTS)[number];

const WIDTHS: Record<Viewport, string> = {
  Desktop: "100%",
  Tablet: "768px",
  Mobile: "390px",
};

// Tear the iframe down after this much invisibility.
const SUSPEND_AFTER_MS = 30_000;

interface Props {
  /** Resolved URL the iframe should load (see lib/preview-url.ts). Empty =
   *  nothing entered yet → empty state. */
  url: string;
  /** Whether the preview tab is the visible one. Drives memory suspension. */
  visible: boolean;
  viewport: Viewport;
  /** Bump to force a reload (remount). */
  nonce: number;
  /** Whether the *entered* URL points at an external (non-loopback) origin —
   *  drives the X-Frame-Options hint. */
  external: boolean;
  onReload: () => void;
}

export function PreviewPane({
  url,
  visible,
  viewport,
  nonce,
  external,
  onReload,
}: Props) {
  const [loaded, setLoaded] = useState(visible);

  useEffect(() => {
    if (visible) {
      setLoaded(true);
      return;
    }
    const t = setTimeout(() => setLoaded(false), SUSPEND_AFTER_MS);
    return () => clearTimeout(t);
  }, [visible]);

  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      {external && url ? (
        <div className="mb-2 flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-1.5 text-[11px] text-amber-300/90">
          <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
          <span className="truncate">
            Many public sites refuse to embed (X-Frame-Options). If it’s blank,
            open it in your browser.
          </span>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.015]">
        <div
          className="
            mx-auto flex h-full flex-col overflow-hidden
            transition-[max-width] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]
          "
          style={{ maxWidth: WIDTHS[viewport], width: "100%" }}
        >
          {url ? (
            loaded ? (
              <iframe
                key={`${url}#${nonce}`}
                src={url}
                title="Preview"
                // No background here, deliberately — do not add `bg-white`.
                // A backdrop only shows through when the embedded document
                // paints no canvas of its own, and the two kinds of content
                // that do that want opposite colours: a browser-*generated*
                // view (plain text, directory listing, error page) takes its
                // text colour from the system appearance — white on a dark Mac
                // — while an HTML page that declares no background has black
                // text. `color-scheme` here can't settle it; it does not
                // propagate into the embedded document. Falling onto the app's
                // dark pane fixes the generated views, which is the case that
                // actually shows up (every API-style dev server answers `/`
                // with text or JSON). Accepted trade-off: a background-less
                // HTML page renders dark-on-dark.
                className="h-full w-full border-0"
                // Minimum grants for a dev preview: scripts, same-origin
                // (cookies/storage), forms, popups for "open in new tab".
                // OMITS `allow-top-navigation*` on purpose — see file header.
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
                referrerPolicy="no-referrer"
                allow="clipboard-read; clipboard-write; fullscreen"
              />
            ) : (
              <SuspendedState onReload={onReload} />
            )
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  );
}

function SuspendedState({ onReload }: { onReload: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[oklch(0.16_0.015_280)] px-6 text-center">
      <GlobeGlyph />
      <div className="space-y-1">
        <p className="text-[12.5px] font-medium text-foreground/85">
          Preview suspended
        </p>
        <p className="max-w-xs text-[11px] leading-relaxed text-foreground/45">
          Released to free memory after sitting in the background.
        </p>
      </div>
      <button
        type="button"
        onClick={onReload}
        className="rounded-md border border-white/[0.1] bg-white/[0.05] px-3 py-1 text-[11px] text-foreground/85 hover:bg-white/[0.1]"
      >
        Reload
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[oklch(0.16_0.015_280)] px-6 text-center">
      <GlobeGlyph large />
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground/85">
          Nothing to preview yet
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-foreground/45">
          Run your dev server in the terminal, then type its port in the address
          bar above (or pick one from the <span className="font-mono">Ports</span>{" "}
          menu). Public sites often block embedding.
        </p>
      </div>
    </div>
  );
}

function GlobeGlyph({ large }: { large?: boolean }) {
  const box = large ? 12 : 10;
  const icon = large ? 20 : 18;
  return (
    <div
      className="flex items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-foreground/45"
      style={{ width: box * 4, height: box * 4 }}
    >
      <svg viewBox="0 0 24 24" width={icon} height={icon} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
    </div>
  );
}
