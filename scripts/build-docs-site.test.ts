import { describe, expect, test } from "bun:test";
import { pageHtml, renderDocumentation } from "./build-docs-site";
import { decorateInstall, installIcon, INSTALL_CSS } from "./docs-install";

describe("installation documentation", () => {
  test("builds the full documentation graph without broken internal links", () => {
    const pages = renderDocumentation();
    expect(pages.some((page) => page.file === "install.html")).toBe(true);
    expect(pages.some((page) => page.file === "getting-started.html")).toBe(true);
    expect(pages.some((page) => page.file === "remote-vps.html")).toBe(true);
  });

  test("renders platform choices whose anchors exist", () => {
    const install = renderDocumentation().find((page) => page.file === "install.html")!;
    expect(install.title).toBe("Install Clidable");
    for (const id of ["desktop", "macos", "windows", "linux", "homebrew", "server"]) {
      expect(install.ids.has(id)).toBe(true);
    }
    for (const [, id] of install.body.matchAll(/href="#([^"]+)"/g)) expect(install.ids.has(id!)).toBe(true);
    expect(install.body).toContain('aria-label="Choose your installation"');
  });

  test("uses a stable latest-release link and copyable install commands", () => {
    const install = renderDocumentation().find((page) => page.file === "install.html")!;
    expect(install.body.match(/href="https:\/\/github.com\/openclide\/clidable\/releases\/latest"/g)).toHaveLength(3);
    expect(install.body).not.toContain("/releases/download/v");
    for (const command of [
      "brew install --cask openclide/tap/clidable-desktop",
      "brew trust --cask openclide/tap/clidable-desktop",
      "npm install -g @clidable/cli",
      "ssh -N -L 7878:127.0.0.1:7878 you@your-server",
    ]) {
      expect(install.body).toContain(command);
    }
    expect(install.body.match(/<pre><code/g)).toHaveLength(4);
    expect(install.body).toContain("npm install -g @clidable/cli\nclidable\n");
  });

  test("explains prerequisites and keeps remote access private", () => {
    const install = renderDocumentation().find((page) => page.file === "install.html")!;
    expect(install.body).toContain("Node and npm");
    expect(install.body).toContain("not root");
    expect(install.body).toContain("no built-in authentication");
    expect(install.body).toContain("Do not expose port 7878 publicly");
    expect(install.links).toContainEqual({
      from: "install.md",
      href: "./remote-vps.md",
      file: "remote-vps.html",
      hash: "",
    });
  });

  test("gives installation its own download layout and handles clipboard failure", () => {
    const pages = renderDocumentation();
    const index = pages.findIndex((page) => page.file === "install.html");
    const html = pageHtml(pages[index]!, index, pages);
    expect(html).toContain("<title>Install Clidable</title>");
    expect(html).toContain('href="./docs.css"');
    expect(html).toContain('<body class="install-page">');
    expect(html).toContain('class="install-skip" href="#desktop"');
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).not.toContain('<aside class="side">');
    expect(html).not.toContain('<nav class="pager">');
    expect(html).toContain('btn.setAttribute("aria-label", "Copy command")');
    expect(html).toContain('btn.textContent = "Select & copy"');
  });

  test("renders locally bundled platform icons without duplicate accessible names", () => {
    const install = renderDocumentation().find((page) => page.file === "install.html")!;
    const body = decorateInstall(install.body);
    for (const name of ["apple", "windows", "linux", "terminal", "server", "shield"]) {
      expect(body).toContain(`<svg class="install-icon" data-icon="${name}"`);
      expect(installIcon(name)).toContain('aria-hidden="true" focusable="false"');
    }
    expect(body).not.toContain('<span data-icon=');
    expect(() => installIcon("missing")).toThrow("Unknown installation icon");
    expect(INSTALL_CSS).toContain("@media (max-width: 680px)");
    expect(INSTALL_CSS).toContain("@media (prefers-reduced-motion: reduce)");
  });

  test("keeps the other documentation pages in the existing layout", () => {
    const pages = renderDocumentation();
    const index = pages.findIndex((page) => page.file === "getting-started.html");
    const html = pageHtml(pages[index]!, index, pages);
    expect(html).toContain(" · Clidable Docs</title>");
    expect(html).toContain('<aside class="side">');
    expect(html).toContain('href="./install.html">Install Clidable</a>');
    expect(html).not.toContain('<body class="install-page">');
  });
});
