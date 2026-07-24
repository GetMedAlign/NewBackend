/**
 * End-to-end tests for the public clinic directory/profile endpoints:
 *   GET /clinics
 *   GET /clinics/:slug
 *
 * Requires a running Postgres with the patient-journey seed applied (this
 * suite seeds it itself, mirroring test/clinics/clinic-repository.int-spec.ts).
 * Both routes are read-only (@Public(), GET) so no state is mutated and no
 * snapshot/restore is needed — the shared demo dataset (6 clinics) is left
 * untouched.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import supertest = require('supertest');

import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/infrastructure/security/all-exceptions.filter';
import { PrismaClient } from '../../generated/prisma/client';
import { seedPatientJourney } from '../../prisma/seed/patient-journey.seed';
import type { ClinicDirectoryResponseDto } from '../../src/modules/clinics/domain/clinic-directory.dto';
import type { ClinicProfileDto } from '../../src/modules/clinics/domain/clinic-profile.dto';

describe('Clinics (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    const adapter = new PrismaPg(pool);
    const seedPrisma = new PrismaClient({ adapter });
    await seedPatientJourney(seedPrisma);
    await seedPrisma.$disconnect();
    await pool.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const agent = () => supertest(app.getHttpServer());

  describe('GET /clinics', () => {
    it('returns a paginated directory with the expected envelope shape', async () => {
      const res = await agent().get('/clinics').expect(200);
      const body = res.body as ClinicDirectoryResponseDto;

      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.totalCount).toBe('number');
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.totalPages).toBe(Math.ceil(body.totalCount / body.pageSize));

      const slugs = body.items.map((i) => i.slug);
      expect(slugs).toContain('vitality-hormone-nyc');
      expect(slugs).toContain('apex-peptide-telehealth');
      expect(slugs).toContain('glow-med-spa-miami');
      expect(slugs).toContain('thrive-wellness-chicago');
      // billing overdue / non-active — never listed publicly
      expect(slugs).not.toContain('balance-hormone-la');
      expect(slugs).not.toContain('renew-peptide-seattle');
    });

    it('each item has the ClinicDirectoryItem fields the frontend reads', async () => {
      const res = await agent().get('/clinics?search=Vitality').expect(200);
      const body = res.body as ClinicDirectoryResponseDto;
      const item = body.items.find((i) => i.slug === 'vitality-hormone-nyc');

      expect(item).toBeDefined();
      expect(typeof item!.id).toBe('string');
      expect(typeof item!.name).toBe('string');
      expect(typeof item!.category).toBe('string');
      expect(typeof item!.specialty).toBe('string');
      expect(typeof item!.city).toBe('string');
      expect(typeof item!.stateCode).toBe('string');
      expect(typeof item!.rating).toBe('number');
      expect(typeof item!.reviewCount).toBe('number');
      expect(typeof item!.telehealth).toBe('boolean');
      expect(Array.isArray(item!.topServices)).toBe(true);
      expect(item!.topServices.length).toBeLessThanOrEqual(3);
      expect(item!.distanceMiles === null || typeof item!.distanceMiles === 'number').toBe(true);
    });

    it('a category filter narrows the results', async () => {
      const res = await agent().get('/clinics?category=med_spa').expect(200);
      const slugs = (res.body as ClinicDirectoryResponseDto).items.map((i) => i.slug);

      expect(slugs).toContain('glow-med-spa-miami');
      expect(slugs).toContain('thrive-wellness-chicago');
      expect(slugs).not.toContain('vitality-hormone-nyc');
      expect(slugs).not.toContain('apex-peptide-telehealth');
    });

    it('a state filter narrows the results', async () => {
      const res = await agent().get('/clinics?state=ny').expect(200);
      const slugs = (res.body as ClinicDirectoryResponseDto).items.map((i) => i.slug);

      expect(slugs).toContain('vitality-hormone-nyc');
      expect(slugs).not.toContain('glow-med-spa-miami');
    });

    it('an unrecognised category returns an empty (not error) result', async () => {
      const res = await agent().get('/clinics?category=not-a-real-category').expect(200);
      const body = res.body as ClinicDirectoryResponseDto;
      expect(body.items).toEqual([]);
      expect(body.totalCount).toBe(0);
    });

    it('sortBy=name orders items alphabetically', async () => {
      const res = await agent().get('/clinics?sortBy=name&pageSize=50').expect(200);
      const names = (res.body as ClinicDirectoryResponseDto).items.map((i) => i.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });

    it('pageSize=1 paginates correctly and totalPages matches totalCount', async () => {
      const res = await agent().get('/clinics?pageSize=1&page=1').expect(200);
      const body = res.body as ClinicDirectoryResponseDto;

      expect(body.items.length).toBe(1);
      expect(body.pageSize).toBe(1);
      expect(body.totalPages).toBe(body.totalCount);
    });

    it('clamps pageSize above 50 down to 50', async () => {
      const res = await agent().get('/clinics?pageSize=999').expect(200);
      expect((res.body as ClinicDirectoryResponseDto).pageSize).toBe(50);
    });
  });

  describe('GET /clinics/:slug', () => {
    it('returns the public profile for an active, billing-current clinic', async () => {
      const res = await agent().get('/clinics/vitality-hormone-nyc').expect(200);
      const clinic = res.body as ClinicProfileDto;

      expect(clinic.slug).toBe('vitality-hormone-nyc');
      expect(clinic.name).toBe('Vitality Hormone Health NYC');
      expect(clinic.category).toBe('hormone');
      expect(clinic.city).toBe('New York');
      expect(clinic.stateCode).toBe('NY');
      expect(typeof clinic.about).toBe('string');
      expect(Array.isArray(clinic.services)).toBe(true);
      expect(Array.isArray(clinic.allServices)).toBe(true);
      // 'lab_work' is not flagged as a top service for this seeded clinic.
      expect(clinic.services).not.toContain('lab_work');
      expect(clinic.allServices).toContain('lab_work');
      expect(clinic.allServices.length).toBeGreaterThan(clinic.services.length);
    });

    it('includes seeded photoUrls for glow-med-spa-miami', async () => {
      const res = await agent().get('/clinics/glow-med-spa-miami').expect(200);
      const clinic = res.body as ClinicProfileDto;

      expect(clinic.photoUrls).toEqual([
        'https://images.medalign-seed.example.com/glow-med-spa-miami/exterior.jpg',
        'https://images.medalign-seed.example.com/glow-med-spa-miami/treatment-room.jpg',
      ]);
    });

    it('404s for an unknown slug', async () => {
      const res = await agent().get('/clinics/does-not-exist-xyz').expect(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('404s for an overdue-billing clinic even though its status is "active"', async () => {
      await agent().get('/clinics/balance-hormone-la').expect(404);
    });

    it('404s for a non-active (pending) clinic', async () => {
      await agent().get('/clinics/renew-peptide-seattle').expect(404);
    });
  });
});
