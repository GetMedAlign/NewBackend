/**
 * Integration test: verifies DB-side audit triggers write audit_log rows with
 * the acting user's context, that password_hash is stripped from the captured
 * jsonb, and that app_authenticated cannot write audit_log directly.
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

let service: PrismaService;
let idA: string;

async function createUser(email: string): Promise<string> {
  const rows = await service.asSystem((client) =>
    client.$queryRaw<{ id: string }[]>`
      SELECT create_user(${email}::citext, 'h') AS id
    `,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`create_user did not return an id for ${email}`);
  return id;
}

beforeAll(async () => {
  service = new PrismaService();
  await service.onModuleInit();

  await service.asSystem(
    (client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`,
  );
  await service.asSystem(
    (client) => client.$executeRaw`TRUNCATE audit_log RESTART IDENTITY CASCADE`,
  );

  idA = await createUser('a@x.com');
});

afterAll(async () => {
  await service.asSystem(
    (client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`,
  );
  await service.asSystem(
    (client) => client.$executeRaw`TRUNCATE audit_log RESTART IDENTITY CASCADE`,
  );
  await service.onModuleDestroy();
});

describe('audit triggers', () => {
  it('records a user_updated audit row with actor context and no password_hash', async () => {
    await service.withUserContext(
      { userId: idA, role: 'patient', ip: '203.0.113.7' },
      (tx) =>
        tx.user.update({
          where: { id: idA },
          data: { emailConfirmed: true },
        }),
    );

    const rows = await service.asSystem((client) =>
      client.$queryRaw<
        {
          actor_user_id: string;
          action_type: string;
          affected_record: string;
          new_value: Record<string, unknown>;
        }[]
      >`
        SELECT actor_user_id, action_type, affected_record, new_value
        FROM audit_log
        WHERE action_type = 'user_updated'
        ORDER BY created_at DESC
        LIMIT 1
      `,
    );

    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.actor_user_id).toBe(idA);
    expect(row?.action_type).toBe('user_updated');
    expect(row?.affected_record).toBe(`users:${idA}`);
    expect(row?.new_value).toBeDefined();
    expect(row?.new_value).not.toHaveProperty('password_hash');
  });

  it('denies a direct audit_log insert from app_authenticated', async () => {
    await expect(
      service.withUserContext(
        { userId: idA, role: 'patient', ip: null },
        (tx) => tx.$executeRaw`
          INSERT INTO audit_log (actor_role, action_type, affected_record)
          VALUES ('patient', 'hack', 'users:x')
        `,
      ),
    ).rejects.toThrow();
  });
});
