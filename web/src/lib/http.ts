/**
 * Shared fetch helpers for the workspace API clients (skills / mcp / plugins /
 * context). One place for parsing the server's `{ ok:false, error }` envelope,
 * so every client surfaces the server's message verbatim, falling back to
 * "<label> (<status>)".
 */

/** Throw the server's error message on a non-OK response; otherwise parse JSON. */
export async function jsonOrThrow<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${label} (${res.status})`);
  }
  return (await res.json()) as T;
}

/** GET a URL and parse JSON (or throw the server's error). */
export async function getJson<T>(url: string, label: string): Promise<T> {
  return jsonOrThrow<T>(await fetch(url), label);
}

/** POST a JSON body and parse the JSON response (or throw the server's error). */
export async function postJson<T>(
  url: string,
  body: unknown,
  label = "request failed",
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<T>(res, label);
}
