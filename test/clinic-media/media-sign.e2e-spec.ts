/**
 * E2E tests for POST /clinic/portal/media/logo/sign and /clinic/portal/media/photos/sign.
 *
 * Boots the full AppModule with the STORAGE_PORT overridden to a stub that
 * never hits real Supabase.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
import { SEEDED_CLINIC_USERS, seedPatientJourney } from '../../prisma/seed/patient-journey.seed';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

class CapturingEmailSender implements EmailSenderPort {
  public readonly codeByEmail = new Map<string, string>();

  async send(_to: string, _subject: string, body: string): Promise<void> {
    const match = /\b(\d{6})\b/.exec(body);
    if (match) {
      this.codeByEmail.set(_to.toLowerCase(), match[1]!);
    }
  }

  codeFor(email: string): string {
    const code = this.codeByEmail.get(email.toLowerCase());
    if (!code) throw new Error(`No 2FA code captured for ${email}`);
    return code;
  }
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

describe('Clinic Media (e2e)', () => {
  let app: INestApplication;
  let csrfToken: string;
  let clinicCookie: string;
  let patientCookie: string;
  let clinicId: string;

  const emailSender = new CapturingEmailSender();
  const clinicUser = SEEDED_CLINIC_USERS[0]!;

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  beforeAll(async () => {
    await seedPatientJourney(seedPrisma);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(emailSender)
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

    // Resolve clinicId from slug
    const clinic = await seedPrisma.clinic.findUniqueOrThrow({
      where: { slug: clinicUser.clinicSlug },
      select: { id: true },
    });
    clinicId = clinic.id;

    // Acquire CSRF token
    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;

    // Sign in as clinic user
    await supertest(app.getHttpServer())
      .post('/auth/signin')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: clinicUser.email, password: clinicUser.password })
      .expect(200);

    const clinicCode = emailSender.codeFor(clinicUser.email);
    const verifyRes = await supertest(app.getHttpServer())
      .post('/auth/2fa/verify')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: clinicUser.email, code: clinicCode })
      .expect(200);

    clinicCookie = cookieValue(
      verifyRes.headers['set-cookie'] as unknown as string[],
      'access_token',
    )!;
    expect(clinicCookie).toBeTruthy();

    // Sign in as a patient
    const patientEmail = `e2e-media-patient-${Date.now()}@example.com`;
    await supertest(app.getHttpServer())
      .post('/auth/signup')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: patientEmail, password: 'SeedClinic1!' })
      .expect(201);

    await supertest(app.getHttpServer())
      .post('/auth/signin')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: patientEmail, password: 'SeedClinic1!' })
      .expect(200);

    const patientCode = emailSender.codeFor(patientEmail);
    const patientVerifyRes = await supertest(app.getHttpServer())
      .post('/auth/2fa/verify')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: patientEmail, code: patientCode })
      .expect(200);

    patientCookie = cookieValue(
      patientVerifyRes.headers['set-cookie'] as unknown as string[],
      'access_token',
    )!;
    expect(patientCookie).toBeTruthy();
  });

  afterAll(async () => {
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());

  describe('POST /clinic/portal/media/logo/sign', () => {
    it('returns 200 with { uploadUrl, token, path } for a valid clinic request', async () => {
      const res = await agent()
        .post('/clinic/portal/media/logo/sign')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ contentType: 'image/png' })
        .expect(200);

      const body = res.body as Record<string, string>;
      expect(typeof body.uploadUrl).toBe('string');
      expect(typeof body.token).toBe('string');
      expect(body.path.startsWith(`logos/${clinicId}/`)).toBe(true);
    });

    it('returns 403 for a patient token', async () => {
      await agent()
        .post('/clinic/portal/media/logo/sign')
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ contentType: 'image/png' })
        .expect(403);
    });

    it('returns 401 when unauthenticated', async () => {
      await agent()
        .post('/clinic/portal/media/logo/sign')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ contentType: 'image/png' })
        .expect(401);
    });

    it('returns 400 for an invalid contentType', async () => {
      await agent()
        .post('/clinic/portal/media/logo/sign')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ contentType: 'image/gif' })
        .expect(400);
    });
  });

  describe('POST /clinic/portal/media/photos/sign', () => {
    it('returns 200 with { uploads: [...] } of length 3 for count=3', async () => {
      const res = await agent()
        .post('/clinic/portal/media/photos/sign')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ count: 3 })
        .expect(200);

      const body = res.body as { uploads: { uploadUrl: string; token: string; path: string }[] };
      expect(Array.isArray(body.uploads)).toBe(true);
      expect(body.uploads).toHaveLength(3);
      for (const upload of body.uploads) {
        expect(upload.path.startsWith(`photos/${clinicId}/`)).toBe(true);
        expect(typeof upload.uploadUrl).toBe('string');
        expect(typeof upload.token).toBe('string');
      }
    });

    it('returns 403 for a patient token', async () => {
      await agent()
        .post('/clinic/portal/media/photos/sign')
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ count: 1 })
        .expect(403);
    });

    it('returns 400 when count < 1', async () => {
      await agent()
        .post('/clinic/portal/media/photos/sign')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ count: 0 })
        .expect(400);
    });

    it('returns 400 when count > 8', async () => {
      await agent()
        .post('/clinic/portal/media/photos/sign')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ count: 9 })
        .expect(400);
    });
  });
});
