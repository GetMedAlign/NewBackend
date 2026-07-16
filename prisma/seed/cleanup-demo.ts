/**
 * Removes the demo/seed rows created by `prisma/seed/patient-journey.seed.ts`.
 *
 * Every delete is SCOPED to the seed's own identifiers, so it can only ever
 * touch seeded demo data, never real records:
 *   - users:    email ends with `@medalign-seed.example.com`
 *   - leads:    `lead_id` starts with `lead_seed`
 *   - assessments: `session_id` starts with `session_seed`
 *   - clinics:  the fixed demo slugs from `clinics.ts`
 *
 * Deletes run in FK-safe order (children before parents) inside one
 * transaction, so it is all-or-nothing and idempotent (re-running is a no-op
 * once the rows are gone). `zip_codes` are generic reference data and are left
 * in place.
 *
 * Connects as the `postgres` role via DATABASE_URL (bypasses RLS), same as the
 * seed. Run it with the SAME env you seeded with (esp. DATABASE_URL):
 *
 *   pnpm exec ts-node -r dotenv/config -P tsconfig.json prisma/seed/cleanup-demo.ts
 *
 * WARNING: this points at whatever DATABASE_URL resolves to. If that is prod,
 * it deletes the demo data from prod. Double-check DATABASE_URL first.
 */
import { Pool } from 'pg';
import { CLINICS } from './clinics';

/**
 * Set to `true` to KEEP the six demo clinics (and their categories/services/
 * photos) and remove only the patient/lead/assessment/delivery demo data.
 * Default `false` = full clean, including the demo clinics.
 */
const KEEP_CLINICS = false;

const SEED_EMAIL_SUFFIX = '@medalign-seed.example.com';
const DEMO_CLINIC_SLUGS = CLINICS.map((c) => c.slug);
// The two seeded pending clinic applications, keyed by their unique clinic names.
const DEMO_APPLICATION_CLINIC_NAMES = ['Horizon Hormone Health', 'Summit Wellness Collective'];

async function cleanup(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set to run the demo cleanup.');
  }

  const pool = new Pool({
    connectionString,
    ssl:
      connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
        ? undefined
        : { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  const report: Record<string, number> = {};
  const del = async (label: string, sql: string, params: unknown[] = []): Promise<void> => {
    const res = await client.query(sql, params);
    report[label] = res.rowCount ?? 0;
  };

  try {
    console.log(`Cleaning demo data from ${connectionString.split('@')[1] ?? 'the database'} ...`);
    await client.query('BEGIN');

    // 1. webhook_deliveries -> leads is RESTRICT: delete deliveries first.
    await del(
      'webhook_deliveries',
      `DELETE FROM webhook_deliveries
       WHERE lead_id IN (SELECT id FROM leads WHERE lead_id LIKE 'lead_seed%')`,
    );

    // 2. leads -> clinics/assessments/patients: delete before clinics (RESTRICT).
    await del('leads', `DELETE FROM leads WHERE lead_id LIKE 'lead_seed%'`);

    // 3. patient_assessments (cascades assessment_goals/symptoms/etc).
    await del(
      'patient_assessments',
      `DELETE FROM patient_assessments WHERE session_id LIKE 'session_seed%'`,
    );

    // 4. patients for the seeded patient users (before users).
    await del(
      'patients',
      `DELETE FROM patients
       WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%' || $1)`,
      [SEED_EMAIL_SUFFIX],
    );

    // 5. demo clinics (cascades clinic_categories/services/photos). Guarded by
    //    KEEP_CLINICS; leads referencing them were already removed above.
    if (!KEEP_CLINICS) {
      await del('clinics', `DELETE FROM clinics WHERE slug = ANY($1::text[])`, [DEMO_CLINIC_SLUGS]);
    } else {
      report['clinics'] = 0;
    }

    // 6. seed users (cascades user_roles, two_factor_codes, password_reset_tokens,
    //    and any remaining patients). Covers clinic + patient + superadmin seed
    //    users, since all use the seed email domain.
    await del('users', `DELETE FROM users WHERE email LIKE '%' || $1`, [SEED_EMAIL_SUFFIX]);

    // 7. seeded pending clinic applications (cascades application_categories/services).
    await del(
      'clinic_applications',
      `DELETE FROM clinic_applications WHERE clinic_name = ANY($1::text[])`,
      [DEMO_APPLICATION_CLINIC_NAMES],
    );

    await client.query('COMMIT');

    console.log('Removed rows:');
    for (const [table, count] of Object.entries(report)) {
      console.log(`  ${table.padEnd(22)} ${count}`);
    }
    if (KEEP_CLINICS) console.log('  (clinics kept: KEEP_CLINICS = true)');
    console.log('Demo cleanup complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cleanup failed, rolled back. No rows deleted.');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanup().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
