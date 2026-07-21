/**
 * One-off backfill: creates a Stripe customer for every already-approved
 * clinic that does not yet have one, so all clinics end up provisioned the
 * same way a NEW approval provisions them (see
 * `ReviewApplicationUseCase.approve`, Task 9). This covers clinics that were
 * approved before Stripe customer creation was wired into the approval flow.
 *
 * Selects clinics with `status <> 'inactive'` (skips inactive/deleted
 * clinics) and `stripe_customer_id IS NULL`. Idempotent: a clinic that
 * already has an id is never selected, so re-running the script (or the
 * per-clinic loop failing partway through and being re-run) is a no-op for
 * clinics already backfilled.
 *
 * Connects via `pg` using DATABASE_URL (mirrors
 * `prisma/seed/cleanup-demo.ts`'s connection + ssl handling). Run it with the
 * SAME env you want to backfill (esp. DATABASE_URL and STRIPE_SECRET_KEY):
 *
 *   pnpm backfill:stripe
 *
 * WARNING: this points at whatever DATABASE_URL resolves to, and the default
 * entry point below talks to the REAL Stripe API (via STRIPE_SECRET_KEY). If
 * DATABASE_URL is prod, running this creates REAL Stripe customers for prod
 * clinics. Double-check both DATABASE_URL and STRIPE_SECRET_KEY first.
 */
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import type { StripePort } from '../../src/modules/billing/domain/ports/stripe.port';
import { StripeAdapter } from '../../src/modules/billing/infrastructure/adapters/stripe.adapter';
import type { Env } from '../../src/infrastructure/config/env.schema';

interface ClinicRow {
  id: string;
  name: string;
  business_email: string | null;
}

/**
 * Core backfill loop, extracted so it can be driven by an integration test
 * with a `FakeStripeAdapter` and the local test pool (never the real Stripe
 * API in tests). A clinic's row is only re-selected here while its
 * `stripe_customer_id` stays NULL, so re-running this function is safe.
 */
export async function backfillWithStripe(pool: Pool, stripe: StripePort): Promise<void> {
  const { rows } = await pool.query<ClinicRow>(
    `SELECT id, name, business_email FROM clinics
      WHERE status <> 'inactive' AND stripe_customer_id IS NULL
      ORDER BY name`,
  );

  console.log(`Found ${rows.length} clinic(s) needing a Stripe customer.`);

  for (const clinic of rows) {
    const email = clinic.business_email ?? '';
    try {
      const customerId = await stripe.createCustomer(clinic.name, email, clinic.id);
      await pool.query(`UPDATE clinics SET stripe_customer_id = $1 WHERE id = $2`, [
        customerId,
        clinic.id,
      ]);
      console.log(`  OK   ${clinic.id}  ${clinic.name}  -> ${customerId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL ${clinic.id}  ${clinic.name}  -> ${message}`);
    }
  }
}

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set to run the Stripe backfill.');
  }

  const pool = new Pool({
    connectionString,
    ssl:
      connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: false },
  });

  // Real StripeAdapter — reads STRIPE_SECRET_KEY from process.env (loaded via
  // `-r dotenv/config`). This is the one place this script touches the real
  // Stripe network.
  const stripe: StripePort = new StripeAdapter(new ConfigService<Env, true>());

  console.log(
    `Backfilling Stripe customers against ${connectionString.split('@')[1] ?? 'the database'} ...`,
  );
  try {
    await backfillWithStripe(pool, stripe);
    console.log('Backfill complete.');
  } finally {
    await pool.end();
  }
}

// Guarded so importing `backfillWithStripe` (e.g. from the integration test,
// which drives it with a FakeStripeAdapter) never triggers the real entry
// point / real Stripe network calls — only running this file directly does.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
