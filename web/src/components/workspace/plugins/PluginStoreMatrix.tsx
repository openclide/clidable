import { useState } from "react";
import { AgentIcon } from "../../icons/AgentIcon";
import { removePlugin } from "./api";
import { PLUGIN_STORES, type InstalledPlugin, type PluginStore } from "./data";

interface Props {
  plugin: InstalledPlugin;
  projectPath: string;
  /** Receives the refreshed list after a remove. */
  onMutated: (list: InstalledPlugin[]) => void;
}

/**
 * Per-store presence + Remove for an installed plugin. Remove delegates to the
 * native CLIs server-side (`claude plugin uninstall`, `codex plugin remove`).
 * Cross-store "install here" isn't offered: `plugins add` installs from a
 * source (and would pull every plugin in a marketplace), so adds go through the
 * Add-custom / Discover flows instead.
 */
export function PluginStoreMatrix({ plugin, projectPath, onMutated }: Props) {
  const [busy, setBusy] = useState<PluginStore | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (store: PluginStore) => {
    if (busy) return;
    setBusy(store);
    setError(null);
    try {
      onMutated(await removePlugin({ projectPath, name: plugin.name, stores: [store] }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        {PLUGIN_STORES.map((s) => {
          const on = plugin.stores.includes(s.id);
          const isBusy = busy === s.id;
          return (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
            >
              <span className="flex shrink-0 items-center -space-x-1.5">
                {s.agents.map((a) => (
                  <span
                    key={a}
                    className="flex size-7 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.025]"
                  >
                    <AgentIcon id={a} size={13} className="opacity-90" />
                  </span>
                ))}
              </span>

              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium">{s.label}</div>
                <div className="text-[10.5px] uppercase tracking-wider text-foreground/40">
                  {on ? `installed · ${plugin.scope}` : "not installed"}
                </div>
              </div>

              {on && (
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  disabled={isBusy}
                  className="
                    shrink-0 rounded-lg border border-white/[0.08] bg-transparent
                    px-3 py-1 text-[11.5px] font-medium text-foreground/65
                    transition-[background-color,border-color,color] duration-150
                    hover:border-rose-400/30 hover:bg-rose-500/8 hover:text-rose-300
                    disabled:cursor-not-allowed disabled:opacity-50
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                  "
                >
                  {isBusy ? "Removing…" : "Remove"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-200">
          {error}
        </p>
      )}
    </div>
  );
}
