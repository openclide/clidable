import { describe, expect, test } from "bun:test";
import { guardApiRoutes, isSameSiteRequest } from "./origin";
import { isLoopbackBind, isLoopbackHost } from "./ssrf";
import type { ServerConfig } from "../cli";

const loopback: ServerConfig = {
  port: 7878,
  bind: "127.0.0.1",
  token: null,
  auth: "none",
  tls: null,
  dev: false,
  allowLan: false,
};
const publicBind: ServerConfig = { ...loopback, bind: "0.0.0.0", allowLan: true };

/** Build a request with the given headers (Host defaults to the loopback server). */
function reqWith(headers: Record<string, string>, host = "127.0.0.1:7878"): Request {
  return new Request("http://127.0.0.1:7878/api/terminal", {
    headers: { host, ...headers },
  });
}

describe("isSameSiteRequest — Sec-Fetch-Site (closes the Origin-less GET hole)", () => {
  test("REJECTS a cross-site no-cors GET that omits Origin (<img>/<script> on evil.com)", () => {
    // The exact bypass: browsers omit Origin on cross-origin no-cors GET but
    // DO send Sec-Fetch-Site: cross-site.
    expect(
      isSameSiteRequest(reqWith({ "sec-fetch-site": "cross-site" }), loopback),
    ).toBe(false);
  });

  test("allows the app's own request (same-origin)", () => {
    expect(
      isSameSiteRequest(reqWith({ "sec-fetch-site": "same-origin" }), loopback),
    ).toBe(true);
  });

  test("allows a user-initiated navigation (none)", () => {
    expect(isSameSiteRequest(reqWith({ "sec-fetch-site": "none" }), loopback)).toBe(true);
  });

  test("REJECTS same-site (no legit same-site-but-cross-origin case on localhost)", () => {
    expect(
      isSameSiteRequest(reqWith({ "sec-fetch-site": "same-site" }), loopback),
    ).toBe(false);
  });

  test("Sec-Fetch-Site is authoritative even if a stale Origin says otherwise", () => {
    expect(
      isSameSiteRequest(
        reqWith({ "sec-fetch-site": "cross-site", origin: "http://127.0.0.1:7878" }),
        loopback,
      ),
    ).toBe(false);
  });
});

describe("isSameSiteRequest — loopback bind (the default, only supported mode)", () => {
  test("allows a non-browser client (no Origin) — the CLI, curl, health probes", () => {
    expect(isSameSiteRequest(reqWith({}), loopback)).toBe(true);
  });

  test("allows the app's own same-origin request (Origin === Host)", () => {
    expect(
      isSameSiteRequest(reqWith({ origin: "http://127.0.0.1:7878" }), loopback),
    ).toBe(true);
    expect(
      isSameSiteRequest(
        reqWith({ origin: "http://localhost:7878" }, "localhost:7878"),
        loopback,
      ),
    ).toBe(true);
  });

  test("allows the Tauri custom-protocol origin", () => {
    expect(
      isSameSiteRequest(reqWith({ origin: "tauri://localhost" }), loopback),
    ).toBe(true);
  });

  test("REJECTS a foreign page (the drive-by RCE / CSRF vector)", () => {
    expect(
      isSameSiteRequest(reqWith({ origin: "https://evil.com" }), loopback),
    ).toBe(false);
    // even one whose host string merely contains a loopback substring
    expect(
      isSameSiteRequest(reqWith({ origin: "https://127.0.0.1.evil.com" }), loopback),
    ).toBe(false);
  });

  test("REJECTS DNS-rebinding: attacker domain re-resolved to 127.0.0.1 → non-loopback Host", () => {
    // The page is same-origin to itself (Origin===Host) but the Host it lands
    // on is the attacker domain, not a loopback name.
    expect(
      isSameSiteRequest(
        reqWith({ origin: "http://evil.com" }, "evil.com"),
        loopback,
      ),
    ).toBe(false);
    // …and a rebinding GET navigation (no Origin) is caught by the Host check.
    expect(isSameSiteRequest(reqWith({}, "evil.com"), loopback)).toBe(false);
  });

  test("REJECTS a malformed Origin", () => {
    expect(isSameSiteRequest(reqWith({ origin: "not a url" }), loopback)).toBe(false);
  });

  test("REJECTS a mismatched port (a different local server is a different origin)", () => {
    expect(
      isSameSiteRequest(reqWith({ origin: "http://127.0.0.1:9999" }), loopback),
    ).toBe(false);
  });
});

