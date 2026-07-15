import type { ReactNode } from "react";
import { SkillGlyph } from "./SkillGlyph";
import { SkillAgentMatrix } from "./SkillAgentMatrix";
import { SkillFilesList } from "./SkillFilesList";
import {
  formatInstalls,
  isInstalledSkill,
  type AnySkill,
} from "./data";
import type { SkillBucket, SkillScope } from "@shared/types";

interface Props {
  skill: AnySkill;
  /** Buckets the skill occupies per scope (live, from the modal). */
  installedByScope: Record<SkillScope, SkillBucket[]>;
  /** Scope the matrix opens on (the row the user came from). */
  defaultScope: SkillScope;
  /** False when there's no known source repo to install from. */
  installable: boolean;
  /** In-flight mutation key, e.g. "<id>:apply". */
  busyKey: string | null;
  onApply: (
    scope: SkillScope,
    toInstall: SkillBucket[],
    toRemove: SkillBucket[],
  ) => void;
}

export function SkillDetail({
  skill,
  installedByScope,
  defaultScope,
  installable,
  busyKey,
  onApply,
}: Props) {
  const installed = isInstalledSkill(skill);
  const anywhere =
    installedByScope.project.length > 0 || installedByScope.global.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Hero */}
      <section className="flex gap-4">
        <span
          className="
            flex size-12 shrink-0 items-center justify-center rounded-2xl
            border border-white/[0.08] bg-white/[0.04]
            text-foreground/85
          "
        >
          <SkillGlyph id={skill.glyph} size={22} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="truncate font-mono text-[14.5px] font-medium tracking-tight">
              {skill.name}
            </h2>
            {installed && skill.version && (
              <span className="shrink-0 text-[11px] text-foreground/45">
                v{skill.version}
              </span>
            )}
            <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-wider text-foreground/40">
              {skill.source}
            </span>
          </div>

          <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground/65">
            {skill.description}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!anywhere && !installed && (
              <span className="flex items-center gap-2 text-[11px] text-foreground/45">
                <DownloadGlyph />
                {formatInstalls(skill.installs)} installs
              </span>
            )}
            <SecondaryButton>
              <ExternalGlyph />
              View source
            </SecondaryButton>
          </div>
        </div>
      </section>

      <Divider />

      {/* Triggers when — only when the SKILL.md frontmatter gave us one. */}
      {skill.triggerHint && (
        <Section title="Triggers when">
          <blockquote
            className="
              rounded-xl border border-white/[0.06] bg-white/[0.025]
              px-4 py-3
              text-[12.5px] italic text-foreground/70
            "
          >
            “{skill.triggerHint}”
          </blockquote>
        </Section>
      )}

      {/* SKILL.md content. Search hits carry no body until installed. */}
      <Section title="SKILL.md">
        {skill.content ? (
          <pre
            className="
              max-h-[280px] overflow-auto
              rounded-xl border border-white/[0.06] bg-white/[0.015]
              px-4 py-3
              font-mono text-[11.5px] leading-[1.65]
              text-foreground/75
              whitespace-pre-wrap
            "
          >
            {skill.content}
          </pre>
        ) : (
          <p
            className="
              rounded-xl border border-white/[0.06] bg-white/[0.015]
              px-4 py-3 text-[12px] text-foreground/45
            "
          >
            Preview available once installed — or view the full skill on
            skills.sh.
          </p>
        )}
      </Section>

      {/* Per-bucket install matrix — renders its own "Agents" header + the
          scope selector on the far right. */}
      <SkillAgentMatrix
        key={skill.id}
        installedByScope={installedByScope}
        defaultScope={defaultScope}
        installable={installable}
        busyKey={busyKey}
        skillKey={skill.id}
        onApply={onApply}
      />

      {/* Files — hidden for search hits (no file list until installed). */}
      {skill.files.length > 0 && (
        <Section title={`Files (${skill.files.length})`}>
          <SkillFilesList files={skill.files} />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.12em] text-foreground/45">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Divider() {
  return <span aria-hidden className="h-px w-full bg-white/[0.05]" />;
}

function SecondaryButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="
        flex items-center gap-1.5 rounded-lg
        border border-white/[0.1] bg-white/[0.04]
        px-3 py-1.5 text-[11.5px] text-foreground/85
        transition-[background-color,border-color] duration-150
        hover:border-white/[0.2] hover:bg-white/[0.07] hover:text-foreground
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
      "
    >
      {children}
    </button>
  );
}

function ExternalGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" />
      <path d="M10 14l11-11" />
      <path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5" />
    </svg>
  );
}

function DownloadGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M6 11l6 6 6-6M5 21h14" />
    </svg>
  );
}
