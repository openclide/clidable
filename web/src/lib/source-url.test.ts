import { describe, expect, test } from "bun:test";
import { sourceUrl } from "./source-url";

/**
 * The Skills and MCP panels used to render "View source" as a styled button
 * with no href and no handler — it looked clickable and did nothing. Now the
 * link renders only when `source` is actually resolvable, so the null cases
 * matter as much as the positive ones.
 */
describe("sourceUrl", () => {
  test("owner/repo slugs become GitHub URLs", () => {
    expect(sourceUrl("vercel-labs/skills")).toBe("https://github.com/vercel-labs/skills");
    expect(sourceUrl("github/github-mcp-server")).toBe(
      "https://github.com/github/github-mcp-server",
    );
    expect(sourceUrl("openclide/clidable.git")).toBe(
      "https://github.com/openclide/clidable.git",
    );
  });

  test("full URLs pass through (remote MCP endpoints)", () => {
    expect(sourceUrl("https://mcp.render.com/mcp")).toBe("https://mcp.render.com/mcp");
    expect(sourceUrl("http://example.com/x")).toBe("http://example.com/x");
  });

  test("returns null for anything unlinkable, so no dead affordance renders", () => {
    expect(sourceUrl("")).toBeNull();
    expect(sourceUrl("   ")).toBeNull();
    // npm package names — scoped and bare.
    expect(sourceUrl("@modelcontextprotocol/server-postgres")).toBeNull();
    expect(sourceUrl("opencode-ai")).toBeNull();
    // A bare command, a marketplace alias, a local path.
    expect(sourceUrl("npx some-server --flag")).toBeNull();
    expect(sourceUrl("anthropics")).toBeNull();
    expect(sourceUrl("/Users/me/code/my-skill")).toBeNull();
    // Not a scheme we open.
    expect(sourceUrl("file:///etc/passwd")).toBeNull();
    expect(sourceUrl("javascript:alert(1)")).toBeNull();
  });

  test("surrounding whitespace doesn't defeat the match", () => {
    expect(sourceUrl("  vercel-labs/skills  ")).toBe("https://github.com/vercel-labs/skills");
  });
});
