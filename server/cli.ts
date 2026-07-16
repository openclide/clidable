/**
 * CLI flag parsing for the Bun server.
 *
 * Clidable is LOCALHOST-ONLY by default:
 *   clidable-server --port 7878 --bind 127.0.0.1   (loopback; the default)
 *
 * A non-loopback bind exposes an unauthenticated PTY-spawner (RCE) to the
 * network, so it is refused UNLESS the user explicitly opts in with
 * `--allow-lan` (or CLIDABLE_ALLOW_LAN=1) — an informed "I control this
 * network" choice, accompanied by a loud startup warning (see server/index.ts).
 *
 * `--auth`/`--tls` are a different case: they are NOT implemented (no
 * request-time auth or TLS exists yet), so the server refuses them outright —
 * accepting them would be *false* assurance. They stay on ServerConfig as the
 * seam for that future work (see PLAN.md §12); real auth is what makes a public
 * bind genuinely safe rather than merely permitted.
 */
import { isLoopbackHost } from "./net/ssrf";

export interface ServerConfig {
  port: number;
  bind: string;
  token: string | null;
  auth: "none" | "token" | "oauth";
  tls: string | null;
  dev: boolean;
  /** User opted into a non-loopback bind via --allow-lan / CLIDABLE_ALLOW_LAN. */
  allowLan: boolean;
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
  const allowLan =
    hasFlag("--allow-lan") || isTruthy(process.env.CLIDABLE_ALLOW_LAN);

  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`invalid --port: ${port}`);
  }

  // Localhost-only by default: refuse ANY non-loopback bind unless the user
  // explicitly opts in. Checked against the same predicate the per-request Host
  // guard uses, so `--bind ::`, a LAN IP, or a hostname can't slip past a
  // literal "0.0.0.0" comparison — each would expose unauthenticated PTY
  // spawning (RCE) to whatever network the interface reaches (LAN, or the
  // internet on a VPS). `--allow-lan` is the informed escape hatch; the server
  // still prints a loud warning at startup (server/index.ts).
  if (!isLoopbackHost(bind) && !allowLan) {
    throw new Error(
      `refusing to start: Clidable is localhost-only by default — \`--bind ${bind}\` ` +
        "would expose unauthenticated remote code execution (PTY spawn) to the network. " +
        "Bind a loopback address (127.0.0.1, the default) and use a tunnel or " +
        "authenticating reverse proxy for remote access. If you control this network " +
        "and accept the risk, re-run with `--allow-lan` (or CLIDABLE_ALLOW_LAN=1).",
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

  return { port, bind, token, auth, tls, dev, allowLan };
}

function isTruthy(v: string | undefined): boolean {
  if (v === undefined) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}
