/**
 * e2e for POST /stripe/webhook (spec §5).
 *
 * Covers:
 *   1. `invoice.paid` for a known invoice: invoice -> paid, clinic
 *      billing_status -> current.
 *   2. `invoice.paid` reinstate rule: a clinic suspended for
 *      `overdue_payment` (not cancelled) is reinstated (active,
 *      notify_on_lead=true, suspension_reason cleared).
 *   3. `invoice.paid` reinstate guard: a clinic whose subscription is
 *      cancelled is NEVER reinstated, even if suspended for overdue_payment.
 *   4. `invoice.payment_failed` for a known invoice: invoice -> overdue,
 *      clinic billing_status -> overdue.
 *   5. An unknown `stripe_invoice_id` is a no-op, still 200.
 *   6. A bad signature -> 400, and the handler is never invoked (the
 *      referenced invoice is left untouched).
 *
 * The webhook is `@Public()` and CSRF-excluded (no cookies/tokens needed).
 * This is Stripe calling us directly, so the test app is bootstrapped with
 * `rawBody: true` (mirrors `main.ts`) and the real signature verifier is
 * swapped for `FakeStripeWebhookVerifier` (trusts the JSON body) except in
 * the dedicated bad-signature test.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import supertest = require('supertest');
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/infrastructure/security/all-exceptions.filter';
import { STRIPE_PORT } from '../../src/modules/billing/domain/ports/stripe.port';
import { FakeStripeAdapter } from '../../src/modules/billing/infrastructure/adapters/fake-stripe.adapter';
import { STRIPE_WEBHOOK_VERIFIER } from '../../src/modules/billing/domain/ports/stripe-webhook-verifier.port';
import type { StripeWebhookVerifier } from '../../src/modules/billing/domain/ports/stripe-webhook-verifier.port';
import { FakeStripeWebhookVerifier } from '../../src/modules/billing/infrastructure/adapters/stripe-webhook-verifier.adapter';
import { seedPatientJourney } from '../../prisma/seed/patient-journey.seed';
import { PrismaClient } from '../../generated/prisma/client';

describe('POST /stripe/webhook (e2e)', () => {
  let app: INestApplication;

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  const touchedSlugs = new Set<string>();
  const createdInvoiceIds: string[] = [];

  async function findClinic(slug: string) {
    touchedSlugs.add(slug);
    return seedPrisma.clinic.findUniqueOrThrow({ where: { slug } });
  }

  async function findInvoiceByStripeId(stripeInvoiceId: string) {
    return seedPrisma.invoice.findFirstOrThrow({ where: { stripeInvoiceId } });
  }

  async function createOpenInvoice(clinicId: string, stripeInvoiceId: string) {
    const now = new Date();
    const row = await seedPrisma.invoice.create({
      data: {
        clinicId,
        stripeInvoiceId,
        periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        leadCount: 5,
        pricePerLead: 90,
        platformFee: 49,
        totalAmount: 499,
        status: 'open',
        dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        invoiceUrl: null,
        pdfUrl: null,
      },
    });
    createdInvoiceIds.push(row.id);
    return row;
  }

  /** Reset every clinic this suite mutated back to the seed baseline. */
  async function resetTouchedClinics(): Promise<void> {
    await seedPatientJourney(seedPrisma);
    if (touchedSlugs.size > 0) {
      const clinics = await seedPrisma.clinic.findMany({
        where: { slug: { in: [...touchedSlugs] } },
      });
      await Promise.all(
        clinics.map((c) =>
          seedPrisma.clinic.update({
            where: { id: c.id },
            data: { subscriptionCancelledAt: null },
          }),
        ),
      );
    }
  }

  beforeAll(async () => {
    await seedPatientJourney(seedPrisma);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STRIPE_PORT)
      .useValue(new FakeStripeAdapter())
      .overrideProvider(STRIPE_WEBHOOK_VERIFIER)
      .useValue(new FakeStripeWebhookVerifier())
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    if (createdInvoiceIds.length > 0) {
      await seedPrisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    await resetTouchedClinics();
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  it('marks a known invoice paid and the clinic billing_status current', async () => {
    const clinic = await findClinic('thrive-wellness-chicago');
    const stripeInvoiceId = `in_e2e_paid_${Date.now()}`;
    await createOpenInvoice(clinic.id, stripeInvoiceId);

    const res = await supertest(app.getHttpServer())
      .post('/stripe/webhook')
      .set('stripe-signature', 'fake-sig')
      .send({ type: 'invoice.paid', data: { object: { id: stripeInvoiceId } } })
      .expect(200);

    expect(res.body).toEqual({ received: true });

    const invoice = await findInvoiceByStripeId(stripeInvoiceId);
    expect(invoice.status).toBe('paid');
    expect(invoice.paidAt).not.toBeNull();

    const clinicAfter = await seedPrisma.clinic.findUniqueOrThrow({ where: { id: clinic.id } });
    expect(clinicAfter.billingStatus).toBe('current');
  });

  it('reinstates a clinic suspended for overdue_payment (not cancelled) on invoice.paid', async () => {
    const clinic = await findClinic('balance-hormone-la');
    await seedPrisma.clinic.update({
      where: { id: clinic.id },
      data: {
        status: 'suspended',
        suspensionReason: 'overdue_payment',
        notifyOnLead: false,
        billingStatus: 'overdue',
        subscriptionCancelledAt: null,
      },
    });

    const stripeInvoiceId = `in_e2e_reinstate_${Date.now()}`;
    await createOpenInvoice(clinic.id, stripeInvoiceId);

    const res = await supertest(app.getHttpServer())
      .post('/stripe/webhook')
      .set('stripe-signature', 'fake-sig')
      .send({ type: 'invoice.paid', data: { object: { id: stripeInvoiceId } } })
      .expect(200);
    expect(res.body).toEqual({ received: true });

    const invoice = await findInvoiceByStripeId(stripeInvoiceId);
    expect(invoice.status).toBe('paid');

    const clinicAfter = await seedPrisma.clinic.findUniqueOrThrow({ where: { id: clinic.id } });
    expect(clinicAfter.billingStatus).toBe('current');
    expect(clinicAfter.status).toBe('active');
    expect(clinicAfter.suspensionReason).toBeNull();
    expect(clinicAfter.notifyOnLead).toBe(true);
  });

  it('does NOT reinstate a clinic whose subscription is cancelled, even if suspended for overdue_payment', async () => {
    const clinic = await findClinic('renew-peptide-seattle');
    await seedPrisma.clinic.update({
      where: { id: clinic.id },
      data: {
        status: 'suspended',
        suspensionReason: 'overdue_payment',
        notifyOnLead: false,
        billingStatus: 'overdue',
        subscriptionCancelledAt: new Date(),
      },
    });

    const stripeInvoiceId = `in_e2e_cancelled_${Date.now()}`;
    await createOpenInvoice(clinic.id, stripeInvoiceId);

    const res = await supertest(app.getHttpServer())
      .post('/stripe/webhook')
      .set('stripe-signature', 'fake-sig')
      .send({ type: 'invoice.paid', data: { object: { id: stripeInvoiceId } } })
      .expect(200);
    expect(res.body).toEqual({ received: true });

    // The invoice/billing_status update always runs...
    const invoice = await findInvoiceByStripeId(stripeInvoiceId);
    expect(invoice.status).toBe('paid');
    const clinicAfter = await seedPrisma.clinic.findUniqueOrThrow({ where: { id: clinic.id } });
    expect(clinicAfter.billingStatus).toBe('current');

    // ...but the reinstate is guarded off: a cancelled clinic stays suspended.
    expect(clinicAfter.status).toBe('suspended');
    expect(clinicAfter.suspensionReason).toBe('overdue_payment');
    expect(clinicAfter.notifyOnLead).toBe(false);
  });

  it('marks a known invoice overdue and the clinic billing_status overdue on invoice.payment_failed', async () => {
    const clinic = await findClinic('glow-med-spa-miami');
    const stripeInvoiceId = `in_e2e_failed_${Date.now()}`;
    await createOpenInvoice(clinic.id, stripeInvoiceId);

    const res = await supertest(app.getHttpServer())
      .post('/stripe/webhook')
      .set('stripe-signature', 'fake-sig')
      .send({ type: 'invoice.payment_failed', data: { object: { id: stripeInvoiceId } } })
      .expect(200);
    expect(res.body).toEqual({ received: true });

    const invoice = await findInvoiceByStripeId(stripeInvoiceId);
    expect(invoice.status).toBe('overdue');

    const clinicAfter = await seedPrisma.clinic.findUniqueOrThrow({ where: { id: clinic.id } });
    expect(clinicAfter.billingStatus).toBe('overdue');
  });

  it('no-ops with 200 for an unknown stripe_invoice_id', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/stripe/webhook')
      .set('stripe-signature', 'fake-sig')
      .send({ type: 'invoice.paid', data: { object: { id: 'in_does_not_exist_e2e' } } })
      .expect(200);

    expect(res.body).toEqual({ received: true });
    const invoice = await seedPrisma.invoice.findFirst({
      where: { stripeInvoiceId: 'in_does_not_exist_e2e' },
    });
    expect(invoice).toBeNull();
  });

  it('returns 200 and does nothing for an event type it does not handle', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/stripe/webhook')
      .set('stripe-signature', 'fake-sig')
      .send({ type: 'customer.updated', data: { object: { id: 'cus_1' } } })
      .expect(200);
    expect(res.body).toEqual({ received: true });
  });

  describe('bad signature', () => {
    let badSigApp: INestApplication;
    const throwingVerifier: StripeWebhookVerifier = {
      constructEvent: () => {
        throw new Error('signature mismatch');
      },
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(STRIPE_PORT)
        .useValue(new FakeStripeAdapter())
        .overrideProvider(STRIPE_WEBHOOK_VERIFIER)
        .useValue(throwingVerifier)
        .compile();

      badSigApp = moduleRef.createNestApplication({ rawBody: true });
      badSigApp.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
      );
      badSigApp.useGlobalFilters(new AllExceptionsFilter());
      await badSigApp.init();
    });

    afterAll(async () => {
      await badSigApp.close();
    });

    it('rejects a bad signature with 400 and never invokes the handler', async () => {
      const clinic = await findClinic('vitality-hormone-nyc');
      const stripeInvoiceId = `in_e2e_badsig_${Date.now()}`;
      await createOpenInvoice(clinic.id, stripeInvoiceId);

      await supertest(badSigApp.getHttpServer())
        .post('/stripe/webhook')
        .set('stripe-signature', 'bad-sig')
        .send({ type: 'invoice.paid', data: { object: { id: stripeInvoiceId } } })
        .expect(400);

      // The handler must never have run: the invoice is untouched.
      const invoice = await findInvoiceByStripeId(stripeInvoiceId);
      expect(invoice.status).toBe('open');
      expect(invoice.paidAt).toBeNull();
    });
  });
});
