/**
 * /api/billing — invoices + plan changes. Plan changes are eventually
 * consistent: we update Stripe first, then mirror back into our DB
 * when the webhook fires. The endpoint returns 202 to make that
 * contract obvious to callers.
 */
import Stripe from "stripe";
import { sql } from "../db";
import type { Invoice, Plan, Session } from "../types";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-06-20",
});

const PLAN_PRICE: Record<Plan, string | null> = {
  free: null,
  starter: "price_starter_monthly",
  pro: "price_pro_monthly",
  enterprise: "price_enterprise_monthly",
};

export async function handleBilling(
  req: Request,
  session: Session,
): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/api/billing/invoices" && req.method === "GET") {
    const rows = await sql<Invoice[]>`
      SELECT id, org_id AS "orgId", amount, currency, status, issued_at AS "issuedAt"
      FROM invoices
      WHERE org_id = ${session.orgId}
      ORDER BY issued_at DESC
    `;
    return Response.json({ invoices: rows });
  }

  if (url.pathname === "/api/billing/plan" && req.method === "PUT") {
    const { plan } = (await req.json()) as { plan: Plan };
    const price = PLAN_PRICE[plan];
    if (price === undefined) {
      return new Response("Invalid plan", { status: 400 });
    }

    if (price !== null) {
      // Update Stripe subscription; webhook mirrors back into DB.
      await stripe.subscriptions.update(`sub_${session.orgId}`, {
        items: [{ price }],
        proration_behavior: "create_prorations",
      });
    }
    return new Response(null, { status: 202 });
  }

  return new Response("Method not allowed", { status: 405 });
}
