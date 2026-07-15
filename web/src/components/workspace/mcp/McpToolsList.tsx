import type { McpResource, McpTool } from "./data";

interface Props {
  tools: McpTool[];
}

export function McpToolsList({ tools }: Props) {
  return (
    <ul
      className="
        flex flex-col overflow-hidden
        rounded-xl border border-white/[0.06] bg-white/[0.015]
      "
    >
      {tools.map((t, i) => (
        <li
          key={t.name}
          className={`
            flex items-baseline gap-4 px-4 py-2.5
            ${i > 0 ? "border-t border-white/[0.04]" : ""}
          `}
        >
          <code className="shrink-0 font-mono text-[11.5px] text-foreground/85">
            {t.name}
          </code>
          <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-foreground/55">
            {t.description}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function McpResourcesList({ resources }: { resources: McpResource[] }) {
  return (
    <ul
      className="
        flex flex-col overflow-hidden
        rounded-xl border border-white/[0.06] bg-white/[0.015]
      "
    >
      {resources.map((r, i) => (
        <li
          key={r.name}
          className={`
            flex items-baseline gap-4 px-4 py-2.5
            ${i > 0 ? "border-t border-white/[0.04]" : ""}
          `}
        >
          <code className="shrink-0 font-mono text-[11.5px] text-emerald-300/80">
            {r.name}
          </code>
          <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-foreground/55">
            {r.description}
          </p>
        </li>
      ))}
    </ul>
  );
}
