/**
 * /api/users — list, fetch, update org members. All routes are scoped
 * to the caller's org via `session.orgId`; the DB queries below all
 * include that as a WHERE clause so no leakage is possible from the
 * handler layer.
 */
import { sql } from "../db";
import type { Session, User } from "../types";

export async function handleUsers(
  req: Request,
  session: Session,
): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/api/users" && req.method === "GET") {
    const rows = await sql<User[]>`
      SELECT id, email, name, created_at AS "createdAt", last_login_at AS "lastLoginAt"
      FROM users
      WHERE org_id = ${session.orgId}
      ORDER BY created_at DESC
    `;
    return Response.json({ users: rows });
  }

  const match = url.pathname.match(/^\/api\/users\/([\w-]+)$/);
  if (match && req.method === "GET") {
    const [user] = await sql<User[]>`
      SELECT id, email, name, created_at AS "createdAt", last_login_at AS "lastLoginAt"
      FROM users
      WHERE org_id = ${session.orgId} AND id = ${match[1]}
      LIMIT 1
    `;
    if (!user) return new Response("Not found", { status: 404 });
    return Response.json(user);
  }

  return new Response("Method not allowed", { status: 405 });
}
