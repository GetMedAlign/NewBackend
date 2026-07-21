/**
 * e2e for GET and PUT /clinic/portal/billing.
 *
 * Covers:
 *   1. Signin + 2FA for a seeded clinic user, then 200 with the expected shape
 *      (the seeded clinic has no billing profile yet, so profile fields are
 *      null and currentPeriodLeadCount is a number).
 *   2. Security: a signed-in patient gets 403.
 *   3. PUT partial-update semantics: only the fields sent are written; a
 *      GET afterwards shows unnamed fields still null.
 *   4. PUT billing-email sync: when the clinic has a Stripe customer id, a
 *      changed billingEmail is synced to the (fake) Stripe adapter; the
 *      fake never touches the network.
 *   5. Security: PUT is also 403 for a non-clinic caller.
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

  /**
   * `seedPatientJourney` upserts clinics but never touches `stripe_customer_id`
   * or `billing_profiles` (those columns/table postdate the original seed and
   * this PUT test is the first writer of them), so leftover state from a
   * previous run of this suite would otherwise leak into the next one. Reset
   * both explicitly, independent of the shared seed helper.
   */
  async function resetBillingState(clinicId: string): Promise<void> {
    await seedPrisma.billingProfile.deleteMany({ where: { clinicId } });
    await seedPrisma.clinic.update({ where: { id: clinicId }, data: { stripeCustomerId: null } });
  }

  beforeAll(async () => {
    await seedPatientJourney(seedPrisma);

    const vitalityClinic = await seedPrisma.clinic.findUniqueOrThrow({
      where: { slug: clinicUser.clinicSlug },
    });
    await resetBillingState(vitalityClinic.id);

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
    const vitalityClinic = await seedPrisma.clinic.findUniqueOrThrow({
      where: { slug: clinicUser.clinicSlug },
    });
    await resetBillingState(vitalityClinic.id);
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

  it('rejects a non-clinic (patient) caller on PUT with 403', async () => {
    await supertest(app.getHttpServer())
      .put('/clinic/portal/billing')
      .set('Cookie', [`access_token=${patientCookie}`, `csrf_token=${csrfToken}`])
      .set('x-csrf-token', csrfToken)
      .send({ billingContactName: 'Nope' })
      .expect(403);
  });

  it('upserts only the fields sent, leaving the rest untouched', async () => {
    await supertest(app.getHttpServer())
      .put('/clinic/portal/billing')
      .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
      .set('x-csrf-token', csrfToken)
      .send({ billingContactName: 'Dana Vitality', city: 'Austin' })
      .expect(200, { success: true });

    const res = await supertest(app.getHttpServer())
      .get('/clinic/portal/billing')
      .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
      .expect(200);

    expect(res.body).toMatchObject({
      billingContactName: 'Dana Vitality',
      city: 'Austin',
      billingEmail: null,
      addressLine1: null,
      addressLine2: null,
      stateCode: null,
      zipCode: null,
      taxId: null,
    });
  });

  it('syncs a changed billing email to Stripe (best-effort, no network)', async () => {
    const clinic = await seedPrisma.clinic.findUniqueOrThrow({
      where: { slug: clinicUser.clinicSlug },
    });
    const stripeCustomerId = await fakeStripe.createCustomer(
      clinic.name,
      'old-billing@vitality.test',
      clinic.id,
    );
    await seedPrisma.clinic.update({
      where: { id: clinic.id },
      data: { stripeCustomerId },
    });

    await supertest(app.getHttpServer())
      .put('/clinic/portal/billing')
      .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
      .set('x-csrf-token', csrfToken)
      .send({ billingEmail: 'new-billing@vitality.test' })
      .expect(200, { success: true });

    expect(fakeStripe.emailFor(stripeCustomerId)).toBe('new-billing@vitality.test');

    const res = await supertest(app.getHttpServer())
      .get('/clinic/portal/billing')
      .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
      .expect(200);
    expect(res.body.billingEmail).toBe('new-billing@vitality.test');

    // A repeat PUT with the same email must not call Stripe again (unchanged
    // email), and still succeeds.
    await supertest(app.getHttpServer())
      .put('/clinic/portal/billing')
      .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
      .set('x-csrf-token', csrfToken)
      .send({ billingEmail: 'new-billing@vitality.test' })
      .expect(200, { success: true });
  });

  it('treats an explicit null the same as absent: it does not overwrite the column', async () => {
    await supertest(app.getHttpServer())
      .put('/clinic/portal/billing')
      .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
      .set('x-csrf-token', csrfToken)
      .send({ billingContactName: 'Keep Me' })
      .expect(200, { success: true });

    await supertest(app.getHttpServer())
      .put('/clinic/portal/billing')
      .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
      .set('x-csrf-token', csrfToken)
      .send({ billingContactName: null })
      .expect(200, { success: true });

    const res = await supertest(app.getHttpServer())
      .get('/clinic/portal/billing')
      .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
      .expect(200);

    expect(res.body.billingContactName).toBe('Keep Me');
  });

  describe('GET/POST/DELETE /clinic/portal/payment-method', () => {
    it('runs the full card lifecycle against the fake Stripe adapter', async () => {
      const clinic = await seedPrisma.clinic.findUniqueOrThrow({
        where: { slug: clinicUser.clinicSlug },
      });
      const stripeCustomerId = await fakeStripe.createCustomer(
        clinic.name,
        'pm-lifecycle@vitality.test',
        clinic.id,
      );
      await seedPrisma.clinic.update({
        where: { id: clinic.id },
        data: { stripeCustomerId, billingStatus: 'no_card' },
      });

      // No card yet.
      const beforeRes = await supertest(app.getHttpServer())
        .get('/clinic/portal/payment-method')
        .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
        .expect(200);
      expect(JSON.parse(beforeRes.text)).toBeNull();

      // Attach a card; billing_status flips no_card -> current.
      const postRes = await supertest(app.getHttpServer())
        .post('/clinic/portal/payment-method')
        .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
        .set('x-csrf-token', csrfToken)
        .send({ paymentMethodId: 'pm_visa' })
        .expect(200);

      expect(Object.keys(postRes.body).sort()).toEqual([
        'brand',
        'exp_month',
        'exp_year',
        'last4',
        'stripePaymentMethodId',
      ]);
      expect(postRes.body).toEqual({
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2030,
        stripePaymentMethodId: 'pm_visa',
      });

      const clinicAfterPost = await seedPrisma.clinic.findUniqueOrThrow({
        where: { id: clinic.id },
      });
      expect(clinicAfterPost.billingStatus).toBe('current');

      // A second GET now returns the same card.
      const afterAttachRes = await supertest(app.getHttpServer())
        .get('/clinic/portal/payment-method')
        .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
        .expect(200);
      expect(afterAttachRes.body).toEqual({
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2030,
        stripePaymentMethodId: 'pm_visa',
      });

      // Remove it; billing_status flips back to no_card.
      await supertest(app.getHttpServer())
        .delete('/clinic/portal/payment-method')
        .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
        .set('x-csrf-token', csrfToken)
        .expect(200, { success: true });

      const clinicAfterDelete = await seedPrisma.clinic.findUniqueOrThrow({
        where: { id: clinic.id },
      });
      expect(clinicAfterDelete.billingStatus).toBe('no_card');

      const afterDeleteRes = await supertest(app.getHttpServer())
        .get('/clinic/portal/payment-method')
        .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
        .expect(200);
      expect(JSON.parse(afterDeleteRes.text)).toBeNull();
    });

    it('rejects POST with 422 when the clinic has no Stripe customer', async () => {
      const clinic = await seedPrisma.clinic.findUniqueOrThrow({
        where: { slug: clinicUser.clinicSlug },
      });
      await seedPrisma.clinic.update({
        where: { id: clinic.id },
        data: { stripeCustomerId: null },
      });

      const res = await supertest(app.getHttpServer())
        .post('/clinic/portal/payment-method')
        .set('Cookie', [`access_token=${clinicCookie}`, `csrf_token=${csrfToken}`])
        .set('x-csrf-token', csrfToken)
        .send({ paymentMethodId: 'pm_visa' })
        .expect(422);

      expect(res.body.error.message).toBe(
        'No Stripe customer found for this clinic. Contact support.',
      );
    });

    it('rejects a non-clinic (patient) caller with 403 on every payment-method route', async () => {
      await supertest(app.getHttpServer())
        .get('/clinic/portal/payment-method')
        .set('Cookie', [`access_token=${patientCookie}`, `csrf_token=${csrfToken}`])
        .expect(403);

      await supertest(app.getHttpServer())
        .post('/clinic/portal/payment-method')
        .set('Cookie', [`access_token=${patientCookie}`, `csrf_token=${csrfToken}`])
        .set('x-csrf-token', csrfToken)
        .send({ paymentMethodId: 'pm_visa' })
        .expect(403);

      await supertest(app.getHttpServer())
        .delete('/clinic/portal/payment-method')
        .set('Cookie', [`access_token=${patientCookie}`, `csrf_token=${csrfToken}`])
        .set('x-csrf-token', csrfToken)
        .expect(403);
    });
  });
});
