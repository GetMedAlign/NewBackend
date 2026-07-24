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
        expect(['no_card', 'overdue']).not.toContain(clinic.billingStatus);
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
      // webhookSecretEncrypted is a non-empty base64 ciphertext (NOT the plaintext).
      expect(typeof clinic!.webhookSecretEncrypted).toBe('string');
      expect(clinic!.webhookSecretEncrypted!.length).toBeGreaterThan(40);
      expect(clinic!.webhookSecretEncrypted).not.toBe('whsec_vitality_hormone_nyc_5f3a9c');
      expect(clinic!.webhookSecretEncrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('returns null for an unknown slug', async () => {
      const clinic = await repo.findBySlug('does-not-exist-xyz');
      expect(clinic).toBeNull();
    });
  });

  describe('findDirectory', () => {
    const baseFilter = {
      sortBy: 'rating' as const,
      page: 1,
      pageSize: 50,
      patientLat: null,
      patientLng: null,
    };

    it('includes active + listed + billing-current clinics and excludes overdue/pending ones', async () => {
      const { items } = await repo.findDirectory(baseFilter);
      const slugs = items.map((i) => i.slug);

      expect(slugs).toContain('vitality-hormone-nyc');
      expect(slugs).toContain('apex-peptide-telehealth');
      expect(slugs).toContain('glow-med-spa-miami');
      expect(slugs).toContain('thrive-wellness-chicago');
      expect(slugs).not.toContain('balance-hormone-la'); // billing_status = overdue
      expect(slugs).not.toContain('renew-peptide-seattle'); // status = pending
    });

    it('filters by category', async () => {
      const { items } = await repo.findDirectory({ ...baseFilter, category: 'med_spa' });
      const slugs = items.map((i) => i.slug);

      expect(slugs).toContain('glow-med-spa-miami');
      expect(slugs).toContain('thrive-wellness-chicago');
      expect(slugs).not.toContain('vitality-hormone-nyc');
      expect(slugs).not.toContain('apex-peptide-telehealth');
    });

    it('returns an empty result for an unrecognised category instead of throwing', async () => {
      const result = await repo.findDirectory({ ...baseFilter, category: 'not-a-real-category' });
      expect(result).toEqual({ items: [], totalCount: 0 });
    });

    it('filters by state', async () => {
      const { items } = await repo.findDirectory({ ...baseFilter, state: 'NY' });
      const slugs = items.map((i) => i.slug);

      expect(slugs).toContain('vitality-hormone-nyc');
      expect(slugs).not.toContain('glow-med-spa-miami');
    });

    it('filters by telehealth availability', async () => {
      const { items } = await repo.findDirectory({ ...baseFilter, telehealth: false });
      const slugs = items.map((i) => i.slug);

      expect(slugs).not.toContain('apex-peptide-telehealth'); // telehealth-only
      expect(slugs).toContain('glow-med-spa-miami'); // in-person only
    });

    it('filters by search (case-insensitive clinic name match)', async () => {
      const { items } = await repo.findDirectory({ ...baseFilter, search: 'glow' });
      const slugs = items.map((i) => i.slug);

      expect(slugs).toEqual(['glow-med-spa-miami']);
    });

    it('sorts by name ascending', async () => {
      const { items } = await repo.findDirectory({ ...baseFilter, sortBy: 'name' });
      const names = items.map((i) => i.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });

    it('paginates: pageSize=1 returns a single item and totalCount matches the unpaginated count', async () => {
      const full = await repo.findDirectory(baseFilter);
      const page1 = await repo.findDirectory({ ...baseFilter, pageSize: 1, page: 1 });

      expect(page1.items.length).toBe(1);
      expect(page1.totalCount).toBe(full.totalCount);
      expect(page1.items[0]!.slug).toBe(full.items[0]!.slug);
    });

    it('caps topServices at 3 and only includes is_top_service rows', async () => {
      const { items } = await repo.findDirectory({ ...baseFilter, category: 'hormone' });
      const vitality = items.find((i) => i.slug === 'vitality-hormone-nyc');

      expect(vitality).toBeDefined();
      expect(vitality!.topServices.length).toBeLessThanOrEqual(3);
      expect(vitality!.topServices).not.toContain('lab_work');
      expect(vitality!.topServices).toContain('trt');
    });
  });

  describe('findProfileBySlug', () => {
    it('returns the full public profile for an active, billing-current clinic', async () => {
      const profile = await repo.findProfileBySlug('vitality-hormone-nyc');

      expect(profile).not.toBeNull();
      expect(profile!.name).toBe('Vitality Hormone Health NYC');
      expect(profile!.category).toBe('hormone');
      expect(profile!.city).toBe('New York');
      expect(profile!.stateCode).toBe('NY');
      // topServiceCodes for this clinic excludes 'lab_work'.
      expect(profile!.topServices).not.toContain('lab_work');
      expect(profile!.allServices).toContain('lab_work');
      expect(profile!.allServices.length).toBeGreaterThan(profile!.topServices.length);
    });

    it('returns seeded photoUrls ordered by display_order for glow-med-spa-miami', async () => {
      const profile = await repo.findProfileBySlug('glow-med-spa-miami');

      expect(profile).not.toBeNull();
      expect(profile!.photoUrls).toEqual([
        'https://images.medalign-seed.example.com/glow-med-spa-miami/exterior.jpg',
        'https://images.medalign-seed.example.com/glow-med-spa-miami/treatment-room.jpg',
      ]);
    });

    it('returns null for an overdue-billing clinic (still "active" status)', async () => {
      const profile = await repo.findProfileBySlug('balance-hormone-la');
      expect(profile).toBeNull();
    });

    it('returns null for a non-active (pending) clinic', async () => {
      const profile = await repo.findProfileBySlug('renew-peptide-seattle');
      expect(profile).toBeNull();
    });

    it('returns null for an unknown slug', async () => {
      const profile = await repo.findProfileBySlug('does-not-exist-xyz');
      expect(profile).toBeNull();
    });
  });
});
