/**
 * A link to somewhere outside the app.
 *
 * Exists because a plain `<a target="_blank">` is a DEAD CLICK in the desktop
 * app — WKWebView hands the new-window request to a navigation delegate Tauri
 * doesn't install, so nothing happens (see lib/open-external.ts). Every
 * outbound link has to route through `openExternal`, which asks the Rust shell
 * to hand the URL to the OS.
 *
 * The `href` is kept on the element (rather than using a button) so the browser
 * still shows the target on hover, middle-click/⌘-click keep working there, and
 * it stays a real link for assistive tech. The click handler is what makes it
 * work on desktop.
 */
import { openExternal } from "../../lib/open-external";

/** The outbound-link glyph. Shared so every "opens elsewhere" affordance in the
 *  app looks the same. */
export function ExternalGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={11}
      height={11}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 3h6v6" />
      <path d="M10 14l11-11" />
      <path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5" />
    </svg>
  );
}

interface Props {
  href: string;
  children: React.ReactNode;
  /** Replaces the default pill styling entirely when set. */
  className?: string;
  /** Show the outbound glyph before the label. Default true. */
  glyph?: boolean;
}

const PILL = `
  inline-flex items-center gap-1.5 rounded-lg
  border border-white/[0.1] bg-white/[0.04]
  px-3 py-1.5 text-[11.5px] text-foreground/85
  transition-[background-color,border-color] duration-150
  hover:border-white/[0.2] hover:bg-white/[0.07] hover:text-foreground
  focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
`;

export function ExternalLink({ href, children, className, glyph = true }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={className ?? PILL}
      onClick={(e) => {
        // Let the browser handle the modifier-click conventions (new tab,
        // new window, download) rather than hijacking them.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
          return;
        }
        e.preventDefault();
        void openExternal(href);
      }}
    >
      {glyph && <ExternalGlyph />}
      {children}
      <span className="sr-only"> (opens in your browser)</span>
    </a>
  );
}
