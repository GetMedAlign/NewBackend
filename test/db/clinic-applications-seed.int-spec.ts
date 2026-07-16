/**
 * Integration test for the clinic-applications seed additions (Task 3).
 *
 * Verifies:
 *  - A superadmin user exists with has_role(user_id, 'superadmin') = true and
 *    EXACTLY the role set ['superadmin'] (no leftover 'patient' or other roles).
 *  - At least 2 pending clinic_applications exist, each with at least 1
 *    application_categories row and at least 1 application_services row.
 *  - Re-running the seed a second time does not error or duplicate rows
 *    (idempotency).
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { seedPatientJourney, SEEDED_ADMIN_USER } from '../../prisma/seed/patient-journey.seed';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

beforeAll(async () => {
  // Run twice to prove idempotency (no errors, no duplicates).
  await seedPatientJourney(prisma);
  await seedPatientJourney(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe('Clinic-applications seed', () => {
  it('exports SEEDED_ADMIN_USER with an email and password', () => {
    expect(typeof SEEDED_ADMIN_USER.email).toBe('string');
    expect(SEEDED_ADMIN_USER.email).toMatch(/@/);
    expect(typeof SEEDED_ADMIN_USER.password).toBe('string');
    expect(SEEDED_ADMIN_USER.password.length).toBeGreaterThan(0);
  });

  it('the superadmin user exists with exactly the superadmin role', async () => {
    const userRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${SEEDED_ADMIN_USER.email}::citext
    `;
    expect(userRows.length).toBe(1);
    const userId = userRows[0]!.id;

    // Exact role set must be ['superadmin'] — no 'patient', no other role.
    const roleRows = await prisma.$queryRaw<{ role: string }[]>`
      SELECT role FROM user_roles WHERE user_id = ${userId}::uuid ORDER BY role
    `;
    expect(roleRows.map((r) => r.role)).toEqual(['superadmin']);

    // has_role helper must return true for superadmin.
    const hasRoleRows = await prisma.$queryRaw<{ result: boolean }[]>`
      SELECT has_role(${userId}::uuid, 'superadmin') AS result
    `;
    expect(hasRoleRows[0]!.result).toBe(true);
  });

  it('at least 2 pending clinic_applications exist', async () => {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM clinic_applications WHERE status = 'pending'
    `;
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('each pending application has at least 1 category and 1 service', async () => {
    const apps = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM clinic_applications WHERE status = 'pending'
    `;
    for (const app of apps) {
      const catRows = await prisma.$queryRaw<{ application_id: string }[]>`
        SELECT application_id FROM application_categories
        WHERE application_id = ${app.id}::uuid
      `;
      expect(catRows.length).toBeGreaterThanOrEqual(1);

      const svcRows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM application_services
        WHERE application_id = ${app.id}::uuid
      `;
      expect(svcRows.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('application services have is_top_service and display_order set', async () => {
    const svcRows = await prisma.$queryRaw<{ is_top_service: boolean; display_order: number }[]>`
      SELECT s.is_top_service, s.display_order
      FROM application_services s
      JOIN clinic_applications a ON a.id = s.application_id
      WHERE a.status = 'pending'
    `;
    expect(svcRows.length).toBeGreaterThanOrEqual(2);
    for (const svc of svcRows) {
      expect(typeof svc.is_top_service).toBe('boolean');
      expect(Number.isInteger(Number(svc.display_order))).toBe(true);
      expect(Number(svc.display_order)).toBeGreaterThanOrEqual(0);
    }
  });

  it('seeded admin user count does not grow on re-run (idempotency)', async () => {
    const beforeCount = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM users
      WHERE email = ${SEEDED_ADMIN_USER.email}::citext
    `;
    const before = Number(beforeCount[0]!.count);

    // Third run
    await seedPatientJourney(prisma);

    const afterCount = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM users
      WHERE email = ${SEEDED_ADMIN_USER.email}::citext
    `;
    const after = Number(afterCount[0]!.count);

    expect(after).toBe(before);
  });

  it('pending application count does not grow on re-run (idempotency)', async () => {
    const beforeCount = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM clinic_applications WHERE status = 'pending'
      AND contact_email = ANY(ARRAY[
        'apply@horizon-hormone-health.example.com',
        'apply@summit-wellness-collective.example.com'
      ])
    `;
    const before = Number(beforeCount[0]!.count);

    // Fourth run
    await seedPatientJourney(prisma);

    const afterCount = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM clinic_applications WHERE status = 'pending'
      AND contact_email = ANY(ARRAY[
        'apply@horizon-hormone-health.example.com',
        'apply@summit-wellness-collective.example.com'
      ])
    `;
    const after = Number(afterCount[0]!.count);

    expect(after).toBe(before);
  });
});
