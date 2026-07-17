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
 * `--auth`/`--tls` are a different case: Clidable has NO built-in auth or TLS
 * BY DESIGN — authenticating remote access is the user's access layer (a tunnel
 * like Tailscale/Cloudflare, or an authenticating reverse proxy). The server
 * refuses these flags outright rather than accept them as false assurance; they
 * are parsed into locals only to be rejected, so passing one yields a helpful
 * error, not silent acceptance.
 */
import { isLoopbackHost } from "./net/ssrf";

export interface ServerConfig {
  port: number;
  bind: string;
  dev: boolean;
  /** User opted into a non-loopback bind via --allow-lan / CLIDABLE_ALLOW_LAN. */
  allowLan: boolean;
}

function arg(flag: string): string | undefined {
  const i = Bun.argv.indexOf(flag);
  if (i === -1) return undefined;
  return Bun.argv[i + 1];
}

function hasFlag(flag: string): boolean {
  return Bun.argv.includes(flag);
}

export function parseConfig(): ServerConfig {
  const port = Number(
    arg("--port") ?? process.env.CLIDABLE_PORT ?? "7878",
  );
  const bind = arg("--bind") ?? process.env.CLIDABLE_BIND ?? "127.0.0.1";
  const auth = arg("--auth") ?? "none";
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

  // Clidable has no built-in auth/TLS by design — remote access is the user's
  // access layer (a tunnel, or an authenticating reverse proxy). Refuse these
  // flags rather than silently ignore, so nobody deploys believing they're
  // protected.
  if (auth !== "none" || tls !== null) {
    throw new Error(
      "refusing to start: Clidable has no built-in auth/TLS by design — remote " +
        "access is your access layer's job (Tailscale, Cloudflare Tunnel, or an " +
        "authenticating reverse proxy). Remove --auth/--tls and bind a loopback " +
        "address; see docs/remote-vps.md.",
    );
  }

  return { port, bind, dev, allowLan };
}

function isTruthy(v: string | undefined): boolean {
  if (v === undefined) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}
