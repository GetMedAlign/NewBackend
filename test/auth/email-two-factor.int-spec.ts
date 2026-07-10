/**
 * Integration tests for EmailTwoFactor adapter.
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 * The EmailSenderPort is mocked — no real email is sent.
 */
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { EmailTwoFactor } from '../../src/modules/auth/infrastructure/adapters/email-two-factor';
import { Argon2PasswordHasher } from '../../src/modules/auth/infrastructure/adapters/argon2-password-hasher';
import type { EmailSenderPort } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';

let prisma: PrismaService;
let emailTwoFactor: EmailTwoFactor;
let mockEmailSender: jest.Mocked<EmailSenderPort>;
let testUserId: string;

beforeAll(async () => {
  prisma = new PrismaService();
  await prisma.onModuleInit();

  // Create a test user
  await prisma.asSystem((c) => c.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  const rows = await prisma.asSystem((c) =>
    c.$queryRaw<{ id: string }[]>`SELECT create_user('2fa@example.com'::citext, 'h') AS id`,
  );
  testUserId = rows[0]!.id;
});

beforeEach(async () => {
  // Clean 2FA codes between tests
  await prisma.asSystem((c) =>
    c.$executeRaw`TRUNCATE two_factor_codes RESTART IDENTITY CASCADE`,
  );

  mockEmailSender = {
    send: jest.fn().mockResolvedValue(undefined),
  };

  const hasher = new Argon2PasswordHasher();
  emailTwoFactor = new EmailTwoFactor(prisma, hasher, mockEmailSender);
});

afterAll(async () => {
  await prisma.asSystem((c) => c.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await prisma.onModuleDestroy();
});

describe('EmailTwoFactor', () => {
  describe('issueCode', () => {
    it('stores a hashed code in two_factor_codes (not plaintext)', async () => {
      await emailTwoFactor.issueCode(testUserId);

      const rows = await prisma.asSystem((c) =>
        c.$queryRaw<{ code_hash: string; user_id: string }[]>`
          SELECT code_hash, user_id FROM two_factor_codes WHERE user_id = ${testUserId}::uuid
        `,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.code_hash).not.toMatch(/^\d{6}$/); // must be a hash, not a 6-digit plaintext
    });

    it('calls the email sender with the user email area (mocked)', async () => {
      await emailTwoFactor.issueCode(testUserId);
      expect(mockEmailSender.send).toHaveBeenCalledTimes(1);
    });

    it('sets expires_at to roughly now + 10 min', async () => {
      await emailTwoFactor.issueCode(testUserId);

      const rows = await prisma.asSystem((c) =>
        c.$queryRaw<{ expires_at: Date }[]>`
          SELECT expires_at FROM two_factor_codes WHERE user_id = ${testUserId}::uuid
        `,
      );
      const expiresAt = rows[0]!.expires_at;
      const tenMinFromNow = new Date(Date.now() + 10 * 60 * 1000);
      const nineMinFromNow = new Date(Date.now() + 9 * 60 * 1000);
      expect(expiresAt.getTime()).toBeGreaterThan(nineMinFromNow.getTime());
      expect(expiresAt.getTime()).toBeLessThanOrEqual(tenMinFromNow.getTime() + 2000);
    });
  });

  describe('verifyCode', () => {
    it('returns true for the correct code', async () => {
      // Capture the code sent via email
      let capturedCode = '';
      mockEmailSender.send = jest.fn().mockImplementation((_to, _subject, body) => {
        const match = body.match(/\d{6}/);
        if (match) capturedCode = match[0];
        return Promise.resolve();
      });

      await emailTwoFactor.issueCode(testUserId);
      expect(capturedCode).toMatch(/^\d{6}$/);

      const result = await emailTwoFactor.verifyCode(testUserId, capturedCode);
      expect(result).toBe(true);
    });

    it('returns false for a wrong code', async () => {
      await emailTwoFactor.issueCode(testUserId);
      const result = await emailTwoFactor.verifyCode(testUserId, '000000');
      expect(result).toBe(false);
    });

    it('returns false after the code has been consumed', async () => {
      let capturedCode = '';
      mockEmailSender.send = jest.fn().mockImplementation((_to, _subject, body) => {
        const match = body.match(/\d{6}/);
        if (match) capturedCode = match[0];
        return Promise.resolve();
      });

      await emailTwoFactor.issueCode(testUserId);
      // First verify consumes the code
      await emailTwoFactor.verifyCode(testUserId, capturedCode);
      // Second verify on same code should fail
      const result = await emailTwoFactor.verifyCode(testUserId, capturedCode);
      expect(result).toBe(false);
    });

    it('returns false for an expired code', async () => {
      // Insert an already-expired code row directly
      const hasher = new Argon2PasswordHasher();
      const codeHash = await hasher.hash('123456');
      const pastExpiry = new Date(Date.now() - 1000); // 1 second ago

      await prisma.asSystem((c) =>
        c.$executeRaw`
          INSERT INTO two_factor_codes (user_id, code_hash, expires_at, attempts)
          VALUES (${testUserId}::uuid, ${codeHash}, ${pastExpiry}, 0)
        `,
      );

      const result = await emailTwoFactor.verifyCode(testUserId, '123456');
      expect(result).toBe(false);
    });
  });
});
