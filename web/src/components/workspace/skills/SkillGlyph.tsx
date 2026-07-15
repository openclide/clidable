import type { SkillGlyphId } from "./data";

/**
 * Inline SVG glyphs for skill categories. Single source of truth — both the
 * Installed and Discover lists pick from here, and the colors come from
 * Tailwind's foreground tokens so they read on glass.
 */
export function SkillGlyph({
  id,
  size = 18,
  className,
}: {
  id: SkillGlyphId;
  size?: number;
  className?: string;
}) {
  const path = PATHS[id] ?? PATHS.spark;
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

const PATHS: Record<SkillGlyphId, string> = {
  spark:
    "M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z M19 4l.6 1.7L21 6l-1.4.4L19 8l-.6-1.6L17 6l1.4-.4z",
  db:
    "M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6 M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6",
  commit:
    "M3 12h6 M15 12h6 M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z",
  test:
    "M9 3v3l-4 9a3 3 0 003 4h8a3 3 0 003-4l-4-9V3 M9 3h6 M9 12h6",
  "type-strict":
    "M4 6h6M7 6v12 M14 8a4 4 0 014 4v6 M14 18v-6c0-1.5 1-3 3-3",
  ui:
    "M3 5.5h18v13H3z M3 9.5h18 M7 5.5v13",
  deploy:
    "M5 12l3-9 6 18 3-9 5 2",
  lint:
    "M5 7h14M5 12h14M5 17h8 M19 16l3 3-3 3",
  security:
    "M12 3l8 3v6c0 4.5-3.4 8.5-8 9-4.6-.5-8-4.5-8-9V6z M9 12l2 2 4-4",
  codemod:
    "M8 4l-5 5v6l5 5 M16 4l5 5v6l-5 5 M14 4l-4 16",
  sql:
    "M5 5h14v4H5z M5 11h14v8H5z M9 14h2M9 17h2 M13 14h6 M13 17h4",
  deno:
    "M12 21a9 9 0 100-18 9 9 0 000 18z M10 6.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z M14 12l5 7",
};
