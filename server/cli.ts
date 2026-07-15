/**
 * CLI flag parsing for the Bun server.
 *
 * Clidable is LOCALHOST-ONLY for now:
 *   clidable-server --port 7878 --bind 127.0.0.1   (loopback; the default)
 *
 * Remote/multi-user server mode (--auth, --tls, non-loopback bind) is NOT
 * implemented — request-time auth and TLS don't exist yet — so the server
 * REFUSES to start with any of them rather than boot an unauthenticated,
 * network-exposed PTY-spawner (RCE). The `--auth`/`--tls`/`--token` fields
 * remain on ServerConfig as the seam for that future work (see PLAN.md §12).
 */
import { isLoopbackHost } from "./net/ssrf";

export interface ServerConfig {
  port: number;
  bind: string;
  token: string | null;
  auth: "none" | "token" | "oauth";
  tls: string | null;
  dev: boolean;
}

function arg(flag: string, fallback?: string): string | undefined {
  const i = Bun.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = Bun.argv[i + 1];
  return v ?? fallback;
}

function hasFlag(flag: string): boolean {
  return Bun.argv.includes(flag);
}

export function parseConfig(): ServerConfig {
  const port = Number(
    arg("--port") ?? process.env.CLIDABLE_PORT ?? "7878",
  );
  const bind = arg("--bind") ?? process.env.CLIDABLE_BIND ?? "127.0.0.1";
  const token = arg("--token") ?? process.env.CLIDABLE_TOKEN ?? null;
  const auth = (arg("--auth") ?? "none") as ServerConfig["auth"];
  const tls = arg("--tls") ?? null;
  const dev = hasFlag("--dev") || process.env.NODE_ENV !== "production";

  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`invalid --port: ${port}`);
  }

  // Localhost-only: refuse ANY non-loopback bind. Checked against the same
  // predicate the per-request Host guard uses, so `--bind ::`, a LAN IP, or a
  // hostname can't slip past a literal "0.0.0.0" comparison — all of which
  // would expose unauthenticated PTY spawning (RCE) to the network.
  if (!isLoopbackHost(bind)) {
    throw new Error(
      `refusing to start: Clidable is localhost-only — \`--bind ${bind}\` would ` +
        "expose unauthenticated remote code execution (PTY spawn) to the network. " +
        "Bind a loopback address (127.0.0.1, the default); for remote access, put " +
        "Clidable behind a VPN or authenticating reverse proxy you control.",
    );
  }

  // --auth / --tls are parsed (the seam for future server mode) but NOT
  // implemented — accepting them would be false assurance. Refuse rather than
  // silently ignore, so nobody deploys believing they're protected.
  if (auth !== "none" || tls !== null) {
    throw new Error(
      "refusing to start: --auth / --tls are not implemented yet — Clidable is " +
        "localhost-only. Remove them and bind a loopback address.",
    );
  }

  return { port, bind, token, auth, tls, dev };
}
