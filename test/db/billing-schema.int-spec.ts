import { Pool } from 'pg';

describe('billing schema', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  });
  afterAll(async () => {
    await pool.end();
  });

  it('creates billing_profiles and invoices', async () => {
    const { rows } = await pool.query(
      `SELECT to_regclass('public.billing_profiles') AS bp, to_regclass('public.invoices') AS inv`,
    );
    expect(rows[0].bp).not.toBeNull();
    expect(rows[0].inv).not.toBeNull();
  });

  it('makes billing_profiles.clinic_id unique and cascade', async () => {
    const { rows } = await pool.query(
      `SELECT rc.delete_rule
         FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name
        WHERE kcu.table_name = 'billing_profiles' AND kcu.column_name = 'clinic_id'`,
    );
    expect(rows[0].delete_rule).toBe('CASCADE');
    const uq = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'billing_profiles' AND constraint_type = 'UNIQUE'`,
    );
    expect(uq.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('adds the three clinics billing columns', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'clinics'
          AND column_name IN ('stripe_customer_id','subscription_active_through','subscription_cancelled_at')
        ORDER BY column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'stripe_customer_id',
      'subscription_active_through',
      'subscription_cancelled_at',
    ]);
  });

  it('defaults invoices.status to draft', async () => {
    const { rows } = await pool.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'invoices' AND column_name = 'status'`,
    );
    expect(rows[0].column_default).toContain('draft');
  });

  it('indexes invoices by clinic and period', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'invoices' AND indexname = 'invoices_clinic_period_idx'`,
    );
    expect(rows).toHaveLength(1);
  });
});
