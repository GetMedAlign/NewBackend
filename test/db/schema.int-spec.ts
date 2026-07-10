/**
 * Integration test: verifies that the database schema contains the expected
 * tables and the app_role enum, after migrations have been applied.
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test
 * (via the jest integration config's setupFiles).
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe('Schema integration', () => {
  it('should have the required tables in the public schema', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name IN ('users', 'user_roles', 'two_factor_codes', 'audit_log')
      ORDER BY table_name
    `;

    const names = rows.map((r: { table_name: string }) => r.table_name).sort();
    expect(names).toEqual(['audit_log', 'two_factor_codes', 'user_roles', 'users']);
  });

  it('should have the app_role enum with the correct 4 labels', async () => {
    const rows = await prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'app_role'
      ORDER BY e.enumsortorder
    `;

    const labels = rows.map((r: { enumlabel: string }) => r.enumlabel);
    expect(labels).toEqual(['patient', 'clinic', 'admin', 'superadmin']);
  });

  it('should have the citext extension installed', async () => {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'citext'
    `;
    expect(rows).toHaveLength(1);
  });
});
