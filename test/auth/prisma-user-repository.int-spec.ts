/**
 * Integration tests for PrismaUserRepository.
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AesGcmEncryptionService } from '../../src/infrastructure/crypto/aes-gcm-encryption.service';
import { PrismaUserRepository } from '../../src/modules/auth/infrastructure/persistence/prisma-user.repository';

let prisma: PrismaService;
let repo: PrismaUserRepository;

beforeAll(async () => {
  prisma = new PrismaService();
  await prisma.onModuleInit();
  const configService = new ConfigService<{ ENCRYPTION_KEY: string }>({
    ENCRYPTION_KEY: process.env['ENCRYPTION_KEY'] ?? '',
  });
  const encryption = new AesGcmEncryptionService(configService as never);
  repo = new PrismaUserRepository(prisma, encryption);
});

afterAll(async () => {
  await prisma.onModuleDestroy();
});

beforeEach(async () => {
  // Clean out dependent tables first
  await prisma.asSystem((c) => c.$executeRaw`TRUNCATE two_factor_codes RESTART IDENTITY CASCADE`);
  await prisma.asSystem((c) => c.$executeRaw`TRUNCATE audit_log RESTART IDENTITY CASCADE`);
  await prisma.asSystem((c) => c.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
});

describe('PrismaUserRepository', () => {
  describe('create + findByEmail + findById', () => {
    it('creates a user via create_user and finds them by email', async () => {
      const id = await repo.create('test@example.com', 'hashed-pw');
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      const user = await repo.findByEmail('test@example.com');
      expect(user).not.toBeNull();
      expect(user?.id).toBe(id);
      expect(user?.email).toBe('test@example.com');
      expect(user?.passwordHash).toBe('hashed-pw');
    });

    it('creates the patient row atomically at signup (matches .NET)', async () => {
      const id = await repo.create('patient-row@example.com', 'hashed-pw');

      const rows = await prisma.asSystem(
        (c) =>
          c.$queryRaw<{ user_id: string; date_of_birth: Date | null; zip_code: string | null }[]>`
            SELECT user_id::text AS user_id, date_of_birth, zip_code
            FROM patients
            WHERE user_id = ${id}::uuid
            LIMIT 1
          `,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(id);
      // dob/zip stay null until the patient sets them.
      expect(rows[0].date_of_birth).toBeNull();
      expect(rows[0].zip_code).toBeNull();
    });

    it('findByEmail is case-insensitive (citext column)', async () => {
      const id = await repo.create('case@example.com', 'h');
      const user = await repo.findByEmail('CASE@EXAMPLE.COM');
      expect(user?.id).toBe(id);
    });

    it('finds user by id', async () => {
      const id = await repo.create('byid@example.com', 'h');
      const user = await repo.findById(id);
      expect(user).not.toBeNull();
      expect(user?.id).toBe(id);
    });

    it('findByEmail returns null for unknown email', async () => {
      const user = await repo.findByEmail('nobody@example.com');
      expect(user).toBeNull();
    });

    it('findById returns null for unknown id', async () => {
      const user = await repo.findById('00000000-0000-0000-0000-000000000000');
      expect(user).toBeNull();
    });

    it('persists name and dob supplied at signup', async () => {
      const id = await repo.create(
        'with-profile@example.com',
        'hashed-pw',
        'Jane Doe',
        '1985-06-15',
      );

      const user = await repo.findByEmail('with-profile@example.com');
      expect(user?.name).toBe('Jane Doe');

      const rows = await prisma.asSystem(
        (c) =>
          c.$queryRaw<{ date_of_birth: Date | null }[]>`
            SELECT date_of_birth FROM patients WHERE user_id = ${id}::uuid LIMIT 1
          `,
      );
      expect(rows[0]?.date_of_birth?.toISOString().slice(0, 10)).toBe('1985-06-15');
    });

    it('leaves name null when signup omits it', async () => {
      const id = await repo.create('no-name@example.com', 'hashed-pw');
      const user = await repo.findByEmail('no-name@example.com');
      expect(user?.id).toBe(id);
      expect(user?.name).toBeNull();
    });

    it('drops an unparseable dob rather than rejecting signup', async () => {
      const id = await repo.create('bad-dob@example.com', 'hashed-pw', 'Alex', 'not-a-date');

      const rows = await prisma.asSystem(
        (c) =>
          c.$queryRaw<{ date_of_birth: Date | null }[]>`
            SELECT date_of_birth FROM patients WHERE user_id = ${id}::uuid LIMIT 1
          `,
      );
      expect(rows[0]?.date_of_birth).toBeNull();
    });
  });

  describe('getPrimaryRole', () => {
    it('returns patient for a freshly created user', async () => {
      const id = await repo.create('patient@example.com', 'h');
      const role = await repo.getPrimaryRole(id);
      expect(role).toBe('patient');
    });

    it('returns superadmin when a user holds both admin and superadmin roles', async () => {
      const id = await repo.create('superadmin@example.com', 'h');
      // Assign admin role
      await prisma.asSystem(
        (c) => c.$executeRaw`INSERT INTO user_roles (user_id, role) VALUES (${id}::uuid, 'admin')`,
      );
      // Assign superadmin role
      await prisma.asSystem(
        (c) =>
          c.$executeRaw`INSERT INTO user_roles (user_id, role) VALUES (${id}::uuid, 'superadmin')`,
      );
      const role = await repo.getPrimaryRole(id);
      expect(role).toBe('superadmin');
    });

    it('returns admin when a user holds admin and clinic roles', async () => {
      const id = await repo.create('admin@example.com', 'h');
      await prisma.asSystem(
        (c) => c.$executeRaw`INSERT INTO user_roles (user_id, role) VALUES (${id}::uuid, 'admin')`,
      );
      await prisma.asSystem(
        (c) => c.$executeRaw`INSERT INTO user_roles (user_id, role) VALUES (${id}::uuid, 'clinic')`,
      );
      const role = await repo.getPrimaryRole(id);
      expect(role).toBe('admin');
    });
  });

  describe('getClinicId', () => {
    it('returns the clinic_id for a clinic-linked user', async () => {
      // Insert a throwaway clinic row (supply all NOT NULL columns that have no DB default)
      const clinicRows = await prisma.asSystem(
        (c) =>
          c.$queryRaw<{ id: string }[]>`
            INSERT INTO clinics (
              name, slug, rating, review_count,
              telehealth_available, financing_available, accepts_insurance,
              status, billing_status, notify_on_lead
            )
            VALUES (
              'Test Clinic Int', 'test-clinic-int-getclinicid', 4.5, 0,
              false, false, false,
              'active', 'active', false
            )
            ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
          `,
      );
      const clinicId = clinicRows[0]!.id;

      // Create a clinic user and link it
      const userId = await repo.create('clinic-user@int-test.example.com', 'h');
      await prisma.asSystem(
        (c) =>
          c.$executeRaw`UPDATE users SET clinic_id = ${clinicId}::uuid WHERE id = ${userId}::uuid`,
      );

      const result = await repo.getClinicId(userId);
      expect(result).toBe(clinicId);
    });

    it('returns null for a patient user (clinic_id is NULL)', async () => {
      const userId = await repo.create('patient-user@int-test.example.com', 'h');
      // clinic_id is NULL by default for a freshly created user
      const result = await repo.getClinicId(userId);
      expect(result).toBeNull();
    });

    it('returns null for a non-existent user id', async () => {
      const result = await repo.getClinicId('00000000-0000-0000-0000-000000000099');
      expect(result).toBeNull();
    });
  });

  describe('recordFailedLogin + resetFailedLogin', () => {
    it('increments failed_login_count on each call', async () => {
      const id = await repo.create('fail@example.com', 'h');

      await repo.recordFailedLogin(id);
      await repo.recordFailedLogin(id);

      const user = await repo.findById(id);
      expect(user?.failedLoginCount).toBe(2);
      // Not yet locked (< 5)
      expect(user?.lockedUntil).toBeNull();
    });

    it('sets lockedUntil when failed count reaches 5', async () => {
      const id = await repo.create('lock@example.com', 'h');

      for (let i = 0; i < 5; i++) {
        await repo.recordFailedLogin(id);
      }

      const user = await repo.findById(id);
      expect(user?.failedLoginCount).toBe(5);
      expect(user?.lockedUntil).not.toBeNull();
      // Should be locked until roughly now + 15 min
      const fifteenMinFromNow = new Date(Date.now() + 15 * 60 * 1000);
      expect(user?.lockedUntil!.getTime()).toBeLessThanOrEqual(
        fifteenMinFromNow.getTime() + 1000, // 1s tolerance
      );
      expect(user?.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('resetFailedLogin zeroes the count and clears lockedUntil', async () => {
      const id = await repo.create('reset@example.com', 'h');

      for (let i = 0; i < 5; i++) {
        await repo.recordFailedLogin(id);
      }

      await repo.resetFailedLogin(id);
      const user = await repo.findById(id);
      expect(user?.failedLoginCount).toBe(0);
      expect(user?.lockedUntil).toBeNull();
    });

    it('isLocked returns true when lockedUntil is in the future', async () => {
      const id = await repo.create('islock@example.com', 'h');
      for (let i = 0; i < 5; i++) {
        await repo.recordFailedLogin(id);
      }
      const user = await repo.findById(id);
      expect(user?.isLocked(new Date())).toBe(true);
    });
  });
});
