/**
 * E2E tests for GET /admin/clinics and GET /admin/clinics/:id.
 *
 * Strategy: boot the full AppModule, craft tokens via JwtTokenService, and
 * exercise the admin clinic read endpoints. Mirrors
 * test/clinic-applications/admin-read.e2e-spec.ts (the closest analogue for
 * an admin-role read path in this repo).
 *
 * Covers:
 *   - Admin token → GET /admin/clinics returns 200 with an array ordered by name
 *   - Admin token → GET /admin/clinics/:id returns 200 with the matching clinic,
 *     including derived category/specialty, services split, and lead stats
 *   - Admin token → unknown but well-formed uuid → 404 "Clinic not found."
 *   - Admin token → malformed uuid → 400
 *   - Patient token → 403 on both endpoints (RolesGuard)
 *
 * Authentication: tokens are crafted directly via JwtTokenService (same
 * approach as admin-read.e2e-spec.ts). The seeded superadmin user id is
 * looked up from the DB so RLS recognises it as role=superadmin via user_roles.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import supertest = require('supertest');

import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/infrastructure/security/all-exceptions.filter';
import { EMAIL_SENDER } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';
import type { EmailSenderPort } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';
import { WEBHOOK_SENDER } from '../../src/modules/leads/domain/ports/webhook-sender.port';
import type {
  WebhookSenderPort,
  WebhookSendResult,
} from '../../src/modules/leads/domain/ports/webhook-sender.port';
import { STORAGE_PORT } from '../../src/modules/clinic-media/domain/ports/storage.port';
import type { StoragePort } from '../../src/modules/clinic-media/domain/ports/storage.port';
import { TOKEN_SERVICE } from '../../src/modules/auth/domain/ports/token-service.port';
import type { TokenServicePort } from '../../src/modules/auth/domain/ports/token-service.port';

class StubEmailSender implements EmailSenderPort {
  async send(): Promise<void> {}
}

class StubWebhookSender implements WebhookSenderPort {
  async send(): Promise<WebhookSendResult> {
    return { ok: true, status: 200 };
  }
}

const mockStorage: StoragePort = {
  createSignedUploadUrl: async (path: string) => ({
    uploadUrl: `https://storage.test/${path}`,
    token: 'test-token',
  }),
  publicUrl: (path: string) => `https://storage.test/${path}`,
  remove: async () => {},
  pathFromPublicUrl: () => null,
};

function cookieValue(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined;
  for (const raw of setCookie) {
    const [pair] = raw.split(';');
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return undefined;
}

interface AdminClinicDtoShape {
  id: string;
  slug: string;
  name: string;
  category: string;
  specialty: string;
  services: string[];
  allServices: string[];
  leadCount: number;
  lastLeadAt: string | null;
}

describe('GET /admin/clinics (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenServicePort;
  let adminToken: string;
  let patientToken: string;
  let csrfToken: string;
  const createdClinicIds: string[] = [];

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  let adminUserId: string;
  let patientUserId: string;

  // Names chosen to sort predictably around other seeded clinics.
  const unique = Date.now();
  const nameA = `AAA E2E Admin Clinic ${unique.toString()}`;
  const nameM = `MMM E2E Admin Clinic ${unique.toString()}`;
  const nameZ = `ZZZ E2E Admin Clinic ${unique.toString()}`;
  let clinicAId: string;
  let clinicMId: string;
  let clinicZId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(new StubEmailSender())
      .overrideProvider(WEBHOOK_SENDER)
      .useValue(new StubWebhookSender())
      .overrideProvider(STORAGE_PORT)
      .useValue(mockStorage)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    tokenService = moduleRef.get<TokenServicePort>(TOKEN_SERVICE);

    // Look up the seeded superadmin user id.
    const adminRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.email = 'superadmin@medalign-seed.example.com'::citext
        AND ur.role = 'superadmin'
      LIMIT 1
    `;
    if (adminRows.length === 0) {
      throw new Error('Seeded superadmin not found — run pnpm seed:pj against the test DB first.');
    }
    adminUserId = adminRows[0]!.id;

    // Create a patient user for the 403 tests.
    const patientEmail = `admin-clinics-e2e-patient-${unique.toString()}@test.example.com`;
    const patientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${patientEmail}::citext, 'test-hash') AS id
    `;
    patientUserId = patientRows[0]!.id;

    adminToken = tokenService.issue({ sub: adminUserId, role: 'superadmin' });
    patientToken = tokenService.issue({ sub: patientUserId, role: 'patient' });

    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
    expect(csrfToken).toBeTruthy();

    // Seed three clinics (inserted out of alphabetical order on purpose) to
    // assert the response is actually ORDER BY name ASC, not insertion order.
    const baseClinicData = {
      rating: 0,
      reviewCount: 0,
      telehealthAvailable: false,
      financingAvailable: false,
      acceptsInsurance: false,
      status: 'active',
      billingStatus: 'no_card',
      notifyOnLead: false,
    };

    const clinicZ = await seedPrisma.clinic.create({
      data: { slug: `e2e-admin-clinic-z-${unique.toString()}`, name: nameZ, ...baseClinicData },
      select: { id: true },
    });
    clinicZId = clinicZ.id;
    createdClinicIds.push(clinicZId);

    const clinicA = await seedPrisma.clinic.create({
      data: {
        slug: `e2e-admin-clinic-a-${unique.toString()}`,
        name: nameA,
        about: 'About clinic A',
        differentiators: 'Differentiator A',
        insuranceNotes: 'Insurance notes A',
        providerName: 'Provider A',
        credentials: 'MD',
        websiteUrl: 'https://clinic-a.example.com',
        ...baseClinicData,
      },
      select: { id: true },
    });
    clinicAId = clinicA.id;
    createdClinicIds.push(clinicAId);

    const clinicM = await seedPrisma.clinic.create({
      data: { slug: `e2e-admin-clinic-m-${unique.toString()}`, name: nameM, ...baseClinicData },
      select: { id: true },
    });
    clinicMId = clinicM.id;
    createdClinicIds.push(clinicMId);

    // Category + services + leads for clinic A (used for the detail assertions).
    await seedPrisma.$executeRaw`
      INSERT INTO clinic_categories (clinic_id, category)
      VALUES (${clinicAId}::uuid, 'hormone'::assessment_category)
    `;
    await seedPrisma.clinicService.createMany({
      data: [
        { clinicId: clinicAId, serviceCode: 'trt-top', isTopService: true, displayOrder: 1 },
        { clinicId: clinicAId, serviceCode: 'other-svc', isTopService: false, displayOrder: 1 },
      ],
    });
    await seedPrisma.lead.createMany({
      data: [
        {
          leadId: `e2e-admin-clinic-lead-1-${unique.toString()}`,
          clinicId: clinicAId,
          patientFirstName: 'Pat',
          patientEmail: `pat-${unique.toString()}-1@test.example.com`,
          treatmentCategory: 'hormone',
          leadSource: 'assessment',
          deliveryStatus: 'delivered',
          clinicStatus: 'new',
          receivedAt: new Date('2026-01-01T10:00:00.000Z'),
        },
        {
          leadId: `e2e-admin-clinic-lead-2-${unique.toString()}`,
          clinicId: clinicAId,
          patientFirstName: 'Sam',
          patientEmail: `sam-${unique.toString()}-2@test.example.com`,
          treatmentCategory: 'hormone',
          leadSource: 'assessment',
          deliveryStatus: 'delivered',
          clinicStatus: 'new',
          receivedAt: new Date('2026-02-15T10:00:00.000Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    for (const id of createdClinicIds) {
      await seedPrisma.$executeRaw`DELETE FROM leads WHERE clinic_id = ${id}::uuid`;
      await seedPrisma.$executeRaw`DELETE FROM clinic_services WHERE clinic_id = ${id}::uuid`;
      await seedPrisma.$executeRaw`DELETE FROM clinic_categories WHERE clinic_id = ${id}::uuid`;
      await seedPrisma.$executeRaw`DELETE FROM clinics WHERE id = ${id}::uuid`;
    }
    await seedPrisma.$executeRaw`DELETE FROM users WHERE id = ${patientUserId}::uuid`;
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());

  describe('GET /admin/clinics', () => {
    it('returns 200 with an array when called with an admin token', async () => {
      const res = await agent()
        .get('/admin/clinics')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('includes the seeded clinics, ordered by name ASC', async () => {
      const res = await agent()
        .get('/admin/clinics')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      const body = res.body as AdminClinicDtoShape[];
      const ourIds = new Set([clinicAId, clinicMId, clinicZId]);
      const ourClinicsInResponseOrder = body.filter((c) => ourIds.has(c.id));

      expect(ourClinicsInResponseOrder.map((c) => c.id)).toEqual([clinicAId, clinicMId, clinicZId]);

      // The full response is sorted by name too — not just our subsequence.
      const names = body.map((c) => c.name);
      const sortedNames = [...names].sort((x, y) => x.localeCompare(y));
      expect(names).toEqual(sortedNames);
    });

    it('derives category/specialty, splits services, and aggregates lead stats', async () => {
      const res = await agent()
        .get('/admin/clinics')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      const body = res.body as AdminClinicDtoShape[];
      const clinicA = body.find((c) => c.id === clinicAId)!;
      expect(clinicA.category).toBe('hormone');
      expect(clinicA.specialty).toBe('Hormone Therapy');
      expect(clinicA.services).toEqual(['trt-top']);
      expect(clinicA.allServices).toEqual(['trt-top', 'other-svc']);
      expect(clinicA.leadCount).toBe(2);
      expect(clinicA.lastLeadAt).toBe('2026-02-15');

      const clinicM = body.find((c) => c.id === clinicMId)!;
      expect(clinicM.category).toBe('wellness');
      expect(clinicM.specialty).toBe('Integrative Wellness');
      expect(clinicM.leadCount).toBe(0);
      expect(clinicM.lastLeadAt).toBeNull();
    });

    it('returns 403 when called with a patient token', async () => {
      await agent()
        .get('/admin/clinics')
        .set('Cookie', `access_token=${patientToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(403);
    });

    it('returns 401 when called with no token', async () => {
      await agent()
        .get('/admin/clinics')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(401);
    });
  });

  describe('GET /admin/clinics/:id', () => {
    it('returns 200 with the matching clinic for a valid id and admin token', async () => {
      const res = await agent()
        .get(`/admin/clinics/${clinicAId}`)
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      const body = res.body as AdminClinicDtoShape;
      expect(body.id).toBe(clinicAId);
      expect(body.name).toBe(nameA);
      expect(body.services).toEqual(['trt-top']);
      expect(body.allServices).toEqual(['trt-top', 'other-svc']);
      expect(body.leadCount).toBe(2);
    });

    it('returns 404 with "Clinic not found." for an unknown but well-formed uuid', async () => {
      const res = await agent()
        .get('/admin/clinics/00000000-0000-0000-0000-000000000000')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(404);

      const body = res.body as { error: { message: string } };
      expect(body.error.message).toBe('Clinic not found.');
    });

    it('returns 400 for a malformed id', async () => {
      await agent()
        .get('/admin/clinics/not-a-uuid')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(400);
    });

    it('returns 403 when called with a patient token', async () => {
      await agent()
        .get(`/admin/clinics/${clinicAId}`)
        .set('Cookie', `access_token=${patientToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(403);
    });

    it('returns 401 when called with no token', async () => {
      await agent()
        .get(`/admin/clinics/${clinicAId}`)
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(401);
    });
  });
});
