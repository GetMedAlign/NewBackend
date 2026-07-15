/**
 * Integration test: verifies that the database schema contains all clinic-portal
 * additions — users.clinic_id FK, new clinics columns, and the clinic_photos table.
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
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

describe('Clinic-portal schema integration', () => {
  it('clinic_photos table exists', async () => {
    const rows = await prisma.$queryRaw<{ regclass: string | null }[]>`
      SELECT to_regclass('public.clinic_photos')::text AS regclass
    `;
    expect(rows[0]?.regclass).not.toBeNull();
  });

  it('users table has a clinic_id column', async () => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'clinic_id'
    `;
    expect(rows.length).toBe(1);
  });

  it('users.clinic_id has a FK to clinics(id)', async () => {
    const rows = await prisma.$queryRaw<{ constraint_name: string }[]>`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.table_schema
      JOIN information_schema.key_column_usage kcu2
        ON rc.unique_constraint_name = kcu2.constraint_name
        AND rc.unique_constraint_schema = kcu2.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'users'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'clinic_id'
        AND kcu2.table_name = 'clinics'
        AND kcu2.column_name = 'id'
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ['differentiators', 'text', 'YES'],
    ['offers_lab_work', 'boolean', 'NO'],
    ['insurance_notes', 'text', 'YES'],
    ['credentials', 'text', 'YES'],
    ['npi_number', 'text', 'YES'],
    ['state_license_number', 'text', 'YES'],
    ['logo_url', 'text', 'YES'],
    ['photo_count', 'integer', 'NO'],
    ['weekly_summary', 'boolean', 'NO'],
    ['location', 'text', 'YES'],
    ['webhook_health', 'text', 'NO'],
    ['suspension_reason', 'text', 'YES'],
    ['created_at', 'timestamp with time zone', 'NO'],
  ])(
    'clinics has column %s with correct data_type=%s, is_nullable=%s',
    async (columnName, dataType, isNullable) => {
      const rows = await prisma.$queryRaw<
        { column_name: string; data_type: string; is_nullable: string }[]
      >`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'clinics'
          AND column_name = ${columnName}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0]?.data_type).toBe(dataType);
      expect(rows[0]?.is_nullable).toBe(isNullable);
    },
  );

  it('clinic_photos has the correct columns and constraints', async () => {
    const columns = await prisma.$queryRaw<
      { column_name: string; data_type: string; is_nullable: string }[]
    >`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'clinic_photos'
      ORDER BY ordinal_position
    `;
    const colMap = Object.fromEntries(
      columns.map((c) => [c.column_name, { data_type: c.data_type, is_nullable: c.is_nullable }]),
    );

    expect(colMap['id']).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(colMap['clinic_id']).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(colMap['url']).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(colMap['display_order']).toMatchObject({ data_type: 'integer', is_nullable: 'NO' });
  });

  it('clinic_photos.clinic_id has a FK to clinics(id) with ON DELETE CASCADE', async () => {
    const rows = await prisma.$queryRaw<{ delete_rule: string }[]>`
      SELECT rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.table_schema
      JOIN information_schema.key_column_usage kcu2
        ON rc.unique_constraint_name = kcu2.constraint_name
        AND rc.unique_constraint_schema = kcu2.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'clinic_photos'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'clinic_id'
        AND kcu2.table_name = 'clinics'
        AND kcu2.column_name = 'id'
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.delete_rule).toBe('CASCADE');
  });
});
