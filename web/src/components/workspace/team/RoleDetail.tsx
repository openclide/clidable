import type { ReactNode } from "react";
import { RoleGlyph } from "./RoleGlyph";
import { RoleToggle } from "./RoleToggle";
import { HandlerPicker } from "./HandlerPicker";
import { LeadAgentCheckboxes } from "./LeadAgentCheckboxes";
import { AGENTS } from "../../welcome/data";
import { bucketsForAgents, type SkillBucket } from "@shared/types";
import { leadInstallPath, type Role } from "./data";

interface Props {
  role: Role;
  /** Patch one or more fields of this role (persisted by the parent). */
  onPatch: (patch: Partial<Role>) => void;
  onDelete?: () => void;
  /** Apply (install / remove) THIS role's skill — like the Skills matrix's
   *  per-skill Apply. Rendered right under the leads picker. */
  onApply?: () => void;
  applying?: boolean;
  applyError?: string | null;
  /** Buckets the role's skill is currently installed in (on disk). */
  installedBuckets?: SkillBucket[];
}

export function RoleDetail({
  role,
  onPatch,
  onDelete,
  onApply,
  applying,
  applyError,
  installedBuckets = [],
}: Props) {
  // Diff what's checked (desired = enabled role's lead buckets) against what's
  // installed on disk — drives the Apply button + subtext, exactly like Skills.
  const desired = role.enabled ? bucketsForAgents(role.enabledForLeads) : [];
  const desiredSet = new Set(desired);
  const installedSet = new Set(installedBuckets);
  const toInstall = desired.filter((b) => !installedSet.has(b));
  const toRemove = installedBuckets.filter((b) => !desiredSet.has(b));
  const changed = toInstall.length > 0 || toRemove.length > 0;
  const fresh = installedBuckets.length === 0;

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
          <RoleGlyph id={role.glyph} size={22} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {role.isCustom ? (
              <EditableInput
                value={role.name}
                onChange={(name) => onPatch({ name })}
                placeholder="Role name"
                className="min-w-0 flex-1 text-[15px] font-medium tracking-tight"
              />
            ) : (
              <h2 className="min-w-0 flex-1 truncate text-[15px] font-medium tracking-tight">
                {role.name}
              </h2>
            )}
            {role.isCustom && (
              <span className="shrink-0 rounded-md border border-white/[0.08] bg-white/[0.02] px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em] text-foreground/45">
                custom
              </span>
            )}
          </div>

          {role.isCustom ? (
            <EditableInput
              value={role.description}
              onChange={(description) => onPatch({ description })}
              placeholder="Short description"
              className="mt-1 w-full text-[12.5px] leading-relaxed text-foreground/65"
            />
          ) : (
            <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/65">
              {role.description}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2">
              <RoleToggle
                on={role.enabled}
                onChange={(enabled) => onPatch({ enabled })}
              />
              <span className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-foreground/65">
                {role.enabled ? "enabled" : "disabled"}
              </span>
            </span>

            {role.isCustom && onDelete && (
              <DangerButton onClick={onDelete}>
                <TrashGlyph />
                Delete role
              </DangerButton>
            )}
          </div>
        </div>
      </section>

      <Divider />

      <Section title="Triggers when">
        {role.isCustom ? (
          <EditableTextarea
            value={role.triggerHint}
            onChange={(triggerHint) => onPatch({ triggerHint })}
            rows={2}
            placeholder="Describe when the lead should hand off — include the role's name…"
            className="text-[12.5px] italic text-foreground/80"
          />
        ) : (
          <blockquote className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-[12.5px] italic text-foreground/70">
            “{role.triggerHint}”
          </blockquote>
        )}
      </Section>

      <Section title="Handler">
        <div
          className="
            flex flex-col overflow-hidden
            rounded-xl border border-white/[0.06] bg-white/[0.02]
          "
        >
          <ConfigRow label="Agent">
            <HandlerPicker
              value={role.handlerAgent}
              onChange={(handlerAgent) => onPatch({ handlerAgent })}
            />
          </ConfigRow>
        </div>
      </Section>

      <Section title={`Enabled for leads (${role.enabledForLeads.length} / ${AGENTS.length})`}>
        <LeadAgentCheckboxes
          selected={role.enabledForLeads}
          onChange={(enabledForLeads) => onPatch({ enabledForLeads })}
        />
        {onApply && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-[11px] text-foreground/45">
              {applyError ? (
                <span className="text-red-400/80">{applyError}</span>
              ) : (
                applyStatus({ enabled: role.enabled, changed, fresh, toInstall, toRemove, installedBuckets })
              )}
            </span>
            <button
              type="button"
              onClick={onApply}
              disabled={applying || !changed}
              className="
                shrink-0 rounded-lg border border-accent/40 bg-accent/15
                px-4 py-1.5 text-[11.5px] font-medium text-foreground
                transition-[background-color,border-color] duration-150
                hover:border-accent/60 hover:bg-accent/25
                disabled:cursor-not-allowed disabled:border-white/[0.08]
                disabled:bg-white/[0.03] disabled:text-foreground/40
                focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
              "
            >
              {applying ? "Applying…" : fresh && toInstall.length > 0 ? "Install" : "Apply changes"}
            </button>
          </div>
        )}
      </Section>

      <Section title="Prompt">
        {role.isCustom ? (
          <EditableTextarea
            value={role.promptTemplate}
            onChange={(promptTemplate) => onPatch({ promptTemplate })}
            rows={6}
            placeholder="The persona / instructions written into the teammate's prompt…"
            className="font-mono text-[11.5px] leading-[1.65] text-foreground/80"
          />
        ) : (
          <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3 font-mono text-[11.5px] leading-[1.65] text-foreground/75">
            {role.promptTemplate}
          </pre>
        )}
      </Section>

      <Section title="Installs into">
        <div className="flex flex-col gap-2">
          <p className="text-[11.5px] text-foreground/50">
            When enabled and synced, Clidable writes this role's skill where each
            lead agent reads skills:
          </p>
          <ul className="flex flex-col gap-1">
            {[
              ...new Set(
                role.enabledForLeads
                  .map((leadId) => leadInstallPath(leadId, role.id))
                  .filter((p): p is string => p !== null),
              ),
            ].map((path) => (
              <li
                key={path}
                className="
                  flex items-center gap-2
                  rounded-lg border border-white/[0.05] bg-white/[0.015]
                  px-3 py-1.5
                "
              >
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/75">
                  {path}
                </code>
              </li>
            ))}
            {role.enabledForLeads.length === 0 && (
              <li className="text-[11.5px] text-foreground/40">
                No leads selected — this role won't be written anywhere.
              </li>
            )}
          </ul>
        </div>
      </Section>
    </div>
  );
}

