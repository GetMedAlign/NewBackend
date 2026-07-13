/**
 * Full patient-journey end-to-end test (spec §7 / §8).
 *
 * Exercises the REAL production frontend order against the seeded DB and,
 * crucially, proves the patient-at-signup fix: the authenticated caller submits
 * the lead BEFORE claiming the assessment, yet the lead is still attributed to
 * their own patient (resolved directly by userId) and therefore appears in
 * GET /patients/me/leads.
 *
 * Requires a running Postgres with the patient-journey seed applied
 * (clinics + zip codes). Reuses the same CSRF double-submit + 2FA-cookie dance
 * as test/auth.e2e-spec.ts.
 *
 * Journey (real production order):
 *   1. POST /assessments (anonymous)                → { sessionId, claimToken }
 *   2. GET  /recommendations/{sessionId} (public)   → ranked clinic matches
 *   3. signup → signin → 2FA verify                 → authenticated cookie
 *   4. POST /leads (authenticated, BEFORE any claim,
 *        sessionId + claimToken)                    → { leadId }, patient +
 *                                                      assessment both linked
 *   5. GET  /patients/me/leads (authenticated)      → the lead appears
 *   6. GET  /assessments/latest?...&claimToken=...  → returns the assessment
 *   7. SECURITY: a DIFFERENT signed-in user calling GET /assessments/latest with
 *      the same sessionId but NO / an INVALID claimToken does NOT receive it.
 *
 * Why the order matters: because signup now creates the caller's patients row
 * (matching .NET), the patient row already exists at lead time even though the
 * assessment has NOT been claimed yet. The assessment still links because the
 * valid claimToken proves ownership. Step 5 is the assertion that fails without
 * the patient-at-signup fix.
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
import type { ClinicMatchDto } from '../src/modules/recommendations/domain/clinic-match.dto';

/** Captures 2FA emails (to read the 6-digit code) and lead notification emails. */
class CapturingEmailSender implements EmailSenderPort {
  public readonly lastBodyByEmail = new Map<string, string>();
  public readonly sent: { to: string; subject: string; body: string }[] = [];

  async send(to: string, subject: string, body: string): Promise<void> {
    this.lastBodyByEmail.set(to.toLowerCase(), body);
    this.sent.push({ to, subject, body });
  }

  codeFor(email: string): string {
    const body = this.lastBodyByEmail.get(email.toLowerCase());
    if (!body) throw new Error(`No email captured for ${email}`);
    const match = body.match(/\b(\d{6})\b/);
    if (!match) throw new Error(`No 6-digit code in email body: ${body}`);
    return match[1];
  }
}

/** Stub webhook sender so no real network egress happens. */
class StubWebhookSender implements WebhookSenderPort {
  public readonly calls: { url: string; payload: object; secret: string }[] = [];
  public result: WebhookSendResult = { ok: true, status: 200 };
  async send(url: string, payload: object, secret: string): Promise<WebhookSendResult> {
    this.calls.push({ url, payload, secret });
    return this.result;
  }
}

function cookieValue(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined;
  for (const raw of setCookie) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return undefined;
}

const HORMONE_ASSESSMENT = {
  treatmentCategory: 'hormone',
  selectedGoals: ['boost_energy'],
  selectedSymptoms: ['fatigue'],
  symptomSeverities: { fatigue: 3 },
  budgetBand: '200_500',
  telehealthPreference: 'yes',
  zipCode: '10001',
  chronicConditions: [],
  currentPrescriptions: [],
  consentGiven: true,
  consentVersion: '1.0',
};

const PASSWORD = 'super-secret-password-123';
const NOTIFY_CLINIC_SLUG = 'vitality-hormone-nyc';

