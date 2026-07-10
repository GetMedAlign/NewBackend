/**
 * Integration test: verifies Row-Level Security is actually enforced through
 * the app connection. Seeding happens via asSystem (superuser, bypasses RLS);
 * scoped reads happen via withUserContext (runs as app_authenticated).
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

let service: PrismaService;

let idA: string;
let idB: string;
let idAdmin: string;

async function createUser(email: string): Promise<string> {
  const rows = await service.asSystem(
    (client) =>
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

  // Clean slate for deterministic assertions.
  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);

  idA = await createUser('a@x.com');
  idB = await createUser('b@x.com');
  idAdmin = await createUser('admin@x.com');

  await service.asSystem(
    (client) => client.$executeRaw`
      INSERT INTO user_roles (user_id, role) VALUES (${idAdmin}::uuid, 'admin'::app_role)
    `,
  );
});

afterAll(async () => {
  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await service.onModuleDestroy();
});

describe('RLS enforcement', () => {
  it('patient sees only their own user row via findMany', async () => {
    const rows = await service.withUserContext({ userId: idA, role: 'patient', ip: null }, (tx) =>
      tx.user.findMany(),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(idA);
  });

  it('patient cannot read another user row via findUnique', async () => {
    const row = await service.withUserContext({ userId: idA, role: 'patient', ip: null }, (tx) =>
      tx.user.findUnique({ where: { id: idB } }),
    );

    expect(row).toBeNull();
  });

  it('admin sees all user rows via findMany', async () => {
    const rows = await service.withUserContext({ userId: idAdmin, role: 'admin', ip: null }, (tx) =>
      tx.user.findMany(),
    );

    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([idA, idB, idAdmin].sort());
  });
});
