/**
 * Postgres client. Re-exported as the tagged-template `sql` helper so
 * call sites read like plain SQL with safe interpolation.
 */
import postgres from "postgres";

export const sql = postgres(process.env.DATABASE_URL ?? "", {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 5,
});
