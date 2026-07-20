/**
 * Integration test for the Task 12 seed additions (admin notes + soft-deleted
 * patient), added to `prisma/seed/patient-journey.seed.ts`.
 *
 * Self-seeds in `beforeAll` (running the seed twice, matching every other
 * `*-seed.int-spec.ts` file's convention) rather than assuming the DB was
 * seeded out-of-band: `admin-rls.int-spec.ts` (which sorts before this file
 * alphabetically, and runs first in the same serial `test:int` run) truncates
 * `users` and `clinics` in its own cleanup, which cascades away any rows a
 * prior manual `pnpm seed:pj` left behind.
 *
 * Requires a real Postgres instance: DATABASE_URL loaded from test/.env.test.
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { seedPatientJourney } from '../../prisma/seed/patient-journey.seed';

describe('admin seed additions', () => {
  let pool: Pool;
  let prisma: PrismaClient;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });

    // Run twice to prove idempotency.
    await seedPatientJourney(prisma);
    await seedPatientJourney(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it('seeds admin notes on a demo clinic', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM admin_notes
        WHERE clinic_id = (SELECT id FROM clinics WHERE slug = 'vitality-hormone-nyc')`,
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('seeds one soft-deleted patient', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM patients WHERE is_deleted = true`,
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('locks the soft-deleted patient out of sign-in', async () => {
    const { rows } = await pool.query(
      `SELECT u.locked_until FROM users u
         JOIN patients p ON p.user_id = u.id WHERE p.is_deleted = true LIMIT 1`,
    );
    expect(new Date(rows[0].locked_until).getUTCFullYear()).toBe(9999);
  });
});
