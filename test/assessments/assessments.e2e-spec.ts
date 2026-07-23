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

class CapturingEmailSender implements EmailSenderPort {
  public readonly lastBodyByEmail = new Map<string, string>();

  async send(to: string, _subject: string, body: string): Promise<void> {
    this.lastBodyByEmail.set(to.toLowerCase(), body);
  }

  codeFor(email: string): string {
    const body = this.lastBodyByEmail.get(email.toLowerCase());
    if (!body) throw new Error(`No email captured for ${email}`);
    const match = body.match(/\b(\d{6})\b/);
    if (!match) throw new Error(`No 6-digit code in email body: ${body}`);
    return match[1];
  }
}

/** Extracts a single cookie value by name from a Set-Cookie header array. */
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

const VALID_SUBMISSION = {
  treatmentCategory: 'hormone',
  selectedGoals: ['goal_energy'],
  selectedSymptoms: ['fatigue'],
  symptomSeverities: { fatigue: 3 },
  budgetBand: '200_500',
  telehealthPreference: 'yes',
  zipCode: '90210',
  chronicConditions: [],
  currentPrescriptions: [],
  consentGiven: true,
  consentVersion: '1.0',
};

describe('Assessments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let csrfToken: string;
  const sessionIds: string[] = [];
  const emailSender = new CapturingEmailSender();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EMAIL_SENDER)
      .useValue(emailSender)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Clean up test assessments
    for (const sid of sessionIds) {
      await prisma.asSystem((client) =>
        client.patientAssessment.deleteMany({ where: { sessionId: sid } }),
      );
    }
    await app.close();
  });

  const agent = () => supertest(app.getHttpServer());

  it('GET /health issues a csrf_token cookie', async () => {
    const res = await agent().get('/health').expect(200);
    const token = cookieValue(res.headers['set-cookie'] as unknown as string[], 'csrf_token');
    expect(token).toBeDefined();
    csrfToken = token as string;
  });

  it('POST /assessments anonymous succeeds with 200 and returns sessionId + claimToken', async () => {
    const res = await agent()
      .post('/assessments')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send(VALID_SUBMISSION)
      .expect(200);

    expect(typeof res.body.sessionId).toBe('string');
    expect(res.body.sessionId).toMatch(/^session_[0-9a-f]{32}$/);
    expect(typeof res.body.claimToken).toBe('string');
    expect(res.body.claimToken.length).toBeGreaterThan(0);

    sessionIds.push(res.body.sessionId as string);
  });

  it('POST /assessments writes an assessment_created audit_log row', async () => {
    const res = await agent()
      .post('/assessments')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send(VALID_SUBMISSION)
      .expect(200);

    const sessionId = res.body.sessionId as string;
    sessionIds.push(sessionId);

    const rows = await prisma.asSystem(
      (client) =>
        client.$queryRaw<{ action_type: string }[]>`
          SELECT action_type
          FROM audit_log
          WHERE action_type = 'assessment_created'
            AND affected_record = ${`patient_assessments:${sessionId}`}
          LIMIT 1
        `,
    );
    expect(rows.length).toBe(1);
  });

  it('POST /assessments with consentGiven: false returns 400', async () => {
    const res = await agent()
      .post('/assessments')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_SUBMISSION, consentGiven: false })
      .expect(400);

    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('POST /assessments with symptomSeverities value of 9 returns 400', async () => {
    await agent()
      .post('/assessments')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_SUBMISSION, symptomSeverities: { fatigue: 9 } })
      .expect(400);
  });

  it('POST /assessments with bad zipCode returns 400', async () => {
    await agent()
      .post('/assessments')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_SUBMISSION, zipCode: 'BADZIP' })
      .expect(400);
  });

  it('POST /assessments accepts otherChronicCondition without 400ing', async () => {
    const res = await agent()
      .post('/assessments')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_SUBMISSION, otherChronicCondition: 'Some rare condition' })
      .expect(200);

    expect(typeof res.body.sessionId).toBe('string');
    sessionIds.push(res.body.sessionId as string);
  });

  it('POST /assessments accepts a null otherChronicCondition without 400ing', async () => {
    const res = await agent()
      .post('/assessments')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_SUBMISSION, otherChronicCondition: null })
      .expect(200);

    expect(typeof res.body.sessionId).toBe('string');
    sessionIds.push(res.body.sessionId as string);
  });

  it('POST /assessments with a symptom missing its severity returns 400', async () => {
    await agent()
      .post('/assessments')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({
        ...VALID_SUBMISSION,
        selectedSymptoms: ['fatigue', 'brain_fog'],
        symptomSeverities: { fatigue: 3 }, // brain_fog has no severity
      })
      .expect(400);
  });

  describe('claim-security (spec §7)', () => {
    const claimEmail = `e2e-claim-${Date.now()}@example.com`;
    const claimPassword = 'claim-test-password-123!';

    let sessionId: string;
    let claimToken: string;
    let accessCookie: string;

    afterAll(async () => {
      // Must delete patients (FK child) before the user row.
      await prisma.asSystem(
        (client) =>
          client.$executeRaw`
            DELETE FROM patients
            WHERE user_id = (SELECT id FROM users WHERE email = ${claimEmail}::citext LIMIT 1)
          `,
      );
      await prisma.asSystem(
        (client) => client.$executeRaw`DELETE FROM users WHERE email = ${claimEmail}::citext`,
      );
    });

    it('submits an anonymous assessment and captures sessionId + claimToken', async () => {
      const res = await agent()
        .post('/assessments')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send(VALID_SUBMISSION)
        .expect(200);

      sessionId = res.body.sessionId as string;
      claimToken = res.body.claimToken as string;
      sessionIds.push(sessionId);

      expect(typeof sessionId).toBe('string');
      expect(typeof claimToken).toBe('string');
    });

    it('signs up and signs in a user (with 2FA)', async () => {
      await agent()
        .post('/auth/signup')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ email: claimEmail, password: claimPassword })
        .expect(201);

      await agent()
        .post('/auth/signin')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ email: claimEmail, password: claimPassword })
        .expect(200);

      const code = emailSender.codeFor(claimEmail);
      const verifyRes = await agent()
        .post('/auth/2fa/verify')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ email: claimEmail, code })
        .expect(200);

      const setCookie = verifyRes.headers['set-cookie'] as unknown as string[];
      const access = cookieValue(setCookie, 'access_token');
      expect(access).toBeDefined();
      accessCookie = access as string;
    });

    it('GET /assessments/latest WITHOUT claimToken returns 204 (no assessment leaked)', async () => {
      await agent()
        .get(`/assessments/latest?sessionId=${sessionId}`)
        .set('Cookie', `access_token=${accessCookie}; csrf_token=${csrfToken}`)
        .expect(204);
    });

    it('GET /assessments/latest with WRONG claimToken returns 204 (no assessment leaked)', async () => {
      await agent()
        .get(`/assessments/latest?sessionId=${sessionId}&claimToken=wrong-token-abc`)
        .set('Cookie', `access_token=${accessCookie}; csrf_token=${csrfToken}`)
        .expect(204);
    });

    it('GET /assessments/latest with CORRECT claimToken returns 200 and claims the assessment', async () => {
      const res = await agent()
        .get(`/assessments/latest?sessionId=${sessionId}&claimToken=${claimToken}`)
        .set('Cookie', `access_token=${accessCookie}; csrf_token=${csrfToken}`)
        .expect(200);

      expect(res.body.sessionId).toBe(sessionId);
    });

    it('second claim attempt with correct token returns 204 (already claimed — no re-link)', async () => {
      await agent()
        .get(`/assessments/latest?sessionId=${sessionId}&claimToken=${claimToken}`)
        .set('Cookie', `access_token=${accessCookie}; csrf_token=${csrfToken}`)
        .expect(200);
    });
  });
});
