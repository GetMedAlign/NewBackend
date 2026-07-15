/**
 * Integration test for PrismaApplicationRepository against a live Postgres.
 * DATABASE_URL is loaded from test/.env.test.
 *
 * Verifies that create() atomically persists the clinic_applications row
 * (status='pending'), its application_categories, and its application_services
 * (with correct is_top_service / display_order).
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaApplicationRepository } from '../../src/modules/clinic-applications/infrastructure/prisma-application.repository';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const seedPrisma = new PrismaClient({ adapter });

let prismaService: PrismaService;
let repo: PrismaApplicationRepository;

const createdApplicationIds: string[] = [];

beforeAll(async () => {
  prismaService = new PrismaService();
  await prismaService.onModuleInit();
  repo = new PrismaApplicationRepository(prismaService);
});

afterAll(async () => {
  // Clean up rows created during tests (cascades to categories + services)
  for (const id of createdApplicationIds) {
    await seedPrisma.$executeRaw`DELETE FROM clinic_applications WHERE id = ${id}::uuid`;
  }
  await prismaService.onModuleDestroy();
  await seedPrisma.$disconnect();
  await pool.end();
});

describe('PrismaApplicationRepository', () => {
  it('create() returns an applicationId (uuid string)', async () => {
    const { applicationId } = await repo.create({
      clinicName: 'Int Test Clinic',
      contactEmail: `int-test-${Date.now()}@example.com`,
      categories: ['hormone'],
      services: [{ serviceCode: 'testosterone-replacement', isTopService: true, displayOrder: 1 }],
    });
    createdApplicationIds.push(applicationId);

    expect(typeof applicationId).toBe('string');
    expect(applicationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('persists the clinic_applications row with status=pending', async () => {
    const email = `int-test-status-${Date.now()}@example.com`;
    const { applicationId } = await repo.create({
      clinicName: 'Status Pending Clinic',
      contactEmail: email,
      categories: ['hormone'],
      services: [],
    });
    createdApplicationIds.push(applicationId);

    const rows = await seedPrisma.$queryRaw<{ status: string; clinic_name: string }[]>`
      SELECT status, clinic_name FROM clinic_applications WHERE id = ${applicationId}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.clinic_name).toBe('Status Pending Clinic');
  });

  it('persists all provided fields onto the clinic_applications row', async () => {
    const email = `int-test-fields-${Date.now()}@example.com`;
    const { applicationId } = await repo.create({
      clinicName: 'Full Fields Clinic',
      contactEmail: email,
      businessEmail: 'biz@example.com',
      city: 'Denver',
      stateCode: 'CO',
      zipCode: '80203',
      websiteUrl: 'https://fullfields.example.com',
      telehealthAvailable: true,
      offersLabWork: false,
      newPatientWait: '2-3 weeks',
      npiNumber: '0987654321',
      stateLicenseNumber: 'CO-MED-042',
      consultationFeeBand: '$150-$250',
      monthlyProgramBand: '$300-$500',
      financingAvailable: true,
      insuranceAccepted: false,
      insuranceNotes: 'HSA/FSA accepted.',
      about: 'We are a test clinic.',
      differentiators: 'Best in class.',
      providerName: 'Dr. Test',
      credentials: 'MD',
      logoUrl: 'https://storage.test/logo.png',
      photoUrls: ['https://storage.test/photo1.jpg'],
      categories: ['wellness'],
      services: [],
    });
    createdApplicationIds.push(applicationId);

    const rows = await seedPrisma.$queryRaw<
      {
        business_email: string;
        city: string;
        state_code: string;
        telehealth_available: boolean;
        logo_url: string;
      }[]
    >`
      SELECT business_email, city, state_code, telehealth_available, logo_url
      FROM clinic_applications WHERE id = ${applicationId}::uuid
    `;
    expect(rows[0]!.business_email).toBe('biz@example.com');
    expect(rows[0]!.city).toBe('Denver');
    expect(rows[0]!.state_code).toBe('CO');
    expect(rows[0]!.telehealth_available).toBe(true);
    expect(rows[0]!.logo_url).toBe('https://storage.test/logo.png');
  });

  it('persists application_categories for each category in input', async () => {
    const email = `int-test-cats-${Date.now()}@example.com`;
    const { applicationId } = await repo.create({
      clinicName: 'Categories Clinic',
      contactEmail: email,
      categories: ['hormone', 'peptide'],
      services: [],
    });
    createdApplicationIds.push(applicationId);

    const rows = await seedPrisma.$queryRaw<{ category: string }[]>`
      SELECT category::text FROM application_categories
      WHERE application_id = ${applicationId}::uuid
      ORDER BY category
    `;
    expect(rows).toHaveLength(2);
    const cats = rows.map((r) => r.category).sort();
    expect(cats).toContain('hormone');
    expect(cats).toContain('peptide');
  });

  it('persists application_services with correct is_top_service and display_order', async () => {
    const email = `int-test-svcs-${Date.now()}@example.com`;
    const { applicationId } = await repo.create({
      clinicName: 'Services Clinic',
      contactEmail: email,
      categories: ['hormone'],
      services: [
        { serviceCode: 'testosterone-replacement', isTopService: true, displayOrder: 1 },
        { serviceCode: 'peptide-therapy', isTopService: true, displayOrder: 2 },
        { serviceCode: 'thyroid-optimization', isTopService: false, displayOrder: 3 },
      ],
    });
    createdApplicationIds.push(applicationId);

    const rows = await seedPrisma.$queryRaw<
      { service_code: string; is_top_service: boolean; display_order: number }[]
    >`
      SELECT service_code, is_top_service, display_order
      FROM application_services
      WHERE application_id = ${applicationId}::uuid
      ORDER BY display_order
    `;
    expect(rows).toHaveLength(3);
    expect(rows[0]!.service_code).toBe('testosterone-replacement');
    expect(rows[0]!.is_top_service).toBe(true);
    expect(rows[0]!.display_order).toBe(1);
    expect(rows[1]!.service_code).toBe('peptide-therapy');
    expect(rows[1]!.is_top_service).toBe(true);
    expect(rows[1]!.display_order).toBe(2);
    expect(rows[2]!.service_code).toBe('thyroid-optimization');
    expect(rows[2]!.is_top_service).toBe(false);
    expect(rows[2]!.display_order).toBe(3);
  });

  it('persists zero services when services array is empty', async () => {
    const email = `int-test-no-svcs-${Date.now()}@example.com`;
    const { applicationId } = await repo.create({
      clinicName: 'No Services Clinic',
      contactEmail: email,
      categories: ['hormone'],
      services: [],
    });
    createdApplicationIds.push(applicationId);

    const rows = await seedPrisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM application_services
      WHERE application_id = ${applicationId}::uuid
    `;
    expect(Number(rows[0]!.count)).toBe(0);
  });
});
