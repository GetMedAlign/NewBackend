/**
 * E2E tests for clinic lead endpoints:
 *   GET  /clinic/portal/leads
 *   GET  /clinic/portal/leads/:leadId
 *   PATCH /clinic/portal/leads/:leadId/status
 *   POST  /clinic/portal/leads/:leadId/contact-request
 *
 * Boots the full AppModule against the seeded DB.
 * Seeds a lead for the vitality-hormone-nyc clinic so the tests can exercise
 * the endpoints. Uses the seeded clinic user credentials from patient-journey.seed.
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

const E2E_LEAD_BUSINESS_ID = 'e2e-spec-lead-vitality-00000000000001';

class CapturingEmailSender implements EmailSenderPort {
  public readonly sent: { to: string; subject: string; body: string }[] = [];

  async send(to: string, subject: string, body: string): Promise<void> {
    const match = /\b(\d{6})\b/.exec(body);
    if (match) {
      // 2FA code capture
      this.codeByEmail.set(to.toLowerCase(), match[1]!);
    }
    this.sent.push({ to, subject, body });
  }

  public readonly codeByEmail = new Map<string, string>();

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

describe('Clinic Portal Leads (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let csrfToken: string;
  let clinicCookie: string;
  let patientCookie: string;
  let clinicId: string;
  let leadUuid: string;

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

    const clinic = await seedPrisma.clinic.findUniqueOrThrow({
      where: { slug: clinicUser.clinicSlug },
      select: { id: true },
    });
    clinicId = clinic.id;

    // Seed a lead for the clinic
    const rows = await prisma.asSystem(
      (client) => client.$queryRaw<{ id: string }[]>`
        INSERT INTO leads (
          lead_id, clinic_id, patient_first_name, patient_email,
          patient_zip, treatment_category, top_goals, top_symptoms,
          budget_band, telehealth_preference, start_timeline,
          lead_source, delivery_status, clinic_status, received_at
        )
        VALUES (
          ${E2E_LEAD_BUSINESS_ID},
          ${clinicId}::uuid,
          'TestPatient', 'test-patient@e2e.example.com',
          '10001', 'hormone', 'energy,mood', 'fatigue,brain fog',
          '$100-200/mo', 'yes', 'immediately',
          'assessment', 'delivered', 'new', NOW()
        )
        ON CONFLICT (lead_id) DO UPDATE
          SET clinic_id = EXCLUDED.clinic_id,
              clinic_status = 'new'
        RETURNING id
      `,
    );
    leadUuid = rows[0]!.id;

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

    // Register + sign in a patient to get a patient cookie for 403 tests
    const patientEmail = `e2e-leads-patient-${Date.now()}@example.com`;
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
    await prisma.asSystem(
      (client) => client.$executeRaw`DELETE FROM leads WHERE id = ${leadUuid}::uuid`,
    );
    await seedPatientJourney(seedPrisma);
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());

  // -------------------------------------------------------------------------
  // GET /clinic/portal/leads
  // -------------------------------------------------------------------------

  describe('GET /clinic/portal/leads', () => {
    it('returns 401 when unauthenticated', async () => {
      await agent().get('/clinic/portal/leads').expect(401);
    });

    it('returns 403 for a patient token', async () => {
      await agent()
        .get('/clinic/portal/leads')
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .expect(403);
    });

    it('returns 200 with an array of leads for authenticated clinic user', async () => {
      const res = await agent()
        .get('/clinic/portal/leads')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const lead = (res.body as Record<string, unknown>[]).find(
        (l) => l['lead_id'] === E2E_LEAD_BUSINESS_ID,
      );
      expect(lead).toBeDefined();
      expect(lead!['lead_source']).toBe('assessment');
      expect(lead!['delivery_status']).toBe('delivered');
      expect(lead!['clinic_status']).toBe('new');

      const patient = lead!['patient'] as Record<string, unknown>;
      expect(patient['first_name']).toBe('TestPatient');
      expect(patient['email']).toBe('test-patient@e2e.example.com');
      expect(patient['zip_code']).toBe('10001');

      const summary = lead!['assessment_summary'] as Record<string, unknown>;
      expect(summary['treatmentCategory']).toBe('hormone');
      expect(Array.isArray(summary['topGoals'])).toBe(true);
      expect(summary['topGoals']).toContain('energy');
      expect(summary['topGoals']).toContain('mood');
    });
  });

  // -------------------------------------------------------------------------
  // GET /clinic/portal/leads/:leadId
  // -------------------------------------------------------------------------

  describe('GET /clinic/portal/leads/:leadId', () => {
    it('returns 200 with lead detail for own lead', async () => {
      const res = await agent()
        .get(`/clinic/portal/leads/${E2E_LEAD_BUSINESS_ID}`)
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      const body = res.body as Record<string, unknown>;
      expect(body['lead_id']).toBe(E2E_LEAD_BUSINESS_ID);
      expect(body['clinic_status']).toBe('new');
      expect(typeof body['received_at']).toBe('string');
      // ISO-8601 check
      expect(new Date(body['received_at'] as string).toISOString()).toBeTruthy();
    });

    it('returns 404 for a non-existent leadId', async () => {
      await agent()
        .get('/clinic/portal/leads/nonexistent-lead-id-xyz')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(404);
    });

    it('returns 403 for a patient token', async () => {
      await agent()
        .get(`/clinic/portal/leads/${E2E_LEAD_BUSINESS_ID}`)
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /clinic/portal/leads/:leadId/status
  // -------------------------------------------------------------------------

  describe('PATCH /clinic/portal/leads/:leadId/status', () => {
    it('returns { success: true } for a valid status', async () => {
      const res = await agent()
        .patch(`/clinic/portal/leads/${E2E_LEAD_BUSINESS_ID}/status`)
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ status: 'contacted' })
        .expect(200);

      expect(res.body).toEqual({ success: true });
    });

    it('the status change is reflected in GET /leads/:leadId', async () => {
      await agent()
        .patch(`/clinic/portal/leads/${E2E_LEAD_BUSINESS_ID}/status`)
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ status: 'booked' })
        .expect(200);

      const res = await agent()
        .get(`/clinic/portal/leads/${E2E_LEAD_BUSINESS_ID}`)
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      expect((res.body as Record<string, unknown>)['clinic_status']).toBe('booked');
    });

    it('returns 400 for an invalid status value', async () => {
      await agent()
        .patch(`/clinic/portal/leads/${E2E_LEAD_BUSINESS_ID}/status`)
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ status: 'invalid_status' })
        .expect(400);
    });

    it('returns 404 for a non-existent leadId', async () => {
      await agent()
        .patch('/clinic/portal/leads/nonexistent-lead-id/status')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ status: 'contacted' })
        .expect(404);
    });

    it('returns 403 for a patient token', async () => {
      await agent()
        .patch(`/clinic/portal/leads/${E2E_LEAD_BUSINESS_ID}/status`)
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ status: 'contacted' })
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // POST /clinic/portal/leads/:leadId/contact-request
  // -------------------------------------------------------------------------

  describe('POST /clinic/portal/leads/:leadId/contact-request', () => {
    it('returns { success: true } for own lead (email seam captures)', async () => {
      const sentBefore = emailSender.sent.length;

      const res = await agent()
        .post(`/clinic/portal/leads/${E2E_LEAD_BUSINESS_ID}/contact-request`)
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      expect(res.body).toEqual({ success: true });

      // Email was sent
      const contactEmails = emailSender.sent.slice(sentBefore);
      expect(contactEmails.length).toBeGreaterThanOrEqual(1);

      const contactEmail = contactEmails[contactEmails.length - 1]!;
      expect(contactEmail.to).toBe('test-patient@e2e.example.com');
      expect(contactEmail.body).toContain('TestPatient');
    });

    it('returns 404 for a non-existent leadId', async () => {
      await agent()
        .post('/clinic/portal/leads/nonexistent-lead-id/contact-request')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(404);
    });

    it('returns 403 for a patient token', async () => {
      await agent()
        .post(`/clinic/portal/leads/${E2E_LEAD_BUSINESS_ID}/contact-request`)
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(403);
    });
  });
});
