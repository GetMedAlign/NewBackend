/**
 * Integration test for `backfillWithStripe` (prisma/scripts/backfill-stripe-customers.ts)
 * against a live local Postgres (DATABASE_URL from test/.env.test).
 *
 * Drives the extracted core loop with a `FakeStripeAdapter` (never the real
 * Stripe network) and the local `pg` Pool. Verifies:
 *   - a clinic missing a `stripe_customer_id` gets one created and stored.
 *   - re-running is a no-op: no second Stripe call, the id is unchanged.
 *   - an inactive clinic is skipped even though its id is null.
 */
import { Pool } from 'pg';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { FakeStripeAdapter } from '../../src/modules/billing/infrastructure/adapters/fake-stripe.adapter';
import { backfillWithStripe } from '../../prisma/scripts/backfill-stripe-customers';

describe('backfillWithStripe', () => {
  let service: PrismaService;
  let pool: Pool;
  let clinicId: string;
  let inactiveClinicId: string;
  // Ids of OTHER (pre-existing, e.g. demo-seeded) clinics that already had a
  // null stripe_customer_id before this suite ran. backfillWithStripe has no
  // way to scope itself to just our fixtures (nor should it — that mirrors
  // real usage), so it will also backfill these. Restore them to null
  // afterwards so this suite leaves shared local DB state exactly as found.
  let preExistingNullIds: string[] = [];

  beforeAll(async () => {
    service = new PrismaService();
    await service.onModuleInit();
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

    const preExisting = await pool.query<{ id: string }>(
      `SELECT id FROM clinics WHERE status <> 'inactive' AND stripe_customer_id IS NULL`,
    );
    preExistingNullIds = preExisting.rows.map((r) => r.id);

    const rows = await service.asSystem(
      (client) => client.$queryRaw<{ id: string }[]>`
        INSERT INTO clinics (
          slug, name, rating, review_count, telehealth_available, financing_available,
          accepts_insurance, status, billing_status, notify_on_lead, business_email
        )
        VALUES (
          'backfill-int-clinic', 'Backfill Int Test Clinic', 4.0, 0, false, false, false,
          'active', 'no_card', false, 'backfill-int@test.example.com'
        )
        RETURNING id
      `,
    );
    clinicId = rows[0]!.id;

    const inactiveRows = await service.asSystem(
      (client) => client.$queryRaw<{ id: string }[]>`
        INSERT INTO clinics (
          slug, name, rating, review_count, telehealth_available, financing_available,
          accepts_insurance, status, billing_status, notify_on_lead
        )
        VALUES (
          'backfill-int-inactive-clinic', 'Backfill Int Inactive Clinic', 4.0, 0, false, false,
          false, 'inactive', 'no_card', false
        )
        RETURNING id
      `,
    );
    inactiveClinicId = inactiveRows[0]!.id;
  });

  afterAll(async () => {
    if (preExistingNullIds.length > 0) {
      await pool.query(`UPDATE clinics SET stripe_customer_id = NULL WHERE id = ANY($1::uuid[])`, [
        preExistingNullIds,
      ]);
    }
    await service.asSystem(
      (client) => client.$executeRaw`DELETE FROM clinics WHERE id = ${clinicId}::uuid`,
    );
    await service.asSystem(
      (client) => client.$executeRaw`DELETE FROM clinics WHERE id = ${inactiveClinicId}::uuid`,
    );
    await service.onModuleDestroy();
    await pool.end();
  });

  it('creates a Stripe customer for a clinic missing one, then is a no-op on re-run', async () => {
    const fakeStripe = new FakeStripeAdapter();
    const createSpy = jest.spyOn(fakeStripe, 'createCustomer');

    await backfillWithStripe(pool, fakeStripe);

    const afterFirst = await pool.query<{ stripe_customer_id: string | null }>(
      'SELECT stripe_customer_id FROM clinics WHERE id = $1',
      [clinicId],
    );
    expect(afterFirst.rows[0]!.stripe_customer_id).not.toBeNull();
    const firstCallCount = createSpy.mock.calls.length;
    expect(firstCallCount).toBeGreaterThanOrEqual(1);
    const firstCustomerId = afterFirst.rows[0]!.stripe_customer_id;

    // Second run: idempotent for this clinic — no new Stripe call touches
    // it, and its stored id is unchanged.
    await backfillWithStripe(pool, fakeStripe);
    const secondCallClinicIds = createSpy.mock.calls.slice(firstCallCount).map((args) => args[2]);
    expect(secondCallClinicIds).not.toContain(clinicId);

    const afterSecond = await pool.query<{ stripe_customer_id: string | null }>(
      'SELECT stripe_customer_id FROM clinics WHERE id = $1',
      [clinicId],
    );
    expect(afterSecond.rows[0]!.stripe_customer_id).toBe(firstCustomerId);
  });

  it('skips inactive clinics even without a stripe_customer_id', async () => {
    const fakeStripe = new FakeStripeAdapter();

    await backfillWithStripe(pool, fakeStripe);

    const after = await pool.query<{ stripe_customer_id: string | null }>(
      'SELECT stripe_customer_id FROM clinics WHERE id = $1',
      [inactiveClinicId],
    );
    expect(after.rows[0]!.stripe_customer_id).toBeNull();
  });
});