/** Subtext under the leads picker, describing what Apply will do — mirrors the
 *  Skills manager's status logic. */
function applyStatus(d: {
  enabled: boolean;
  changed: boolean;
  fresh: boolean;
  toInstall: SkillBucket[];
  toRemove: SkillBucket[];
  installedBuckets: SkillBucket[];
}): string {
  const n = (k: number) => `${k} bucket${k === 1 ? "" : "s"}`;
  if (!d.enabled) {
    return d.installedBuckets.length
      ? `Role disabled — Apply removes it from ${n(d.installedBuckets.length)}.`
      : "Role disabled — enable it to install.";
  }
  if (d.changed) {
    if (d.toInstall.length && d.toRemove.length) {
      return `Apply: install ${n(d.toInstall.length)}, remove ${n(d.toRemove.length)}.`;
    }
    if (d.toInstall.length) return `Apply installs into ${n(d.toInstall.length)}.`;
    return `Apply removes from ${n(d.toRemove.length)}.`;
  }
  if (d.fresh) return "Not installed yet — Apply to install.";
  return `Up to date — installed in ${n(d.installedBuckets.length)}.`;
}

/* ------------------------------- editables ------------------------------- */

function EditableInput({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`
        -mx-1 rounded-md bg-transparent px-1 py-0.5 outline-none
        placeholder:text-foreground/25
        transition-colors duration-150
        hover:bg-white/[0.02]
        focus:bg-white/[0.04] focus:ring-1 focus:ring-white/15
        ${className}
      `}
    />
  );
}

function EditableTextarea({
  value,
  onChange,
  rows = 3,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className={`
        w-full resize-y rounded-xl
        border border-white/[0.06] bg-white/[0.025]
        px-4 py-3 outline-none
        placeholder:text-foreground/25 placeholder:not-italic
        transition-colors duration-150
        hover:border-white/[0.12]
        focus:border-white/20 focus:bg-white/[0.035]
        ${className}
      `}
    />
  );
}

/* -------------------------------- chrome --------------------------------- */

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

function ConfigRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.05] last:border-b-0">
      <div className="w-[88px] shrink-0 text-[10.5px] font-medium uppercase tracking-[0.12em] text-foreground/45">
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="h-px w-full bg-white/[0.05]" />;
}

function DangerButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        flex items-center gap-1.5 rounded-lg
        border border-rose-400/30 bg-rose-500/10
        px-3 py-1.5 text-[11.5px] font-medium text-rose-200
        transition-[background-color,border-color,color] duration-150
        hover:border-rose-400/55 hover:bg-rose-500/18 hover:text-rose-100
        focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50
      "
    >
      {children}
    </button>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14 M10 11v5 M14 11v5" />
    </svg>
  );
}
