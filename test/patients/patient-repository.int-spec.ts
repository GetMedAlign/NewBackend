/**
 * Integration tests for PrismaPatientRepository against a live Postgres.
 * DATABASE_URL is loaded from test/.env.test via setupFiles.
 *
 * Verifies findProfile, updateProfile, and per-user isolation.
 */
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaPatientRepository } from '../../src/modules/patients/infrastructure/prisma-patient.repository';

/** Creates a minimal user row and returns its UUID. */
async function createTestUser(prisma: PrismaService, email: string): Promise<string> {
  const rows = await prisma.asSystem(
    (client) =>
      client.$queryRaw<{ id: string }[]>`
        SELECT create_user(${email}::citext, 'test-hash') AS id
      `,
  );
  return rows[0]!.id;
}

/** Creates a patient row for a given userId and returns its UUID. */
async function createTestPatient(
  prisma: PrismaService,
  userId: string,
  dob: string | null = null,
): Promise<string> {
  const rows = await prisma.asSystem(
    (client) =>
      client.$queryRaw<{ id: string }[]>`
        INSERT INTO patients (user_id, date_of_birth, is_deleted)
        VALUES (${userId}::uuid, ${dob}::date, false)
        RETURNING id::text AS id
      `,
  );
  return rows[0]!.id;
}

describe('PrismaPatientRepository (integration)', () => {
  let repo: PrismaPatientRepository;
  let prisma: PrismaService;

  const suffix = Date.now();
  const userAEmail = `patient-repo-a-${suffix}@test.local`;
  const userBEmail = `patient-repo-b-${suffix}@test.local`;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ envFilePath: 'test/.env.test' }), PrismaModule],
      providers: [PrismaPatientRepository],
    }).compile();

    repo = module.get(PrismaPatientRepository);
    prisma = module.get(PrismaService);

    userAId = await createTestUser(prisma, userAEmail);
    userBId = await createTestUser(prisma, userBEmail);

    await createTestPatient(prisma, userAId, '1985-03-20');
    await createTestPatient(prisma, userBId, '1990-07-04');
  });

  afterAll(async () => {
    await prisma.asSystem(
      (client) =>
        client.$executeRaw`
          DELETE FROM patients WHERE user_id IN (${userAId}::uuid, ${userBId}::uuid)
        `,
    );
    await prisma.asSystem(
      (client) =>
        client.$executeRaw`
          DELETE FROM users WHERE id IN (${userAId}::uuid, ${userBId}::uuid)
        `,
    );
  });

  it('findProfile returns correct data for a user with a patient row', async () => {
    const profile = await repo.findProfile(userAId);
    expect(profile).not.toBeNull();
    expect(profile!.email).toBe(userAEmail);
    expect(profile!.hasPatient).toBe(true);
    expect(profile!.isDeleted).toBe(false);
    expect(profile!.dob).not.toBeNull();
    // The DOB should be 1985-03-20 — compare year/month/day
    const dob = profile!.dob as Date;
    // Use UTC methods since Postgres DATE -> JS Date comes back as UTC midnight
    expect(dob.getUTCFullYear()).toBe(1985);
    expect(dob.getUTCMonth()).toBe(2); // 0-indexed (March = 2)
    expect(dob.getUTCDate()).toBe(20);
  });

  it('findProfile returns hasPatient: false for user with no patient row', async () => {
    // Create a user with no patient row
    const noPatientEmail = `no-patient-${suffix}@test.local`;
    const noPatientId = await createTestUser(prisma, noPatientEmail);

    try {
      const profile = await repo.findProfile(noPatientId);
      expect(profile).not.toBeNull();
      expect(profile!.hasPatient).toBe(false);
      expect(profile!.dob).toBeNull();
      expect(profile!.zipCode).toBeNull();
    } finally {
      await prisma.asSystem(
        (client) => client.$executeRaw`DELETE FROM users WHERE id = ${noPatientId}::uuid`,
      );
    }
  });

  it('findProfile returns null for a non-existent userId', async () => {
    const profile = await repo.findProfile('00000000-0000-0000-0000-000000000000');
    expect(profile).toBeNull();
  });

  it('updateProfile updates name on the user row', async () => {
    await repo.updateProfile(userAId, { name: 'Alice Test' });

    const rows = await prisma.asSystem(
      (client) =>
        client.$queryRaw<{ name: string | null }[]>`
          SELECT name FROM users WHERE id = ${userAId}::uuid LIMIT 1
        `,
    );
    expect(rows[0]?.name).toBe('Alice Test');

    // findProfile should now return the name
    const profile = await repo.findProfile(userAId);
    expect(profile!.name).toBe('Alice Test');
  });

  it('updateProfile updates dob when a valid date string is provided', async () => {
    await repo.updateProfile(userAId, { name: 'Alice Test', dob: '1985-06-15' });

    const rows = await prisma.asSystem(
      (client) =>
        client.$queryRaw<{ date_of_birth: Date | null }[]>`
          SELECT date_of_birth FROM patients WHERE user_id = ${userAId}::uuid LIMIT 1
        `,
    );
    const dob = rows[0]?.date_of_birth;
    expect(dob).not.toBeNull();
    // Month/day check (date may be UTC-aligned)
    const d = new Date(dob as Date);
    expect(d.getUTCMonth()).toBe(5); // June is 5 in 0-indexed
    expect(d.getUTCDate()).toBe(15);
  });

  it('RLS isolation: withUserContext as userB cannot read userA patient row', async () => {
    // This is the canonical RLS cross-context probe: open a withUserContext
    // transaction under user B's identity and query for user A's patient row.
    // The patients table has RLS enforced, so B's context must return 0 rows.
    // If RLS were removed or misconfigured this assertion would fail.
    const rowsSeenByB = await prisma.withUserContext(
      { userId: userBId, role: 'patient', ip: null },
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id
          FROM patients
          WHERE user_id = ${userAId}::uuid
          LIMIT 1
        `,
    );
    expect(rowsSeenByB).toHaveLength(0);

    // Sanity check: under A's own context the row IS visible.
    const rowsSeenByA = await prisma.withUserContext(
      { userId: userAId, role: 'patient', ip: null },
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
          SELECT id::text AS id
          FROM patients
          WHERE user_id = ${userAId}::uuid
          LIMIT 1
        `,
    );
    expect(rowsSeenByA).toHaveLength(1);
  });
});
