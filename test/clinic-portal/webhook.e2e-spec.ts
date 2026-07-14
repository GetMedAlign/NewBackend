/**
 * E2E tests for webhook management endpoints:
 *   POST /clinic/portal/webhook/rotate
 *   GET  /clinic/portal/webhook-deliveries
 *   POST /clinic/portal/test-webhook
 *
 * Boots the full AppModule against the seeded DB.
 * Overrides EMAIL_SENDER and WEBHOOK_SENDER with stubs.
 * Uses seeded clinic user credentials from patient-journey.seed.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import supertest = require('supertest');

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AllExceptionsFilter } from '../../src/infrastructure/security/all-exceptions.filter';
import { EMAIL_SENDER } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';
import type { EmailSenderPort } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';
import { WEBHOOK_SENDER } from '../../src/modules/leads/domain/ports/webhook-sender.port';
import type {
  WebhookSenderPort,
  WebhookSendResult,
} from '../../src/modules/leads/domain/ports/webhook-sender.port';
import { SEEDED_CLINIC_USERS, seedPatientJourney } from '../../prisma/seed/patient-journey.seed';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

class CapturingEmailSender implements EmailSenderPort {
  public readonly sent: { to: string; subject: string; body: string }[] = [];
  public readonly codeByEmail = new Map<string, string>();

  async send(to: string, subject: string, body: string): Promise<void> {
    const match = /\b(\d{6})\b/.exec(body);
    if (match) {
      this.codeByEmail.set(to.toLowerCase(), match[1]!);
    }
    this.sent.push({ to, subject, body });
  }

  codeFor(email: string): string {
    const code = this.codeByEmail.get(email.toLowerCase());
    if (!code) throw new Error(`No 2FA code captured for ${email}`);
    return code;
  }
}

class StubWebhookSender implements WebhookSenderPort {
  public readonly calls: { url: string; payload: object; secret: string }[] = [];

  async send(url: string, payload: object, secret: string): Promise<WebhookSendResult> {
    this.calls.push({ url, payload, secret });
    return { ok: true, status: 200 };
  }
}

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

describe('Clinic Portal Webhook (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let csrfToken: string;
  let clinicCookie: string;
  let patientCookie: string;
  let clinicId: string;

  const emailSender = new CapturingEmailSender();
  const webhookSender = new StubWebhookSender();
  const clinicUser = SEEDED_CLINIC_USERS[0]!; // vitality-hormone-nyc

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  beforeAll(async () => {
    await seedPatientJourney(seedPrisma);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(emailSender)
      .overrideProvider(WEBHOOK_SENDER)
      .useValue(webhookSender)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);

    const clinic = await seedPrisma.clinic.findUniqueOrThrow({
      where: { slug: clinicUser.clinicSlug },
      select: { id: true },
    });
    clinicId = clinic.id;

    // Reset webhook_secret so tests start from a known state
    await prisma.asSystem(
      (client) =>
        client.$executeRaw`UPDATE clinics SET webhook_secret = NULL WHERE id = ${clinicId}::uuid`,
    );

    // Acquire CSRF token
    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;

    // Sign in as the clinic user
    await supertest(app.getHttpServer())
      .post('/auth/signin')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: clinicUser.email, password: clinicUser.password })
      .expect(200);

    const code = emailSender.codeFor(clinicUser.email);
    const verifyRes = await supertest(app.getHttpServer())
      .post('/auth/2fa/verify')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: clinicUser.email, code })
      .expect(200);

    clinicCookie = cookieValue(
      verifyRes.headers['set-cookie'] as unknown as string[],
      'access_token',
    )!;
    expect(clinicCookie).toBeTruthy();

    // Register + sign in a patient for 403 tests
    const patientEmail = `e2e-webhook-patient-${Date.now()}@example.com`;
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
    const patientVerify = await supertest(app.getHttpServer())
      .post('/auth/2fa/verify')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: patientEmail, code: patientCode })
      .expect(200);

    patientCookie = cookieValue(
      patientVerify.headers['set-cookie'] as unknown as string[],
      'access_token',
    )!;
  });

  afterAll(async () => {
    // Reset webhook_secret
    await prisma.asSystem(
      (client) =>
        client.$executeRaw`UPDATE clinics SET webhook_secret = NULL WHERE id = ${clinicId}::uuid`,
    );
    await seedPatientJourney(seedPrisma);
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());

  // -------------------------------------------------------------------------
  // POST /clinic/portal/webhook/rotate
  // -------------------------------------------------------------------------

  describe('POST /clinic/portal/webhook/rotate', () => {
    it('returns 401 when unauthenticated with CSRF token present', async () => {
      await agent()
        .post('/clinic/portal/webhook/rotate')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(401);
    });

    it('returns 403 for a patient token', async () => {
      await agent()
        .post('/clinic/portal/webhook/rotate')
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(403);
    });

    it('returns 200 with a 64-char hex webhookSecret for authenticated clinic', async () => {
      const res = await agent()
        .post('/clinic/portal/webhook/rotate')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      const body = res.body as Record<string, unknown>;
      expect(typeof body['webhookSecret']).toBe('string');
      expect(body['webhookSecret'] as string).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(body['webhookSecret'] as string)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // GET /clinic/portal/webhook-deliveries
  // -------------------------------------------------------------------------

  describe('GET /clinic/portal/webhook-deliveries', () => {
    it('returns 401 when unauthenticated', async () => {
      await agent().get('/clinic/portal/webhook-deliveries').expect(401);
    });

    it('returns 403 for a patient token', async () => {
      await agent()
        .get('/clinic/portal/webhook-deliveries')
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .expect(403);
    });

    it('returns 200 with an array (may be empty)', async () => {
      const res = await agent()
        .get('/clinic/portal/webhook-deliveries')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // POST /clinic/portal/test-webhook
  // -------------------------------------------------------------------------

  describe('POST /clinic/portal/test-webhook', () => {
    it('returns 401 when unauthenticated with CSRF token present', async () => {
      await agent()
        .post('/clinic/portal/test-webhook')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ webhookUrl: 'https://example.com/hook' })
        .expect(401);
    });

    it('returns 400 for a non-HTTPS webhookUrl', async () => {
      await agent()
        .post('/clinic/portal/test-webhook')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ webhookUrl: 'http://not-https.com' })
        .expect(400);
    });

    it('returns 400 if no webhook secret has been configured yet', async () => {
      // Reset to null so there's no secret
      await prisma.asSystem(
        (client) =>
          client.$executeRaw`UPDATE clinics SET webhook_secret = NULL WHERE id = ${clinicId}::uuid`,
      );

      await agent()
        .post('/clinic/portal/test-webhook')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ webhookUrl: 'https://example.com/hook' })
        .expect(400);
    });

    it('returns 200 with a WebhookDeliveryDto shape after rotate', async () => {
      // First rotate so a secret exists
      await agent()
        .post('/clinic/portal/webhook/rotate')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      const res = await agent()
        .post('/clinic/portal/test-webhook')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ webhookUrl: 'https://example.com/hook' })
        .expect(200);

      const body = res.body as Record<string, unknown>;
      expect(typeof body['lead_id']).toBe('string');
      expect((body['lead_id'] as string).startsWith('test_')).toBe(true);
      expect(typeof body['attempted_at']).toBe('string');
      expect(body['status']).toBe('success');
      expect(body['http_status_code']).toBe(200);
      expect(body['error_message']).toBeNull();
    });

    it('stub sender was called with the expected payload shape', async () => {
      const callsBefore = webhookSender.calls.length;

      await agent()
        .post('/clinic/portal/test-webhook')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ webhookUrl: 'https://example.com/hook' })
        .expect(200);

      expect(webhookSender.calls.length).toBeGreaterThan(callsBefore);
      const lastCall = webhookSender.calls[webhookSender.calls.length - 1]!;
      expect(lastCall.url).toBe('https://example.com/hook');
      expect((lastCall.payload as Record<string, unknown>)['event_type']).toBe('lead.created');
    });

    it('returns 403 for a patient token', async () => {
      await agent()
        .post('/clinic/portal/test-webhook')
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ webhookUrl: 'https://example.com/hook' })
        .expect(403);
    });
  });
});
