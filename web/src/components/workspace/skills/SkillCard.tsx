import type { ReactNode } from "react";
import { SkillGlyph } from "./SkillGlyph";
import { AgentDots } from "../AgentDots";
import { formatInstalls, type DiscoverSkill, type InstalledSkill } from "./data";

interface InstalledProps {
  variant: "installed";
  skill: InstalledSkill;
  onSelect: () => void;
}
interface DiscoverProps {
  variant: "discover";
  skill: DiscoverSkill;
  installed: boolean;
  installing?: boolean;
  onInstall: () => void;
  onSelect: () => void;
}
type Props = InstalledProps | DiscoverProps;

/**
 * Single skill row used by both the Installed and Discover tabs. The whole
 * card is clickable (→ detail view). Sub-interactives (install button,
 * kebab menu) stop propagation so they don't bubble into the row click.
 */
export function SkillCard(props: Props) {
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
      {/* Glyph badge */}
      <span
        className="
          flex size-9 shrink-0 items-center justify-center rounded-xl
          border border-white/[0.06] bg-white/[0.025]
          text-foreground/75
        "
      >
        <SkillGlyph id={props.skill.glyph} size={16} />
      </span>

      {/* Info column */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-mono text-[12.5px] font-medium tracking-tight">
            {props.skill.name}
          </span>
          {props.variant === "installed" && props.skill.version && (
            <span className="shrink-0 text-[10px] text-foreground/40">
              v{props.skill.version}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-wider text-foreground/35">
            {props.skill.source}
          </span>
        </div>

        <p className="mt-1 line-clamp-2 text-[12px] text-foreground/55">
          {props.skill.description}
        </p>

        {/* Bottom row varies by variant */}
        {props.variant === "installed" ? (
          <Bottom>
            <AgentDots agents={props.skill.agents} />
            <span className="ml-auto flex items-center gap-2">
              <ScopeBadge scope={props.skill.scope} />
              <KebabMenu />
            </span>
          </Bottom>
        ) : (
          <Bottom>
            <span className="flex items-center gap-1.5 text-[10.5px] text-foreground/40">
              <DownloadIcon />
              {formatInstalls(props.skill.installs)} installs
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                props.onInstall();
              }}
              disabled={props.installed || props.installing}
              className="
                ml-auto rounded-lg
                border border-white/[0.1] bg-white/[0.04]
                px-3 py-1 text-[11.5px] font-medium text-foreground/85
                transition-[background-color,border-color] duration-150
                hover:border-white/[0.18] hover:bg-white/[0.08] hover:text-foreground
                focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                disabled:cursor-not-allowed disabled:opacity-50
                disabled:hover:bg-white/[0.04] disabled:hover:border-white/[0.1]
              "
            >
              {props.installed
                ? "Installed"
                : props.installing
                  ? "Installing…"
                  : "Install"}
            </button>
          </Bottom>
        )}
      </div>
    </article>
  );
}

function Bottom({ children }: { children: ReactNode }) {
  return <div className="mt-2.5 flex items-center gap-2">{children}</div>;
}

function ScopeBadge({ scope }: { scope: "project" | "global" }) {
  return (
    <span
      className="
        rounded-md border border-white/[0.06] bg-white/[0.02]
        px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em]
        text-foreground/45
      "
      title={
        scope === "global"
          ? "Installed globally (~, all projects)"
          : "Installed in this project (committed)"
      }
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

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M6 11l6 6 6-6M5 21h14" />
    </svg>
  );
}
