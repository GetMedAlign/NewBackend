/**
 * E2E tests for POST /clinic-applications.
 *
 * The endpoint is @Public (no auth required). It writes to the real database,
 * so this spec uses the real AppModule with only non-infrastructure stubs
 * (EmailSender, WebhookSender, StoragePort) replaced.
 *
 * Cleanup: each created application is deleted in afterAll via a raw query
 * (cascades to categories + services).
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

describe('POST /clinic-applications (e2e)', () => {
  let app: INestApplication;
  let csrfToken: string;
  const createdApplicationIds: string[] = [];

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

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

    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
    expect(csrfToken).toBeTruthy();
  });

  afterAll(async () => {
    for (const id of createdApplicationIds) {
      await seedPrisma.$executeRaw`DELETE FROM clinic_applications WHERE id = ${id}::uuid`;
    }
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());

  const validBody = {
    clinicName: 'E2E Test Clinic',
    contactEmail: `e2e-test-${Date.now()}@example.com`,
    city: 'Austin',
    stateCode: 'TX',
    telehealthAvailable: true,
    categories: ['hormone', 'peptide'],
    services: [
      { serviceCode: 'testosterone-replacement', isTopService: true },
      { serviceCode: 'peptide-therapy', isTopService: false },
    ],
  };

  it('returns 201 with { applicationId } for a valid anonymous request', async () => {
    const res = await agent()
      .post('/clinic-applications')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send(validBody)
      .expect(201);

    const body = res.body as { applicationId: string };
    expect(typeof body.applicationId).toBe('string');
    expect(body.applicationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    createdApplicationIds.push(body.applicationId);
  });

  it('persists the application with status=pending in the database', async () => {
    const body = { ...validBody, contactEmail: `e2e-pending-${Date.now()}@example.com` };
    const res = await agent()
      .post('/clinic-applications')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send(body)
      .expect(201);

    const { applicationId } = res.body as { applicationId: string };
    createdApplicationIds.push(applicationId);

    const rows = await seedPrisma.$queryRaw<{ status: string }[]>`
      SELECT status FROM clinic_applications WHERE id = ${applicationId}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
  });

  it('returns 400 when clinicName is missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { clinicName: _omitted, ...bodyWithoutName } = validBody;
    await agent()
      .post('/clinic-applications')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send(bodyWithoutName)
      .expect(400);
  });

  it('returns 400 when contactEmail is missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { contactEmail: _omitted, ...bodyWithoutEmail } = validBody;
    await agent()
      .post('/clinic-applications')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send(bodyWithoutEmail)
      .expect(400);
  });

  it('returns 400 when contactEmail is not a valid email', async () => {
    await agent()
      .post('/clinic-applications')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ ...validBody, contactEmail: 'not-an-email' })
      .expect(400);
  });

  it('returns 400 when businessEmail is not a valid email', async () => {
    await agent()
      .post('/clinic-applications')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({
        ...validBody,
        contactEmail: `e2e-bademail-${Date.now()}@example.com`,
        businessEmail: 'bad-email',
      })
      .expect(400);
  });

  it('returns 400 when services contains an entry with invalid shape', async () => {
    await agent()
      .post('/clinic-applications')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({
        ...validBody,
        contactEmail: `e2e-badsvc-${Date.now()}@example.com`,
        services: [{ serviceCode: 'svc', isTopService: 'not-a-boolean' }],
      })
      .expect(400);
  });

  it('accepts a submission with no optional fields (only clinicName, contactEmail, categories, services)', async () => {
    const res = await agent()
      .post('/clinic-applications')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({
        clinicName: 'Minimal Clinic',
        contactEmail: `e2e-minimal-${Date.now()}@example.com`,
        categories: ['wellness'],
        services: [],
      })
      .expect(201);

    const body = res.body as { applicationId: string };
    expect(typeof body.applicationId).toBe('string');
    createdApplicationIds.push(body.applicationId);
  });
});
