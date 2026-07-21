/**
 * "Configure dev server" — edits a project's `.clidable/launch.json`
 * (command · port · url). Every field is optional; a blank field shows the
 * auto-detected default as a placeholder and falls back to it. The URL field is
 * how a remote/Tailscale deployment points the preview at the reachable host.
 */
import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import {
  getLaunchConfig,
  saveLaunchConfig,
  type LaunchConfig,
  type LaunchConfigResponse,
} from "../../lib/launch-config-client";

interface Props {
  open: boolean;
  projectPath: string | null;
  projectName?: string;
  onClose: () => void;
  /** Called after a successful save with the persisted overrides. */
  onSaved: (config: LaunchConfig) => void;
}

export function LaunchConfigModal({
  open,
  projectPath,
  projectName,
  onClose,
  onSaved,
}: Props) {
  const [data, setData] = useState<LaunchConfigResponse | null>(null);
  const [command, setCommand] = useState("");
  const [port, setPort] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the saved overrides + detected defaults each time the modal opens.
  useEffect(() => {
    if (!open || !projectPath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    getLaunchConfig(projectPath)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setCommand(res.config.command ?? "");
        setPort(res.config.port != null ? String(res.config.port) : "");
        setUrl(res.config.url ?? "");
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, projectPath]);

  const detected = data?.detected;
  const portNum = port.trim() ? Number(port) : null;
  const portInvalid =
    portNum !== null && (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535);
  // Warn when the local bind Port and the Preview URL's port disagree: the
  // server comes up on Port but the preview loads the URL's port, so unless a
  // proxy maps one to the other, the preview stays blank.
  const urlPort = parseUrlPort(url);
  const portMismatch =
    portNum !== null && !portInvalid && urlPort !== null && urlPort !== portNum;

  const save = async () => {
    if (!projectPath || portInvalid) return;
    const next: LaunchConfig = {};
    if (command.trim()) next.command = command.trim();
    if (portNum !== null && !portInvalid) next.port = portNum;
    if (url.trim()) next.url = url.trim();
    setSaving(true);
    setError(null);
    try {
      await saveLaunchConfig(projectPath, next);
      onSaved(next);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" title="Configure dev server">
      <p className="mb-4 text-[12px] leading-relaxed text-foreground/55">
        How Clidable runs {projectName ? <span className="text-foreground/80">{projectName}</span> : "this project"}.
        Leave a field blank to use the auto-detected default.
      </p>

      {loading ? (
        <div className="py-6 text-center text-[12px] text-foreground/45">Loading…</div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field
            label="Command"
            hint="The shell command that starts the dev server."
            placeholder={detected?.command || "e.g. npm run dev"}
            value={command}
            onChange={setCommand}
            mono
          />
          <Field
            label="Local port"
            hint="The port the dev server binds to on this machine (exported as $PORT). Blank → the Preview URL's port, else the detected default."
            placeholder={detected ? String(detected.port) : "3000"}
            value={port}
            onChange={setPort}
            mono
            error={portInvalid ? "Enter a port between 1 and 65535." : undefined}
          />
          <Field
            label="Preview URL"
            hint="What the browser loads. Blank → http://localhost:<port>. Set a reachable host (e.g. a Tailscale name) when Clidable runs on a remote server; its port can differ from the local port only if a proxy maps them."
            placeholder={detected?.url || (port ? `http://localhost:${port}` : "http://localhost:3000")}
            value={url}
            onChange={setUrl}
            mono
          />

          {portMismatch && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-300/90">
              Local port is <span className="font-mono">{portNum}</span> but the Preview
              URL points at <span className="font-mono">:{urlPort}</span>. The server binds{" "}
              <span className="font-mono">{portNum}</span> and the preview loads{" "}
              <span className="font-mono">:{urlPort}</span> — clear Local port to bind the
              URL's port, or match them unless a proxy maps one to the other.
            </div>
          )}

          {detected && !detected.runnable && !command.trim() && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-300/90">
              No dev command was auto-detected for this project. Set a Command above
              so Run and auto-start know what to launch.
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.07] px-3 py-2 text-[11px] text-rose-300/90">
              {error}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-[12px] text-foreground/70 transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || loading || portInvalid || !projectPath}
          className="rounded-lg bg-white/10 px-3.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-white/20 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white/10"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

/** The **explicit** port in a URL, or null. Mirrors the server's portFromUrl so
 *  the warning reflects what the server would actually bind — a port-less URL
 *  (`https://box.ts.net`) is the ordinary proxy setup, not a conflict. */
function parseUrlPort(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.port ? Number(u.port) : null;
  } catch {
    return null;
  }
}

function Field({
  label,
  hint,
  placeholder,
  value,
  onChange,
  mono,
  error,
}: {
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  error?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-foreground/75">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className={`
          rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5
          text-[12px] text-foreground/90 placeholder:text-foreground/30
          focus:border-white/20 focus:outline-none
          ${mono ? "font-mono" : ""}
        `}
      />
      <span className={`text-[10.5px] leading-snug ${error ? "text-rose-300/90" : "text-foreground/40"}`}>
        {error ?? hint}
      </span>
    </label>
  );
}
