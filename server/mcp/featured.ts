/**
 * Featured MCP servers — the curated catalog Discover renders instantly at
 * rest, before any registry round-trip (ported from claude-code-chat's
 * `top-mcp-servers.json`, same author/curation). Registry results merge in
 * on top of these; dedupe is by `id`, featured entries win.
 *
 * Data, not code: keep entries in the `DiscoverMcpInfo` wire shape so the
 * route returns them verbatim. Secret names (env/headers) drive the install
 * flow's value collection.
 */
import type { DiscoverMcpInfo } from "../../shared/types";

const stdio = (
  id: string,
  name: string,
  description: string,
  url: string,
  args: string[],
  envNames: string[] = [],
  command = "npx",
): DiscoverMcpInfo => ({
  id,
  name,
  description,
  url,
  transport: "stdio",
  command,
  args,
  serverUrl: null,
  headerNames: [],
  envNames,
});

const remote = (
  id: string,
  name: string,
  description: string,
  url: string,
  serverUrl: string,
  headerNames: string[] = [],
  transport: "http" | "sse" = "http",
): DiscoverMcpInfo => ({
  id,
  name,
  description,
  url,
  transport,
  command: null,
  args: [],
  serverUrl,
  headerNames,
  envNames: [],
});

export const FEATURED_MCP_SERVERS: DiscoverMcpInfo[] = [
  stdio("sequential-thinking", "Sequential Thinking", "Step-by-step reasoning capabilities", "", ["-y", "@modelcontextprotocol/server-sequential-thinking"]),
  stdio("memory", "Memory", "Knowledge graph storage", "", ["-y", "@modelcontextprotocol/server-memory"]),
  stdio("puppeteer", "Puppeteer", "Browser automation", "", ["-y", "@modelcontextprotocol/server-puppeteer"]),
  // The official fetch server is Python-only — `uvx`, not npx.
  stdio("fetch", "Fetch", "HTTP requests & web scraping", "", ["mcp-server-fetch"], [], "uvx"),
  stdio("filesystem", "Filesystem", "File operations & management", "", ["-y", "@modelcontextprotocol/server-filesystem"]),
  stdio("io.github.upstash/context7", "Context7", "Up-to-date code docs for any prompt", "https://github.com/upstash/context7", ["-y", "@upstash/context7-mcp"], ["CONTEXT7_API_KEY"]),
  remote("com.airtable/mcp", "Airtable", "Official Airtable MCP server for managing bases, tables, and records.", "", "https://mcp.airtable.com/mcp", ["Authorization"]),
  remote("com.apify/mcp", "Apify", "Extract data from social media, search engines, maps, e-commerce sites, and any website using thousands of ready-made tools from Apify Store.", "https://github.com/apify/apify-mcp-server", "https://mcp.apify.com"),
  stdio("io.github.browserbase/mcp-server-browserbase", "Browserbase", "MCP server for AI web browser automation using Browserbase and Stagehand", "https://github.com/browserbase/mcp-server-browserbase", ["-y", "@browserbasehq/mcp-server-browserbase"], ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID", "GEMINI_API_KEY"]),
  remote("io.github.clerk/mcp-server", "Clerk", "Access Clerk authentication docs, SDK snippets, and quickstart guides", "https://clerk.com/docs/guides/ai/mcp/clerk-mcp-server", "https://mcp.clerk.com/mcp"),
  remote("com.cloudflare.mcp/mcp", "Cloudflare", "Cloudflare MCP servers", "https://github.com/cloudflare/mcp-server-cloudflare", "https://docs.mcp.cloudflare.com/mcp"),
  remote("ai.exa/mcp", "Exa", "Web search and code search MCP server powered by Exa", "https://github.com/exa-labs/exa-mcp-server", "https://mcp.exa.ai/mcp"),
  remote("com.figma/mcp", "Figma", "Official Figma MCP server for accessing design files, components, and design context", "https://help.figma.com/hc/en-us/articles/35281350665623", "https://mcp.figma.com/mcp"),
  remote("dev.firecrawl/mcp", "Firecrawl", "Web scraping, crawling, search, and structured data extraction powered by Firecrawl.", "https://github.com/firecrawl/firecrawl-mcp-server", "https://mcp.firecrawl.dev/v2/mcp", ["Authorization"]),
  remote("io.github.github/github-mcp-server", "GitHub", "Official GitHub MCP server for repos, issues, PRs, and workflows", "https://github.com/github/github-mcp-server", "https://api.githubcopilot.com/mcp/"),
  // Linear retired the /sse endpoint (404s); /mcp is the live streamable-HTTP one.
  remote("app.linear/linear", "Linear", "MCP server for Linear project management and issue tracking", "", "https://mcp.linear.app/mcp"),
  remote("com.mux/mcp", "Mux", "The official MCP Server for the Mux API", "https://github.com/muxinc/mux-node-sdk", "https://mcp.mux.com", ["Authorization"]),
  remote("com.neon/mcp", "Neon", "Official Neon MCP server for managing Neon projects and Postgres databases.", "https://github.com/neondatabase/mcp-server-neon", "https://mcp.neon.tech/mcp", ["Authorization", "x-read-only"]),
  stdio("com.netlify/mcp", "Netlify", "Netlify's official MCP server for builds, deploys, and project management.", "https://github.com/netlify/netlify-mcp", ["-y", "@netlify/mcp"], ["NETLIFY_PERSONAL_ACCESS_TOKEN"]),
  stdio("io.github.vercel/next-devtools-mcp", "Next.js Devtools", "Next.js development tools MCP server with stdio transport", "https://github.com/vercel/next-devtools-mcp", ["-y", "next-devtools-mcp"]),
  remote("com.notion/mcp", "Notion", "Official Notion MCP server", "", "https://mcp.notion.com/mcp"),
  stdio("io.github.railwayapp/mcp-server", "Railway", "Official Railway MCP server", "https://github.com/railwayapp/railway-mcp-server", ["-y", "@railway/mcp-server"]),
  remote("com.render/mcp", "Render", "Official Render MCP server for managing Render resources.", "https://github.com/render-oss/render-mcp-server", "https://mcp.render.com/mcp", ["Authorization"]),
  stdio("com.resend/mcp", "Resend", "Official Resend MCP server for email operations and audience management.", "https://github.com/resend/mcp-send-email", ["-y", "resend-mcp"], ["RESEND_API_KEY"]),
  remote("io.sanity.www/mcp", "Sanity", "Direct access to your Sanity projects (content, datasets, releases, schemas) and agent rules", "https://github.com/sanity-io/agent-toolkit", "https://mcp.sanity.io"),
  stdio("io.github.getsentry/sentry-mcp", "Sentry", "MCP server for Sentry issue tracking and debugging", "https://github.com/getsentry/sentry-mcp", ["-y", "@sentry/mcp-server"], ["SENTRY_ACCESS_TOKEN"]),
  remote("com.slack/mcp", "Slack", "Official Slack MCP server for search, messaging, canvases, and users.", "https://github.com/slackapi/slack-mcp-plugin", "https://mcp.slack.com/mcp"),
  remote("com.stripe/mcp", "Stripe", "Official Stripe MCP server for Stripe API tools.", "https://github.com/stripe/agent-toolkit", "https://mcp.stripe.com"),
  remote("com.supabase/mcp", "Supabase", "MCP server for interacting with the Supabase platform", "https://github.com/supabase-community/supabase-mcp", "https://mcp.supabase.com/mcp"),
  remote("com.vercel/vercel-mcp", "Vercel", "An MCP server for Vercel", "https://github.com/vercel/vercel-mcp-overview", "https://mcp.vercel.com"),
];
