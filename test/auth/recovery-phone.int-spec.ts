/**
 * Integration test: encrypted recovery-phone column (spec §8/§12.3).
 *
 * Verifies:
 *  (a) The raw DB column stores ciphertext — not the plaintext phone number —
 *      proving field-level encryption at rest.
 *  (b) getRecoveryPhone decrypts the stored value and returns the original
 *      plaintext (round-trip correctness).
 *
 * Requires a real Postgres instance — DATABASE_URL and ENCRYPTION_KEY loaded
 * from test/.env.test via jest.int.config.ts setupFiles.
 */
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AesGcmEncryptionService } from '../../src/infrastructure/crypto/aes-gcm-encryption.service';
import { PrismaUserRepository } from '../../src/modules/auth/infrastructure/persistence/prisma-user.repository';

const PHONE = '+15555550123';

let prisma: PrismaService;
let repo: PrismaUserRepository;

beforeAll(async () => {
  prisma = new PrismaService();
  await prisma.onModuleInit();

  // Build the encryption service without full NestJS DI.
  // ENCRYPTION_KEY is loaded from test/.env.test by setup-env.ts.
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
  await prisma.asSystem((c) => c.$executeRaw`TRUNCATE two_factor_codes RESTART IDENTITY CASCADE`);
  await prisma.asSystem((c) => c.$executeRaw`TRUNCATE audit_log RESTART IDENTITY CASCADE`);
  await prisma.asSystem((c) => c.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
});

describe('Recovery phone — encrypted column (§8/§12.3)', () => {
  it('stores ciphertext in the DB column (not plaintext) and round-trips via decrypt', async () => {
    // Create a user via the SECURITY DEFINER function (same as production path).
    const userId = await repo.create('recovery-phone@example.com', 'hashed-pw');

    // Set the recovery phone — this must encrypt before writing.
    await repo.setRecoveryPhone(userId, PHONE);

    // (a) Read the RAW column directly — must not equal plaintext and must be
    //     non-empty base64, proving at-rest ciphertext (§12.3).
    const rawRows = await prisma.asSystem((client) =>
      client.$queryRaw<{ recovery_phone_encrypted: string | null }[]>`
        SELECT recovery_phone_encrypted FROM users WHERE id = ${userId}::uuid LIMIT 1
      `,
    );
    const rawValue = rawRows[0]?.recovery_phone_encrypted ?? null;

    expect(rawValue).not.toBeNull();
    expect(rawValue).not.toBe(PHONE);
    // Must be valid non-empty base64.
    expect(rawValue).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect((rawValue as string).length).toBeGreaterThan(0);

    // (b) getRecoveryPhone must decrypt and return the original plaintext.
    const decrypted = await repo.getRecoveryPhone(userId);
    expect(decrypted).toBe(PHONE);
  });

  it('getRecoveryPhone returns null when no phone has been set', async () => {
    const userId = await repo.create('no-phone@example.com', 'hashed-pw');
    const result = await repo.getRecoveryPhone(userId);
    expect(result).toBeNull();
  });
});
