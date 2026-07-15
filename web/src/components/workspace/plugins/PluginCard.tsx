import type { ReactNode } from "react";
import { PluginGlyph } from "./PluginGlyph";
import { PluginComponentSummary } from "./PluginComponents";
import { AgentDots } from "../AgentDots";
import { formatInstalls } from "../skills/data";
import {
  PLUGIN_STORES,
  type DiscoverPlugin,
  type InstalledPlugin,
  type PluginScope,
  type PluginStore,
} from "./data";

/** The agents a Discover plugin's store installs into (Claude+Cursor, or Codex). */
function storeAgents(store: PluginStore) {
  return PLUGIN_STORES.find((s) => s.id === store)?.agents ?? [];
}

interface InstalledProps {
  variant: "installed";
  plugin: InstalledPlugin;
  onSelect: () => void;
}
interface DiscoverProps {
  variant: "discover";
  plugin: DiscoverPlugin;
  installed: boolean;
  installing: boolean;
  onInstall: () => void;
  onSelect: () => void;
}
type Props = InstalledProps | DiscoverProps;

/**
 * Plugin card — used by both Installed and Discover tabs. Same shape as
 * SkillCard but the tagline row shows component-count pills instead of an
 * agent attribution row.
 */
export function PluginCard(props: Props) {
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
        <PluginGlyph id={props.plugin.glyph} size={16} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-mono text-[12.5px] font-medium tracking-tight">
            {props.plugin.name}
          </span>
          {props.variant === "installed" && (
            <span className="shrink-0 text-[10px] text-foreground/40">
              v{props.plugin.version}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-wider text-foreground/35">
            {props.plugin.source}
          </span>
        </div>

        <p className="mt-1 line-clamp-2 text-[12px] text-foreground/55">
          {props.plugin.description}
        </p>

        <Bottom>
          {props.variant === "installed" ? (
            <>
              <AgentDots agents={props.plugin.agents} />
              <span className="ml-auto flex items-center gap-2">
                <PluginComponentSummary components={props.plugin.components} />
                {!props.plugin.enabled && <DisabledBadge />}
                <ScopeBadge scope={props.plugin.scope} />
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-2">
                <AgentDots agents={storeAgents(props.plugin.store)} />
                {props.plugin.category && (
                  <CategoryBadge category={props.plugin.category} />
                )}
              </span>
              <span className="ml-auto flex items-center gap-2.5">
                {props.plugin.installs > 0 && (
                  <span className="flex items-center gap-1.5 text-[10.5px] text-foreground/40">
                    <DownloadIcon />
                    {formatInstalls(props.plugin.installs)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onInstall();
                  }}
                  disabled={props.installed || props.installing}
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
                  {props.installing
                    ? "Installing…"
                    : props.installed
                      ? "Installed"
                      : "Install"}
                </button>
              </span>
            </>
          )}
        </Bottom>
      </div>
    </article>
  );
}

function Bottom({ children }: { children: ReactNode }) {
  return <div className="mt-2.5 flex flex-wrap items-center gap-2">{children}</div>;
}

function ScopeBadge({ scope }: { scope: PluginScope }) {
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

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="rounded-md border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-[10px] lowercase tracking-wide text-foreground/45">
      {category}
    </span>
  );
}

function DisabledBadge() {
  return (
    <span
      className="
        rounded-md border border-amber-400/25 bg-amber-500/10
        px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em]
        text-amber-200/80
      "
      title="Disabled in all stores"
    >
      disabled
    </span>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M6 11l6 6 6-6M5 21h14" />
    </svg>
  );
}
