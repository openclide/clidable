/**
 * Session verification. JWTs are HS256-signed with `JWT_SECRET`. We
 * deliberately don't refresh tokens on every request — a session lives
 * for `SESSION_TTL_HOURS` and the client requests a new one when the
 * old one is within 10% of expiry. This keeps the hot path cheap and
 * the audit log readable.
 */
import { jwtVerify, SignJWT } from "jose";
import type { Session, UserId, OrgId } from "./types";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "");
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 24);

if (SECRET.length === 0) {
  throw new Error("JWT_SECRET is required");
}

export async function issueSession(
  userId: UserId,
  orgId: OrgId,
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_HOURS * 3600;
  return await new SignJWT({ userId, orgId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(SECRET);
}

export async function verifySession(req: Request): Promise<Session | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (typeof payload.exp !== "number") return null;
    return {
      userId: String(payload.userId),
      orgId: String(payload.orgId),
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}
