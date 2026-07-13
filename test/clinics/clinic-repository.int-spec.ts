/**
 * Integration tests for PrismaClinicRepository.
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 *
 * Ensures the patient-journey seed is applied before running (idempotent upsert),
 * then exercises all three query methods against the live DB.
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaClinicRepository } from '../../src/modules/clinics/infrastructure/prisma-clinic.repository';
import { seedPatientJourney } from '../../prisma/seed/patient-journey.seed';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const seedPrisma = new PrismaClient({ adapter });

let prismaService: PrismaService;
let repo: PrismaClinicRepository;

beforeAll(async () => {
  // Ensure seed data is present (idempotent).
  await seedPatientJourney(seedPrisma);

  prismaService = new PrismaService();
  await prismaService.onModuleInit();
  repo = new PrismaClinicRepository(prismaService);
});

afterAll(async () => {
  await prismaService.onModuleDestroy();
  await seedPrisma.$disconnect();
  await pool.end();
});

describe('PrismaClinicRepository', () => {
  describe('findMatchable("hormone")', () => {
    it('returns active + billing-current hormone clinics with non-empty categories and services', async () => {
      const clinics = await repo.findMatchable('hormone');

      expect(clinics.length).toBeGreaterThanOrEqual(1);

      for (const clinic of clinics) {
        expect(clinic.status).toBe('active');
        expect(['current', 'trialing', 'paused'].includes(clinic.billingStatus)).toBe(true);
        expect(clinic.categories).toContain('hormone');
        expect(clinic.categories.length).toBeGreaterThan(0);
        expect(clinic.services.length).toBeGreaterThan(0);
      }
    });

    it('excludes the overdue-billing hormone clinic (balance-hormone-la)', async () => {
      const clinics = await repo.findMatchable('hormone');
      const slugs = clinics.map((c) => c.slug);
      expect(slugs).not.toContain('balance-hormone-la');
    });

    it('excludes the non-active hormone/wellness clinic even if it exists', async () => {
      const clinics = await repo.findMatchable('hormone');
      for (const clinic of clinics) {
        expect(clinic.status).toBe('active');
      }
    });
  });

  describe('findMatchable("peptide")', () => {
    it('returns at least one active peptide clinic', async () => {
      const clinics = await repo.findMatchable('peptide');

      expect(clinics.length).toBeGreaterThanOrEqual(1);

      for (const clinic of clinics) {
        expect(clinic.status).toBe('active');
        expect(clinic.categories).toContain('peptide');
        expect(clinic.services.length).toBeGreaterThan(0);
      }
    });

    it('excludes the pending peptide clinic (renew-peptide-seattle)', async () => {
      const clinics = await repo.findMatchable('peptide');
      const slugs = clinics.map((c) => c.slug);
      expect(slugs).not.toContain('renew-peptide-seattle');
    });
  });

  describe('findById', () => {
    it('returns the correct clinic by id with categories, services, and webhookSecretEncrypted', async () => {
      // First look up the id of vitality-hormone-nyc via raw query.
      const result = await repo.findBySlug('vitality-hormone-nyc');
      expect(result).not.toBeNull();

      const clinic = await repo.findById(result!.id);
      expect(clinic).not.toBeNull();
      expect(clinic!.slug).toBe('vitality-hormone-nyc');
      expect(clinic!.name).toBe('Vitality Hormone Health NYC');
      expect(clinic!.categories).toContain('hormone');
      expect(clinic!.services.length).toBeGreaterThan(0);
      // webhookSecretEncrypted is the raw ciphertext (non-empty base64 string).
      expect(typeof clinic!.webhookSecretEncrypted).toBe('string');
      expect(clinic!.webhookSecretEncrypted!.length).toBeGreaterThan(0);
    });

    it('returns null for an unknown id', async () => {
      const clinic = await repo.findById('00000000-0000-0000-0000-000000000000');
      expect(clinic).toBeNull();
    });
  });

  describe('findBySlug', () => {
    it('round-trips vitality-hormone-nyc with all expected fields', async () => {
      const clinic = await repo.findBySlug('vitality-hormone-nyc');

      expect(clinic).not.toBeNull();
      expect(clinic!.slug).toBe('vitality-hormone-nyc');
      expect(clinic!.name).toBe('Vitality Hormone Health NYC');
      expect(clinic!.state).toBe('NY');
      expect(clinic!.city).toBe('New York');
      expect(typeof clinic!.latitude).toBe('number');
      expect(typeof clinic!.longitude).toBe('number');
      expect(typeof clinic!.rating).toBe('number');
      expect(clinic!.telehealthAvailable).toBe(true);
      expect(clinic!.notifyOnLead).toBe(true);
      expect(clinic!.categories).toContain('hormone');
      expect(clinic!.categories).toContain('wellness');
      expect(clinic!.services).toContain('trt');
      // webhookSecretEncrypted is a non-empty ciphertext (NOT the plaintext).
      expect(typeof clinic!.webhookSecretEncrypted).toBe('string');
      expect(clinic!.webhookSecretEncrypted!.length).toBeGreaterThan(0);
      expect(clinic!.webhookSecretEncrypted).not.toBe('whsec_vitality_hormone_nyc_5f3a9c');
    });

    it('returns null for an unknown slug', async () => {
      const clinic = await repo.findBySlug('does-not-exist-xyz');
      expect(clinic).toBeNull();
    });
  });
});
