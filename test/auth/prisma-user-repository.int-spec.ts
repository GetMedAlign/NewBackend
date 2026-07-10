/**
 * Integration tests for PrismaUserRepository.
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaUserRepository } from '../../src/modules/auth/infrastructure/persistence/prisma-user.repository';

let prisma: PrismaService;
let repo: PrismaUserRepository;

beforeAll(async () => {
  prisma = new PrismaService();
  await prisma.onModuleInit();
  repo = new PrismaUserRepository(prisma);
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
      await prisma.asSystem((c) =>
        c.$executeRaw`INSERT INTO user_roles (user_id, role) VALUES (${id}::uuid, 'admin')`,
      );
      // Assign superadmin role
      await prisma.asSystem((c) =>
        c.$executeRaw`INSERT INTO user_roles (user_id, role) VALUES (${id}::uuid, 'superadmin')`,
      );
      const role = await repo.getPrimaryRole(id);
      expect(role).toBe('superadmin');
    });

    it('returns admin when a user holds admin and clinic roles', async () => {
      const id = await repo.create('admin@example.com', 'h');
      await prisma.asSystem((c) =>
        c.$executeRaw`INSERT INTO user_roles (user_id, role) VALUES (${id}::uuid, 'admin')`,
      );
      await prisma.asSystem((c) =>
        c.$executeRaw`INSERT INTO user_roles (user_id, role) VALUES (${id}::uuid, 'clinic')`,
      );
      const role = await repo.getPrimaryRole(id);
      expect(role).toBe('admin');
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
