/**
 * Shared domain types. Kept structural rather than nominal so they
 * cross the wire (REST, queue payloads, audit log) without adapters.
 */

export type UserId = string;
export type OrgId = string;

export type Plan = "free" | "starter" | "pro" | "enterprise";

export interface User {
  id: UserId;
  email: string;
  name: string;
  /** ms since epoch */
  createdAt: number;
  /** ms since epoch, null if never */
  lastLoginAt: number | null;
}

export interface Org {
  id: OrgId;
  name: string;
  plan: Plan;
  /** monthly seats included in the plan */
  seats: number;
  /** ms since epoch when the trial converts (or null if not on trial) */
  trialEndsAt: number | null;
}

export interface Session {
  userId: UserId;
  orgId: OrgId;
  /** unix seconds */
  expiresAt: number;
}

export interface Invoice {
  id: string;
  orgId: OrgId;
  /** cents */
  amount: number;
  currency: "USD" | "EUR" | "GBP";
  status: "draft" | "open" | "paid" | "void";
  /** ms since epoch */
  issuedAt: number;
}
