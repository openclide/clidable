import type { ReactNode } from "react";
import { McpGlyph } from "./McpGlyph";
import { McpConfiguration } from "./McpConfiguration";
import { McpResourcesList, McpToolsList } from "./McpToolsList";
import { McpAgentMatrix } from "./McpAgentMatrix";
import { SkillFilesList } from "../skills/SkillFilesList";
import { isInstalledMcp, type AnyMcp } from "./data";
import type { AgentId } from "../../welcome/data";
import type { McpScope } from "@shared/types";

interface Props {
  server: AnyMcp;
  /** Agents that have this server, per scope (live, from the modal). */
  installedByScope: Record<McpScope, AgentId[]>;
  /** Scope to open on (the row the user came from). */
  defaultScope: McpScope;
  busyKey: string | null;
  onApply: (
    scope: McpScope,
    toInstall: AgentId[],
    toRemove: AgentId[],
    secrets: Record<string, string>,
  ) => void;
}

export function McpDetail({
  server,
  installedByScope,
  defaultScope,
  busyKey,
  onApply,
}: Props) {
  const installed = isInstalledMcp(server);
  // Not configured in any scope → install mode (collect secrets the catalog
  // config declares); otherwise manage per-agent/scope.
  const fresh =
    installedByScope.project.length + installedByScope.global.length === 0;
  const secretKeys = fresh
    ? server.transport === "stdio"
      ? server.envVars.map((e) => e.name)
      : (server.headers ?? []).map((h) => h.name)
    : [];
  const secretLabel = server.transport === "stdio" ? "Env vars" : "Headers";

  const matrix = (
    <Section title={fresh ? "Install" : "Agents"}>
      <McpAgentMatrix
        key={`${server.id}:${defaultScope}`}
        installedByScope={installedByScope}
        defaultScope={defaultScope}
        fresh={fresh}
        secretKeys={secretKeys}
        secretLabel={secretLabel}
        busyKey={busyKey}
        serverKey={server.id}
        onApply={onApply}
      />
    </Section>
  );

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
          <McpGlyph id={server.glyph} size={22} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="truncate font-mono text-[14.5px] font-medium tracking-tight">
              {server.name}
            </h2>
            {installed && server.version && (
              <span className="shrink-0 text-[11px] text-foreground/45">
                v{server.version}
              </span>
            )}
            <span className="ml-auto shrink-0 truncate font-mono text-[10.5px] text-foreground/45">
              {server.source}
            </span>
          </div>

          <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground/65">
            {server.description}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SecondaryButton>
              <ExternalGlyph />
              View source
            </SecondaryButton>
          </div>
        </div>
      </section>

      <Divider />

      {/* For a not-yet-installed server, install is the primary action — put it
          right under the hero so opening from Discover lands on it. */}
      {fresh && matrix}

      <Section title="Configuration">
        <McpConfiguration server={server} />
      </Section>

      {server.tools.length > 0 && (
        <Section title={`Tools (${server.tools.length})`}>
          <McpToolsList tools={server.tools} />
        </Section>
      )}

      {server.resources && server.resources.length > 0 && (
        <Section title={`Resources (${server.resources.length})`}>
          <McpResourcesList resources={server.resources} />
        </Section>
      )}

      {/* For an installed server, the agent matrix belongs after the config. */}
      {!fresh && matrix}

      {server.readme && (
        <Section title="README">
          <pre
            className="
              max-h-[240px] overflow-auto
              rounded-xl border border-white/[0.06] bg-white/[0.015]
              px-4 py-3
              font-mono text-[11.5px] leading-[1.65]
              text-foreground/75
              whitespace-pre-wrap
            "
          >
            {server.readme}
          </pre>
        </Section>
      )}

      {server.files.length > 0 && (
        <Section title={`Files (${server.files.length})`}>
          <SkillFilesList files={server.files} />
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


