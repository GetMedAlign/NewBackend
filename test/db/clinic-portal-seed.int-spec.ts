/**
 * Integration test for the clinic-portal seed additions (Task 3).
 *
 * Verifies:
 *  - Clinic-portal columns (webhook_health, photo_count, etc.) are populated
 *    on all seeded clinics.
 *  - At least 2 clinic users exist with role='clinic', a non-null clinic_id,
 *    and has_role(user_id, 'clinic') = true.
 *  - Each seeded clinic user's clinic_id points at the expected clinic slug.
 *  - Re-running the seed a second time does not error or duplicate rows.
 *
 * Seed credentials are exported from patient-journey.seed.ts as
 * SEEDED_CLINIC_USERS for use by later e2e tasks.
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { seedPatientJourney, SEEDED_CLINIC_USERS } from '../../prisma/seed/patient-journey.seed';

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

describe('Clinic-portal seed', () => {
  it('exports at least 2 seeded clinic users with email, password, and clinicSlug', () => {
    expect(SEEDED_CLINIC_USERS.length).toBeGreaterThanOrEqual(2);
    for (const u of SEEDED_CLINIC_USERS) {
      expect(typeof u.email).toBe('string');
      expect(u.email).toMatch(/@/);
      expect(typeof u.password).toBe('string');
      expect(u.password.length).toBeGreaterThan(0);
      expect(typeof u.clinicSlug).toBe('string');
      expect(u.clinicSlug.length).toBeGreaterThan(0);
    }
  });

  it('each seeded clinic user exists with role=clinic and a matching clinic_id', async () => {
    for (const u of SEEDED_CLINIC_USERS) {
      // Fetch the user row
      const userRows = await prisma.$queryRaw<{ id: string; clinic_id: string | null }[]>`
        SELECT id, clinic_id FROM users WHERE email = ${u.email}::citext
      `;
      expect(userRows.length).toBe(1);
      const user = userRows[0]!;
      expect(user.clinic_id).not.toBeNull();

      // The linked clinic must have the expected slug
      const clinicRows = await prisma.$queryRaw<{ slug: string }[]>`
        SELECT slug FROM clinics WHERE id = ${user.clinic_id}::uuid
      `;
      expect(clinicRows.length).toBe(1);
      expect(clinicRows[0]!.slug).toBe(u.clinicSlug);

      // The user must have EXACTLY the 'clinic' role in user_roles (no leftover 'patient')
      const roleRows = await prisma.$queryRaw<{ role: string }[]>`
        SELECT role FROM user_roles WHERE user_id = ${user.id}::uuid ORDER BY role
      `;
      expect(roleRows.map((r) => r.role)).toEqual(['clinic']);

      // has_role helper must return true
      const hasRoleRows = await prisma.$queryRaw<{ result: boolean }[]>`
        SELECT has_role(${user.id}::uuid, 'clinic') AS result
      `;
      expect(hasRoleRows[0]!.result).toBe(true);
    }
  });

  it('every seeded clinic has webhook_health=unknown and expected photo_count', async () => {
    const clinics = await prisma.$queryRaw<
      { slug: string; webhook_health: string; photo_count: number }[]
    >`
      SELECT slug, webhook_health, photo_count FROM clinics
    `;
    expect(clinics.length).toBeGreaterThanOrEqual(6);
    // glow-med-spa-miami receives 2 demo clinic_photos via the demo-seed additions;
    // all other seeded clinics start at photo_count=0.
    const photoCountBySeed: Record<string, number> = {
      'vitality-hormone-nyc': 0,
      'apex-peptide-telehealth': 0,
      'glow-med-spa-miami': 2,
      'thrive-wellness-chicago': 0,
      'balance-hormone-la': 0,
      'renew-peptide-seattle': 0,
    };
    for (const c of clinics) {
      if (!(c.slug in photoCountBySeed)) continue;
      expect(c.webhook_health).toBe('unknown');
      expect(Number(c.photo_count)).toBe(photoCountBySeed[c.slug]);
    }
  });

  it('every seeded clinic has offers_lab_work populated (not null)', async () => {
    const clinics = await prisma.$queryRaw<{ slug: string; offers_lab_work: boolean }[]>`
      SELECT slug, offers_lab_work FROM clinics
      WHERE slug IN (
        'vitality-hormone-nyc', 'apex-peptide-telehealth', 'glow-med-spa-miami',
        'thrive-wellness-chicago', 'balance-hormone-la', 'renew-peptide-seattle'
      )
    `;
    expect(clinics.length).toBe(6);
    for (const c of clinics) {
      // lab-work clinics should have offersLabWork=true
      if (c.slug === 'vitality-hormone-nyc' || c.slug === 'apex-peptide-telehealth') {
        expect(c.offers_lab_work).toBe(true);
      } else {
        expect(c.offers_lab_work).toBe(false);
      }
    }
  });

  it('seeded clinic user count does not grow on re-run (idempotency)', async () => {
    const beforeCount = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM users
      WHERE email = ANY(${SEEDED_CLINIC_USERS.map((u) => u.email)}::citext[])
    `;
    const before = Number(beforeCount[0]!.count);

    // Third run
    await seedPatientJourney(prisma);

    const afterCount = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM users
      WHERE email = ANY(${SEEDED_CLINIC_USERS.map((u) => u.email)}::citext[])
    `;
    const after = Number(afterCount[0]!.count);

    expect(after).toBe(before);
  });

  it('the notify-enabled clinics have differentiators set', async () => {
    const clinics = await prisma.$queryRaw<{ slug: string; differentiators: string | null }[]>`
      SELECT slug, differentiators FROM clinics
      WHERE slug IN ('vitality-hormone-nyc', 'apex-peptide-telehealth')
    `;
    expect(clinics.length).toBe(2);
    for (const c of clinics) {
      expect(c.differentiators).not.toBeNull();
      expect((c.differentiators ?? '').length).toBeGreaterThan(0);
    }
  });
});
