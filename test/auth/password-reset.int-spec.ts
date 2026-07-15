/**
 * Integration tests for PrismaPasswordResetRepository.
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaPasswordResetRepository } from '../../src/modules/auth/infrastructure/persistence/prisma-password-reset.repository';
import { generateResetToken, hashResetToken } from '../../src/modules/auth/domain/reset-token';

let prisma: PrismaService;
let repo: PrismaPasswordResetRepository;
let testUserId: string;
const testEmail = 'pw-reset-int@example.com';

beforeAll(async () => {
  prisma = new PrismaService();
  await prisma.onModuleInit();

  // Create a test user via the SECURITY DEFINER function
  await prisma.asSystem((c) => c.$executeRaw`DELETE FROM users WHERE email = ${testEmail}::citext`);
  const rows = await prisma.asSystem(
    (c) => c.$queryRaw<{ id: string }[]>`SELECT create_user(${testEmail}::citext, 'hash') AS id`,
  );
  testUserId = rows[0]!.id;

  repo = new PrismaPasswordResetRepository(prisma);
});

beforeEach(async () => {
  await prisma.asSystem(
    (c) => c.$executeRaw`TRUNCATE password_reset_tokens RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await prisma.asSystem((c) => c.$executeRaw`DELETE FROM users WHERE email = ${testEmail}::citext`);
  await prisma.onModuleDestroy();
});

describe('PrismaPasswordResetRepository', () => {
  describe('issue then findValidByEmail', () => {
    it('returns the token record after issuing', async () => {
      const { raw, hash } = generateResetToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await repo.issue(testUserId, hash, expiresAt);
      const record = await repo.findValidByEmail(testEmail, hash);

      expect(record).not.toBeNull();
      expect(record!.userId).toBe(testUserId);
      expect(typeof record!.id).toBe('string');

      // Verify raw token also resolves correctly (via hashResetToken)
      const recordViaRaw = await repo.findValidByEmail(testEmail, hashResetToken(raw));
      expect(recordViaRaw).not.toBeNull();
      expect(recordViaRaw!.id).toBe(record!.id);
    });
  });

  describe('consume', () => {
    it('after consume, findValidByEmail returns null (single-use enforcement)', async () => {
      const { hash } = generateResetToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await repo.issue(testUserId, hash, expiresAt);
      const record = await repo.findValidByEmail(testEmail, hash);
      expect(record).not.toBeNull();

      await repo.consume(record!.id);

      const afterConsume = await repo.findValidByEmail(testEmail, hash);
      expect(afterConsume).toBeNull();
    });
  });

  describe('expired token', () => {
    it('findValidByEmail returns null for an expired token', async () => {
      const { hash } = generateResetToken();
      const pastExpiry = new Date(Date.now() - 1000); // 1 second ago

      // Insert directly with past expiry
      await prisma.asSystem(
        (c) =>
          c.$executeRaw`
          INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
          VALUES (${testUserId}::uuid, ${hash}, ${pastExpiry})
        `,
      );

      const record = await repo.findValidByEmail(testEmail, hash);
      expect(record).toBeNull();
    });
  });

  describe('findUserIdByEmail', () => {
    it('returns the user id for a known email', async () => {
      const userId = await repo.findUserIdByEmail(testEmail);
      expect(userId).toBe(testUserId);
    });

    it('returns null for an unknown email', async () => {
      const userId = await repo.findUserIdByEmail('nonexistent@example.com');
      expect(userId).toBeNull();
    });

    it('is case-insensitive (citext): uppercase query finds lowercase email', async () => {
      const upperEmail = testEmail.toUpperCase();
      const userId = await repo.findUserIdByEmail(upperEmail);
      expect(userId).toBe(testUserId);
    });
  });

  describe('updatePasswordHash', () => {
    it('actually changes the stored password_hash', async () => {
      const newHash = 'new-argon2id-hash-value';
      await repo.updatePasswordHash(testUserId, newHash);

      const rows = await prisma.asSystem(
        (c) =>
          c.$queryRaw<{ password_hash: string }[]>`
          SELECT password_hash FROM users WHERE id = ${testUserId}::uuid
        `,
      );
      expect(rows[0]!.password_hash).toBe(newHash);
    });
  });
});
