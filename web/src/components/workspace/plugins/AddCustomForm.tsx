import { useState } from "react";
import { AGENTS, type AgentId } from "../../welcome/data";
import { AgentIcon } from "../../icons/AgentIcon";
import { installPlugin } from "./api";
import { PLUGIN_SCOPES, PLUGIN_STORES, type PluginScope, type PluginStore } from "./data";

function agentColor(id: AgentId): string {
  return AGENTS.find((a) => a.id === id)?.color ?? "var(--color-claude)";
}

interface Props {
  projectPath: string;
  /** Called once the install settles. `ok` is false on failure so the modal can
   *  still refresh — a partial multi-store install leaves real changes on disk. */
  onDone: (ok: boolean) => void;
}

/**
 * "Add custom" form — installs a plugin from a GitHub repo or local path via
 * the bundled `plugins` CLI. Targets are the two stores (Claude+Cursor / Codex),
 * not individual agents, because Claude and Cursor share one store.
 */
export function AddCustomForm({ projectPath, onDone }: Props) {
  const [source, setSource] = useState("");
  const [stores, setStores] = useState<Set<PluginStore>>(
    new Set<PluginStore>(["claude"]),
  );
  const [scope, setScope] = useState<PluginScope>("project");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleStore = (s: PluginStore) =>
    setStores((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await installPlugin({ projectPath, source: source.trim(), scope, stores: [...stores] });
      onDone(true);
    } catch (err) {
      setError((err as Error).message);
      onDone(false); // refresh anyway — a partial install changed real state
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = source.trim().length > 0 && stores.size > 0;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Field
        label="Source"
        hint="GitHub owner/repo, full URL, SSH URL, or absolute local path."
      >
        <input
          type="text"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="owner/my-plugin  ·  or  ·  ~/my-plugin"
          className="
            w-full rounded-xl
            border border-white/[0.08] bg-white/[0.03]
            px-3.5 py-2.5
            font-mono text-[12.5px] text-foreground
            placeholder:text-foreground/30
            outline-none
            transition-[border-color,background-color,box-shadow] duration-150
            focus:border-white/[0.2] focus:bg-white/[0.05]
            focus:shadow-[0_0_0_4px_rgba(255,255,255,0.03)]
          "
        />
        <p className="mt-1 text-[10.5px] text-foreground/35">
          Installs every plugin found at the source.
        </p>
      </Field>

      <Field
        label="Install into"
        hint="Claude Code and Cursor share one plugin store; Codex has its own."
      >
        <div className="flex flex-wrap gap-1.5">
          {PLUGIN_STORES.map((opt) => {
            const on = stores.has(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggleStore(opt.id)}
                aria-pressed={on}
                className={`
                  flex items-center gap-1.5 rounded-full
                  px-2.5 py-1 text-[11.5px]
                  transition-[background-color,border-color,color] duration-150
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                  ${
                    on
                      ? "border border-[color:var(--target)]/40 bg-[color:var(--target)]/12 text-foreground"
                      : "border border-white/[0.08] bg-white/[0.02] text-foreground/55 hover:border-white/[0.16] hover:bg-white/[0.04] hover:text-foreground/85"
                  }
                `}
                style={{ "--target": agentColor(opt.agents[0]!) } as React.CSSProperties}
              >
                <span className="flex shrink-0 items-center -space-x-1">
                  {opt.agents.map((a) => (
                    <AgentIcon key={a} id={a} size={11} className="opacity-90" />
                  ))}
                </span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Scope" hint="Where the install is recorded.">
        <div className="flex flex-wrap gap-1.5">
          {PLUGIN_SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScope(s.id)}
              aria-pressed={scope === s.id}
              title={s.hint}
              className={`
                flex items-baseline gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px]
                transition-[background-color,border-color,color] duration-150
                focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                ${
                  scope === s.id
                    ? "border border-white/[0.18] bg-white/[0.08] text-foreground"
                    : "border border-white/[0.06] bg-white/[0.02] text-foreground/55 hover:border-white/[0.12] hover:text-foreground/85"
                }
              `}
            >
              <span className="capitalize">{s.id}</span>
              <span className="text-[9.5px] text-foreground/40">{s.hint}</span>
            </button>
          ))}
        </div>
        {stores.has("antigravity") && (
          <p className="mt-1.5 text-[10.5px] text-foreground/40">
            Antigravity installs into the workspace (<code className="font-mono">.agents/plugins/</code>);
            scope doesn’t apply to it.
          </p>
        )}
      </Field>

      {error && (
        <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-200">
          {error}
        </p>
      )}

      <div className="mt-1 flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="
            rounded-lg
            border border-white/[0.12] bg-white/[0.06]
            px-4 py-2 text-[12px] font-medium text-foreground
            transition-[background-color,border-color] duration-150
            hover:border-white/[0.22] hover:bg-white/[0.1]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
            disabled:cursor-not-allowed disabled:opacity-50
            disabled:hover:border-white/[0.12] disabled:hover:bg-white/[0.06]
          "
        >
          {submitting ? "Installing…" : "Install plugin"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-foreground/55">
          {label}
        </label>
        {hint && <span className="text-[10.5px] text-foreground/35">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
