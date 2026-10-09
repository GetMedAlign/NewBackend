import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

describe('localization RLS', () => {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const raw = new PrismaClient({ adapter });
  let prisma: PrismaService;

  beforeAll(async () => {
    await raw.$executeRawUnsafe(
      `INSERT INTO location (slug, name, state_code, status) VALUES ('rls-test-city','RLS Test','FL','available') ON CONFLICT (slug) DO NOTHING`,
    );
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });
  afterAll(async () => {
    await raw.$executeRawUnsafe(`DELETE FROM location WHERE slug = 'rls-test-city'`);
    await prisma.onModuleDestroy();
    await raw.$disconnect();
    await pool.end();
  });

  it('asSystem reads locations (RLS bypassed for system path)', async () => {
    const rows = await prisma.asSystem(
      (c) =>
        c.$queryRaw<{ slug: string }[]>`SELECT slug FROM location WHERE slug = 'rls-test-city'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('a non-admin user context sees no location rows (policy denies)', async () => {
    const rows = await prisma.withUserContext(
      { userId: null, role: 'patient', ip: null },
      (tx) =>
        tx.$queryRaw<{ slug: string }[]>`SELECT slug FROM location WHERE slug = 'rls-test-city'`,
    );
    expect(rows).toHaveLength(0);
  });
});
