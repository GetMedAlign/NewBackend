import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import supertest = require('supertest');

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AllExceptionsFilter } from '../../src/infrastructure/security/all-exceptions.filter';

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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

  it('POST /assessments anonymous succeeds with 201 and returns sessionId + claimToken', async () => {
    const res = await agent()
      .post('/assessments')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send(VALID_SUBMISSION)
      .expect(201);

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
      .expect(201);

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
});
