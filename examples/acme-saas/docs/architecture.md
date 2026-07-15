# Architecture

acme-saas is a single-process Bun server fronted by Cloudflare. Persistence
is Postgres (primary) + Redis (queues, ephemeral state). Stripe owns billing
state; we mirror it into Postgres on webhook.

```
                ┌─────────────┐
   Browser ───► │ Cloudflare  │ ───► Bun (server.ts)
                └─────────────┘           │
                                          ├──► Postgres   (state of record)
                                          ├──► Redis      (queues, sessions)
                                          └──► Stripe API (billing)
```

## Why a single process

We started on a microservices split — auth, billing, users, audit log — and
hit the usual issues: stack traces stopped at network boundaries, schema
migrations had to land in lock-step, and every new junior engineer asked
"where do I add this endpoint?" 14 times.

The current monolith is ~8 kLOC and routes are co-located with their data.
We'll split a service out when one of them has independent scaling pressure
— right now everything peaks at the same time of day so there's nothing to
gain.

## Sessions

JWTs, HS256, 24-hour TTL. The client refreshes when it's within 10% of
expiry — see `src/auth.ts`. No refresh tokens; if your session expires
you log in again.

## Billing eventual consistency

Plan changes hit Stripe first, then mirror back via the `customer.subscription.updated`
webhook. The PUT endpoint returns **202 Accepted**, not 200 — callers
should treat the plan as in-flight for ~2s. The UI optimistically updates
and reconciles on webhook ACK.
