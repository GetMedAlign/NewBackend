/**
 * E2E tests for PUT /admin/clinics/:id and POST /admin/clinics/:id/pause-delivery.
 *
 * Strategy: boot the full AppModule, craft tokens via JwtTokenService, and
 * exercise the admin clinic write endpoints. Mirrors
 * test/admin/admin-clinics-read.e2e-spec.ts (Task 4) for auth/seeding setup.
 *
 * Covers:
 *   - PUT partial update changes only the named fields, leaves others untouched
 *     (read back via GET /admin/clinics/:id)
 *   - city + stateCode together recompute location as "City, ST"
 *   - an unknown status is ignored: status unchanged, still 200
 *   - pause-delivery {paused:true} sets status paused, notifyOnLead false
 *   - pause-delivery {paused:false} on an active clinic is a no-op
 *   - pause-delivery {paused:false} on a paused clinic returns it to active,
 *     notifyOnLead true
 *   - 404 on an unknown id for both routes
 *   - 403 for a non-admin
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
  name: string;
  about: string;
  city: string;
  stateCode: string;
  location: string;
  status: string;
  notifyOnLead?: boolean;
}

describe('Admin clinic write endpoints (e2e)', () => {
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

  const unique = Date.now();

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

  async function createClinic(
    slugSuffix: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const clinic = await seedPrisma.clinic.create({
      data: {
        slug: `e2e-admin-clinic-write-${slugSuffix}-${unique.toString()}`,
        name: `E2E Write Clinic ${slugSuffix} ${unique.toString()}`,
        about: 'Original about text',
        differentiators: 'Original differentiators',
        ...baseClinicData,
        ...overrides,
      },
      select: { id: true },
    });
    createdClinicIds.push(clinic.id);
    return clinic.id;
  }

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

    const patientEmail = `admin-clinics-write-e2e-patient-${unique.toString()}@test.example.com`;
    const patientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${patientEmail}::citext, 'test-hash') AS id
    `;
    patientUserId = patientRows[0]!.id;

    adminToken = tokenService.issue({ sub: adminUserId, role: 'superadmin' });
    patientToken = tokenService.issue({ sub: patientUserId, role: 'patient' });

    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
    expect(csrfToken).toBeTruthy();
  });

  afterAll(async () => {
    for (const id of createdClinicIds) {
      await seedPrisma.$executeRaw`DELETE FROM clinics WHERE id = ${id}::uuid`;
    }
    await seedPrisma.$executeRaw`DELETE FROM users WHERE id = ${patientUserId}::uuid`;
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());
  const adminHeaders = () => ({
    Cookie: `access_token=${adminToken}; csrf_token=${csrfToken}`,
    'x-csrf-token': csrfToken,
  });
  const patientHeaders = () => ({
    Cookie: `access_token=${patientToken}; csrf_token=${csrfToken}`,
    'x-csrf-token': csrfToken,
  });

  describe('PUT /admin/clinics/:id', () => {
    it('updates only the named fields and leaves the others untouched', async () => {
      const id = await createClinic('partial');

      await agent()
        .put(`/admin/clinics/${id}`)
        .set(adminHeaders())
        .send({ name: 'Updated Name Only' })
        .expect(200, { success: true });

      const res = await agent().get(`/admin/clinics/${id}`).set(adminHeaders()).expect(200);
      const body = res.body as AdminClinicDtoShape;
      expect(body.name).toBe('Updated Name Only');
      expect(body.about).toBe('Original about text');
    });

    it('recomputes location as "City, ST" when city and stateCode are sent', async () => {
      const id = await createClinic('location');

      await agent()
        .put(`/admin/clinics/${id}`)
        .set(adminHeaders())
        .send({ city: 'Austin', stateCode: 'TX' })
        .expect(200, { success: true });

      const res = await agent().get(`/admin/clinics/${id}`).set(adminHeaders()).expect(200);
      const body = res.body as AdminClinicDtoShape;
      expect(body.city).toBe('Austin');
      expect(body.stateCode).toBe('TX');
      expect(body.location).toBe('Austin, TX');
    });

    it('ignores an unrecognized status and still returns 200', async () => {
      const id = await createClinic('badstatus');

      await agent()
        .put(`/admin/clinics/${id}`)
        .set(adminHeaders())
        .send({ status: 'bogus' })
        .expect(200, { success: true });

      const res = await agent().get(`/admin/clinics/${id}`).set(adminHeaders()).expect(200);
      const body = res.body as AdminClinicDtoShape;
      expect(body.status).toBe('active');
    });

    it('applies a recognized status', async () => {
      const id = await createClinic('goodstatus');

      await agent()
        .put(`/admin/clinics/${id}`)
        .set(adminHeaders())
        .send({ status: 'suspended' })
        .expect(200, { success: true });

      const res = await agent().get(`/admin/clinics/${id}`).set(adminHeaders()).expect(200);
      const body = res.body as AdminClinicDtoShape;
      expect(body.status).toBe('suspended');
    });

    it('returns 404 with "Clinic not found." for an unknown id', async () => {
      const res = await agent()
        .put('/admin/clinics/00000000-0000-0000-0000-000000000000')
        .set(adminHeaders())
        .send({ name: 'X' })
        .expect(404);

      const body = res.body as { error: { message: string } };
      expect(body.error.message).toBe('Clinic not found.');
    });

    it('returns 403 when called with a patient token', async () => {
      const id = await createClinic('forbidden');

      await agent()
        .put(`/admin/clinics/${id}`)
        .set(patientHeaders())
        .send({ name: 'X' })
        .expect(403);
    });
  });

  describe('POST /admin/clinics/:id/pause-delivery', () => {
    it('{paused:true} sets status paused and notifyOnLead false', async () => {
      const id = await createClinic('pause-true', { status: 'active', notifyOnLead: true });

      await agent()
        .post(`/admin/clinics/${id}/pause-delivery`)
        .set(adminHeaders())
        .send({ paused: true })
        .expect(200, { success: true });

      const row = await seedPrisma.clinic.findUniqueOrThrow({
        where: { id },
        select: { status: true, notifyOnLead: true },
      });
      expect(row.status).toBe('paused');
      expect(row.notifyOnLead).toBe(false);
    });

    it('{paused:false} on an active clinic changes nothing', async () => {
      const id = await createClinic('unpause-noop', { status: 'active', notifyOnLead: true });

      await agent()
        .post(`/admin/clinics/${id}/pause-delivery`)
        .set(adminHeaders())
        .send({ paused: false })
        .expect(200, { success: true });

      const row = await seedPrisma.clinic.findUniqueOrThrow({
        where: { id },
        select: { status: true, notifyOnLead: true },
      });
      expect(row.status).toBe('active');
      expect(row.notifyOnLead).toBe(true);
    });

    it('{paused:false} on a paused clinic returns it to active with notifyOnLead true', async () => {
      const id = await createClinic('unpause-real', { status: 'paused', notifyOnLead: false });

      await agent()
        .post(`/admin/clinics/${id}/pause-delivery`)
        .set(adminHeaders())
        .send({ paused: false })
        .expect(200, { success: true });

      const row = await seedPrisma.clinic.findUniqueOrThrow({
        where: { id },
        select: { status: true, notifyOnLead: true },
      });
      expect(row.status).toBe('active');
      expect(row.notifyOnLead).toBe(true);
    });

    it('{paused:false} on a suspended clinic changes nothing', async () => {
      const id = await createClinic('unpause-suspended', {
        status: 'suspended',
        notifyOnLead: false,
      });

      await agent()
        .post(`/admin/clinics/${id}/pause-delivery`)
        .set(adminHeaders())
        .send({ paused: false })
        .expect(200, { success: true });

      const row = await seedPrisma.clinic.findUniqueOrThrow({
        where: { id },
        select: { status: true, notifyOnLead: true },
      });
      expect(row.status).toBe('suspended');
      expect(row.notifyOnLead).toBe(false);
    });

    it('returns 404 with "Clinic not found." for an unknown id', async () => {
      const res = await agent()
        .post('/admin/clinics/00000000-0000-0000-0000-000000000000/pause-delivery')
        .set(adminHeaders())
        .send({ paused: true })
        .expect(404);

      const body = res.body as { error: { message: string } };
      expect(body.error.message).toBe('Clinic not found.');
    });

    it('returns 403 when called with a patient token', async () => {
      const id = await createClinic('pause-forbidden');

      await agent()
        .post(`/admin/clinics/${id}/pause-delivery`)
        .set(patientHeaders())
        .send({ paused: true })
        .expect(403);
    });
  });
});
