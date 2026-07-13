/**
 * End-to-end tests for GET /recommendations/:sessionId.
 * Requires a running Postgres with the patient-journey seed applied.
 *
 * Test flow:
 *  1. Submit a hormone assessment → capture sessionId.
 *  2. GET /recommendations/{sessionId} → expect ranked matches.
 *  3. Verify: only active + billing-current clinics included.
 *  4. Verify: response contains NO PHI (no email, no zip, no symptoms, etc.).
 *  5. Invalid sessionId format → 404.
 *  6. Missing assessment → 404.
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
import type { ClinicMatchDto } from '../../src/modules/recommendations/domain/clinic-match.dto';

class NullEmailSender implements EmailSenderPort {
  async send(): Promise<void> {
    // no-op in tests
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

/** PHI field names that must NOT appear in any response body. */
const PHI_FIELDS = [
  'selectedGoals',
  'selectedSymptoms',
  'symptomSeverities',
  'symptomDuration',
  'budgetBand',
  'telehealthPreference',
  'zipCode',
  'patientId',
  'email',
  'consentGiven',
  'biologicalSex',
];

describe('Recommendations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let csrfToken: string;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EMAIL_SENDER)
      .useValue(new NullEmailSender())
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

  describe('valid session flow', () => {
    let sessionId: string;
    let matchDtos: ClinicMatchDto[];

    it('POST /assessments creates a hormone assessment and returns sessionId', async () => {
      const res = await agent()
        .post('/assessments')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send(HORMONE_ASSESSMENT)
        .expect(201);

      expect(res.body.sessionId).toMatch(/^session_[0-9a-f]{32}$/);
      sessionId = res.body.sessionId as string;
      sessionIds.push(sessionId);
    });

    it('GET /recommendations/:sessionId returns 200 with ranked clinics', async () => {
      const res = await agent().get(`/recommendations/${sessionId}`).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      matchDtos = res.body as ClinicMatchDto[];
    });

    it('results include at most 10 clinics', () => {
      expect(matchDtos.length).toBeLessThanOrEqual(10);
    });

    it('results include hormone clinics (vitality-hormone-nyc should appear)', () => {
      // At least one result expected — the seed has active hormone clinics
      expect(matchDtos.length).toBeGreaterThanOrEqual(1);
      const slugs = matchDtos.map((c) => c.slug);
      expect(slugs).toContain('vitality-hormone-nyc');
    });

    it('excludes overdue-billing clinic (balance-hormone-la)', () => {
      const slugs = matchDtos.map((c) => c.slug);
      expect(slugs).not.toContain('balance-hormone-la');
    });

    it('excludes non-active clinic (renew-peptide-seattle)', () => {
      const slugs = matchDtos.map((c) => c.slug);
      expect(slugs).not.toContain('renew-peptide-seattle');
    });

    it('results are sorted by score descending', () => {
      for (let i = 1; i < matchDtos.length; i++) {
        expect(matchDtos[i - 1].score).toBeGreaterThanOrEqual(matchDtos[i].score);
      }
    });

    it('each result has the required ClinicMatchDto fields', () => {
      for (const dto of matchDtos) {
        expect(typeof dto.clinicId).toBe('string');
        expect(typeof dto.slug).toBe('string');
        expect(typeof dto.name).toBe('string');
        expect(typeof dto.score).toBe('number');
        expect(typeof dto.location).toBe('string');
        expect(typeof dto.rating).toBe('number');
        expect(typeof dto.reviewCount).toBe('number');
        expect(Array.isArray(dto.topServices)).toBe(true);
        expect(Array.isArray(dto.categories)).toBe(true);
        expect(typeof dto.telehealthAvailable).toBe('boolean');
        expect(typeof dto.financingAvailable).toBe('boolean');
        expect(typeof dto.about).toBe('string');
        expect(typeof dto.providerName).toBe('string');
        expect(typeof dto.websiteUrl).toBe('string');
        // distanceMiles is number or null
        expect(dto.distanceMiles === null || typeof dto.distanceMiles === 'number').toBe(true);
      }
    });

    it('response contains NO PHI fields', () => {
      for (const dto of matchDtos) {
        const dtoStr = JSON.stringify(dto);
        for (const phi of PHI_FIELDS) {
          expect(dtoStr).not.toContain(`"${phi}"`);
        }
      }
    });
  });

  describe('error cases', () => {
    it('invalid sessionId format → 404', async () => {
      const res = await agent().get('/recommendations/not-a-valid-session').expect(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('valid format but non-existent sessionId → 404', async () => {
      const fakeSession = 'session_' + '0'.repeat(32);
      const res = await agent().get(`/recommendations/${fakeSession}`).expect(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
