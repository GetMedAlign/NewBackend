/**
 * Integration test: verifies that the database schema contains all patient-journey
 * tables, the assessment_category enum (4 labels), and the required unique constraints,
 * after migrations have been applied.
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

describe('Patient-journey schema integration', () => {
  it('should have all 12 patient-journey tables in the public schema', async () => {
    const expectedTables = [
      'patients',
      'patient_assessments',
      'assessment_goals',
      'assessment_symptoms',
      'assessment_chronic_conditions',
      'assessment_prescriptions',
      'clinics',
      'clinic_categories',
      'clinic_services',
      'leads',
      'webhook_deliveries',
      'zip_codes',
    ].sort();

    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name = ANY(ARRAY[
          'patients','patient_assessments','assessment_goals','assessment_symptoms',
          'assessment_chronic_conditions','assessment_prescriptions','clinics',
          'clinic_categories','clinic_services','leads','webhook_deliveries','zip_codes'
        ])
      ORDER BY table_name
    `;

    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual(expectedTables);
  });

  it('should have the assessment_category enum with exactly 4 labels', async () => {
    const rows = await prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'assessment_category'
      ORDER BY e.enumsortorder
    `;

    const labels = rows.map((r) => r.enumlabel);
    expect(labels).toEqual(['hormone', 'peptide', 'med_spa', 'wellness']);
  });

  it('should have a unique constraint on patient_assessments.session_id', async () => {
    // Postgres unique constraints can be backed by unique indexes; check pg_indexes
    // (which covers both CREATE UNIQUE INDEX and ADD CONSTRAINT ... UNIQUE).
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'patient_assessments'
        AND indexdef LIKE '%UNIQUE%'
        AND indexdef LIKE '%session_id%'
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('should have a unique constraint on leads.lead_id', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'leads'
        AND indexdef LIKE '%UNIQUE%'
        AND indexdef LIKE '%lead_id%'
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('should have a unique constraint on clinics.slug', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'clinics'
        AND indexdef LIKE '%UNIQUE%'
        AND indexdef LIKE '%slug%'
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('should have zip_codes.zip as the primary key (which implies uniqueness)', async () => {
    const rows = await prisma.$queryRaw<{ constraint_name: string }[]>`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'zip_codes'
        AND tc.constraint_type = 'PRIMARY KEY'
        AND kcu.column_name = 'zip'
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
