import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../../ui/Modal";
import { RoleCard } from "./RoleCard";
import { RoleDetail } from "./RoleDetail";
import { AddCustomForm } from "./AddCustomForm";
import { fetchTeamRoles, saveTeamRoles, syncTeamRoles, uninstallTeamRole } from "./api";
import { findRoleById, type Role } from "./data";
import { bucketsForAgents, type SkillBucket } from "@shared/types";
import type { AgentId } from "../../welcome/data";

type Tab = "roles" | "custom";

interface Props {
  open: boolean;
  onClose: () => void;
  projectPath: string;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function TeamModal({ open, onClose, projectPath }: Props) {
  const [tab, setTab] = useState<Tab>("roles");
  const [query, setQuery] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Per role id → buckets its skill is installed in on disk (drives Apply diffs).
  const [installed, setInstalled] = useState<Record<string, SkillBucket[]>>({});

  // Load the project's roles + install state whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetchTeamRoles(projectPath)
      .then((r) => {
        if (!alive) return;
        setRoles(r.roles);
        setInstalled(r.installed);
      })
      .catch((e) => alive && setError(errMsg(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, projectPath]);

  const selected = selectedId ? findRoleById(roles, selectedId) : null;
  const enabledCount = useMemo(() => roles.filter((r) => r.enabled).length, [roles]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return roles;
    return roles.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle),
    );
  }, [roles, query]);

  // Latest roles, readable synchronously between renders so rapid successive
  // edits build off each other instead of a stale render closure.
  const rolesRef = useRef<Role[]>(roles);
  rolesRef.current = roles;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edits update the UI immediately and persist to config on a short debounce
  // (so typing in a field doesn't fire a write per keystroke); Apply (per role,
  // under the leads picker) installs the skills. Clearing error gives each edit
  // a fresh attempt.
  const persist = (next: Role[]) => {
    rolesRef.current = next;
    setRoles(next);
    setError(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      saveTeamRoles(projectPath, rolesRef.current).catch((e) => setError(errMsg(e)));
    }, 400);
  };

  const updateRole = (id: string, patch: Partial<Role>) =>
    persist(rolesRef.current.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Delete drops the role from config AND removes its skill from disk. The
  // uninstall is scoped to this id (it doesn't reconcile the other roles), and
  // is config-independent, so it still works once the role is gone from config.
  const deleteRole = (id: string) => {
    persist(rolesRef.current.filter((r) => r.id !== id));
    setSelectedId(null);
    setInstalled((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    uninstallTeamRole(projectPath, id).catch((e) => setError(errMsg(e)));
  };

  const handleCreate = (newRole: Omit<Role, "id" | "isCustom">) => {
    persist([
      ...rolesRef.current,
      { ...newRole, id: `custom-${crypto.randomUUID().slice(0, 8)}`, isCustom: true },
    ]);
    setTab("roles");
  };

  // Apply ONE role (the leads-picker button): flush the config, install/remove
  // its skill, then mark its installed buckets = its desired set.
  const handleApply = async (roleId: string) => {
    setSyncing(true);
    setError(null);
    try {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      await saveTeamRoles(projectPath, rolesRef.current);
      await syncTeamRoles(projectPath, roleId);
      const role = rolesRef.current.find((r) => r.id === roleId);
      const buckets = role?.enabled ? bucketsForAgents(role.enabledForLeads) : [];
      setInstalled((prev) => ({ ...prev, [roleId]: buckets }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSyncing(false);
    }
  };

  const handleClose = () => {
    // Flush a pending debounced save so closing doesn't lose the last edit.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      saveTeamRoles(projectPath, rolesRef.current).catch((e) => setError(errMsg(e)));
    }
    onClose();
    setTimeout(() => setSelectedId(null), 200);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="xl"
      title={
        selected ? (
          <DetailTitle name={selected.name} onBack={() => setSelectedId(null)} />
        ) : (
          <ListTitle />
        )
      }
    >
      {selected ? (
        <div className="max-h-[60vh] min-h-[440px] overflow-y-auto pr-1">
          <RoleDetail
            role={selected}
            onPatch={(patch) => updateRole(selected.id, patch)}
            onDelete={
              selected.isCustom ? () => deleteRole(selected.id) : undefined
            }
            onApply={() => handleApply(selected.id)}
            applying={syncing}
            applyError={error}
            installedBuckets={installed[selected.id] ?? []}
          />
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <SegmentedTabs
              value={tab}
              enabledCount={enabledCount}
              totalCount={roles.length}
              onChange={(next) => {
                setTab(next);
                setQuery("");
              }}
            />
            {tab === "roles" && (
              <div className="ml-auto flex min-w-0 max-w-[260px] flex-1 items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-1.5">
                <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground/40">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search roles…"
                  className="
                    min-w-0 flex-1 bg-transparent
                    text-[12px] text-foreground
                    placeholder:text-foreground/30
                    outline-none
                  "
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="
                      shrink-0 text-foreground/40
                      hover:text-foreground/80
                      transition-colors
                    "
                  >
                    <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                      <path d="M6 6l12 12M6 18L18 6" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="max-h-[52vh] min-h-[420px] overflow-y-auto pr-1">
            {tab === "roles" &&
              (loading ? (
                <div className="py-12 text-center text-[12px] text-foreground/40">
                  Loading roles…
                </div>
              ) : (
                <RolesList
                  items={filtered}
                  query={query}
                  onSelect={setSelectedId}
                  onToggle={(id, enabled) => updateRole(id, { enabled })}
                  onHandlerChange={(id, handlerAgent) => updateRole(id, { handlerAgent })}
                  onAddCustom={() => setTab("custom")}
                />
              ))}
            {tab === "custom" && <AddCustomForm onCreate={handleCreate} />}
          </div>
        </>
      )}
    </Modal>
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
          <circle cx="9" cy="8" r="3" />
          <circle cx="16" cy="9" r="2.5" />
          <path d="M3 19a6 6 0 0112 0" />
          <path d="M14 19a5 5 0 017-3" />
        </svg>
      </span>
      <span>AI Team</span>
    </span>
  );
}

function DetailTitle({
  name,
  onBack,
}: {
  name: string;
  onBack: () => void;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="
          flex items-center gap-1.5 rounded-md
          px-1.5 py-1 text-foreground/65
          hover:bg-white/[0.06] hover:text-foreground
          transition-colors
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        "
        aria-label="Back to AI Team list"
      >
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        <span>AI Team</span>
      </button>
      <span aria-hidden className="text-foreground/25">/</span>
      <span className="truncate text-[12.5px] text-foreground/85">{name}</span>
    </span>
  );
}

function SegmentedTabs({
  value,
  enabledCount,
  totalCount,
  onChange,
}: {
  value: Tab;
  enabledCount: number;
  totalCount: number;
  onChange: (next: Tab) => void;
}) {
  const tabs: Array<{ id: Tab; label: string; badge?: string }> = [
    { id: "roles", label: "Roles", badge: `${enabledCount} / ${totalCount}` },
    { id: "custom", label: "Add custom" },
  ];
  const activeIndex = tabs.findIndex((t) => t.id === value);

  return (
    <div className="relative flex h-8 shrink-0 items-center rounded-xl bg-white/[0.025] p-0.5">
      <span
        aria-hidden
        className="
          absolute inset-y-0.5 rounded-lg
          bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]
          transition-[transform,width] duration-250 ease-[cubic-bezier(0.2,0.7,0.2,1)]
        "
        style={{
          left: 2,
          width: `calc((100% - 4px) / ${tabs.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`
            relative z-[1] flex h-full items-center gap-1.5 rounded-lg px-3
            text-[12px] tracking-tight
            transition-colors duration-200
            ${value === t.id ? "text-foreground" : "text-foreground/55 hover:text-foreground/85"}
          `}
        >
          <span>{t.label}</span>
          {t.badge && (
            <span
              className={`
                shrink-0 rounded-full px-1.5 py-px text-[10px] tabular-nums
                ${value === t.id ? "bg-white/[0.12] text-foreground/80" : "bg-white/[0.05] text-foreground/45"}
              `}
            >
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function RolesList({
  items,
  query,
  onSelect,
  onToggle,
  onHandlerChange,
  onAddCustom,
}: {
  items: Role[];
  query: string;
  onSelect: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onHandlerChange: (id: string, agent: AgentId) => void;
  onAddCustom: () => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title={query ? "No roles match." : "No roles defined."}
        body={
          query
            ? "Try different keywords or clear the search."
            : "Add a custom role to get started."
        }
        cta={query ? undefined : { label: "Add custom role", onClick: onAddCustom }}
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((r) => (
        <li key={r.id}>
          <RoleCard
            role={r}
            onToggle={(enabled) => onToggle(r.id, enabled)}
            onHandlerChange={(next) => onHandlerChange(r.id, next)}
            onSelect={() => onSelect(r.id)}
          />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div
        className="
          flex size-10 items-center justify-center rounded-2xl
          border border-white/[0.08] bg-white/[0.03]
          text-foreground/40
        "
      >
        <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="8" r="3" />
          <circle cx="16" cy="9" r="2.5" />
          <path d="M3 19a6 6 0 0112 0" />
          <path d="M14 19a5 5 0 017-3" />
        </svg>
      </div>
      <p className="text-sm font-medium text-foreground/85">{title}</p>
      <p className="max-w-[320px] text-[11.5px] text-foreground/45">{body}</p>
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          className="
            mt-2 rounded-lg
            border border-white/[0.1] bg-white/[0.04]
            px-3 py-1.5 text-[11.5px] text-foreground/85
            hover:border-white/[0.2] hover:bg-white/[0.07]
            transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30
          "
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}
