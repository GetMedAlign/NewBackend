/**
 * Integration tests for the admin read methods of PrismaApplicationRepository.
 *
 * Verifies:
 *   - Under an admin context, list() returns all seeded applications newest-first.
 *   - Under an admin context, findById() returns one application with its categories
 *     and services correctly shaped.
 *   - Under a non-admin context (role=patient), list() returns 0 rows (RLS enforces
 *     this via the clinic_applications_admin_all policy).
 *
 * DATABASE_URL is loaded from test/.env.test.
 * Rows are seeded fresh per run and cleaned up in afterAll.
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaApplicationRepository } from '../../src/modules/clinic-applications/infrastructure/prisma-application.repository';
import { Argon2PasswordHasher } from '../../src/modules/auth/infrastructure/adapters/argon2-password-hasher';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const seedPrisma = new PrismaClient({ adapter });

let prismaService: PrismaService;
let repo: PrismaApplicationRepository;

let adminUserId: string;
let patientUserId: string;
const createdApplicationIds: string[] = [];

/** Creates a user via create_user (bypasses RLS) and returns the id. */
async function createUser(email: string): Promise<string> {
  const rows = await seedPrisma.$queryRaw<{ id: string }[]>`
    SELECT create_user(${email}::citext, 'test-hash-admin-read-spec') AS id
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error(`create_user did not return an id for ${email}`);
  return id;
}

beforeAll(async () => {
  prismaService = new PrismaService();
  await prismaService.onModuleInit();
  repo = new PrismaApplicationRepository(prismaService, new Argon2PasswordHasher());

  // Create an admin user and a patient user for RLS cross-context probe.
  const unique = Date.now();
  adminUserId = await createUser(`admin-read-spec-admin-${unique}@test.example.com`);
  patientUserId = await createUser(`admin-read-spec-patient-${unique}@test.example.com`);

  // Assign admin role to adminUserId.
  await seedPrisma.$executeRaw`
    INSERT INTO user_roles (user_id, role)
    VALUES (${adminUserId}::uuid, 'admin'::app_role)
    ON CONFLICT DO NOTHING
  `;

  // Seed two applications at known timestamps (newer first in expected order).
  const olderTs = new Date(Date.now() - 5000).toISOString();
  const newerTs = new Date().toISOString();

  const older = await seedPrisma.$queryRaw<{ id: string }[]>`
    INSERT INTO clinic_applications (
      clinic_name, contact_email, city, state_code, status, created_at
    ) VALUES (
      'Older Clinic', 'older-admin-read@test.example.com', 'Boston', 'MA', 'pending', ${olderTs}::timestamptz
    )
    RETURNING id
  `;
  const olderId = older[0]!.id;
  createdApplicationIds.push(olderId);

  await seedPrisma.$executeRaw`
    INSERT INTO application_categories (application_id, category)
    VALUES (${olderId}::uuid, 'wellness'::assessment_category)
  `;
  await seedPrisma.$executeRaw`
    INSERT INTO application_services (application_id, service_code, is_top_service, display_order)
    VALUES (${olderId}::uuid, 'iv-therapy', false, 1)
  `;

  const newer = await seedPrisma.$queryRaw<{ id: string }[]>`
    INSERT INTO clinic_applications (
      clinic_name, contact_email, city, state_code, status, created_at
    ) VALUES (
      'Newer Clinic', 'newer-admin-read@test.example.com', 'Seattle', 'WA', 'pending', ${newerTs}::timestamptz
    )
    RETURNING id
  `;
  const newerId = newer[0]!.id;
  createdApplicationIds.push(newerId);

  await seedPrisma.$executeRaw`
    INSERT INTO application_categories (application_id, category)
    VALUES (${newerId}::uuid, 'hormone'::assessment_category)
  `;
  await seedPrisma.$executeRaw`
    INSERT INTO application_services (application_id, service_code, is_top_service, display_order)
    VALUES (${newerId}::uuid, 'testosterone-replacement', true, 1)
  `;
  await seedPrisma.$executeRaw`
    INSERT INTO application_services (application_id, service_code, is_top_service, display_order)
    VALUES (${newerId}::uuid, 'thyroid-optimization', false, 2)
  `;
});

afterAll(async () => {
  for (const id of createdApplicationIds) {
    await seedPrisma.$executeRaw`DELETE FROM clinic_applications WHERE id = ${id}::uuid`;
  }
  // Clean up test users (cascades to user_roles).
  await seedPrisma.$executeRaw`
    DELETE FROM users
    WHERE id IN (${adminUserId}::uuid, ${patientUserId}::uuid)
  `;
  await prismaService.onModuleDestroy();
  await seedPrisma.$disconnect();
  await pool.end();
});

describe('PrismaApplicationRepository — admin read', () => {
  describe('list()', () => {
    it('under admin context returns at least the 2 seeded applications', async () => {
      const results = await repo.list({ userId: adminUserId, role: 'admin' });
      // We don't assert an exact count because other tests may seed more rows
      // (e.g. the submit int-spec). We assert our two seeded rows are present.
      const ids = results.map((r) => r.id);
      expect(ids).toContain(createdApplicationIds[0]);
      expect(ids).toContain(createdApplicationIds[1]);
    });

    it('returns applications in newest-first order (created_at DESC)', async () => {
      const results = await repo.list({ userId: adminUserId, role: 'admin' });
      // Find our two seeded apps in the result and check their relative order.
      const ours = results.filter((r) => createdApplicationIds.includes(r.id));
      expect(ours).toHaveLength(2);
      // createdApplicationIds[1] is the newer one
      expect(ours[0]!.id).toBe(createdApplicationIds[1]);
      expect(ours[1]!.id).toBe(createdApplicationIds[0]);
    });

    it('returns summary fields: id, clinicName, contactEmail, city, stateCode, status, createdAt, reviewedAt', async () => {
      const results = await repo.list({ userId: adminUserId, role: 'admin' });
      const row = results.find((r) => r.id === createdApplicationIds[0])!;
      expect(row.clinicName).toBe('Older Clinic');
      expect(row.contactEmail).toBe('older-admin-read@test.example.com');
      expect(row.city).toBe('Boston');
      expect(row.stateCode).toBe('MA');
      expect(row.status).toBe('pending');
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.reviewedAt).toBeNull();
    });

    it('under non-admin (patient) context returns 0 rows (RLS enforces admin-only)', async () => {
      const results = await repo.list({ userId: patientUserId, role: 'patient' });
      expect(results).toHaveLength(0);
    });
  });

  describe('findById()', () => {
    it('under admin context returns the full application detail', async () => {
      const newerId = createdApplicationIds[1]!;
      const result = await repo.findById({ userId: adminUserId, role: 'admin' }, newerId);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(newerId);
      expect(result!.clinicName).toBe('Newer Clinic');
      expect(result!.contactEmail).toBe('newer-admin-read@test.example.com');
      expect(result!.city).toBe('Seattle');
      expect(result!.stateCode).toBe('WA');
      expect(result!.status).toBe('pending');
      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.reviewedAt).toBeNull();
    });

    it('returns categories as a string array', async () => {
      const newerId = createdApplicationIds[1]!;
      const result = await repo.findById({ userId: adminUserId, role: 'admin' }, newerId);
      expect(result!.categories).toEqual(['hormone']);
    });

    it('returns services sorted by displayOrder', async () => {
      const newerId = createdApplicationIds[1]!;
      const result = await repo.findById({ userId: adminUserId, role: 'admin' }, newerId);
      expect(result!.services).toHaveLength(2);
      expect(result!.services[0]!.serviceCode).toBe('testosterone-replacement');
      expect(result!.services[0]!.isTopService).toBe(true);
      expect(result!.services[0]!.displayOrder).toBe(1);
      expect(result!.services[1]!.serviceCode).toBe('thyroid-optimization');
      expect(result!.services[1]!.isTopService).toBe(false);
      expect(result!.services[1]!.displayOrder).toBe(2);
    });

    it('returns null for a non-existent id under admin context', async () => {
      const result = await repo.findById(
        { userId: adminUserId, role: 'admin' },
        '00000000-0000-0000-0000-000000000000',
      );
      expect(result).toBeNull();
    });

    it('under non-admin (patient) context returns null for an existing application (RLS)', async () => {
      const newerId = createdApplicationIds[1]!;
      const result = await repo.findById({ userId: patientUserId, role: 'patient' }, newerId);
      expect(result).toBeNull();
    });
  });
});
