/**
 * Integration test: verifies that the database schema contains all clinic-applications
 * additions — clinic_applications, application_categories, application_services,
 * and password_reset_tokens tables with the correct columns, defaults, nullability,
 * and FK constraints.
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

// ---------------------------------------------------------------------------
// Helper: look up a single column from information_schema
// ---------------------------------------------------------------------------
async function getColumn(
  table: string,
  column: string,
): Promise<{ data_type: string; is_nullable: string; column_default: string | null } | undefined> {
  const rows = await prisma.$queryRaw<
    { data_type: string; is_nullable: string; column_default: string | null }[]
  >`
    SELECT data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = ${table}
      AND column_name  = ${column}
  `;
  return rows[0];
}

// ---------------------------------------------------------------------------
// Helper: look up a FK delete_rule
// ---------------------------------------------------------------------------
async function getFkDeleteRule(
  childTable: string,
  childColumn: string,
  parentTable: string,
  parentColumn: string,
): Promise<string | undefined> {
  const rows = await prisma.$queryRaw<{ delete_rule: string }[]>`
    SELECT rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name        = tc.constraint_name
     AND rc.constraint_schema      = tc.table_schema
    JOIN information_schema.key_column_usage kcu2
      ON rc.unique_constraint_name = kcu2.constraint_name
     AND rc.unique_constraint_schema = kcu2.table_schema
    WHERE tc.table_schema   = 'public'
      AND tc.table_name     = ${childTable}
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name   = ${childColumn}
      AND kcu2.table_name   = ${parentTable}
      AND kcu2.column_name  = ${parentColumn}
  `;
  return rows[0]?.delete_rule;
}

// ---------------------------------------------------------------------------
// Table-existence assertions
// ---------------------------------------------------------------------------

describe('Clinic-applications schema integration', () => {
  it.each([
    'clinic_applications',
    'application_categories',
    'application_services',
    'password_reset_tokens',
  ])('table %s exists', async (tableName) => {
    const rows = await prisma.$queryRaw<{ regclass: string | null }[]>`
      SELECT to_regclass(${`public.${tableName}`})::text AS regclass
    `;
    expect(rows[0]?.regclass).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // clinic_applications columns
  // ---------------------------------------------------------------------------

  describe('clinic_applications columns', () => {
    it.each([
      // [columnName, data_type, is_nullable]
      ['id', 'uuid', 'NO'],
      ['clinic_name', 'text', 'NO'],
      ['contact_email', 'text', 'NO'],
      ['business_email', 'text', 'YES'],
      ['city', 'text', 'YES'],
      ['state_code', 'text', 'YES'],
      ['zip_code', 'text', 'YES'],
      ['website_url', 'text', 'YES'],
      ['telehealth_available', 'boolean', 'NO'],
      ['offers_lab_work', 'boolean', 'NO'],
      ['new_patient_wait', 'text', 'YES'],
      ['npi_number', 'text', 'YES'],
      ['state_license_number', 'text', 'YES'],
      ['consultation_fee_band', 'text', 'YES'],
      ['monthly_program_band', 'text', 'YES'],
      ['financing_available', 'boolean', 'NO'],
      ['insurance_accepted', 'boolean', 'NO'],
      ['insurance_notes', 'text', 'YES'],
      ['about', 'text', 'YES'],
      ['differentiators', 'text', 'YES'],
      ['provider_name', 'text', 'YES'],
      ['credentials', 'text', 'YES'],
      ['logo_url', 'text', 'YES'],
      ['photo_urls', 'jsonb', 'YES'],
      ['status', 'text', 'NO'],
      ['deny_reason', 'text', 'YES'],
      ['reviewed_at', 'timestamp with time zone', 'YES'],
      ['reviewed_by_user_id', 'uuid', 'YES'],
      ['created_clinic_id', 'uuid', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
      ['updated_at', 'timestamp with time zone', 'NO'],
    ])(
      'has column %s with data_type=%s, is_nullable=%s',
      async (columnName, dataType, isNullable) => {
        const col = await getColumn('clinic_applications', columnName);
        expect(col).toBeDefined();
        expect(col?.data_type).toBe(dataType);
        expect(col?.is_nullable).toBe(isNullable);
      },
    );

    it('status column has default "pending"', async () => {
      const col = await getColumn('clinic_applications', 'status');
      expect(col?.column_default).toBe("'pending'::text");
    });

    it('telehealth_available column has default false', async () => {
      const col = await getColumn('clinic_applications', 'telehealth_available');
      expect(col?.column_default).toBe('false');
    });

    it('offers_lab_work column has default false', async () => {
      const col = await getColumn('clinic_applications', 'offers_lab_work');
      expect(col?.column_default).toBe('false');
    });

    it('financing_available column has default false', async () => {
      const col = await getColumn('clinic_applications', 'financing_available');
      expect(col?.column_default).toBe('false');
    });

    it('insurance_accepted column has default false', async () => {
      const col = await getColumn('clinic_applications', 'insurance_accepted');
      expect(col?.column_default).toBe('false');
    });

    it('created_at column has default now()', async () => {
      const col = await getColumn('clinic_applications', 'created_at');
      expect(col?.column_default).toBe('now()');
    });

    it('updated_at column has default now()', async () => {
      const col = await getColumn('clinic_applications', 'updated_at');
      expect(col?.column_default).toBe('now()');
    });

    it('created_clinic_id FK → clinics(id) ON DELETE SET NULL', async () => {
      const rule = await getFkDeleteRule(
        'clinic_applications',
        'created_clinic_id',
        'clinics',
        'id',
      );
      expect(rule).toBe('SET NULL');
    });
  });

  // ---------------------------------------------------------------------------
  // application_categories columns + PK + FK
  // ---------------------------------------------------------------------------

  describe('application_categories', () => {
    it.each([
      ['application_id', 'uuid', 'NO'],
      ['category', 'USER-DEFINED', 'NO'],
    ])(
      'has column %s with data_type=%s, is_nullable=%s',
      async (columnName, dataType, isNullable) => {
        const col = await getColumn('application_categories', columnName);
        expect(col).toBeDefined();
        expect(col?.data_type).toBe(dataType);
        expect(col?.is_nullable).toBe(isNullable);
      },
    );

    it('application_id FK → clinic_applications(id) ON DELETE CASCADE', async () => {
      const rule = await getFkDeleteRule(
        'application_categories',
        'application_id',
        'clinic_applications',
        'id',
      );
      expect(rule).toBe('CASCADE');
    });

    it('has composite primary key (application_id, category)', async () => {
      const rows = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema    = kcu.table_schema
        WHERE tc.table_schema    = 'public'
          AND tc.table_name      = 'application_categories'
          AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position
      `;
      const pkCols = rows.map((r) => r.column_name);
      expect(pkCols).toContain('application_id');
      expect(pkCols).toContain('category');
    });
  });

  // ---------------------------------------------------------------------------
  // application_services columns + FK
  // ---------------------------------------------------------------------------

  describe('application_services', () => {
    it.each([
      ['id', 'uuid', 'NO'],
      ['application_id', 'uuid', 'NO'],
      ['service_code', 'text', 'NO'],
      ['is_top_service', 'boolean', 'NO'],
      ['display_order', 'integer', 'NO'],
    ])(
      'has column %s with data_type=%s, is_nullable=%s',
      async (columnName, dataType, isNullable) => {
        const col = await getColumn('application_services', columnName);
        expect(col).toBeDefined();
        expect(col?.data_type).toBe(dataType);
        expect(col?.is_nullable).toBe(isNullable);
      },
    );

    it('is_top_service column has default false', async () => {
      const col = await getColumn('application_services', 'is_top_service');
      expect(col?.column_default).toBe('false');
    });

    it('application_id FK → clinic_applications(id) ON DELETE CASCADE', async () => {
      const rule = await getFkDeleteRule(
        'application_services',
        'application_id',
        'clinic_applications',
        'id',
      );
      expect(rule).toBe('CASCADE');
    });
  });

  // ---------------------------------------------------------------------------
  // password_reset_tokens columns + FK
  // ---------------------------------------------------------------------------

  describe('password_reset_tokens', () => {
    it.each([
      ['id', 'uuid', 'NO'],
      ['user_id', 'uuid', 'NO'],
      ['token_hash', 'text', 'NO'],
      ['expires_at', 'timestamp with time zone', 'NO'],
      ['consumed_at', 'timestamp with time zone', 'YES'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ])(
      'has column %s with data_type=%s, is_nullable=%s',
      async (columnName, dataType, isNullable) => {
        const col = await getColumn('password_reset_tokens', columnName);
        expect(col).toBeDefined();
        expect(col?.data_type).toBe(dataType);
        expect(col?.is_nullable).toBe(isNullable);
      },
    );

    it('created_at column has default now()', async () => {
      const col = await getColumn('password_reset_tokens', 'created_at');
      expect(col?.column_default).toBe('now()');
    });

    it('user_id FK → users(id) ON DELETE CASCADE', async () => {
      const rule = await getFkDeleteRule('password_reset_tokens', 'user_id', 'users', 'id');
      expect(rule).toBe('CASCADE');
    });
  });
});
