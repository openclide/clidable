/**
 * "View source" → wherever a catalog entry actually came from.
 *
 * Shared by the Plugins, Skills and MCP detail panels. Renders NOTHING when the
 * entry's `source` isn't linkable (an npm package name, a bare command, a
 * marketplace alias, a local path) — which is the point: Skills and MCP used to
 * render this as a styled button with no href and no handler, so it invited a
 * click and did nothing.
 */
import { ExternalLink } from "./ExternalLink";
import { sourceUrl } from "../../lib/source-url";

export function ViewSource({ source }: { source: string }) {
  const url = sourceUrl(source);
  if (!url) return null;
  return <ExternalLink href={url}>View source</ExternalLink>;
}