describe("isSameSiteRequest — explicit non-loopback bind (unsupported opt-in)", () => {
  test("allows a LAN browser's same-origin request (Origin === Host), no loopback-Host requirement", () => {
    expect(
      isSameSiteRequest(
        reqWith({ origin: "http://192.168.1.5:7878" }, "192.168.1.5:7878"),
        publicBind,
      ),
    ).toBe(true);
  });

  test("still REJECTS a foreign page on a public bind", () => {
    expect(
      isSameSiteRequest(
        reqWith({ origin: "https://evil.com" }, "192.168.1.5:7878"),
        publicBind,
      ),
    ).toBe(false);
  });
});

describe("isSameSiteRequest — Host/Origin normalization (no legit blocks)", () => {
  test("allows another loopback-range Host (127.0.0.2)", () => {
    expect(
      isSameSiteRequest(
        reqWith({ origin: "http://127.0.0.2:7878" }, "127.0.0.2:7878"),
        loopback,
      ),
    ).toBe(true);
  });

  test("allows a trailing-dot FQDN Host (localhost.)", () => {
    expect(
      isSameSiteRequest(
        reqWith({ "sec-fetch-site": "same-origin" }, "localhost.:7878"),
        loopback,
      ),
    ).toBe(true);
  });

  test("same-origin match survives IPv6 form + case differences (Origin vs Host)", () => {
    // URL-normalized both sides: [0:0:…:1] ⇔ [::1], LOCALHOST ⇔ localhost.
    expect(
      isSameSiteRequest(
        reqWith({ origin: "http://[0:0:0:0:0:0:0:1]:7878" }, "[::1]:7878"),
        loopback,
      ),
    ).toBe(true);
    expect(
      isSameSiteRequest(
        reqWith({ origin: "http://LOCALHOST:7878" }, "localhost:7878"),
        loopback,
      ),
    ).toBe(true);
  });

  test("allows a Host-less non-browser request (contract: no Origin → pass)", () => {
    const req = new Request("http://127.0.0.1:7878/api/health"); // no Host, no Origin
    expect(isSameSiteRequest(req, loopback)).toBe(true);
  });
});

describe("guardApiRoutes — baseline security headers", () => {
  const ok = () => new Response("ok");
  const req = (headers: Record<string, string> = {}) =>
    new Request("http://127.0.0.1:7878/api/x", {
      headers: { host: "127.0.0.1:7878", ...headers },
    });

  function expectHardened(res: Response): void {
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
  }

  test("an allowed API response carries all four headers", async () => {
    const routes = guardApiRoutes({ "/api/x": ok }, loopback) as Record<
      string,
      (req: Request, s: unknown) => Response | Promise<Response>
    >;
    expectHardened(await routes["/api/x"]!(req({ "sec-fetch-site": "same-origin" }), null));
  });

  test("the 403 cross-site refusal also carries them", async () => {
    const routes = guardApiRoutes({ "/api/x": ok }, loopback) as Record<
      string,
      (req: Request, s: unknown) => Response | Promise<Response>
    >;
    const res = await routes["/api/x"]!(req({ "sec-fetch-site": "cross-site" }), null);
    expect(res.status).toBe(403);
    expectHardened(res);
  });

  test("a per-method map is wrapped and hardened", async () => {
    const routes = guardApiRoutes({ "/api/x": { GET: ok } }, loopback) as Record<
      string,
      { GET: (req: Request, s: unknown) => Response | Promise<Response> }
    >;
    expectHardened(await routes["/api/x"]!.GET(req({ "sec-fetch-site": "same-origin" }), null));
  });
});

describe("loopback predicates agree (bind guard ⇔ rebind check)", () => {
  test("isLoopbackBind === isLoopbackHost across the range", () => {
    for (const v of ["127.0.0.1", "127.0.0.2", "127.255.255.254", "::1", "[::1]", "localhost", "LOCALHOST"]) {
      expect(isLoopbackHost(v)).toBe(true);
      expect(isLoopbackBind(v)).toBe(true);
    }
  });

  test("all-interfaces / LAN / external are NOT loopback (refused at bind)", () => {
    for (const v of ["0.0.0.0", "::", "192.168.1.5", "10.0.0.1", "example.com"]) {
      expect(isLoopbackHost(v)).toBe(false);
      expect(isLoopbackBind(v)).toBe(false);
    }
  });
});
