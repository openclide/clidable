# Clidable — Preview + Projects Milestone Plan

> **Build status — ✅ M-A through M-F shipped.** Projects registry + open/create
> wizard (M-A), hardened preview iframe + address bar + shell-aware URL seam
> (M-B/E1), output-mode URL detection (M-C), process-mode port scan (M-D),
> auth'd reverse-proxy + WS bridge + SSRF gate (M-E), and own-the-spawn
> dev-server auto-URL (M-F). Verified: `tsc` clean, 15 unit/integration tests
> pass (sandbox regression, URL scanner, live port scan), `cargo check` green,
> dev boots on :7878. macOS port detection + the full proxy/dev-server chain
> exercised live; Linux/BSD `/proc` path + Windows `Get-NetTCPConnection` path
> grounded but on-platform-verify pending. Checkpoint screenshots now have a
> real iframe to capture (desktop capture is a manual on-device step).

Detailed plan for **build-order step #5** in [PLAN.md](./PLAN.md): **Projects (#7) + Preview (#3)**.
Grounded in four prior-art references, each contributing one idea:

| Reference | Contributes | Location |
|---|---|---|
| **terax-ai** | The iframe itself + manual/agent URL | `./explore/terax-ai/src/modules/preview/` |
| **VS Code** (issue [#143958](https://github.com/microsoft/vscode/issues/143958)) | Auto-detect: output-scan (portable) + `/proc` process-scan (Linux) | `extHostTunnelService.ts`, `remoteExplorer.ts` |
| **code-server** | Auth'd port-proxy for remote/mobile reachability | `../explore/code-server/src/node/proxy.ts`, `routes/pathProxy.ts` |
| **claudable-new** | Own-the-spawn-so-you-own-the-port (scaffolded projects only) | `../claudable-new/src/lib/projects/manager.ts` |

---

## How the references actually work (the load-bearing findings)

### terax-ai — a manual browser pane, not a dev-server manager
terax never spawns `npm run dev`, never detects frameworks, never allocates ports. The user (or an agent) runs the dev server *in the terminal*; the preview is an iframe pointed at a URL via an address bar + a "Ports" probe dropdown. Its rigor is in the **iframe**, not the process:

- **Sandbox omits `allow-top-navigation`** — `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"` + `referrerPolicy="no-referrer"`. Without top-nav a compromised dev server can't navigate the parent Tauri webview to an attacker origin (which would expose `window.__TAURI__` IPC → RCE). A **source-level regression test** (`PreviewPane.test.ts`) greps the JSX and fails the build if anyone re-adds a top-nav token.
- **Cross-origin reload via remount** — `iframe.contentWindow.location.reload()` throws cross-origin; instead bump a `nonce` baked into `key={`${url}#${nonce}`}` to force React to recreate the iframe.
- **30s memory-suspension** — a backgrounded dev page holds hundreds of MB; tear the iframe down after 30s invisible, swap in a "Suspended — Reload" card.
- **Port-liveness probe** — `fetch(url, {mode:"no-cors", signal: AbortSignal.timeout(900)})` before navigating, so you don't land on a blank page.
- **X-Frame-Options banner** for non-local URLs (most public sites refuse to embed).

### VS Code — two detection modes (`remote.autoForwardPortsSource`)
Maintainer answer on #143958:

- **`process` mode** (`extHostTunnelService.ts`, **Linux-only**, gated `if (isLinux …)`):
  ```js
  readFile('/proc/net/tcp')  + '/proc/net/tcp6'      // loadListeningPorts: filter st === '0A' (LISTEN)
  exec('ls -l /proc/[0-9]*/fd/[0-9]* | grep socket:') // getSockets: socket-inode → pid
  read /proc/<pid>/cwd + /proc/<pid>/cmdline          // process detail
  findPorts(connections, socketMap, processes)        // join socket → pid → cmd
  ```
  Excludes its own processes (`knownExcludeCmdline` → `vscode-server`, `out/server-main.js`). Polls on an adaptive interval (`movingAverage*20`, min 2000ms). The **Docker case** (`docker run -p 8888:8888`, the issue's example) is a separate fallback: `tryFindRootPorts()` + `exec('ps -F -A -l | grep root')` finds a root process with the port in its cmdline (docker-proxy), then walks to the most-child process.
- **`output` mode** (`remoteExplorer.ts` → `UrlFinder`): watches terminal/debug output for localhost-URL-looking strings, dedupes against detected tunnels.
- Default is **hybrid** (both).

**Key caveat for us:** process mode is Linux-only because in VS Code's world the dev server always runs on a Linux *remote*. In Clidable's local desktop mode the dev server runs on the user's own Mac/Windows box, so process-mode = **three** implementations (`/proc`, `lsof`, `Get-NetTCPConnection`). Output mode is **one** implementation, all OSes.

### code-server — proxy, not detection
code-server's own `src/` has **zero** port-detection code. It's a dumb authenticated reverse proxy (`http-proxy`) where the port is a **URL parameter** — `/proxy/3000/...` (`pathProxy.ts`: `parseInt(req.params.port)` → `http://0.0.0.0:${port}`) or `3000.host` (`domainProxy.ts`). The detection it appears to have is inherited from upstream VS Code (the `/proc` scan above). Its real contribution is the **proxy**, which solves remote reachability: when the client (browser/phone) is on a different machine than the Clidable host, `localhost:3000` on the host isn't reachable — the path-proxy tunnels it through the same authed origin. Gated by `ensureAuthenticated` + `ensureOrigin`.

### claudable-new — own-the-spawn (closed-world)
Spawns the dev server as a hidden `child_process` with `stdio:'pipe'`, captured into a log buffer + SSE panel. The whole lifecycle hangs off `getTemplateByType(project.type)` with exactly **two** registry entries (Next.js, Expo) — and `project.type` is only set for projects it **scaffolded from its own templates**. There is no detection path for an arbitrary opened project. So this model only works for projects we create ourselves, where we assigned the port and therefore know it for free. (Its hidden-child-process + SSE-log approach is the *antithesis* of Clidable's PTY-first stance and is **not** ported faithfully — only the "own the spawn → own the port" idea is, and done the PTY-first way.)

---

## Grounding facts (current repo state)

- `SidePane` already has the Preview↔Code toggle + viewport switcher + a `PreviewMock` placeholder in the exact slot the real iframe drops into.
- Terminals are **already project-scoped** (`projectId`/`projectPath`); the terminal already spawns in the project cwd.
- `server/pty/session.ts` **already fans out PTY output server-side** (ring buffer + subscriber set) and **holds `proc.pid`** — the hooks for URL detection already exist.
- `capture_webview` (macOS/Windows/Linux), `web/src/lib/screenshot.ts`, and the `screenshot` DB column are **done and waiting** on a real iframe to snapshot.
- `projects` table + `ensureProjectUuid` exist; the gap is **API routes** + un-mocking `ProjectTabs`/`AddProjectMenu`/welcome `RecentProjects` (currently `web/.../welcome/data.ts` mock).
- `/api/fs/list` already exists (realpath-sandboxed) — reusable as a server-side folder browser for "open existing" in browser/remote mode.

---

## Milestones

All six ship as part of this milestone. The ordering below is dependency-driven, not a core/deferred split.

### M-A · Projects: real open/create + persistence
*The terminal/checkpoint plumbing already works per-project — this fills the registry/open/create gap and un-mocks the UI.*

- **A1 — Project API routes.** `GET /api/projects` (list, `last_opened` desc), `POST /api/projects` (open: `ensureProjectUuid` → detect name + framework hint from `package.json`/`Cargo.toml`/`pyproject.toml` → upsert row), `POST /api/projects/:id/touch` (bump `last_opened`).
- **A2 — Open existing.** Tauri native folder picker (`@tauri-apps/plugin-dialog` `open({directory:true})`) in desktop; **server-side dir browser via existing `/api/fs/list`** in browser/remote mode (the path lives on the *server's* FS — correct model for both shells). Wire `AddProjectMenu` + welcome `RecentProjects` to real data; drop mock `data.ts`.
- **A3 — New Project wizard.** Template list (Next, Vite-React/Svelte/Vue, Astro, Hono, Expo, blank). Scaffold via `Bun.spawn(["bunx","create-next-app",…])` into the chosen dir → git init → `ensureProjectUuid`. *(CLAUDE.md forbids scaffolding **our** repo; spawning scaffolders to create the **user's** project is the feature.)* Port from claudable-new `manager.ts createProject`.
- **A4 — Active-project state.** Persist current + recent; `ProjectTabs` reads real state.
- **Verify:** open a real folder → tab appears → terminal spawns in its cwd → checkpoints snapshot it.
- **New files:** `server/routes/projects.ts`; rewire `web/.../workspace/AddProjectMenu.tsx`, `welcome/RecentProjects`.

### M-B · Preview iframe (terax port) — unblocks screenshots
*A real, hardened iframe with a manual address bar. Complete and shippable on its own.*

- **B1 — Port `PreviewPane`.** Keep verbatim: the sandbox attr (**omit `allow-top-navigation`**), `referrerPolicy="no-referrer"`, nonce-key remount reload, 30s suspension, empty/suspended states. Swap hugeicons→our icons, Radix→`PositionedPortal`, terax classes→our glass. **Port `PreviewPane.test.ts`** (the sandbox tripwire).
- **B2 — Port `PreviewAddressBar`.** URL input + `normalizeUrl` + port-presets dropdown + liveness probe + "open in system browser" (Tauri opener; hidden in browser mode).
- **B3 — Replace `PreviewMock`** in `SidePane`; wire the existing viewport switcher to iframe width; persist last URL per project.
- **B4 — Light up screenshots.** Verify `capture_webview` snaps the real iframe; confirm per-checkpoint thumbnails render end-to-end (mostly verification — capture path is built).
- **Verify:** `bun dev` in our terminal → type port → preview renders → Send → checkpoint thumbnail appears.
- **New files:** `web/.../preview/PreviewPane.tsx`, `PreviewAddressBar.tsx`, `PreviewPane.test.ts`.

### M-C · Auto-detect URL — output mode (portable, one implementation)
*VS Code's `UrlFinder` equivalent, on the PTY stream we already capture. Cross-OS, highest coverage-per-LOC.*

- **C1 — Server-side URL scanner.** New subscriber on the `session.ts` output fan-out. **Strip ANSI first**, then regex dev-server banners: Vite `Local:\s*http://…`, Next `started server on … http://…`, generic `http://(localhost|127\.0\.0\.1|0\.0\.0\.0):\d+`, `Listening on …`. Map `0.0.0.0`→`localhost`.
- **C2 — Debounce + dedupe** per session; emit a "dev-server detected" event.
- **C3 — UI chip.** Dismissible: *"Dev server on :5173 — open preview?"* → fills address bar + probes. **Never auto-hijack** the pane.
- **Verify:** start Vite / Next / a Python server → chip shows the correct URL each time.
- **New files:** `server/preview/url-finder.ts`.

**→ Through M-C: open/create projects, hardened iframe, manual + auto URL on every OS, checkpoint thumbnails live.**

### M-D · Auto-detect URL — process mode (precision: catches silent servers)
*Depends on M-C — feeds the same "detected" chip pipeline. The precision upgrade for servers that print no banner.*

- **D1 — PID-scoped socket enumeration** over the session's descendant tree (we hold `proc.pid` in `session.ts`): `/proc/net/tcp`+`tcp6` with fd-inode join (Linux), `lsof -nP -iTCP -sTCP:LISTEN -p <pids>` (macOS), `Get-NetTCPConnection -State Listen -OwningProcess` (Windows).
- **D2 — Diff before/after** a command runs; the new LISTEN socket in the subtree is the server. Self-exclude our own PIDs (`knownExcludeCmdline` analog) so we never forward Clidable's own ports.
- **D3 — Feed the same chip** as M-C; union with output-mode results, dedupe by port.
- **Cost note:** 3 OS implementations (unlike VS Code, our dev servers aren't guaranteed to be on Linux) → **strong candidate for the Rust side**, where we already do platform-specific work (screenshots).
- **Verify:** start a server that prints nothing → still detected; confirm no false-positive on our own ports.
- **New files:** `server/preview/port-scan.ts` *or* `src-tauri/src/portscan.rs` + a Tauri command.

### M-E · Remote/mobile reachability — shell-aware URL resolution + auth'd port-proxy
*E1 lands inside M-B so every later piece routes through one seam; E2/E3 pair with server/mobile mode (PLAN steps 9–10).*

- **E1 — Shell-aware URL resolution (build with M-B).** Tauri/local → iframe `http://localhost:<port>`; browser/remote → `/proxy/<port>/`. One resolver the address bar + detection chip + screenshots all call.
- **E2 — Bun reverse-proxy.** `/proxy/:port/*` → `127.0.0.1:<port>` on the host (Bun.serve fetch-forward + WebSocket upgrade passthrough; ~30–50 LOC, no `http-proxy` dep). Rewrite absolute redirects against the base path (code-server's `proxyRes` trick).
- **E3 — Auth + SSRF gate.** Proxy requires auth; refuse `--bind 0.0.0.0` + `--auth none` (PLAN §12). Port terax's `net.rs` hardening (IP classification, DNS-rebind pin, CRLF guard, scheme allowlist) — required once we forward arbitrary ports.
- **Verify:** from a second device, load the Clidable host → preview reaches a dev server on the host's localhost; an unauth'd `/proxy` request is refused.
- **New files:** `server/routes/proxy.ts`, `server/net/ssrf.ts`; `lib/preview-url.ts` (E1 resolver).

### M-F · Own-the-spawn auto-URL (for projects we scaffold)
*Depends on M-A3 (New Project wizard). Scoped to our own projects; arbitrary opened projects still flow through M-C/M-D detection.*

- **F1 — Managed-PTY dev command.** For a scaffolded project we know the framework → a "Run dev server" action spawns the dev command **in a visible PTY** with an injected `PORT`/`--port`, so we know the URL a priori.
- **F2 — Auto-fill** the address bar from that known port (no detection needed). PTY-first (visible, killable) — *not* claudable-new's hidden `child_process` + SSE log panel.
- **Verify:** create a project via the wizard → "Run dev server" → visible PTY on a known port → preview auto-fills.

---

## Suggested ordering

`A1→A2` (open existing) **→** `B1→B4 + E1` (iframe + screenshots + shell-aware URL seam — the big visible win) **→** `C` (output auto-detect) **→** `D` (process auto-detect) **→** `A3` (new-project wizard) **→** `F` (own-spawn auto-URL) **→** `E2→E3` (proxy + SSRF hardening).

Rationale for the order:
- Open-existing before new-project — lower-effort, exercises the whole pipeline; the wizard reuses the registry it establishes.
- E1 (shell-aware URL resolution) is built *inside* M-B so the address bar, detection chip, and screenshots all route through one resolver from day one.
- Output detection (C) before process detection (D) — one portable implementation lands the feature; the per-OS socket scan refines it.
- F after A3 — own-the-spawn only applies to projects the wizard created.
- E2/E3 (the actual proxy + hardening) last — they activate only in browser/server/mobile mode, but the seam they plug into already exists from E1.

---

## Design forks already settled

1. **URL source = open-world, not closed-world.** For "any project the user can open," the terax model (human/agent supplies URL, framework-agnostic) is the foundation; claudable-new's template-bound spawn only works for projects we scaffold ourselves. We never guess how to run an arbitrary project — the user/agent already runs it in our PTY.
2. **We don't "tell the agent" to surface the URL.** We own the PTY bytes, so we detect the URL ourselves (output scan) rather than depending on an external CLI agent's tool surface. An `open_preview`-style tool is an optional later bonus, not the mechanism.
3. **Both detection tiers in scope, output first.** Output/log-scan (M-C) ships first because it's portable (1 impl); `/proc`-style process-scan (M-D) follows as the precision upgrade for silent servers. Output simply sequences first — neither is dropped.
4. **Proxy is remote-only but in scope.** In local Tauri mode the iframe hits `localhost:<port>` directly — the proxy (code-server model) only activates in browser/server/mobile mode. The shell-aware URL-resolution seam (E1) is built in M-B so the proxy (E2/E3) drops in without rework.
