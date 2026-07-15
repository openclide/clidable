import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../../ui/Modal";
import { AgentIcon } from "../../icons/AgentIcon";
import { formatBytes } from "../skills/data";
import type { AgentId } from "../../welcome/data";
import type { ContextResponse, InstructionAgentInfo, TerminalAgentId } from "@shared/types";
import { fetchContext, fetchStarter, readInstructionFile, saveContext } from "./api";
import { groupByCoverage, type CoverageGroup } from "./data";

interface Props {
  open: boolean;
  onClose: () => void;
  projectPath: string;
}

type PointerState = "wired" | "edited" | "unset";
function pointerState(a: InstructionAgentInfo): PointerState {
  if (a.pointerOk) return "wired";
  if (a.hasOwnContent) return "edited";
  return "unset";
}

/**
 * Context modal — one canonical `AGENTS.md`. Most agents read it directly;
 * Claude gets a one-line `@import` pointer file (PLAN.md §4). Edit +
 * save AGENTS.md, create/repair pointers, and (for a holdout that already has
 * its own content) fold that content in before converting it to a pointer —
 * the only way its file gets replaced, so nothing is ever silently clobbered.
 */
export function ContextModal({ open, onClose, projectPath }: Props) {
  const [data, setData] = useState<ContextResponse | null>(null);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pointer-mutation intents, reset whenever fresh data lands.
  const [createSet, setCreateSet] = useState<Set<TerminalAgentId>>(new Set());
  const [convertSet, setConvertSet] = useState<Set<TerminalAgentId>>(new Set());
  const [folding, setFolding] = useState<TerminalAgentId | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Latest project path, so an in-flight async handler can detect that the
  // active project changed under it and drop its (now-stale) result.
  const projectRef = useRef(projectPath);

  /** Adopt a fresh scan: seed the editor + default every missing pointer to
   *  "create" (visible + uncheckable), with no pending conversions. */
  function applyData(res: ContextResponse) {
    setData(res);
    setBody(res.content);
    setCreateSet(
      new Set(
        res.agents
          .filter((a) => a.coverage === "pointer" && pointerState(a) === "unset")
          .map((a) => a.agent),
      ),
    );
    setConvertSet(new Set());
  }

  useEffect(() => {
    if (!open) return;
    projectRef.current = projectPath;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaveError(null);
    setJustSaved(false);
    fetchContext(projectPath)
      .then((res) => {
        if (!cancelled) applyData(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectPath]);

  function dirtied() {
    if (justSaved) setJustSaved(false);
    if (saveError) setSaveError(null);
  }

  function editBody(next: string) {
    dirtied();
    setBody(next);
  }

  function toggleCreate(agent: TerminalAgentId) {
    dirtied();
    setCreateSet((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  }

  async function foldAndConvert(a: InstructionAgentInfo) {
    if (!a.file || folding) return;
    dirtied();
    setFolding(a.agent);
    try {
      const legacy = await readInstructionFile(projectPath, a.file);
      if (projectPath !== projectRef.current) return; // project switched mid-flight
      setBody((prev) =>
        prev.trim() ? `${legacy.trimEnd()}\n\n${prev}` : `${legacy.trimEnd()}\n`,
      );
      setConvertSet((prev) => new Set(prev).add(a.agent));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setFolding(null);
    }
  }

  async function generateStarter() {
    if (generating) return;
    dirtied();
    setGenerating(true);
    try {
      const starter = await fetchStarter(projectPath);
      if (projectPath !== projectRef.current) return; // project switched mid-flight
      setBody(starter);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!data) return;
    const wired = data.agents
      .filter((a) => a.coverage === "pointer" && pointerState(a) === "wired")
      .map((a) => a.agent);
    const pointers = [...new Set<TerminalAgentId>([...wired, ...createSet])];
    setSaving(true);
    setSaveError(null);
    try {
      const res = await saveContext({
        projectPath,
        content: body,
        pointers,
        convert: [...convertSet],
      });
      if (projectPath !== projectRef.current) return; // project switched mid-flight
      applyData(res);
      setJustSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const groups = data ? groupByCoverage(data.agents) : [];
  const { lines, bytes } = useMemo(
    () => ({
      lines: body.split("\n").length,
      bytes: new TextEncoder().encode(body).length,
    }),
    [body],
  );

  const bodyChanged = !!data && body !== data.content;
  const pendingPointers = createSet.size > 0 || convertSet.size > 0;
  const canSave =
    !!data && body.trim().length > 0 && (bodyChanged || pendingPointers) && !saving;

  return (
    <Modal open={open} onClose={onClose} size="xl" title={<ListTitle />}>
      <div className="max-h-[68vh] min-h-[480px] overflow-y-auto pr-1">
        <div className="flex flex-col gap-5">
          <header className="flex flex-col gap-1">
            <h3 className="text-[13px] font-medium tracking-tight text-foreground">
              Project instructions
            </h3>
            <p className="text-[11.5px] text-foreground/55">
              One canonical{" "}
              <code className="font-mono text-foreground/75">AGENTS.md</code>.
              Most agents read it directly; Claude gets a one-line import
              pointer to it.
            </p>
          </header>

          {error ? (
            <ErrorBox message={error} />
          ) : loading && !data ? (
            <p className="py-10 text-center text-[12px] text-foreground/45">
              Loading…
            </p>
          ) : (
            <>
              {data && !data.exists && body.trim() === "" && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-white/[0.1] bg-white/[0.015] px-4 py-3">
                  <p className="text-[11.5px] text-foreground/55">
                    No <code className="font-mono text-foreground/75">AGENTS.md</code> yet.
                    Generate a starter from this project, or write your own below.
                  </p>
                  <button
                    type="button"
                    onClick={generateStarter}
                    disabled={generating}
                    className="
                      shrink-0 rounded-lg border border-white/[0.12] bg-white/[0.05]
                      px-3 py-1.5 text-[11.5px] font-medium text-foreground/85
                      transition-[background-color,border-color] duration-150
                      hover:border-white/[0.2] hover:bg-white/[0.09] hover:text-foreground
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                      disabled:cursor-not-allowed disabled:opacity-50
                    "
                  >
                    {generating ? "Generating…" : "Generate starter"}
                  </button>
                </div>
              )}

              <div className="relative">
                <textarea
                  value={body}
                  onChange={(e) => editBody(e.target.value)}
                  rows={18}
                  spellCheck={false}
                  placeholder={
                    data?.exists
                      ? ""
                      : "No AGENTS.md yet — write your project instructions here."
                  }
                  className="
                    w-full resize-y rounded-xl
                    border border-white/[0.08] bg-white/[0.02]
                    px-4 py-3.5
                    font-mono text-[11.5px] leading-[1.7] text-foreground/90
                    placeholder:text-foreground/25
                    outline-none
                    focus:border-white/[0.18] focus:bg-white/[0.035]
                    focus:shadow-[0_0_0_4px_rgba(255,255,255,0.025)]
                    transition-[border-color,background-color,box-shadow] duration-150
                  "
                />
                <div className="mt-1.5 flex items-center justify-between gap-3 text-[10.5px] tabular-nums text-foreground/35">
                  <span className="font-mono tracking-tight">
                    {data?.exists ? "AGENTS.md" : "AGENTS.md (new)"}
                  </span>
                  <span className="flex items-center gap-3">
                    <span>{lines} lines</span>
                    <span aria-hidden>·</span>
                    <span>{formatBytes(bytes)}</span>
                  </span>
                </div>
              </div>

              <section>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h4 className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-foreground/45">
                    Coverage
                  </h4>
                  <span className="text-[10.5px] text-foreground/35">
                    {data?.agents.length ?? 0} agents
                  </span>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {groups.map((g) => (
                    <CoverageRow
                      key={g.coverage}
                      group={g}
                      createSet={createSet}
                      convertSet={convertSet}
                      folding={folding}
                      onToggleCreate={toggleCreate}
                      onFold={foldAndConvert}
                    />
                  ))}
                </ul>
              </section>

              <SaveBar
                createCount={createSet.size}
                convertCount={convertSet.size}
                canSave={canSave}
                saving={saving}
                saveError={saveError}
                justSaved={justSaved}
                onSave={handleSave}
              />
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface RowProps {
  group: CoverageGroup;
  createSet: Set<TerminalAgentId>;
  convertSet: Set<TerminalAgentId>;
  folding: TerminalAgentId | null;
  onToggleCreate: (agent: TerminalAgentId) => void;
  onFold: (a: InstructionAgentInfo) => void;
}

function CoverageRow(props: RowProps) {
  const { group } = props;
  const interactive = group.coverage === "pointer";
  return (
    <li
      className="
        flex flex-col gap-2 rounded-lg border border-white/[0.05] bg-white/[0.015]
        px-3 py-2
        sm:flex-row sm:items-center sm:gap-3
      "
    >
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-medium text-foreground/85">
          {group.label}
        </div>
        <div className="mt-0.5 text-[10.5px] text-foreground/40">{group.hint}</div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
        {interactive
          ? group.agents.map((a) => (
              <PointerControl
                key={a.agent}
                info={a}
                checked={props.createSet.has(a.agent)}
                converting={props.convertSet.has(a.agent)}
                folding={props.folding === a.agent}
                onToggleCreate={() => props.onToggleCreate(a.agent)}
                onFold={() => props.onFold(a)}
              />
            ))
          : group.agents.map((a) => <AgentChip key={a.agent} info={a} />)}
      </div>
    </li>
  );
}

/** A plain icon chip (native readers, and the not-auto-loaded agents). */
function AgentChip({ info }: { info: InstructionAgentInfo }) {
  return (
    <span
      className="flex size-6 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.025]"
      title={info.agent}
    >
      <AgentIcon id={info.agent as AgentId} size={12} className="opacity-90" />
    </span>
  );
}

/** A holdout's control: shows its state and the action to wire it. */
function PointerControl(props: {
  info: InstructionAgentInfo;
  checked: boolean;
  converting: boolean;
  folding: boolean;
  onToggleCreate: () => void;
  onFold: () => void;
}) {
  const { info } = props;
  const state = pointerState(info);
  const icon = (
    <AgentIcon id={info.agent as AgentId} size={12} className="opacity-90" />
  );
  const shell =
    "flex items-center gap-1.5 rounded-full border py-0.5 pl-1.5 pr-2 text-[10px]";

  if (state === "wired") {
    return (
      <span
        className={`${shell} border-emerald-400/25 bg-emerald-500/10 text-emerald-300/80`}
        title={`${info.file} imports AGENTS.md`}
      >
        {icon}
        wired
      </span>
    );
  }

  if (state === "edited") {
    if (props.converting) {
      return (
        <span
          className={`${shell} border-sky-400/25 bg-sky-500/10 text-sky-300/85`}
          title={`${info.file} content folded into AGENTS.md — Save replaces it with a pointer`}
        >
          {icon}
          will convert
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={props.onFold}
        disabled={props.folding}
        className={`${shell} border-amber-400/25 bg-amber-500/10 text-amber-200/85 transition-colors hover:bg-amber-500/15 disabled:opacity-50`}
        title={`${info.file} has its own content — fold it into AGENTS.md, then convert to a pointer`}
      >
        {icon}
        {props.folding ? "folding…" : "edited · fold in"}
      </button>
    );
  }

  // unset → create-on-save checkbox
  return (
    <label
      className={`${shell} cursor-pointer border-white/[0.1] bg-white/[0.03] text-foreground/65 transition-colors hover:bg-white/[0.06]`}
      title={`Create ${info.file} pointing at AGENTS.md`}
    >
      <input
        type="checkbox"
        checked={props.checked}
        onChange={props.onToggleCreate}
        className="size-3 accent-foreground/70"
      />
      {icon}
      pointer
    </label>
  );
}

function SaveBar(props: {
  createCount: number;
  convertCount: number;
  canSave: boolean;
  saving: boolean;
  saveError: string | null;
  justSaved: boolean;
  onSave: () => void;
}) {
  const parts = ["Writes AGENTS.md"];
  if (props.createCount > 0)
    parts.push(
      `creates ${props.createCount} pointer${props.createCount > 1 ? "s" : ""}`,
    );
  if (props.convertCount > 0) parts.push(`converts ${props.convertCount}`);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
      <span className="text-[10.5px] text-foreground/40">{parts.join(" · ")}</span>
      <div className="flex items-center gap-3">
        {props.saveError ? (
          <span className="text-[11px] text-red-300/85">{props.saveError}</span>
        ) : props.justSaved ? (
          <span className="text-[11px] text-emerald-300/80">Saved</span>
        ) : null}
        <button
          type="button"
          onClick={props.onSave}
          disabled={!props.canSave}
          className="
            rounded-lg border border-white/[0.12] bg-white/[0.06]
            px-4 py-1.5 text-[12px] font-medium text-foreground/90
            transition-[background-color,border-color] duration-150
            hover:border-white/[0.2] hover:bg-white/[0.1] hover:text-foreground
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
            disabled:cursor-not-allowed disabled:opacity-40
            disabled:hover:border-white/[0.12] disabled:hover:bg-white/[0.06]
          "
        >
          {props.saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-[11.5px] text-red-200/90">
      {message}
    </div>
  );
}

function ListTitle() {
  return (
    <span className="flex items-center gap-2">
      <span
        className="
          flex size-6 items-center justify-center rounded-lg
          border border-white/[0.08] bg-white/[0.04]
          text-foreground/75
        "
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h4" />
        </svg>
      </span>
      <span>Context</span>
    </span>
  );
}
