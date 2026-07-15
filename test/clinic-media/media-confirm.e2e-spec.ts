/**
 * E2E tests for POST /clinic/portal/media/logo, POST /clinic/portal/media/photos,
 * and GET /clinic/portal/media/photos.
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
  pathFromPublicUrl: (url: string) => {
    const m = /^https:\/\/storage\.test\/(.+)$/.exec(url);
    return m ? m[1]! : null;
  },
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

describe('Clinic Media Confirm (e2e)', () => {
  let app: INestApplication;
  let csrfToken: string;
  let clinicCookie: string;
  let patientCookie: string;
  let clinicAId: string;
  let clinicBId: string;

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

    // Resolve clinicA id from slug
    const clinicA = await seedPrisma.clinic.findUniqueOrThrow({
      where: { slug: clinicUser.clinicSlug },
      select: { id: true },
    });
    clinicAId = clinicA.id;

    // Resolve clinicB id
    const clinicB = await seedPrisma.clinic.findUniqueOrThrow({
      where: { slug: 'apex-peptide-telehealth' },
      select: { id: true },
    });
    clinicBId = clinicB.id;

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
    const patientEmail = `e2e-media-confirm-patient-${Date.now()}@example.com`;
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

  describe('POST /clinic/portal/media/logo', () => {
    it('confirms a logo and returns the public URL', async () => {
      const path = `logos/${clinicAId}/test.png`;
      const res = await agent()
        .post('/clinic/portal/media/logo')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ path })
        .expect(200);

      const body = res.body as { url: string };
      expect(body.url).toBe(`https://storage.test/${path}`);
    });

    it('returns 403 for a path belonging to another clinic', async () => {
      await agent()
        .post('/clinic/portal/media/logo')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ path: `logos/${clinicBId}/file.png` })
        .expect(403);
    });

    it('returns 403 for a patient token', async () => {
      await agent()
        .post('/clinic/portal/media/logo')
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ path: `logos/${clinicAId}/test.png` })
        .expect(403);
    });
  });

  describe('POST /clinic/portal/media/photos', () => {
    it('confirms photos and returns public URLs', async () => {
      const paths = [`photos/${clinicAId}/a.png`, `photos/${clinicAId}/b.png`];
      const res = await agent()
        .post('/clinic/portal/media/photos')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ paths })
        .expect(200);

      const body = res.body as { urls: string[] };
      expect(body.urls).toHaveLength(2);
    });

    it('returns 403 for paths belonging to another clinic', async () => {
      await agent()
        .post('/clinic/portal/media/photos')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ paths: [`photos/${clinicBId}/file.png`] })
        .expect(403);
    });

    it('returns 400 for 9 paths', async () => {
      const paths = Array.from({ length: 9 }, (_, i) => `photos/${clinicAId}/${i}.png`);
      await agent()
        .post('/clinic/portal/media/photos')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ paths })
        .expect(400);
    });
  });

  describe('GET /clinic/portal/media/photos', () => {
    it('returns the confirmed photos after POST photos', async () => {
      const paths = [`photos/${clinicAId}/x.png`, `photos/${clinicAId}/y.png`];
      await agent()
        .post('/clinic/portal/media/photos')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ paths })
        .expect(200);

      const res = await agent()
        .get('/clinic/portal/media/photos')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      const body = res.body as string[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);
    });

    it('returns 403 for a patient token', async () => {
      await agent()
        .get('/clinic/portal/media/photos')
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(403);
    });
  });
});
