/**
 * Seed script — wipes and re-populates the local DB with a handful of
 * users, orgs, and a couple of invoices. Safe to run repeatedly.
 *
 *   bun run scripts/seed.ts
 */
import { sql } from "../src/db";

const ORGS = [
  { id: "org_acme", name: "Acme Inc.", plan: "pro" as const, seats: 25 },
  { id: "org_initech", name: "Initech", plan: "starter" as const, seats: 5 },
];

const USERS = [
  { id: "usr_1", orgId: "org_acme", email: "ann@acme.test", name: "Ann" },
  { id: "usr_2", orgId: "org_acme", email: "bob@acme.test", name: "Bob" },
  { id: "usr_3", orgId: "org_initech", email: "peter@initech.test", name: "Peter" },
];

async function main(): Promise<void> {
  console.log("Wiping…");
  await sql`TRUNCATE invoices, users, orgs RESTART IDENTITY CASCADE`;

  console.log("Inserting orgs…");
  for (const o of ORGS) {
    await sql`
      INSERT INTO orgs (id, name, plan, seats, trial_ends_at)
      VALUES (${o.id}, ${o.name}, ${o.plan}, ${o.seats}, NULL)
    `;
  }

  console.log("Inserting users…");
  for (const u of USERS) {
    await sql`
      INSERT INTO users (id, org_id, email, name, created_at, last_login_at)
      VALUES (${u.id}, ${u.orgId}, ${u.email}, ${u.name}, NOW(), NULL)
    `;
  }

  console.log("Done.");
  await sql.end();
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
