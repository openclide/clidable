/**
 * acme-saas — single-process API server.
 *
 * Routes are mounted under `/api/` and authenticated via a Bearer JWT
 * issued by `/api/auth/login`. Long-running jobs (Stripe webhooks,
 * email send) go through a Redis-backed queue; the handlers below
 * only enqueue, never block.
 */
import { serve } from "bun";
import { handleBilling } from "./api/billing";
import { handleUsers } from "./api/users";
import { verifySession } from "./auth";

const PORT = Number(process.env.PORT ?? 3000);

const server = serve({
  port: PORT,

  async fetch(req) {
    const url = new URL(req.url);

    // Health check (intentionally unauthenticated)
    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, ts: Date.now() });
    }

    // Auth gate — everything else requires a session.
    const session = await verifySession(req);
    if (!session) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (url.pathname.startsWith("/api/users")) {
      return handleUsers(req, session);
    }
    if (url.pathname.startsWith("/api/billing")) {
      return handleBilling(req, session);
    }

    return new Response("Not found", { status: 404 });
  },

  error(err) {
    console.error("[server] unhandled", err);
    return new Response("Internal error", { status: 500 });
  },
});

console.log(`acme-saas listening on http://localhost:${server.port}`);
