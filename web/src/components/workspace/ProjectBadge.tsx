/** A stable hue (0–359) derived from a project's name. Same name → same
 *  color; different names → different colors, so tinted same-initial projects
 *  stay distinguishable. */
function projectHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Should project badges be tinted? Colour is what makes them scannable, so it
 *  applies as soon as there is more than one project open — a lone project has
 *  nothing to be told apart from and stays neutral gray.
 *
 *  It's a property of the open set, not of any one badge: every surface (tabs,
 *  dock, address bar, terminal chips, composer, mobile) asks this once and
 *  passes the answer to each `ProjectBadge`. */
export function shouldTintProjects(names: readonly string[]): boolean {
  return names.length > 1;
}

/** Square first-letter badge for a project. Shared by the project tabs, the
 *  preview URL bar, terminal tab chips, the composer label, and the mobile
 *  switcher. `size` (px) scales the box, font and radius together (20px
 *  default). `tinted` paints it with a per-project color (derived from `name`,
 *  consistent across surfaces) — used whenever more than one project is open
 *  (see `shouldTintProjects`); a lone project stays neutral gray. */
export function ProjectBadge({
  name,
  size = 20,
  tinted = false,
}: {
  name: string;
  size?: number;
  tinted?: boolean;
}) {
  const color = `oklch(0.72 0.16 ${projectHue(name)})`;
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, Math.round(size * 0.5)),
        borderRadius: Math.max(4, Math.round(size * 0.3)),
        // oklch keeps every hue at the same perceived lightness, so no project
        // reads darker or louder than another. Inline wins over the neutral
        // classes below when tinted.
        ...(tinted
          ? {
              background: `color-mix(in oklch, ${color} 22%, transparent)`,
              borderColor: `color-mix(in oklch, ${color} 45%, transparent)`,
              color,
            }
          : null),
      }}
      className={`
        flex shrink-0 items-center justify-center leading-none
        border font-semibold uppercase
        ${tinted ? "" : "border-white/[0.08] bg-white/[0.03] text-foreground/60"}
      `}
    >
      {name.slice(0, 1)}
    </span>
  );
}
