import type { PluginComponentType, PluginGlyphId } from "./data";

/**
 * Glyph for a plugin "type" (badge on the card / hero). Categories chosen to
 * feel distinct from skills — plugins are bundles, glyphs hint at flavor.
 */
export function PluginGlyph({
  id,
  size = 18,
  className,
}: {
  id: PluginGlyphId;
  size?: number;
  className?: string;
}) {
  const path = PLUGIN_PATHS[id] ?? PLUGIN_PATHS.essentials;
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

/**
 * Glyph for a plugin *component* type (commands / skills / agents / hooks /
 * mcp / lsp). Smaller, used in the "What's inside" group headers + the
 * count-pill badges on plugin cards.
 */
export function ComponentGlyph({
  type,
  size = 12,
  className,
}: {
  type: PluginComponentType;
  size?: number;
  className?: string;
}) {
  const path = COMPONENT_PATHS[type];
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

const PLUGIN_PATHS: Record<PluginGlyphId, string> = {
  essentials: "M4 6h16M4 12h16M4 18h10 M19 16l3 3-3 3",
  review: "M4 7h12M4 12h8M4 17h6 M14 13l3 3 4-5",
  security:
    "M12 3l8 3v6c0 4.5-3.4 8.5-8 9-4.6-.5-8-4.5-8-9V6z M9 12l2 2 4-4",
  ui: "M3 5.5h18v13H3z M3 9.5h18 M7 5.5v13",
  db: "M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6 M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6",
  stack:
    "M12 3l9 4.5-9 4.5L3 7.5 12 3z M3 12l9 4.5 9-4.5 M3 16.5l9 4.5 9-4.5",
  forge:
    "M14 4l-2 4-5 2 5 2 2 4 2-4 5-2-5-2-2-4z M4 14l2 4M4 20l4-2",
  shadcn:
    "M12 4v16 M4 8h16 M4 16h16 M8 4l8 16 M16 4L8 20",
  ts:
    "M4 6h6M7 6v12 M14 8a4 4 0 014 4v6 M14 18v-6c0-1.5 1-3 3-3",
  monorepo:
    "M3 7l5-3 5 3 5-3v13l-5 3-5-3-5 3V7z M8 4v13M13 7v13",
  vibe:
    "M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z M5 5l.6 1.6L7 7l-1.4.4L5 9l-.6-1.6L3 7l1.4-.4z",
};

const COMPONENT_PATHS: Record<PluginComponentType, string> = {
  // command: forward slash + chevron suggesting slash-command + cursor
  command: "M9 6l-3 12 M14 9l3 3-3 3",
  // skill: spark (matches the SkillGlyph spark for visual continuity)
  skill: "M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z",
  // agent: person silhouette
  agent:
    "M16 11a4 4 0 100-8 4 4 0 000 8z M8 21v-2a4 4 0 014-4h8a4 4 0 014 4v2",
  // hook: chain link
  hook:
    "M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1 M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1",
  // mcp: plug
  mcp: "M9 8V4M15 8V4 M6 8h12v4a6 6 0 01-12 0V8z M12 18v3",
  // lsp: stacked server racks
  lsp: "M3 5h18v5H3z M3 14h18v5H3z M7 7.5h.01M7 16.5h.01",
};
