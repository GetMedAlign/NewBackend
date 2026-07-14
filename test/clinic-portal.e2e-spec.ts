/**
 * Full clinic-journey e2e — exercises the complete clinic portal flow
 * in a single sequential test run against the seeded database.
 *
 * Covers:
 *   1. Signin + 2FA for a seeded clinic user
 *   2. GET /clinic/portal/profile
 *   3. GET /clinic/portal/leads (seeded lead visible)
 *   4. PATCH /clinic/portal/leads/:leadId/status → contacted
 *   5. POST /clinic/portal/webhook/rotate
 *   6. POST /clinic/portal/media/logo/sign
 *   7. POST /clinic/portal/media/logo (confirm)
 *   8. Security: patient cookie → 403 on clinic routes
 *   9. Security: logo confirm with another clinic's path prefix → 403
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import supertest = require('supertest');

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/infrastructure/security/all-exceptions.filter';
import { EMAIL_SENDER } from '../src/modules/auth/infrastructure/adapters/email-sender.port';
import type { EmailSenderPort } from '../src/modules/auth/infrastructure/adapters/email-sender.port';
import { WEBHOOK_SENDER } from '../src/modules/leads/domain/ports/webhook-sender.port';
import type {
  WebhookSenderPort,
  WebhookSendResult,
} from '../src/modules/leads/domain/ports/webhook-sender.port';
import { STORAGE_PORT } from '../src/modules/clinic-media/domain/ports/storage.port';
import type { StoragePort } from '../src/modules/clinic-media/domain/ports/storage.port';
import { SEEDED_CLINIC_USERS, seedPatientJourney } from '../prisma/seed/patient-journey.seed';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const E2E_JOURNEY_LEAD_ID = 'e2e-journey-lead-vitality-00000000000001';

class CapturingEmailSender implements EmailSenderPort {
  private readonly codeByEmail = new Map<string, string>();

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

describe('Clinic Portal — full journey (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let csrfToken: string;
  let clinicCookie: string;
  let patientCookie: string;
  let clinicAId: string;
  let clinicBId: string;
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

    prisma = app.get(PrismaService);

    const clinicA = await seedPrisma.clinic.findUniqueOrThrow({
      where: { slug: clinicUser.clinicSlug },
      select: { id: true },
    });
    clinicAId = clinicA.id;

    const clinicB = await seedPrisma.clinic.findUniqueOrThrow({
      where: { slug: 'apex-peptide-telehealth' },
      select: { id: true },
    });
    clinicBId = clinicB.id;

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
          ${E2E_JOURNEY_LEAD_ID},
          ${clinicAId}::uuid,
          'JourneyPatient', 'journey-patient@e2e.example.com',
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

    // Reset webhook_secret so rotate test starts from clean state
    await prisma.asSystem(
      (client) =>
        client.$executeRaw`UPDATE clinics SET webhook_secret = NULL WHERE id = ${clinicAId}::uuid`,
    );

    // Reset logo_url so profile logoUrl starts empty
    await prisma.asSystem(
      (client) =>
        client.$executeRaw`UPDATE clinics SET logo_url = NULL WHERE id = ${clinicAId}::uuid`,
    );

    // Acquire CSRF token
    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;

    // --- Sign in as clinic user (step 1) ---
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

    // Sign in as a patient for 403 tests
    const patientEmail = `e2e-journey-patient-${Date.now()}@example.com`;
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
    await prisma.asSystem(
      (client) => client.$executeRaw`DELETE FROM leads WHERE id = ${leadUuid}::uuid`,
    );
    await seedPatientJourney(seedPrisma);
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());

  // Step 2: GET /clinic/portal/profile
  describe('Step 2: GET /clinic/portal/profile', () => {
    it('returns 200 with correct profile shape for authenticated clinic user', async () => {
      const res = await agent()
        .get('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      const body = res.body as Record<string, unknown>;
      expect(body.id).toBe(clinicAId);
      expect(body.slug).toBe(clinicUser.clinicSlug);
      expect(typeof body.name).toBe('string');
      expect(typeof body.webhookSecretConfigured).toBe('boolean');
      expect(body).not.toHaveProperty('webhookSecret');
      expect(typeof body.leadCount).toBe('number');
      expect(Array.isArray(body.treatmentCategories)).toBe(true);
    });
  });

  // Step 3: GET /clinic/portal/leads
  describe('Step 3: GET /clinic/portal/leads', () => {
    it('returns 200 array containing the seeded lead', async () => {
      const res = await agent()
        .get('/clinic/portal/leads')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const lead = (res.body as Record<string, unknown>[]).find(
        (l) => l['lead_id'] === E2E_JOURNEY_LEAD_ID,
      );
      expect(lead).toBeDefined();
      expect(lead!['clinic_status']).toBe('new');
    });
  });

  // Step 4: PATCH lead status
  describe('Step 4: PATCH /clinic/portal/leads/:leadId/status', () => {
    it('updates status to contacted and GET reflects the change', async () => {
      const patchRes = await agent()
        .patch(`/clinic/portal/leads/${E2E_JOURNEY_LEAD_ID}/status`)
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ status: 'contacted' })
        .expect(200);

      expect(patchRes.body).toEqual({ success: true });

      const getRes = await agent()
        .get(`/clinic/portal/leads/${E2E_JOURNEY_LEAD_ID}`)
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      expect((getRes.body as Record<string, unknown>)['clinic_status']).toBe('contacted');
    });
  });

  // Step 5: POST /clinic/portal/webhook/rotate
  describe('Step 5: POST /clinic/portal/webhook/rotate', () => {
    it('returns 200 with a 64-char hex webhookSecret', async () => {
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

  // Steps 6-8: Media logo sign, confirm, profile logoUrl
  describe('Steps 6–8: Media logo sign, confirm, and profile logoUrl', () => {
    it('Step 6: POST /clinic/portal/media/logo/sign returns signed URL under own clinic prefix', async () => {
      const res = await agent()
        .post('/clinic/portal/media/logo/sign')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ contentType: 'image/png' })
        .expect(200);

      const body = res.body as { uploadUrl: string; token: string; path: string };
      expect(typeof body.uploadUrl).toBe('string');
      expect(typeof body.token).toBe('string');
      expect(body.path.startsWith(`logos/${clinicAId}/`)).toBe(true);
    });

    // Step 7: POST /clinic/portal/media/logo (confirm)
    it('Step 7: POST /clinic/portal/media/logo confirms upload and returns public URL', async () => {
      const path = `logos/${clinicAId}/journey-logo.png`;
      const res = await agent()
        .post('/clinic/portal/media/logo')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ path })
        .expect(200);

      const body = res.body as { url: string };
      expect(typeof body.url).toBe('string');
      expect(body.url).toContain('journey-logo.png');
    });

    it('Step 8: GET /clinic/portal/profile reflects logoUrl after confirm', async () => {
      const res = await agent()
        .get('/clinic/portal/profile')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      const body = res.body as Record<string, unknown>;
      // logoUrl should now be set (not null/undefined)
      expect(body.logoUrl).toBeTruthy();
    });
  });

  // Security assertions
  describe('Security: patient cookie on clinic routes → 403', () => {
    it('GET /clinic/portal/profile returns 403 for patient token', async () => {
      await agent()
        .get('/clinic/portal/profile')
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .expect(403);
    });

    it('GET /clinic/portal/leads returns 403 for patient token', async () => {
      await agent()
        .get('/clinic/portal/leads')
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .expect(403);
    });

    it('POST /clinic/portal/webhook/rotate returns 403 for patient token', async () => {
      await agent()
        .post('/clinic/portal/webhook/rotate')
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(403);
    });

    it('POST /clinic/portal/media/logo/sign returns 403 for patient token', async () => {
      await agent()
        .post('/clinic/portal/media/logo/sign')
        .set('Cookie', `access_token=${patientCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ contentType: 'image/png' })
        .expect(403);
    });
  });

  describe('Security: media confirm with another clinic path prefix → 403', () => {
    it('POST /clinic/portal/media/logo with clinicB path returns 403', async () => {
      await agent()
        .post('/clinic/portal/media/logo')
        .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ path: `logos/${clinicBId}/stolen.png` })
        .expect(403);
    });
  });
});
