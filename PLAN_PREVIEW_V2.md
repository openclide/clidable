# Clidable — Preview v0.2: Origin Isolation + URL Stack

> **Status — DESIGN / not yet built.** Follow-on to [PLAN_PREVIEW.md](./PLAN_PREVIEW.md)
> (M-A…M-F, shipped). This plan closes preview security issue **#7** (previewed
> dev content is same-origin with Clidable and can drive `/api` = RCE) and makes
> remote/cloud preview *correct* (client-side routing, deep-link reload) — without
> building the shelved subdomain-per-port proxy. Grounded in a code survey +
> adversarial stress pass (8 agents); the stress pass found a **confirmed
> ship-blocker** that this doc's invariants exist to close. Read
> [§3 Hard invariants](#3-hard-invariants-ship-blockers) first.

---

## 0. TL;DR — what changed vs. the conversation that spawned this

The design we sketched ("serve `/proxy` from a second loopback port so the preview
is cross-origin to the app") is **the correct core idea but not sufficient on its
own**. The adversarial pass confirmed, against live code, that a naive port split
**relocates** #7's RCE into the proxy rather than closing it. Three compensating
controls are mandatory (§3). With them, the design holds.

Two conclusions from the earlier chat are **revised**:

1. **"The second port closes #7."** → *Only with a port-blocklist control.* The
   same-site gate structurally cannot protect `/api` from a co-located server-side
   forwarder, so the proxy's **target-port policy** (`checkProxyAllowed`) is the
   only thing standing between preview content and `/api`. It must refuse the app
   port unconditionally.
2. **"Subdomain-per-port is over-engineering, full stop."** → *Half-true.* Port
   isolation is enough for the *origin/localStorage* isolation that closes the
   literal bug — and since Clidable sets **no cookie by design** (§7 fork 5), that
   holds permanently, not just "for now." But cookies are host-scoped, so if a
   **cookie-based access layer** (Cloudflare Access, oauth2-proxy) is put in front,
   only a **hostname** split keeps its auth cookie out of the preview origin's jar —
   and only a hostname split isolates previews from *each other*. So subdomain
   separation moves from "rejected" to "**deferred (no auth trigger; see §7)**."

Everything else from the chat stands: bring-your-own-URL is the primary remote
path, `/proxy` is the bare-VPS fallback, cloud envs do origin separation for us.

---

## 1. Where previews render, and who owns each case

`resolvePreviewUrl` ([web/src/lib/preview-url.ts:41](web/src/lib/preview-url.ts))
is the single client seam; it has three outcomes today:

| Case | How the iframe loads | #7 exposure | Owner |
|---|---|---|---|
| **A. Local / Tauri** (most users) | `localhost:<devport>` **direct** — already cross-origin, root-served ([preview-url.ts:48-49](web/src/lib/preview-url.ts)) | none | already correct |
| **B. Remote + cloud env / own hostnames** (Codespaces, Gitpod, ngrok, wildcard Caddy) | user's forwarded URL, direct | none (platform separates origins) | **URL stack** (M-P2) |
| **C. Remote bare VPS**, raw `localhost:<devport>`, no per-port hostname | Clidable `/proxy/<port>` on the **app origin** ([preview-url.ts:54](web/src/lib/preview-url.ts)) | **#7 lives here** | **second-port proxy** (M-P1) |

**#7 only manifests in Case C** — the remote-host browser context. M-P1 fixes C's
security; M-P2 makes A/B excellent and gives C an escape hatch. The subdomain
project would only ever have served Case C, which is why it's not worth building.

---

## 2. Confirmed threat model (from the stress pass, verified against code)

- **#7 as it exists today:** `/proxy` is served on the app origin
  ([preview-url.ts:54](web/src/lib/preview-url.ts)); a `fetch('/api/terminal')`
  from previewed content carries `Sec-Fetch-Site: same-origin`
  ([origin.ts:88-89](server/net/origin.ts)) → passes `guardApiRoutes`
  ([origin.ts:141](server/net/origin.ts)) → PTY spawn ([index.ts:277](server/index.ts)).
  **CONFIRMED.**
- **Attacker in scope:** malicious/compromised *previewed dev content* — a cloned
  untrusted repo, or one hostile third-party script in an otherwise-benign dev
  bundle. Per `SECURITY.md`, untrusted-repo preview is in-scope. The dev server
  already runs as the user, but reaching `/api` adds a **persistent, UI-attached**
  terminal + Clidable's project/checkpoint data — a real escalation, and reachable
  by *any third-party script* in the dev app, not just a wholly-malicious repo.
- **The confused-deputy (the ship-blocker):** move `/proxy` to `:7879` and a
  server-side forward to `127.0.0.1:7878/api/*` arrives with **no** `Sec-Fetch-Site`
  → gate's "non-browser client passes" branch ([origin.ts:89/93](server/net/origin.ts))
  → allowed. The split **relocates** the RCE unless the target-port policy blocks it.

**Access & auth model (the frame for everything below):** Clidable has **no auth,
by design, and will not** — authenticating remote access is the user's *access
layer*. Recommended, in order: **Tailscale / WireGuard** (network-layer, no cookie,
zero open ports), **Cloudflare Tunnel + Access**, or an authenticating reverse
proxy. Clidable stays localhost-only by default; `--allow-lan` only lifts the bind
for a network you already trust and adds no auth. This is why the cookie hazard (I3)
is *inert for first-party state* and why the two-origin reverse-proxy recipe (P1-7)
is a **fallback**, not the primary path.

---

## 3. Hard invariants (SHIP-BLOCKERS)

These are not "nice to have." Any implementation that violates one is a no-ship.

### I1 — The proxy MUST refuse Clidable's own ports, on every listener
`checkProxyAllowed` today refuses only `port === config.port`
([ssrf.ts:84](server/net/ssrf.ts)). Change it to reject membership in a
**set of own loopback ports** `{ appPort, proxyPort }`, checked *before* the
loopback-bind "any port" shortcut. Because the proxy target host is hard-coded
`127.0.0.1` ([proxy.ts:37](server/routes/proxy.ts)), a port-number blocklist fully
covers it. **This is the compensating control that turns "moves #7" into "closes
#7."** The same-site gate cannot do this job — a server-side forward has no
`Sec-Fetch-Site`.

### I2 — Both guards run on the second listener's HTTP *and* WS paths
The second listener still exposes `/proxy/<port>/*` = the whole loopback surface
(redis, DB, and — via I1's gap if unfixed — `/api`). It is **not** "nothing to
hit." `isSameSiteRequest` **and** `checkProxyAllowed` must run on both the HTTP
path and the WS-upgrade path. Extract the inline block
([index.ts:344-372](server/index.ts)) into one shared `proxyFetch(req, srv, config)`
used by both listeners — never duplicate, never let the WS branch drop a guard.
Regression test: a `Sec-Fetch-Site: cross-site` request to `:7879/proxy/*` is 403
on **both** HTTP and WS (mirror [origin.test.ts](server/net/origin.test.ts)).

### I3 — Clidable sets no cookie, ever; the cookie hazard belongs to the access layer
Cookies are **host-scoped, not port-scoped**: `:7878` and `:7879` share the jar, so
a port split does **not** isolate cookies. Clidable resolves this the simplest
possible way — **by never having auth of its own** (§2 access model, §7 fork 5). No
session/CSRF cookie is set, now or ever; the vestigial `--token` seam has been
removed, and `--auth`/`--tls` are parsed only to be *refused*. So Clidable's own
cookie jar is empty **by design** and the
hazard is inert for first-party state — a permanent invariant, not a "when auth
lands" caveat. **Nothing may set a trusted cookie on the app host.**

The residual hazard is the **access layer's** cookie: a cookie-based proxy
(Cloudflare Access, oauth2-proxy, Authelia) sets its auth cookie on the host, which
hostile preview content on a same-host different-port origin could read or forge.
Mitigation is the operator's and documented in `remote-vps.md`: prefer
**network-layer auth (Tailscale/WireGuard — no cookie to steal)**, and if using a
cookie-based proxy, serve the preview from a **separate hostname** (not merely a
second port) so its auth cookie is out of the preview origin's jar.

### I4 — Auto-honor is an allowlist on the PARSED url, excluding Clidable's ports
A committed `.clidable/preview.json` is **untrusted** (§5). "Auto-honor loopback"
must NOT wave through the app's own loopback origin (`localhost:7878`) — that
re-frames Clidable itself same-origin and reopens #7. Auto-honor a URL only if
**all** hold, decided on the parsed `URL` (never a substring of the raw string):
`protocol ∈ {http, https}` **AND** `hostname ∈` exact loopback set **AND**
`port ∉ { appPort, proxyPort }` **AND** `port ∈` Clidable's own-spawned/
trusted-detected dev-server ports (mirror `isPortDetected({trustedOnly:true})`
[detector.ts:109-125](server/preview/detector.ts)). Anything else → confirm-first
tier (§5), including app-origin URLs.

### I5 — `{env:}` never touches host/scheme, only a name-allowlist, never in committed configs
Template resolution runs **server-side** (`process.env` — the browser has none),
so untrusted repo data selecting which secret to read is a secret-exfiltration
primitive. Rules: `{env:VAR}` and `{port}` may appear **only in path/query/port
positions**, never scheme/host/authority/userinfo (enforced by parsing the
*template* structurally, not the resolved string). `{env:}` may reference **only a
fixed allowlist** of cloud-forwarding names (`CODESPACE_NAME`,
`GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`, `GITPOD_WORKSPACE_URL`, …), never
arbitrary env. Substituted values validated against a strict single-DNS-label/digit
charset. **Committed configs get no `{env:}` at all** — env interpolation is
permitted only from a provenance-proven local source (§5) into an owned-port
loopback URL. Never run DNS / `probeUrl` / prefetch on any URL whose host or query
contains env-derived data before explicit consent.

---

## 4. M-P1 — Second-port proxy (the security fix, Case C)

*Serve `/proxy/<port>/*` (HTTP + WS) from a second loopback `Bun.serve` on its own
port so the preview iframe is a foreign origin to the app. Closes #7 given I1–I3.*

**Why it works (survey-confirmed):** cross-port = `Sec-Fetch-Site: same-site` (or
`cross-site` for a `localhost`↔`127.0.0.1` mismatch); the gate allows only
`same-origin`/`none` ([origin.ts:88-89](server/net/origin.ts)) → the preview's
direct `fetch` to `:7878/api` is 403'd, and `localStorage` is port-isolated. The
old-browser Origin fallback ([origin.ts:93-96](server/net/origin.ts)) rejects it
too. The *only* hole is the server-side confused-deputy, closed by **I1**.

**Feasibility (survey-confirmed, low-risk):**
- Bun runs multiple in-process `serve()` fine (proven in
  [port-scan.test.ts](server/preview/port-scan.test.ts)); a second listener is a
  second `serve({...})`, not a re-architecture.
- The second listener mounts **no** `/api`/app routes → no `guardApiRoutes`, no
  HTML imports, no HMR/Tailwind bundler (`development: false`) → lighter, and dodges
  the HTML-import outdir traps in CLAUDE.md.
- WS: `srv.upgrade()` uses the owning server's `websocket:` handler, so the second
  `serve` sets `websocket: proxyWsHandler` directly
  ([proxy-ws.ts:20](server/routes/proxy-ws.ts) already open/message/close-shaped);
  drop the `proxy-ws` branch from the main dispatcher.
- The handlers close over only `config` + the per-request `srv`; the detector
  registry is a process-global singleton ([detector.ts:34](server/preview/detector.ts))
  → shared for free. **Derive the second config as `{...config, port: PROXY_PORT}`
  — never re-parse `bind`/`allowLan`** (I-adjacent: a divergent bind silently
  disables the public-bind SSRF restriction).

**Tasks**
- **P1-1 — Second port in config.** Add `proxyPort` to `ServerConfig`
  ([cli.ts:20-29](server/cli.ts)); source = `--proxy-port` / `CLIDABLE_PROXY_PORT`,
  default `appPort + 1`, validated loopback + collision-free. Assert both listeners
  share `bind`/`allowLan` at startup; extend the `--allow-lan` network-exposed
  warning ([index.ts:390](server/index.ts)) to name the proxy port.
- **P1-2 — Extract `proxyFetch(req, srv, config)`.** Lift the inline block
  ([index.ts:344-372](server/index.ts)) verbatim (parse → `isSameSiteRequest` →
  WS: `checkProxyAllowed`+upgrade / HTTP: `proxyHttp`). Main `fetch` fallback
  collapses to `404`. **I2.**
- **P1-3 — Own-ports blocklist.** `checkProxyAllowed` takes the `{appPort,
  proxyPort}` set and rejects membership before the loopback shortcut. **I1.**
- **P1-4 — Second listener.** `serve({ port: proxyPort, hostname: config.bind,
  development: false, fetch: (req, srv) => proxyFetch(req, srv, config),
  websocket: proxyWsHandler, error })`.
- **P1-5 — Point the iframe at the proxy origin.** `resolvePreviewUrl`'s remote
  branch ([preview-url.ts:51-54](web/src/lib/preview-url.ts)) builds the URL against
  the **proxy port**, not `window.location.origin`. The client must *learn* the
  proxy port — there is **no server→client config bridge today** (survey-confirmed:
  no `/api/config`, no `window.__`). Add one (see M-P2's bridge; shared).
- **P1-6 — Tighten the sandbox.** Drop `allow-popups-to-escape-sandbox`
  ([PreviewPane.tsx:96](web/src/components/workspace/PreviewPane.tsx)) — it's a
  phishing primitive (a non-sandboxed popup on a real-looking origin). Keep the
  `PreviewPane.test.ts` tripwire green (edit the asserted token list too). Send
  `Origin-Agent-Cluster: ?1` on app-shell responses to hard-disable
  `document.domain` cross-port relaxation.
- **P1-7 — Two-origin access recipe.** The **recommended** path is Tailscale: both
  the app and proxy ports are reachable over the tailnet with no per-vhost auth to
  forget and no cookie to steal — document reaching both ports over the tailnet.
  The reverse-proxy recipe is the **fallback** for a public URL: a canonical
  Caddy/nginx config exposing **both** origins with auth on **both**, Host-rewrite
  to loopback on both, WS upgrade on both, and (for cookie-based auth) the preview
  on a **separate hostname** (I3). State explicitly the proxy origin is **not**
  lower-trust. Update [docs/remote-vps.md](docs/remote-vps.md).

**Accepted limitation (document, don't hide):** a single proxy port means all
previews share one origin (`host:PROXY_PORT`) → **no preview-vs-preview
isolation** (project A's malicious dev server can script project B's preview,
shared `localStorage`/cookies). This is the exact thing subdomain-per-port would
fix. For v0.2 it's accepted and stated; §7 tracks the hostname upgrade.

---

## 5. M-P2 — The URL stack (correctness + cloud + recovery)

*Make Cases A/B first-class and give C an escape hatch. Everything routes through
the one seam `resolvePreviewUrl`; SidePane/PreviewAddressBar stay untouched
(survey-confirmed the seam is the only rewrite point).*

### P2-1 — `.clidable/preview.json` (committed template, UNTRUSTED)
Mirror the ai-team config pattern exactly: `PREVIEW_CONFIG_REL =
".clidable/preview.json"`, `readJson<PreviewConfig>` (null-safe,
[util/fs.ts:19-26](server/util/fs.ts)), a `coercePreviewConfig` mirroring
`coerceRoles`/`sanitizeRole` ([roles.ts:207-277](server/team/roles.ts)) — **size-cap
the file before parse**, accept only `{ url?: string }` (+ optional per-port
metadata), reject arrays/objects/unknown keys, fail closed. Holds a **template**
(`{port}`, allowlisted `{env:}` per I5 — but see below), portable across machines.
Trust decision per **I4**. **Committed = untrusted** → no `{env:}`, and any
absolute/external or app-origin URL is confirm-first, never auto-loaded.

### P2-2 — Machine-local URL lives OUTSIDE the repo
The committed-vs-`.local` split **cannot** be by filename — a malicious repo just
commits `.clidable/preview.local.json` (git tracks committed files regardless of
`.gitignore`; `.clidable/` is already committed here). Store the machine-specific
absolute URL in the **app data dir**, keyed by the rename-safe project UUID:
`<dataDir>/Clidable/projects/<uuid>/preview.local.json` (same home as checkpoints).
A repo then *physically cannot* carry a "local/trusted" file. Provenance = "not in
the repo," never a filename. (If ever kept in-repo: treat any `git ls-files`-tracked
path as untrusted, and treat a `.git`-less ZIP download as untrusted too.)

### P2-3 — Cloud auto-detect (Codespaces / Gitpod / Coder)
Needs the **server→client config bridge** (shared with P1-5): read
`CODESPACE_NAME` / `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` /
`GITPOD_WORKSPACE_URL` server-side in `parseConfig`, expose via `/api/config` or an
HTML-injected `window.__CLIDABLE_ENV`. A new branch in `resolvePreviewUrl` (between
[preview-url.ts:49 and :51](web/src/lib/preview-url.ts)) rewrites a loopback URL to
the forwarded per-port host. **Caveat (document):** Codespaces forwarded ports
default to *private* (auth-gated) — an iframe load may hit GitHub's auth wall +
X-Frame block. Where the same-origin `/proxy` tunnel would work, prefer it; cloud
detect may be primarily a labeling concern. `rawUrl` stays the canonical
`localhost:<port>` form (so the Ports menu, persistence, and the `external` amber
banner logic [SidePane.tsx:298](web/src/components/workspace/SidePane.tsx) don't
misfire); only `resolvedUrl` changes.

### P2-4 — Probe-driven failure prompt + persistent menu override (HONEST detection)
Two failure classes, and the UX must not overclaim (§6):
- **Unreachable** → auto-prompt. But **probe the *resolved* URL, not
  `localhost:<port>`** — today `probeUrl`/`tryPort` hit the *client's* localhost
  ([PreviewAddressBar.tsx:103](web/src/components/workspace/PreviewAddressBar.tsx)),
  which in remote/cloud is the wrong machine, and mixed-content (HTTPS page →
  `http://localhost`) false-fails. Route the probe through `resolvePreviewUrl`, or
  drop it in remote/HTTPS and rely on the proxy's server-side status.
- **Blank-but-loaded (framing refusal)** → **undetectable cross-origin.** No
  auto-prompt is possible; the honest affordance is a **permanent "Preview URL…"
  entry** in the PreviewAddressBar menu
  ([PreviewAddressBar.tsx:210-309](web/src/components/workspace/PreviewAddressBar.tsx),
  sibling to "Dev-server terminal") + a soft hint. Never render "couldn't reach
  it" for this state.
- **`FailedState`** → a third arm of the PreviewPane ternary
  ([PreviewPane.tsx:86-105](web/src/components/workspace/PreviewPane.tsx)), sibling
  to `SuspendedState`/`EmptyState`, driven by a prop from SidePane (the iframe
  can't self-detect XFO). On failure of a *configured* URL, **retry-in-place on a
  timer — never discard the configured URL**; only prompt when there's no
  candidate at all. Keep the iframe JSX untouched so the sandbox tripwire matches.
- **Proxy-mode error page:** the second listener sees the upstream status, so it
  can render a same-origin in-frame "nothing on :3000 · [Set URL] · [Retry]" page.
  **This channel is proxy-mode-only** — absent in the direct/local path. Scope all
  "we detected it failed" UX to proxy mode; say so.

### P2-5 — Precedence, made legible
Order: **address-bar override → local URL (dataDir) → `.clidable` template →
cloud/port auto-detect.** First that *resolves* wins; a template that fails to
resolve (unset `{env:}`, etc.) **falls to the next tier — never loads garbage.**
Two survey-found UX bugs to fix:
- Address-bar input is currently persisted to `localStorage`
  ([SidePane.tsx:91-95](web/src/components/workspace/SidePane.tsx)), collapsing the
  "ad-hoc" and "durable" tiers — a once-typed URL invisibly, permanently shadows
  the committed template. Separate ephemeral override from durable storage.
- **Show provenance** in the address bar ("from `.clidable/preview.json`" vs
  "override" vs "detected :3000") with a one-click **reset-to-config**.
- Cloud vs proxy vs localhost-detection resolve the *same port* to *incompatible*
  URLs → give them a **shell-keyed tiebreak**: in a known cloud env, prefer the
  forwarded per-port URL and **skip the second-port proxy entirely** (`:PROXY_PORT`
  isn't forwarded in a Codespace anyway). Reserve the green "live" dot / "known-
  live" wording for `process`/`spawn` detections; `output`-scan entries are "seen
  in output" and must be probed before trust ([detector.ts:16](server/preview/detector.ts)).

---

## 6. Detection honesty rules (what we can and cannot know)

State these plainly in code comments and UI copy:

1. A `no-cors` probe resolving means "**something answered**," not 2xx and not
   framable. Never label it "live/will render."
2. **Framing refusal (XFO / CSP `frame-ancestors`) is undetectable** from the
   parent of a cross-origin iframe. The menu override is the mitigation, not
   detection.
3. Honest in-frame error reporting is a **proxy-mode-only** capability. Direct/
   local mode shows the browser's native error page; Clidable can't render its own.
4. A probe is only honest if it tests the **same origin+scheme** the iframe loads.

---

## 7. Design forks (settled + deferred)

1. **Second port, not subdomain — for now.** Port isolation closes the literal #7
   (origin + `localStorage`) today and is a fraction of the cost. **Settled for v0.2.**
2. **Subdomain / distinct-hostname split — DEFERRED (no auth trigger).** Since
   Clidable will never have its own auth (fork 5), no first-party cookie forces a
   hostname split. It remains the *only* thing that (a) keeps a **cookie-based
   access layer's** auth cookie out of the preview origin's jar (I3) and (b)
   isolates previews from **each other** (§4 limitation) — neither a Clidable-auth
   trigger. So it's deferred indefinitely, revisited only if preview-vs-preview
   isolation becomes a real need or to harden a cookie-proxy deployment. Operators
   who need it today get it via a wildcard reverse proxy; the default (Tailscale,
   no cookie) doesn't need it.
3. **Bring-your-own-URL is the primary remote path; `/proxy` is the bare-VPS
   fallback; cloud envs separate origins for us.** **Settled.** In a cloud env,
   bypass the proxy entirely (P2-5 tiebreak).
4. **Committed config is untrusted data, treated with the `coerceRoles`
   discipline.** Machine-local URLs live outside the repo (P2-2). **Settled.**
5. **No auth in Clidable — by design, permanent.** Clidable spawns terminals;
   authenticating remote access is the user's *access layer* — Tailscale/WireGuard
   (recommended), Cloudflare Tunnel + Access, or an authenticating reverse proxy.
   Clidable stays localhost-only by default and sets no cookie. `--auth`/`--tls`
   are refused not as "unimplemented" but as a **non-goal**; `--allow-lan` only
   lifts the bind for a firewalled/VPN'd network and adds no auth. **Settled.**

---

## 8. Suggested ordering

`P1-3` (own-ports blocklist — the ship-blocker, tiny) **→** `P1-2` (extract
`proxyFetch`) **→** `P1-1` (second port in config) **→** `P1-4` (second listener) +
`P1-5`/bridge **→** `P1-6` (sandbox) **→** `P1-7` (docs) — *M-P1 shippable: #7
closed for Case C.* **→** `P2-1`/`P2-2` (`.clidable` config, dataDir-local) **→**
`P2-3` (cloud detect) **→** `P2-4` (failure UX) **→** `P2-5` (precedence legibility).

M-P1 is the security milestone and ships first, standalone. M-P2 is the
experience layer on top.

---

## 9. Test plan (the ones that matter)

- **RCE-relocation regression (I1):** a request to `:PROXY_PORT/proxy/<appPort>/api/terminal`
  is refused — HTTP **and** WS. This is the test that proves "closes #7" not "moves #7."
- **Cross-site 403 on the second listener (I2):** `Sec-Fetch-Site: cross-site` to
  `:PROXY_PORT/proxy/*` → 403 on both paths (mirror [origin.test.ts](server/net/origin.test.ts)).
- **Own-ports blocklist (I1):** `checkProxyAllowed(appPort, …)` and
  `checkProxyAllowed(proxyPort, …)` both refuse, on either listener's config.
- **Config parity (P1-1):** second listener inherits `bind`/`allowLan`; a divergent
  bind is a startup assertion failure.
- **Auto-honor allowlist (I4):** committed `preview.json` = `http://localhost:<appPort>`
  is NOT auto-loaded (confirm-first); a non-http scheme / `http://localhost@evil.com`
  / an undetected loopback port are all rejected on the parsed URL.
- **`{env:}` containment (I5):** a template with `{env:}` in the host, or a
  non-allowlisted var name, or in a committed (untrusted) config → rejected, no DNS.
- **Sandbox tripwire (P1-6):** [PreviewPane.test.ts](web/src/components/workspace/PreviewPane.test.ts)
  updated to assert `allow-popups-to-escape-sandbox` is **absent**, `allow-top-navigation`
  still absent.

---

## 10. Open decisions for the CEO

- **Proxy port source:** derived (`appPort+1`) vs. explicit `--proxy-port` vs.
  ephemeral (`0`, read back `server.port`). Derived is simplest; ephemeral is
  cleanest for collisions but complicates the reverse-proxy recipe (P1-7).
- **Cloud path vs proxy in Codespaces:** given private-port auth walls (P2-3),
  do we prefer the same-origin `/proxy` tunnel over the forwarded hostname, making
  cloud-detect mostly a labeling feature? Leaning yes.
- **When (if ever) does the hostname split (§7.2) get built** — there's no auth
  trigger anymore, so it's driven purely by whether preview-vs-preview isolation
  (untrusted-repo previews scripting each other) is judged to matter, or whether we
  want to harden a cookie-based-proxy deployment beyond a docs note. Default: not
  scheduled.
