/**
 * Integration tests for PrismaPasswordResetRepository.setPasswordWithAudit —
 * the atomic admin set-password + admin_set_password audit write used by
 * SetClinicPasswordUseCase and SetPatientPasswordUseCase.
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 *
 * The key proof here is the second test: it forces the audit half of the
 * write to fail against the REAL database (an invalid ::uuid cast, not a
 * mock), then reads the password hash back and confirms it did NOT change.
 * That is only possible if both statements ran inside one transaction that
 * Postgres rolled back in full.
 */
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaPasswordResetRepository } from '../../src/modules/auth/infrastructure/persistence/prisma-password-reset.repository';
import type { AuditEvent } from '../../src/modules/auth/domain/ports/audit.port';

let prisma: PrismaService;
let repo: PrismaPasswordResetRepository;
let testUserId: string;
const testEmail = 'admin-set-password-int@example.com';
const originalHash = 'original-hash-before-any-set-password-call';

interface PasswordHashRow {
  password_hash: string;
}

interface AuditCountRow {
  count: bigint;
}

beforeAll(async () => {
  prisma = new PrismaService();
  await prisma.onModuleInit();

  await prisma.asSystem((c) => c.$executeRaw`DELETE FROM users WHERE email = ${testEmail}::citext`);
  const rows = await prisma.asSystem(
    (c) => c.$queryRaw<{ id: string }[]>`SELECT create_user(${testEmail}::citext, 'hash') AS id`,
  );
  testUserId = rows[0]!.id;

  repo = new PrismaPasswordResetRepository(prisma);
});

beforeEach(async () => {
  await prisma.asSystem(
    (c) =>
      c.$executeRaw`UPDATE users SET password_hash = ${originalHash} WHERE id = ${testUserId}::uuid`,
  );
  await prisma.asSystem(
    (c) => c.$executeRaw`DELETE FROM audit_log WHERE affected_record = ${testUserId}`,
  );
});

afterAll(async () => {
  await prisma.asSystem((c) => c.$executeRaw`DELETE FROM users WHERE email = ${testEmail}::citext`);
  await prisma.onModuleDestroy();
});

async function readPasswordHash(): Promise<string> {
  const rows = await prisma.asSystem(
    (c) =>
      c.$queryRaw<
        PasswordHashRow[]
      >`SELECT password_hash FROM users WHERE id = ${testUserId}::uuid`,
  );
  return rows[0]!.password_hash;
}

async function countAuditRows(): Promise<number> {
  const rows = await prisma.asSystem(
    (c) =>
      c.$queryRaw<AuditCountRow[]>`
        SELECT count(*)::bigint AS count FROM audit_log
        WHERE affected_record = ${testUserId} AND action_type = 'admin_set_password'
      `,
  );
  return Number(rows[0]!.count);
}

describe('PrismaPasswordResetRepository.setPasswordWithAudit', () => {
  it('updates the password hash and writes exactly one admin_set_password audit row', async () => {
    const auditEvent: AuditEvent = {
      actorUserId: testUserId,
      actorRole: 'admin',
      ip: '127.0.0.1',
      actionType: 'admin_set_password',
      affectedRecord: testUserId,
    };

    await repo.setPasswordWithAudit(testUserId, 'new-hash-success-case', auditEvent);

    expect(await readPasswordHash()).toBe('new-hash-success-case');
    expect(await countAuditRows()).toBe(1);
  });

  it('rolls back the password update when the audit write fails (proves atomicity, not mocked)', async () => {
    // actorUserId is cast to ::uuid inside the same transaction as the
    // password UPDATE. An invalid UUID here makes the audit insert throw a
    // real Postgres error, which must abort the whole transaction.
    const invalidAuditEvent: AuditEvent = {
      actorUserId: 'not-a-valid-uuid',
      actorRole: 'admin',
      ip: '127.0.0.1',
      actionType: 'admin_set_password',
      affectedRecord: testUserId,
    };

    await expect(
      repo.setPasswordWithAudit(testUserId, 'new-hash-that-must-not-persist', invalidAuditEvent),
    ).rejects.toThrow();

    // The password update ran first in program order, but since it shares a
    // transaction with the failed audit insert, Postgres must have rolled it
    // back too — so the hash must still be the pre-call value.
    expect(await readPasswordHash()).toBe(originalHash);
    expect(await countAuditRows()).toBe(0);
  });
});
