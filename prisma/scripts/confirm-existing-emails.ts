/**
 * One-time backfill: marks every EXISTING user's email as confirmed
 * (`email_confirmed = true`).
 *
 * Run this once, before (or together with) the release that gates sign-in on
 * email confirmation. Accounts created before that release default to
 * `email_confirmed = false`; without this backfill the sign-in gate would lock
 * every one of them out. New signups after the release still go through the
 * real confirmation flow, so run this exactly once at cutover, not on a
 * schedule.
 *
 * Idempotent: only rows with `email_confirmed = false` are touched, so
 * re-running is a no-op once everyone is confirmed.
 *
 * Connects via `pg` using DATABASE_URL (same connection + ssl handling as
 * `prisma/seed/cleanup-demo.ts` and `backfill-stripe-customers.ts`). Run it with
 * the SAME env whose database you want to backfill (esp. DATABASE_URL):
 *
 *   pnpm backfill:confirm-emails
 *
 * WARNING: this points at whatever DATABASE_URL resolves to. If DATABASE_URL is
 * prod, it confirms every existing prod account. Double-check DATABASE_URL first.
 */
import { Pool } from 'pg';

/**
 * Core backfill, extracted so it can be driven by an integration test against
 * the local test pool. Returns the number of accounts newly confirmed.
 */
export async function confirmExistingEmails(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM users WHERE email_confirmed = false`,
  );
  const pending = Number(rows[0]?.count ?? '0');
  console.log(`Found ${pending} account(s) with an unconfirmed email.`);

  const result = await pool.query(
    `UPDATE users SET email_confirmed = true WHERE email_confirmed = false`,
  );
  const updated = result.rowCount ?? 0;
  console.log(`Confirmed ${updated} account(s).`);
  return updated;
}

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set to run the email-confirmation backfill.');
  }

  const pool = new Pool({
    connectionString,
    ssl:
      connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: false },
  });

  console.log(
    `Confirming existing emails against ${connectionString.split('@')[1] ?? 'the database'} ...`,
  );
  try {
    await confirmExistingEmails(pool);
    console.log('Backfill complete.');
  } finally {
    await pool.end();
  }
}

// Guarded so importing `confirmExistingEmails` (e.g. from a test) never triggers
// the entry point — only running this file directly does.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
