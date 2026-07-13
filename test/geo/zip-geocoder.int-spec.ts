/**
 * Integration tests for ZipGeocoder.
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 * Runs the patient-journey seed to ensure zip_codes rows exist.
 */
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { ZipGeocoder } from '../../src/infrastructure/geo/zip-geocoder';
import { seedPatientJourney } from '../../prisma/seed/patient-journey.seed';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

let prismaService: PrismaService;
let geocoder: ZipGeocoder;

beforeAll(async () => {
  // Seed the DB so zip_codes rows exist
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedClient = new PrismaClient({ adapter });
  await seedPatientJourney(seedClient);
  await seedClient.$disconnect();
  await pool.end();

  prismaService = new PrismaService();
  await prismaService.onModuleInit();
  geocoder = new ZipGeocoder(prismaService);
});

afterAll(async () => {
  await prismaService.onModuleDestroy();
});

describe('ZipGeocoder', () => {
  it('returns lat, lng, and state for a seeded zip (10001 → NY)', async () => {
    const result = await geocoder.lookup('10001');
    expect(result).not.toBeNull();
    // Seeded values from zip-codes.ts: 40.7484, -73.9967, NY
    expect(result!.lat).toBeCloseTo(40.7484, 3);
    expect(result!.lng).toBeCloseTo(-73.9967, 3);
    expect(result!.state).toBe('NY');
  });

  it('returns null for an unknown zip', async () => {
    const result = await geocoder.lookup('00000');
    expect(result).toBeNull();
  });

  it('returns lat, lng, and state for 90001 (LA → CA)', async () => {
    const result = await geocoder.lookup('90001');
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(33.9731, 3);
    expect(result!.lng).toBeCloseTo(-118.2479, 3);
    expect(result!.state).toBe('CA');
  });
});
