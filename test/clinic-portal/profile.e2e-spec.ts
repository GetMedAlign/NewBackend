/**
 * E2E tests for GET/PUT /clinic/portal/profile.
 *
 * Boots the full AppModule against the seeded DB.
 * Logs in as a seeded clinic user (vitality-hormone-nyc), then:
 *  - GET /clinic/portal/profile  → 200 with full profile shape
 *  - PUT /clinic/portal/profile  → 200 { success: true }, then GET confirms changes
 *  - PUT with invalid webhookUrl → 400
 *  - Unauthenticated GET         → 401
 *  - Patient token GET           → 403
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
import { SEEDED_CLINIC_USERS } from '../../prisma/seed/patient-journey.seed';
import { seedPatientJourney } from '../../prisma/seed/patient-journey.seed';
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

describe('Clinic Portal Profile (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let csrfToken: string;
  let clinicCookie: string;
  let clinicId: string;

  const emailSender = new CapturingEmailSender();
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
      .useValue(new StubWebhookSender())
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);

    // Look up the clinic ID for cleanup
    const clinic = await seedPrisma.clinic.findUniqueOrThrow({
      where: { slug: clinicUser.clinicSlug },
      select: { id: true },
    });
    clinicId = clinic.id;

    // Acquire CSRF token
    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;

    // Sign in as the clinic user (sign-in + 2FA)
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
  });

  afterAll(async () => {
    // Restore the clinic profile to seed state so other suites see clean data
    await seedPatientJourney(seedPrisma);
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());

  describe('GET /clinic/portal/profile', () => {
    it('returns 401 when unauthenticated', async () => {
      await agent().get('/clinic/portal/profile').expect(401);
    });

    it('returns 200 with full profile shape for authenticated clinic user', async () => {
      const res = await agent()
        .get('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      const body = res.body as Record<string, unknown>;
      expect(body.id).toBe(clinicId);
      expect(body.slug).toBe(clinicUser.clinicSlug);
      expect(typeof body.name).toBe('string');
      expect(typeof body.webhookSecretConfigured).toBe('boolean');
      // webhookSecret (ciphertext) must NEVER appear in the response
      expect(body).not.toHaveProperty('webhookSecret');
      expect(typeof body.leadCount).toBe('number');
      expect(Array.isArray(body.treatmentCategories)).toBe(true);
      expect(Array.isArray(body.services)).toBe(true);
      expect(Array.isArray(body.allServices)).toBe(true);
      expect(typeof body.specialty).toBe('string');
    });

    it('returns 403 for a non-clinic (patient) token', async () => {
      // Register + login as a patient, then try the clinic endpoint
      const patientEmail = `e2e-clinic-portal-patient-${Date.now()}@example.com`;

      await agent()
        .post('/auth/signup')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ email: patientEmail, password: 'SeedClinic1!' })
        .expect(201);

      await agent()
        .post('/auth/signin')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ email: patientEmail, password: 'SeedClinic1!' })
        .expect(200);

      const patientCode = emailSender.codeFor(patientEmail);
      const patientVerify = await agent()
        .post('/auth/2fa/verify')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ email: patientEmail, code: patientCode })
        .expect(200);

      const patientCookie = cookieValue(
        patientVerify.headers['set-cookie'] as unknown as string[],
        'access_token',
      );

      await agent()
        .get('/clinic/portal/profile')
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .expect(403);

      // Cleanup: delete patient row (FK to user) before deleting user
      const userRow = await prisma.asSystem((c) =>
        c.user.findFirst({ where: { email: patientEmail }, select: { id: true } }),
      );
      if (userRow) {
        await prisma.asSystem((c) => c.patient.deleteMany({ where: { userId: userRow.id } }));
        await prisma.asSystem((c) => c.user.delete({ where: { id: userRow.id } }));
      }
    });
  });

  describe('PUT /clinic/portal/profile', () => {
    it('returns 200 { success: true } for a valid partial update', async () => {
      const res = await agent()
        .put('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ about: 'E2E test update', offersLabWork: true })
        .expect(200);

      expect(res.body).toEqual({ success: true });
    });

    it('persists the updated fields (GET returns new values)', async () => {
      await agent()
        .put('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ about: 'Confirmed E2E update', differentiators: 'Top provider in NYC' })
        .expect(200);

      const getRes = await agent()
        .get('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      const body = getRes.body as Record<string, unknown>;
      expect(body.about).toBe('Confirmed E2E update');
      expect(body.differentiators).toBe('Top provider in NYC');
    });

    it('returns 400 for a non-HTTPS webhookUrl', async () => {
      await agent()
        .put('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ webhookUrl: 'http://insecure.example.com/hook' })
        .expect(400);
    });

    it('accepts a valid HTTPS webhookUrl and reflects it on GET', async () => {
      await agent()
        .put('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ webhookUrl: 'https://hooks.example.com/medalign' })
        .expect(200);

      const getRes = await agent()
        .get('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      expect((getRes.body as Record<string, unknown>).webhookUrl).toBe(
        'https://hooks.example.com/medalign',
      );
    });

    it('updates location when city and stateCode change', async () => {
      await agent()
        .put('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ city: 'Chicago', stateCode: 'IL' })
        .expect(200);

      const getRes = await agent()
        .get('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      const body = getRes.body as Record<string, unknown>;
      expect(body.city).toBe('Chicago');
      expect(body.stateCode).toBe('IL');
      expect(body.location).toBe('Chicago, IL');
    });

    it('persists zipCode and reflects it on GET', async () => {
      await agent()
        .put('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ zipCode: '10001' })
        .expect(200);

      const getRes = await agent()
        .get('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      expect((getRes.body as Record<string, unknown>).zipCode).toBe('10001');
    });

    it('replaces services with topServices/allServices and reflects on GET', async () => {
      await agent()
        .put('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({
          topServices: ['trt', 'hgh'],
          allServices: ['trt', 'hgh', 'testosterone_pellets'],
        })
        .expect(200);

      const getRes = await agent()
        .get('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      const body = getRes.body as Record<string, unknown>;
      const services = body.services as { serviceCode: string; isTopService: boolean }[];
      const allServices = body.allServices as { serviceCode: string; isTopService: boolean }[];

      expect(services.every((s) => s.isTopService)).toBe(true);
      expect(services.map((s) => s.serviceCode).sort()).toEqual(['hgh', 'trt'].sort());
      expect(allServices.length).toBe(3);
    });

    it('returns 401 when unauthenticated', async () => {
      await agent()
        .put('/clinic/portal/profile')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ name: 'Hack attempt' })
        .expect(401);
    });
  });
});
