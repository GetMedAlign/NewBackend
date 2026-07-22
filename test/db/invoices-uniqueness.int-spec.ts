/**
 * Follow-up to the billing subsystem 2 review: invoice-generation idempotency
 * and the Stripe webhook's reinstate subquery
 * (`WHERE id = (SELECT clinic_id FROM invoices WHERE stripe_invoice_id = $1)`)
 * are currently only guarded at the application level (a `NOT EXISTS`
 * check). This spec asserts the DB-level backstop: two unique constraints on
 * `invoices` so double-invoicing a clinic/period and a duplicate Stripe
 * invoice id are both impossible at the database.
 *
 * Seeds one throwaway fixture clinic (deleted in afterAll) so the FK on the
 * invoices insert is valid, rather than touching any of the 6 demo-seeded
 * clinics.
 */
import { Pool } from 'pg';

describe('invoices uniqueness', () => {
  let pool: Pool;
  let fixtureClinicId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO clinics (
         slug, name, rating, review_count, telehealth_available, financing_available,
         accepts_insurance, status, billing_status, notify_on_lead, created_at
       )
       VALUES (
         'invoices-uniqueness-fixture', 'Invoices Uniqueness Fixture', 4.5, 1, false, false,
         false, 'active', 'current', false, '2024-01-01T00:00:00Z'
       )
       RETURNING id`,
    );
    fixtureClinicId = rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM invoices WHERE clinic_id = $1`, [fixtureClinicId]);
    await pool.query(`DELETE FROM clinics WHERE id = $1`, [fixtureClinicId]);
    await pool.end();
  });

  it('has a UNIQUE constraint named invoices_clinic_period_key', async () => {
    const { rows } = await pool.query(
      `SELECT constraint_type FROM information_schema.table_constraints
        WHERE table_name = 'invoices' AND constraint_name = 'invoices_clinic_period_key'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].constraint_type).toBe('UNIQUE');
  });

  it('has a UNIQUE constraint named invoices_stripe_invoice_id_key', async () => {
    const { rows } = await pool.query(
      `SELECT constraint_type FROM information_schema.table_constraints
        WHERE table_name = 'invoices' AND constraint_name = 'invoices_stripe_invoice_id_key'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].constraint_type).toBe('UNIQUE');
  });

  it('rejects a second invoice for the same clinic/period', async () => {
    const periodStart = '2025-04-01T00:00:00.000Z';
    const periodEnd = '2025-05-01T00:00:00.000Z';

    await pool.query(
      `INSERT INTO invoices (
         clinic_id, period_start, period_end, lead_count, price_per_lead, platform_fee, total_amount, status
       )
       VALUES ($1, $2, $3, 1, 10.00, 0.00, 10.00, 'draft')`,
      [fixtureClinicId, periodStart, periodEnd],
    );

    await expect(
      pool.query(
        `INSERT INTO invoices (
           clinic_id, period_start, period_end, lead_count, price_per_lead, platform_fee, total_amount, status
         )
         VALUES ($1, $2, $3, 1, 10.00, 0.00, 10.00, 'draft')`,
        [fixtureClinicId, periodStart, periodEnd],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
