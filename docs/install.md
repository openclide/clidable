<div class="install-hero">
<div class="install-app-icon"><img src="./logo.png" alt="" width="64" height="64" /></div>
<p class="install-eyebrow">YOUR AGENTS. A BETTER HOME.</p>

# Install Clidable

Your terminal, code and live preview. Together in a beautiful workspace.<br />
Get the desktop app, or make yourself at home on your own server.

<div class="install-badges"><span><span data-icon="check"></span> Free &amp; open source</span><span><span data-icon="terminal"></span> Your real CLI agents</span></div>
<nav class="install-jumps" aria-label="Choose your installation"><a href="#desktop">Desktop app <span data-icon="arrow-down"></span></a><a href="#server">Self-hosted <span data-icon="arrow-down"></span></a></nav>
</div>

<section class="desktop-section">

## Desktop

Pick your platform. The app includes its own server — no Node or Bun setup needed.

<div class="platform-grid">
<section class="platform-card platform-mac" aria-labelledby="macos">
<div class="platform-icon"><span data-icon="apple"></span></div>

### macOS

For your Mac. Ready to make it yours.

<div class="platform-action">

[macOS downloads ↗](https://github.com/openclide/clidable/releases/latest)

</div>
<p class="platform-format">Apple silicon &amp; Intel <span>·</span> .dmg</p>
<a class="platform-alternative" href="#homebrew"><span data-icon="terminal"></span> Prefer Homebrew?</a>
<details class="platform-details"><summary>Installation notes</summary>

Choose the `.dmg` for **Apple silicon** (`aarch64`) or **Intel** (`x64`). Open it and drag Clidable into Applications. The macOS app is signed and notarized.

</details>
</section>
<section class="platform-card platform-windows" aria-labelledby="windows">
<div class="platform-icon"><span data-icon="windows"></span></div>

### Windows

Your agents. A new view.

<div class="platform-action">

[Windows downloads ↗](https://github.com/openclide/clidable/releases/latest)

</div>
<p class="platform-format">Desktop installer <span>·</span> .exe / .msi</p>
<p class="platform-alternative">Unsigned installer — see notes below</p>
<details class="platform-details"><summary>Installation notes</summary>

Choose the `Clidable_…-setup.exe` or `.msi` that matches your processor. The Windows installer is not signed yet, so SmartScreen may show a warning. Verify that you downloaded it from the official `openclide/clidable` release before deciding to use **More info → Run anyway**.

</details>
</section>
<section class="platform-card platform-linux" aria-labelledby="linux">
<div class="platform-icon"><span data-icon="linux"></span></div>

### Linux

Your setup. Your workspace.

<div class="platform-action">

[Linux downloads ↗](https://github.com/openclide/clidable/releases/latest)

</div>
<p class="platform-format">Debian &amp; Fedora families <span>·</span> .deb / .rpm</p>
<p class="platform-alternative">More distributions via the CLI</p>
<details class="platform-details"><summary>Installation notes</summary>

Choose the `.deb` package for **Debian / Ubuntu**, or `.rpm` for **Fedora / RHEL**, matching your processor. For other distributions, see the [standalone CLI options](./getting-started.md#the-clidable-command-browser-ui-servers-scripting).

</details>
</section>
</div>

<div class="release-note"><span data-icon="download"></span><p>Downloads open the latest GitHub release. Expand <strong>Assets</strong> and pick a Clidable installer, not a <code>clidable-server-*</code> binary.</p></div>

<div class="homebrew-panel">
<div class="install-section-label"><span data-icon="terminal"></span> THE TERMINAL ROUTE</div>

### Homebrew

One command, and you’re home.

```bash
brew install --cask openclide/tap/clidable-desktop
```

<details class="install-disclosure"><summary>Homebrew asking for trust?</summary>

Grant trust to this specific app, then run the install command again:

```bash
brew trust --cask openclide/tap/clidable-desktop
```

</details>
</div>

<div class="prerequisites-note"><span data-icon="info"></span><div>

**Bring your agents.** Have Git and at least one CLI agent, such as Claude Code or Codex, installed and signed in on the machine running Clidable. Your agents keep their own logins and billing. [Setup help →](./getting-started.md#2-install-the-prerequisites)

</div></div>
</section>

<section class="server-section">
<div class="install-section-label"><span data-icon="server"></span> YOUR MACHINE. YOUR RULES.</div>

## Server

Same workspace. Wherever your code lives.

<p class="server-description">Run Clidable and your agents on your own server. Connect from a browser on your computer.</p>

<div class="server-steps">
<div class="server-step">
<span class="step-number">01</span>

### Install & run

With **Node and npm** installed, run as your regular user, not root. Install and sign into your agents as that same user.

```bash
npm install -g @clidable/cli
clidable
```

</div>
<div class="server-step">
<span class="step-number">02</span>

### Connect securely

On your computer, replace `you@your-server` with your SSH login. Keep Clidable on its default `127.0.0.1:7878`.

```bash
ssh -N -L 7878:127.0.0.1:7878 you@your-server
```

Leave the tunnel open, then visit [localhost:7878](http://127.0.0.1:7878). Your computer’s local port 7878 must be free.

</div>
</div>

<div class="server-security"><span data-icon="shield"></span><div>

**Keep it private. Do not expose port 7878 publicly.** Clidable has no built-in authentication; anyone who can reach its server can open a terminal. Keep it on localhost and connect through SSH.

</div></div>

Prefer a standalone binary, Tailscale or another protected setup? [Read the server guide →](./remote-vps.md)

</section>

<section class="install-next">
<span class="next-icon"><span data-icon="sparkles"></span></span>
<div>

## Make something good.

Open Clidable, pick your agent and open a project. You’re in.

[Getting started →](./getting-started.md) · [Need a hand?](./troubleshooting.md)

</div>
</section>
