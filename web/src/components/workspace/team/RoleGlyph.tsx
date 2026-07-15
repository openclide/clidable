import type { RoleGlyphId } from "./data";

export function RoleGlyph({
  id,
  size = 18,
  className,
}: {
  id: RoleGlyphId;
  size?: number;
  className?: string;
}) {
  const path = PATHS[id];
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

const PATHS: Record<RoleGlyphId, string> = {
  // compass + ruler — architecture
  architect:
    "M12 3l3 5 5 1-4 4 1 5-5-3-5 3 1-5-4-4 5-1z M12 8v6",
  // magnifier with checkmark — review
  reviewer:
    "M11 4a7 7 0 015 11.95L21 21M11 4a7 7 0 100 14 7 7 0 000-14z M8.5 11l2 2 3.5-4",
  // bug
  debugger:
    "M9 4l3 3 3-3 M12 7v14 M5 9a7 7 0 0114 0v6a7 7 0 01-14 0V9z M2 12h3 M19 12h3 M3 18l3-1 M21 18l-3-1 M3 7l3 1 M21 7l-3 1",
  // grid + pen — UI/UX
  "ui-designer":
    "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13l4 4-1 3-3 1z M17 17l2-2",
  // beaker
  tester:
    "M9 3v3l-4 9a3 3 0 003 4h8a3 3 0 003-4l-4-9V3 M9 3h6 M9 12h6",
  // shield + check
  security:
    "M12 3l8 3v6c0 4-3 8-8 9-5-1-8-5-8-9V6z M9 12l2 2 4-4",
  // lightning bolt
  performance: "M13 3l-8 11h6l-1 7 8-11h-6l1-7z",
  // book / document
  documenter:
    "M4 4h12a2 2 0 012 2v14H6a2 2 0 01-2-2V4z M4 4v14a2 2 0 002 2 M9 9h6 M9 13h6 M9 17h4",
  // megaphone
  marketer:
    "M3 11l13-5v12L3 13v-2z M3 11v2 M16 8a3 3 0 010 6 M7 13v5",
  // clipboard with checkmark
  pm:
    "M8 4h8v3H8z M6 6h2v1h8V6h2v14H6V6z M9 12l2 2 4-4",
  // picture frame: sun + mountains
  "image-creator":
    "M4 5h16v14H4z M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z M4 16l5-5 4 4 3-3 4 4",
};
