import type { McpGlyphId } from "./data";

/**
 * Per-category MCP server glyph. Tiny inline SVG, single source of truth so
 * the same shape shows on the card glyph badge and in the detail hero.
 */
export function McpGlyph({
  id,
  size = 18,
  className,
}: {
  id: McpGlyphId;
  size?: number;
  className?: string;
}) {
  const path = PATHS[id] ?? PATHS.generic;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

const PATHS: Record<McpGlyphId, string> = {
  // git branch-and-merge
  github:
    "M6 3v18 M6 9c0 6 6 6 6 6 M18 6a2 2 0 100-4 2 2 0 000 4z M6 5a2 2 0 100-4 2 2 0 000 4z M6 23a2 2 0 100-4 2 2 0 000 4z M18 6v3a3 3 0 01-3 3h-3",
  // cylinder (db)
  db:
    "M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6 M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6",
  // folder
  filesystem:
    "M4 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V6z",
  // triangle (vercel)
  vercel: "M12 4L22 20H2L12 4z",
  // monitor / browser window
  browser:
    "M3 5h18v14H3z M3 9h18 M6 7h.01 M9 7h.01 M12 7h.01",
  // stacked horizontal lines (project lanes / linear)
  linear: "M3 6h18 M3 12h12 M3 18h6",
  // hash (slack)
  slack:
    "M9 4l-1 16 M16 4l-1 16 M4 9h16 M4 15h16",
  // credit card (stripe)
  stripe:
    "M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z M3 11h18 M7 16h3",
  // shield (sentry)
  sentry:
    "M12 3l8 3v6c0 4-3 8-8 9-5-1-8-5-8-9V6z M9 12l2 2 4-4",
  // generic plug — fallback
  generic:
    "M9 8V4M15 8V4 M6 8h12v4a6 6 0 01-12 0V8z M12 18v3",
};
