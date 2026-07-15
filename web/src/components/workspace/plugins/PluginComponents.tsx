import { ComponentGlyph } from "./PluginGlyph";
import {
  COMPONENT_LABELS,
  groupComponents,
  type PluginComponent,
} from "./data";

interface Props {
  components: PluginComponent[];
}

/**
 * The "What's inside" section of the plugin detail view. Groups components
 * by type, with a header per group + a comma-separated list of names.
 */
export function PluginComponents({ components }: Props) {
  const groups = groupComponents(components);
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
      {groups.map((g, i) => (
        <div
          key={g.type}
          className={`
            flex gap-3 px-4 py-3
            ${i > 0 ? "border-t border-white/[0.05]" : ""}
          `}
        >
          {/* Type header */}
          <div className="flex w-[110px] shrink-0 items-center gap-2 text-foreground/75">
            <ComponentGlyph type={g.type} size={13} className="opacity-90" />
            <span className="text-[11px] font-medium uppercase tracking-[0.1em]">
              {COMPONENT_LABELS[g.type]}
            </span>
            <span className="ml-auto text-[10.5px] tabular-nums text-foreground/40">
              {g.items.length}
            </span>
          </div>

          {/* Items */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-[11.5px] text-foreground/75">
              {g.items.map((it, j) => (
                <span key={j} className="inline-flex items-baseline gap-1">
                  <span>{it.name}</span>
                  {it.meta && (
                    <span className="text-[10px] text-foreground/40">
                      {it.meta}
                    </span>
                  )}
                  {j < g.items.length - 1 && (
                    <span aria-hidden className="text-foreground/25">·</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Compact icon+count pill row used on plugin cards (not the detail view).
 * Example: [⌘ 4]  [✦ 3]  [🪝 2]
 */
export function PluginComponentSummary({
  components,
}: {
  components: PluginComponent[];
}) {
  const groups = groupComponents(components);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {groups.map((g) => (
        <span
          key={g.type}
          title={COMPONENT_LABELS[g.type]}
          className="
            flex items-center gap-1 rounded-full
            border border-white/[0.06] bg-white/[0.02]
            px-1.5 py-0.5
            text-[10.5px] font-medium tabular-nums text-foreground/65
          "
        >
          <ComponentGlyph type={g.type} size={10} className="opacity-80" />
          <span>{g.items.length}</span>
        </span>
      ))}
    </div>
  );
}