describe('Patient journey (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const emailSender = new CapturingEmailSender();
  const webhookSender = new StubWebhookSender();

  const email = `e2e-journey-${Date.now()}@example.com`;
  const attackerEmail = `e2e-journey-attacker-${Date.now()}@example.com`;

  let csrfToken: string;
  let accessCookie: string;
  let attackerCookie: string;

  let sessionId: string;
  let claimToken: string;
  let matches: ClinicMatchDto[];
  let leadId: string;

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    if (leadId) {
      const lead = await prisma.asSystem((c) =>
        c.lead.findUnique({ where: { leadId }, select: { id: true } }),
      );
      if (lead) {
        await prisma.asSystem((c) => c.webhookDelivery.deleteMany({ where: { leadId: lead.id } }));
        await prisma.asSystem((c) => c.lead.delete({ where: { leadId } }));
      }
    }
    if (sessionId) {
      await prisma.asSystem((c) => c.patientAssessment.deleteMany({ where: { sessionId } }));
    }
    // Patients are FK children of users — delete them before the user rows.
    for (const e of [email, attackerEmail]) {
      await prisma.asSystem(
        (c) => c.$executeRaw`
          DELETE FROM patients
          WHERE user_id = (SELECT id FROM users WHERE email = ${e}::citext LIMIT 1)
        `,
      );
      await prisma.asSystem((c) => c.$executeRaw`DELETE FROM users WHERE email = ${e}::citext`);
    }
    await app.close();
  });

  const agent = () => supertest(app.getHttpServer());

  /** Signs up + signs in + verifies 2FA, returning the access_token cookie. */
  async function authenticate(userEmail: string): Promise<string> {
    await agent()
      .post('/auth/signup')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: userEmail, password: PASSWORD })
      .expect(201);

    await agent()
      .post('/auth/signin')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: userEmail, password: PASSWORD })
      .expect(200);

    const code = emailSender.codeFor(userEmail);
    const verifyRes = await agent()
      .post('/auth/2fa/verify')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: userEmail, code })
      .expect(200);

    const cookie = cookieValue(
      verifyRes.headers['set-cookie'] as unknown as string[],
      'access_token',
    );
    expect(cookie).toBeDefined();
    return cookie as string;
  }

  it('GET /health issues a csrf_token cookie', async () => {
    const res = await agent().get('/health').expect(200);
    const token = cookieValue(res.headers['set-cookie'] as unknown as string[], 'csrf_token');
    expect(token).toBeDefined();
    csrfToken = token as string;
  });

  it('GET /patients/me without a cookie returns 401 (fail-closed)', async () => {
    await agent().get('/patients/me').expect(401);
  });

  it('step 1: POST /assessments (anonymous) returns sessionId + claimToken', async () => {
    const res = await agent()
      .post('/assessments')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send(HORMONE_ASSESSMENT)
      .expect(200);

    sessionId = res.body.sessionId as string;
    claimToken = res.body.claimToken as string;
    expect(sessionId).toMatch(/^session_[0-9a-f]{32}$/);
    expect(typeof claimToken).toBe('string');
    expect(claimToken.length).toBeGreaterThan(0);
  });

  it('step 2: GET /recommendations/{sessionId} returns a non-empty ranked clinic list', async () => {
    const res = await agent().get(`/recommendations/${sessionId}`).expect(200);

    matches = res.body as ClinicMatchDto[];
    expect(Array.isArray(matches)).toBe(true);
    expect(matches.length).toBeGreaterThanOrEqual(1);

    // Sorted by score descending.
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }

    // Top result shape sanity.
    const top = matches[0];
    expect(typeof top.clinicId).toBe('string');
    expect(typeof top.slug).toBe('string');
    expect(typeof top.name).toBe('string');
    expect(typeof top.score).toBe('number');

    // The seeded notify-enabled hormone clinic is a match.
    expect(matches.map((m) => m.slug)).toContain(NOTIFY_CLINIC_SLUG);
  });

  it('step 3: signup + signin + 2FA yields an authenticated cookie', async () => {
    accessCookie = await authenticate(email);
    expect(accessCookie).toBeDefined();
  });

  it('step 4: POST /leads (authenticated, BEFORE claiming) creates a lead linked to the caller', async () => {
    const match = matches.find((m) => m.slug === NOTIFY_CLINIC_SLUG) ?? matches[0];

    const res = await agent()
      .post('/leads')
      .set('Cookie', `access_token=${accessCookie}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({
        clinicId: match.clinicId,
        clinicSlug: NOTIFY_CLINIC_SLUG,
        patientEmail: email,
        patientFirstName: 'Journey',
        treatmentCategory: 'hormone',
        patientZip: '10001',
        topGoals: ['boost_energy'],
        topSymptoms: ['fatigue'],
        budgetBand: '200_500',
        telehealthPreference: 'yes',
        sessionId,
        claimToken,
      })
      .expect(200);

    expect(res.body.leadId).toMatch(/^lead_[0-9a-f]{32}$/);
    leadId = res.body.leadId as string;
  });

  it('step 4b: the lead is attributed to the caller (patient_id + assessment_id set)', async () => {
    const lead = await prisma.asSystem((c) =>
      c.lead.findUniqueOrThrow({
        where: { leadId },
        select: { patientId: true, assessmentId: true },
      }),
    );
    // Patient-at-signup fix: the caller's patient row exists from signup, so it
    // is resolved directly by userId even though the assessment is not yet claimed.
    expect(lead.patientId).not.toBeNull();
    // Assessment linked because a valid claimToken proved ownership.
    expect(lead.assessmentId).not.toBeNull();

    // The lead's patient row belongs to the authenticated user.
    const patient = await prisma.asSystem((c) =>
      c.patient.findUniqueOrThrow({
        where: { id: lead.patientId as string },
        select: { userId: true },
      }),
    );
    const user = await prisma.asSystem(
      (c) =>
        c.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE email = ${email}::citext LIMIT 1
      `,
    );
    expect(patient.userId).toBe(user[0].id);
  });

  it('step 5: GET /patients/me/leads shows the lead (this is what the patient-at-signup fix enables)', async () => {
    const res = await agent()
      .get('/patients/me/leads')
      .set('Cookie', `access_token=${accessCookie}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const found = (res.body as { leadId: string; clinicName?: string; clinicSlug?: string }[]).find(
      (l) => l.leadId === leadId,
    );
    expect(found).toBeDefined();
    expect(typeof found?.clinicName).toBe('string');
    expect(found?.clinicSlug).toBe(NOTIFY_CLINIC_SLUG);
  });

  it('step 6: GET /assessments/latest with the correct claimToken returns the assessment', async () => {
    const res = await agent()
      .get(`/assessments/latest?sessionId=${sessionId}&claimToken=${claimToken}`)
      .set('Cookie', `access_token=${accessCookie}; csrf_token=${csrfToken}`)
      .expect(200);

    expect(res.body.sessionId).toBe(sessionId);
  });

  describe('step 7: a stolen sessionId without the claimToken cannot claim the assessment', () => {
    beforeAll(async () => {
      attackerCookie = await authenticate(attackerEmail);
    });

    it('GET /assessments/latest with NO claimToken does not leak the assessment (204)', async () => {
      await agent()
        .get(`/assessments/latest?sessionId=${sessionId}`)
        .set('Cookie', `access_token=${attackerCookie}; csrf_token=${csrfToken}`)
        .expect(204);
    });

    it('GET /assessments/latest with an INVALID claimToken does not leak the assessment (204)', async () => {
      await agent()
        .get(`/assessments/latest?sessionId=${sessionId}&claimToken=not-the-real-token`)
        .set('Cookie', `access_token=${attackerCookie}; csrf_token=${csrfToken}`)
        .expect(204);
    });

    it("the attacker's GET /patients/me/leads does not contain the victim's lead", async () => {
      const res = await agent()
        .get('/patients/me/leads')
        .set('Cookie', `access_token=${attackerCookie}`)
        .expect(200);

      const found = (res.body as { leadId: string }[]).find((l) => l.leadId === leadId);
      expect(found).toBeUndefined();
    });
  });
});
