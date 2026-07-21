/**
 * e2e for GET /clinic/portal/billing.
 *
 * Covers:
 *   1. Signin + 2FA for a seeded clinic user, then 200 with the expected shape
 *      (the seeded clinic has no billing profile yet, so profile fields are
 *      null and currentPeriodLeadCount is a number).
 *   2. Security: a signed-in patient gets 403.
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
import { STRIPE_PORT } from '../../src/modules/billing/domain/ports/stripe.port';
import { FakeStripeAdapter } from '../../src/modules/billing/infrastructure/adapters/fake-stripe.adapter';
import { SEEDED_CLINIC_USERS, seedPatientJourney } from '../../prisma/seed/patient-journey.seed';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

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

describe('GET /clinic/portal/billing (e2e)', () => {
  let app: INestApplication;
  let csrfToken: string;
  let clinicCookie: string;
  let patientCookie: string;

  const emailSender = new CapturingEmailSender();
  const fakeStripe = new FakeStripeAdapter();
  const clinicUser = SEEDED_CLINIC_USERS[0]!; // vitality-hormone-nyc

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  beforeAll(async () => {
    await seedPatientJourney(seedPrisma);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(emailSender)
      .overrideProvider(STRIPE_PORT)
      .useValue(fakeStripe)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    // Acquire CSRF token
    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;

    // --- Sign in as clinic user ---
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

    // --- Sign in as a patient for the 403 test ---
    const patientEmail = `e2e-billing-patient-${Date.now()}@example.com`;
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
    await seedPatientJourney(seedPrisma);
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  it('returns the billing info for the authenticated clinic', async () => {
    const res = await supertest(app.getHttpServer())
      .get('/clinic/portal/billing')
      .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
      .expect(200);

    expect(res.body).toMatchObject({
      billingEmail: null,
      billingContactName: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      stateCode: null,
      zipCode: null,
      taxId: null,
      subscriptionCancelledAt: null,
      subscriptionActiveThrough: null,
    });
    expect(typeof res.body.currentPeriodLeadCount).toBe('number');
    expect(typeof res.body.estimatedPlatformFee).toBe('number');
    expect(typeof res.body.promoMonthsRemaining).toBe('number');
  });

  it('rejects a non-clinic (patient) caller with 403', async () => {
    await supertest(app.getHttpServer())
      .get('/clinic/portal/billing')
      .set('Cookie', [`access_token=${patientCookie}`, `csrf_token=${csrfToken}`])
      .expect(403);
  });
});
