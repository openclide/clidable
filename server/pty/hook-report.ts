/**
 * Where spawned agents' hooks report back to. The server sets the port on boot
 * (`setReportPort`); Session injects `hookReportUrl()` into each agent's env as
 * CLIDABLE_REPORT_URL. Always loopback — the hook runs on this machine, so it
 * reaches the server at 127.0.0.1 regardless of the bind address (--allow-lan).
 */
let reportPort = 7878;

export function setReportPort(port: number): void {
  reportPort = port;
}

export function hookReportUrl(): string {
  return `http://127.0.0.1:${reportPort}/api/agent-hook`;
}
