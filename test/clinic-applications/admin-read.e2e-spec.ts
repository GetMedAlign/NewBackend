/**
 * E2E tests for GET /admin/applications and GET /admin/applications/:id.
 *
 * Strategy: boot the full AppModule, craft tokens via JwtTokenService, and
 * exercise the admin read endpoints.
 *
 * Covers:
 *   - Admin token → GET /admin/applications returns 200 with array including seeded apps
 *   - Admin token → GET /admin/applications/:id returns 200 with full detail
 *   - Patient token → 403 on both endpoints (RolesGuard)
 *   - Admin token → unknown id → 404 (NotFoundException)
 *
 * Authentication: tokens are crafted directly via JwtTokenService (same
 * approach as clinic-guard.e2e-spec.ts). The seeded superadmin user id is
 * looked up from the DB so we get a real user id that RLS recognises as
 * having role=superadmin via user_roles.
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

describe('GET /admin/applications (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenServicePort;
  let adminToken: string;
  let patientToken: string;
  let csrfToken: string;
  const createdApplicationIds: string[] = [];

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  // Real admin user id (has superadmin role in user_roles) — looked up from DB.
  let adminUserId: string;
  let patientUserId: string;
  let seededAppId: string;

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
    const unique = Date.now();
    const patientEmail = `admin-e2e-patient-${unique.toString()}@test.example.com`;
    const patientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${patientEmail}::citext, 'test-hash') AS id
    `;
    patientUserId = patientRows[0]!.id;

    // Craft tokens.
    adminToken = tokenService.issue({ sub: adminUserId, role: 'superadmin' });
    patientToken = tokenService.issue({ sub: patientUserId, role: 'patient' });

    // Get a CSRF token from /health.
    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
    expect(csrfToken).toBeTruthy();

    // Seed one application that we can reference by id.
    const contactEmail = `e2e-admin-read-${unique.toString()}@test.example.com`;
    const appRow = await seedPrisma.$queryRaw<{ id: string }[]>`
      INSERT INTO clinic_applications (clinic_name, contact_email, status)
      VALUES ('E2E Admin Read Clinic', ${contactEmail}, 'pending')
      RETURNING id
    `;
    seededAppId = appRow[0]!.id;
    createdApplicationIds.push(seededAppId);

    // Seed a category and a service for the detail check.
    await seedPrisma.$executeRaw`
      INSERT INTO application_categories (application_id, category)
      VALUES (${seededAppId}::uuid, 'hormone'::assessment_category)
    `;
    await seedPrisma.$executeRaw`
      INSERT INTO application_services (application_id, service_code, is_top_service, display_order)
      VALUES (${seededAppId}::uuid, 'testosterone-replacement', true, 1)
    `;
  });

  afterAll(async () => {
    for (const id of createdApplicationIds) {
      await seedPrisma.$executeRaw`DELETE FROM clinic_applications WHERE id = ${id}::uuid`;
    }
    await seedPrisma.$executeRaw`
      DELETE FROM users WHERE id = ${patientUserId}::uuid
    `;
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());

  describe('GET /admin/applications', () => {
    it('returns 200 with an array when called with an admin token', async () => {
      const res = await agent()
        .get('/admin/applications')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('includes the seeded application in the list response', async () => {
      const res = await agent()
        .get('/admin/applications')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      const body = res.body as { id: string }[];
      const ids = body.map((r) => r.id);
      expect(ids).toContain(seededAppId);
    });

    it('returns summary shape (id, clinicName, contactEmail, city, stateCode, status, createdAt, reviewedAt)', async () => {
      const res = await agent()
        .get('/admin/applications')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      const body = res.body as {
        id: string;
        clinicName: string;
        contactEmail: string;
        city: string | null;
        stateCode: string | null;
        status: string;
        createdAt: string;
        reviewedAt: string | null;
      }[];
      const row = body.find((r) => r.id === seededAppId)!;
      expect(row.clinicName).toBe('E2E Admin Read Clinic');
      expect(row.status).toBe('pending');
      expect(typeof row.createdAt).toBe('string');
      expect(row.reviewedAt).toBeNull();
    });

    it('returns 403 when called with a patient token', async () => {
      await agent()
        .get('/admin/applications')
        .set('Cookie', `access_token=${patientToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(403);
    });

    it('returns 401 when called with no token', async () => {
      await agent()
        .get('/admin/applications')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(401);
    });
  });

  describe('GET /admin/applications/:id', () => {
    it('returns 200 with full detail for a valid id and admin token', async () => {
      const res = await agent()
        .get(`/admin/applications/${seededAppId}`)
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      const body = res.body as {
        id: string;
        clinicName: string;
        contactEmail: string;
        categories: string[];
        services: { serviceCode: string; isTopService: boolean; displayOrder: number }[];
      };
      expect(body.id).toBe(seededAppId);
      expect(body.clinicName).toBe('E2E Admin Read Clinic');
      expect(body.categories).toContain('hormone');
      expect(body.services).toHaveLength(1);
      expect(body.services[0]!.serviceCode).toBe('testosterone-replacement');
      expect(body.services[0]!.isTopService).toBe(true);
    });

    it('returns 404 for an unknown id', async () => {
      await agent()
        .get('/admin/applications/00000000-0000-0000-0000-000000000000')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(404);
    });

    it('returns 403 when called with a patient token', async () => {
      await agent()
        .get(`/admin/applications/${seededAppId}`)
        .set('Cookie', `access_token=${patientToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(403);
    });

    it('returns 401 when called with no token', async () => {
      await agent()
        .get(`/admin/applications/${seededAppId}`)
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(401);
    });
  });
});
