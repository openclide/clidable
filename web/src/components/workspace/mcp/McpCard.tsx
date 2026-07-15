import type { ReactNode } from "react";
import { McpGlyph } from "./McpGlyph";
import { McpStatusBadge } from "./McpStatusBadge";
import { AgentDots } from "../AgentDots";
import type { DiscoverMcp, InstalledMcp } from "./data";

interface InstalledProps {
  variant: "installed";
  server: InstalledMcp;
  onSelect: () => void;
}
interface DiscoverProps {
  variant: "discover";
  server: DiscoverMcp;
  installed: boolean;
  onInstall: () => void;
  onSelect: () => void;
}
type Props = InstalledProps | DiscoverProps;

/**
 * MCP server card. Installed tagline: status + tools count + transport.
 * Discover tagline: transport + a runs-locally/hosted hint — registries carry
 * config only, so never render a tools/installs count there (it'd be fake).
 */
export function McpCard(props: Props) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onSelect();
        }
      }}
      className="
        group relative flex cursor-pointer items-start gap-3 overflow-hidden
        rounded-xl border border-white/[0.06] bg-white/[0.02]
        px-4 py-3.5
        transition-[border-color,background-color,transform] duration-150
        hover:-translate-y-px hover:border-white/[0.14] hover:bg-white/[0.04]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
      "
    >
      <span
        className="
          flex size-9 shrink-0 items-center justify-center rounded-xl
          border border-white/[0.06] bg-white/[0.025]
          text-foreground/75
        "
      >
        <McpGlyph id={props.server.glyph} size={16} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-mono text-[12.5px] font-medium tracking-tight">
            {props.server.name}
          </span>
          {props.variant === "installed" && props.server.version && (
            <span className="shrink-0 text-[10px] text-foreground/40">
              v{props.server.version}
            </span>
          )}
          <span className="ml-auto shrink-0 truncate font-mono text-[10.5px] text-foreground/35">
            {props.server.source}
          </span>
        </div>

        <p className="mt-1 line-clamp-2 text-[12px] text-foreground/55">
          {props.server.description}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {props.variant === "installed" ? (
            <>
              <AgentDots agents={props.server.agents} />
              <span className="ml-auto flex items-center gap-x-3 gap-y-1.5">
                <McpStatusBadge status={props.server.status} />
                <span className="text-[11px] text-foreground/45">
                  <span className="tabular-nums text-foreground/65">
                    {props.server.tools.length}
                  </span>{" "}
                  tool{props.server.tools.length === 1 ? "" : "s"}
                </span>
                <TransportChip transport={props.server.transport} />
                <ScopeBadge scope={props.server.scope} />
                <KebabMenu />
              </span>
            </>
          ) : (
            <>
              {/* Registries carry config only — no tools/installs metadata, so
                  the tagline is transport + a remote/local hint, never a fake
                  count. */}
              <TransportChip transport={props.server.transport} />
              <span className="text-[11px] text-foreground/45">
                {props.server.transport === "stdio" ? "runs locally" : "hosted"}
              </span>
              <span className="ml-auto flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onInstall();
                  }}
                  disabled={props.installed}
                  className="
                    rounded-lg
                    border border-white/[0.1] bg-white/[0.04]
                    px-3 py-1 text-[11.5px] font-medium text-foreground/85
                    transition-[background-color,border-color] duration-150
                    hover:border-white/[0.18] hover:bg-white/[0.08] hover:text-foreground
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                    disabled:cursor-not-allowed disabled:opacity-50
                    disabled:hover:bg-white/[0.04] disabled:hover:border-white/[0.1]
                  "
                >
                  {props.installed ? "Installed" : "Install"}
                </button>
              </span>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function TransportChip({ transport }: { transport: "stdio" | "http" | "sse" }) {
  return (
    <span
      className="
        rounded-md border border-white/[0.06] bg-white/[0.02]
        px-1.5 py-0.5
        text-[9.5px] font-medium uppercase tracking-[0.1em]
        text-foreground/55
      "
      title={`Transport: ${transport}`}
    >
      {transport}
    </span>
  );
}

function ScopeBadge({ scope }: { scope: "project" | "global" }) {
  return (
    <span
      className="
        rounded-md border border-white/[0.06] bg-white/[0.02]
        px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em]
        text-foreground/45
      "
      title={`Installed at ${scope} scope`}
    >
      {scope}
    </span>
  );
}

function KebabMenu() {
  return (
    <button
      type="button"
      onClick={(e) => e.stopPropagation()}
      aria-label="More actions"
      className="
        flex size-6 items-center justify-center rounded-md
        text-foreground/40
        opacity-0 transition-opacity duration-150
        group-hover:opacity-100
        hover:bg-white/[0.06] hover:text-foreground/85
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        focus-visible:opacity-100
      "
    >
      <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor">
        <circle cx="5" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
      </svg>
    </button>
  );
}

