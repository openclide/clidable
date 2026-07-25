import { useState, type ReactNode } from "react";
import { PluginGlyph } from "./PluginGlyph";
import { ViewSource } from "../../ui/ViewSource";
import { PluginComponents } from "./PluginComponents";
import { SkillFilesList } from "../skills/SkillFilesList";
import { formatInstalls } from "../skills/data";
import { PluginStoreMatrix } from "./PluginStoreMatrix";
import {
  isInstalledPlugin,
  PLUGIN_SCOPES,
  UNSUPPORTED_TARGETS,
  type AnyPlugin,
  type DiscoverPlugin,
  type InstalledPlugin,
  type PluginScope,
} from "./data";

interface Props {
  plugin: AnyPlugin;
  projectPath: string;
  /** Receives the refreshed list after a remove from the matrix. */
  onMutated: (list: InstalledPlugin[]) => void;
  /** Install a not-yet-installed (Discover) plugin at the chosen scope. */
  onInstall: (p: DiscoverPlugin, scope: PluginScope) => void;
  installing: boolean;
  alreadyInstalled: boolean;
}

export function PluginDetail({
  plugin,
  projectPath,
  onMutated,
  onInstall,
  installing,
  alreadyInstalled,
}: Props) {
  const isInstalled = isInstalledPlugin(plugin);
  const [scope, setScope] = useState<PluginScope>("user");
  // Codex catalog plugins are user-level OAuth connectors (no scope choice).
  const isCodex = !isInstalled && (plugin as DiscoverPlugin).store === "codex";

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
          <PluginGlyph id={plugin.glyph} size={22} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="truncate font-mono text-[14.5px] font-medium tracking-tight">
              {plugin.name}
            </h2>
            {isInstalled && (
              <span className="shrink-0 text-[11px] text-foreground/45">
                v{plugin.version}
              </span>
            )}
            <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-wider text-foreground/40">
              {plugin.source}
            </span>
          </div>

          <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground/65">
            {plugin.description}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!isInstalled && (
              <span className="flex items-center gap-2 text-[11px] text-foreground/45">
                <DownloadGlyph />
                {formatInstalls(plugin.installs)} installs
              </span>
            )}
            <ViewSource source={plugin.source} />
          </div>
        </div>
      </section>

      <Divider />

      {/* What's inside — only when known. Marketplace (Discover) entries carry
          no component inventory; it's scanned once the plugin is installed. */}
      {plugin.components.length > 0 && (
        <Section title="What's inside">
          <PluginComponents components={plugin.components} />
        </Section>
      )}

      {/* README */}
      {plugin.readme && (
        <Section title="README">
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
            {plugin.readme}
          </pre>
        </Section>
      )}

      {/* Stores — Claude + Cursor share one; Codex has its own. Remove is
          native-delegated server-side. */}
      {isInstalled ? (
        <Section title="Installed for">
          <PluginStoreMatrix
            plugin={plugin}
            projectPath={projectPath}
            onMutated={onMutated}
          />
          <p className="mt-2 text-[10.5px] leading-relaxed text-foreground/40">
            No plugin format yet for {UNSUPPORTED_TARGETS.join(" · ")}.
          </p>
        </Section>
      ) : (
        <Section title="Install">
          <div className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11.5px] text-foreground/65">
                Adds to{" "}
                <span className="font-medium text-foreground/90">
                  {isCodex ? "Codex" : "Claude Code & Cursor"}
                </span>
              </span>
              {!isCodex && <ScopePicker value={scope} onChange={setScope} />}
            </div>
            <InstallButton
              installed={alreadyInstalled}
              installing={installing}
              onClick={() => onInstall(plugin as DiscoverPlugin, scope)}
            />
            <p className="text-[10.5px] leading-relaxed text-foreground/40">
              {isCodex
                ? "OpenAI connector — install may require auth; if it fails, finish in a terminal with codex plugin add."
                : `From a Claude marketplace. No plugin format for ${UNSUPPORTED_TARGETS.join(" · ")}.`}
            </p>
          </div>
        </Section>
      )}

      {/* Files — populated from the cached folder once installed. */}
      {plugin.files.length > 0 && (
        <Section title={`Files (${plugin.files.length})`}>
          <SkillFilesList files={plugin.files} />
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


function ScopePicker({
  value,
  onChange,
}: {
  value: PluginScope;
  onChange: (s: PluginScope) => void;
}) {
  return (
    <div className="flex gap-1">
      {PLUGIN_SCOPES.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onChange(s.id)}
          aria-pressed={value === s.id}
          title={s.hint}
          className={`
            rounded-md px-2 py-1 text-[10.5px] capitalize
            transition-[background-color,border-color,color] duration-150
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
            ${
              value === s.id
                ? "border border-white/[0.18] bg-white/[0.08] text-foreground"
                : "border border-white/[0.06] bg-white/[0.02] text-foreground/50 hover:border-white/[0.12] hover:text-foreground/80"
            }
          `}
        >
          {s.id}
        </button>
      ))}
    </div>
  );
}

function InstallButton({
  installed,
  installing,
  onClick,
}: {
  installed: boolean;
  installing: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={installed || installing}
      className="
        rounded-lg border border-white/[0.12] bg-white/[0.06]
        px-3 py-1.5 text-[11.5px] font-medium text-foreground
        transition-[background-color,border-color] duration-150
        hover:border-white/[0.22] hover:bg-white/[0.1]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        disabled:cursor-not-allowed disabled:opacity-50
        disabled:hover:border-white/[0.12] disabled:hover:bg-white/[0.06]
      "
    >
      {installing ? "Installing…" : installed ? "Installed" : "Install"}
    </button>
  );
}

function DownloadGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M6 11l6 6 6-6M5 21h14" />
    </svg>
  );
}
