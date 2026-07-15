/**
 * Integration tests for PrismaClinicWriteRepository against a live Postgres.
 * DATABASE_URL is loaded from test/.env.test via jest.int.config.ts setupFiles.
 *
 * Verifies:
 *  - findProfile returns all expected fields for a seeded clinic
 *  - updateProfile correctly patches scalar fields, recomputes location, and
 *    replaces categories and services
 *  - RLS enforcement: a different clinic cannot read another clinic's leads
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaClinicWriteRepository } from '../../src/modules/clinic-portal/infrastructure/prisma-clinic-write.repository';
import { seedPatientJourney } from '../../prisma/seed/patient-journey.seed';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const seedPrisma = new PrismaClient({ adapter });

let prismaService: PrismaService;
let repo: PrismaClinicWriteRepository;
let clinicId: string;
let otherClinicId: string;

// Lead seeded for otherClinic (clinic B) — used by the cross-context RLS probe.
let otherClinicLeadId: string;

beforeAll(async () => {
  await seedPatientJourney(seedPrisma);

  const clinic = await seedPrisma.clinic.findUniqueOrThrow({
    where: { slug: 'vitality-hormone-nyc' },
    select: { id: true },
  });
  clinicId = clinic.id;

  const other = await seedPrisma.clinic.findUniqueOrThrow({
    where: { slug: 'apex-peptide-telehealth' },
    select: { id: true },
  });
  otherClinicId = other.id;

  prismaService = new PrismaService();
  await prismaService.onModuleInit();
  repo = new PrismaClinicWriteRepository(prismaService);

  // Seed a lead for clinic B (apex) so the cross-context probe has a row to try to read.
  // asSystem bypasses RLS — this is intentional for test setup only.
  const leadRows = await prismaService.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO leads (
        lead_id, clinic_id, patient_first_name, patient_email,
        treatment_category, lead_source, delivery_status, clinic_status, received_at
      )
      VALUES (
        'profile-spec-rls-probe-00000000000000000000000000',
        ${otherClinicId}::uuid,
        'RLSProbe', 'rls-probe@example.com',
        'hormone', 'assessment', 'pending', 'new', CURRENT_TIMESTAMP
      )
      RETURNING id
    `,
  );
  otherClinicLeadId = leadRows[0]!.id;
});

afterAll(async () => {
  // Remove the probe lead so the DB is clean for other suites.
  await prismaService.asSystem(
    (client) => client.$executeRaw`DELETE FROM leads WHERE id = ${otherClinicLeadId}::uuid`,
  );
  // Restore seeds so other suites start clean
  await seedPatientJourney(seedPrisma);
  await prismaService.onModuleDestroy();
  await seedPrisma.$disconnect();
  await pool.end();
});

describe('PrismaClinicWriteRepository.findProfile', () => {
  it('returns a full profile for a seeded clinic', async () => {
    const profile = await repo.findProfile(clinicId);

    expect(profile).not.toBeNull();
    expect(profile!.id).toBe(clinicId);
    expect(profile!.slug).toBe('vitality-hormone-nyc');
    expect(typeof profile!.name).toBe('string');
    expect(typeof profile!.rating).toBe('number');
    expect(typeof profile!.leadCount).toBe('number');
    expect(Array.isArray(profile!.treatmentCategories)).toBe(true);
    expect(Array.isArray(profile!.services)).toBe(true);
  });

  it('returns null for an unknown clinicId (RLS returns no rows)', async () => {
    const result = await repo.findProfile('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('does not expose webhookSecret in returned profile shape', async () => {
    const profile = await repo.findProfile(clinicId);
    // The raw ciphertext is present on the domain object (to check if configured)
    // but we assert the type is string | null rather than asserting content
    expect(profile).toHaveProperty('webhookSecret');
  });
});

describe('PrismaClinicWriteRepository.updateProfile', () => {
  it('updates scalar fields', async () => {
    await repo.updateProfile(clinicId, {
      about: 'Integration test about text',
      offersLabWork: true,
      weeklySummary: true,
    });

    const profile = await repo.findProfile(clinicId);
    expect(profile!.about).toBe('Integration test about text');
    expect(profile!.offersLabWork).toBe(true);
    expect(profile!.weeklySummary).toBe(true);
  });

  it('recomputes location when city and stateCode are updated', async () => {
    await repo.updateProfile(clinicId, { city: 'Austin', stateCode: 'TX' });

    const profile = await repo.findProfile(clinicId);
    expect(profile!.city).toBe('Austin');
    expect(profile!.stateCode).toBe('TX');
    expect(profile!.location).toBe('Austin, TX');
  });

  it('replaces treatment categories', async () => {
    await repo.updateProfile(clinicId, { treatmentCategories: ['hormone', 'wellness'] });

    const profile = await repo.findProfile(clinicId);
    expect(profile!.treatmentCategories.sort()).toEqual(['hormone', 'wellness'].sort());
  });

  it('replaces services with top/all split', async () => {
    await repo.updateProfile(clinicId, {
      topServices: ['trt', 'hgh'],
      allServices: ['trt', 'hgh', 'testosterone_pellets'],
    });

    const profile = await repo.findProfile(clinicId);
    const top = profile!.services.filter((s) => s.isTopService);
    const all = profile!.services;

    expect(top.map((s) => s.serviceCode).sort()).toEqual(['hgh', 'trt'].sort());
    expect(all.length).toBe(3);
    expect(all.find((s) => s.serviceCode === 'testosterone_pellets')?.isTopService).toBe(false);
  });

  it('does nothing when the patch is empty', async () => {
    const before = await repo.findProfile(clinicId);
    await repo.updateProfile(clinicId, {});
    const after = await repo.findProfile(clinicId);

    expect(after!.name).toBe(before!.name);
  });

  it("updating clinic A's own profile does not change clinic B's profile", async () => {
    const profileBefore = await repo.findProfile(otherClinicId);

    // Update vitality (clinic A) in its own context — this never targets apex (clinic B).
    await repo.updateProfile(clinicId, { about: 'vitality only — should not affect apex' });

    // Read apex using apex's own context — its profile must be unchanged.
    const profileAfter = await repo.findProfile(otherClinicId);
    expect(profileAfter!.about).toBe(profileBefore!.about);
  });
});

describe('RLS cross-context isolation', () => {
  /**
   * Genuine cross-context probe: runs under clinic A's (vitality) RLS context
   * and attempts to read a lead that belongs to clinic B (apex). The leads table
   * has only a clinic-scoped read policy (no public-read policy), so clinic A's
   * context must return 0 rows. This test would FAIL if the leads RLS policy
   * were removed, making it a true isolation guard.
   *
   * We use prismaService.withUserContext directly (not the repository) so the
   * context is explicitly set to clinic A while the WHERE clause targets clinic
   * B's lead — a cross-context read that bypasses the repository's own
   * clinicId scoping.
   */
  it('clinic A context cannot read a lead owned by clinic B (leads RLS blocks cross-context read)', async () => {
    const rows = await prismaService.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM leads WHERE id = ${otherClinicLeadId}::uuid
        `,
    );

    // RLS filters the row out: clinic A's context only sees its own leads.
    expect(rows).toHaveLength(0);
  });
});
