/** A stable hue (0–359) derived from a project's name. Same name → same
 *  color; different names → different colors, so tinted same-initial projects
 *  stay distinguishable. */
function projectHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** The uppercased first letters that occur 2+ times among `names` — i.e. the
 *  initials that need color to tell their projects apart. Callers tint a badge
 *  only when its initial is in this set; everything else stays neutral gray. */
export function duplicatedInitials(names: readonly string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const n of names) {
    const k = n.charAt(0).toUpperCase();
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const dups = new Set<string>();
  for (const [k, c] of counts) if (c > 1) dups.add(k);
  return dups;
}

/** Square first-letter badge for a project. Shared by the project tabs, the
 *  preview URL bar, terminal tab chips, the composer label, and the mobile
 *  switcher. `size` (px) scales the box, font and radius together (20px
 *  default). `tinted` paints it with a per-project color (derived from `name`,
 *  consistent across surfaces) — used only when the initial collides with
 *  another open project; otherwise it stays neutral gray. */
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
