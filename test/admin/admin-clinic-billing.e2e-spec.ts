/**
 * E2E tests for GET /admin/clinics/:id/billing.
 *
 * Strategy: boot the full AppModule (mirrors test/admin/admin-clinics-read.e2e-spec.ts),
 * craft an admin token via JwtTokenService, and override STRIPE_PORT with a
 * FakeStripeAdapter so the live card read never touches the network.
 *
 * Covers:
 *   - Admin token → 200 with monthlyFee 49, pricePerLead 90, and an empty
 *     invoices array for a clinic with no Stripe customer.
 *   - Admin token → the same clinic, once given a stripe_customer_id with an
 *     attached fake card, returns the live cardBrand/cardLast4/etc.
 *   - Admin token → unknown but well-formed uuid → 404 "Clinic not found."
 *   - Patient token → 403 (RolesGuard).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import supertest = require('supertest');

import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/infrastructure/security/all-exceptions.filter';
import { EMAIL_SENDER } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';
import type { EmailSenderPort } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';
import { WEBHOOK_SENDER } from '../../src/modules/leads/domain/ports/webhook-sender.port';
import type {
  WebhookSenderPort,
  WebhookSendResult,
} from '../../src/modules/leads/domain/ports/webhook-sender.port';
import { STORAGE_PORT } from '../../src/modules/clinic-media/domain/ports/storage.port';
import type { StoragePort } from '../../src/modules/clinic-media/domain/ports/storage.port';
import { TOKEN_SERVICE } from '../../src/modules/auth/domain/ports/token-service.port';
import type { TokenServicePort } from '../../src/modules/auth/domain/ports/token-service.port';
import { STRIPE_PORT } from '../../src/modules/billing/domain/ports/stripe.port';
import { FakeStripeAdapter } from '../../src/modules/billing/infrastructure/adapters/fake-stripe.adapter';

class StubEmailSender implements EmailSenderPort {
  async send(): Promise<void> {}
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
  pathFromPublicUrl: () => null,
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

interface AdminClinicBillingInfoShape {
  stripeCustomerId: string | null;
  billingEmail: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  monthlyFee: number;
  pricePerLead: number;
  deliveryPaused: boolean;
}

interface AdminClinicBillingDtoShape {
  info: AdminClinicBillingInfoShape;
  invoices: unknown[];
}

describe('GET /admin/clinics/:id/billing (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenServicePort;
  let adminToken: string;
  let patientToken: string;
  let csrfToken: string;
  const fakeStripe = new FakeStripeAdapter();

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  let adminUserId: string;
  let patientUserId: string;

  const unique = Date.now();
  const clinicName = `E2E Billing Admin Clinic ${unique.toString()}`;
  let clinicId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(new StubEmailSender())
      .overrideProvider(WEBHOOK_SENDER)
      .useValue(new StubWebhookSender())
      .overrideProvider(STORAGE_PORT)
      .useValue(mockStorage)
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

    tokenService = moduleRef.get<TokenServicePort>(TOKEN_SERVICE);

    const adminRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.email = 'superadmin@medalign-seed.example.com'::citext
        AND ur.role = 'superadmin'
      LIMIT 1
    `;
    if (adminRows.length === 0) {
      throw new Error('Seeded superadmin not found — run pnpm seed:pj against the test DB first.');
    }
    adminUserId = adminRows[0]!.id;

    const patientEmail = `admin-clinic-billing-e2e-patient-${unique.toString()}@test.example.com`;
    const patientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${patientEmail}::citext, 'test-hash') AS id
    `;
    patientUserId = patientRows[0]!.id;

    adminToken = tokenService.issue({ sub: adminUserId, role: 'superadmin' });
    patientToken = tokenService.issue({ sub: patientUserId, role: 'patient' });

    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
    expect(csrfToken).toBeTruthy();

    const clinic = await seedPrisma.clinic.create({
      data: {
        slug: `e2e-admin-billing-clinic-${unique.toString()}`,
        name: clinicName,
        rating: 0,
        reviewCount: 0,
        telehealthAvailable: false,
        financingAvailable: false,
        acceptsInsurance: false,
        status: 'active',
        billingStatus: 'no_card',
        notifyOnLead: false,
      },
      select: { id: true },
    });
    clinicId = clinic.id;
  });

  afterAll(async () => {
    await seedPrisma.$executeRaw`DELETE FROM billing_profiles WHERE clinic_id = ${clinicId}::uuid`;
    await seedPrisma.$executeRaw`DELETE FROM clinics WHERE id = ${clinicId}::uuid`;
    await seedPrisma.$executeRaw`DELETE FROM users WHERE id = ${patientUserId}::uuid`;
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());

  it('returns 200 with the fee constants and an empty invoices array when there is no Stripe customer', async () => {
    const res = await agent()
      .get(`/admin/clinics/${clinicId}/billing`)
      .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .expect(200);

    const body = res.body as AdminClinicBillingDtoShape;
    expect(body.info).toEqual({
      stripeCustomerId: null,
      billingEmail: null,
      cardBrand: null,
      cardLast4: null,
      cardExpMonth: null,
      cardExpYear: null,
      monthlyFee: 49,
      pricePerLead: 90,
      deliveryPaused: false,
    });
    expect(body.invoices).toEqual([]);
  });

  it('reads the live card once the clinic has a Stripe customer with an attached card', async () => {
    const stripeCustomerId = await fakeStripe.createCustomer(
      clinicName,
      'billing@e2e-admin.test',
      clinicId,
    );
    await fakeStripe.attachPaymentMethod(stripeCustomerId, 'pm_admin_e2e');
    await seedPrisma.clinic.update({
      where: { id: clinicId },
      data: { stripeCustomerId, status: 'paused' },
    });

    const res = await agent()
      .get(`/admin/clinics/${clinicId}/billing`)
      .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .expect(200);

    const body = res.body as AdminClinicBillingDtoShape;
    expect(body.info).toEqual({
      stripeCustomerId,
      billingEmail: null,
      cardBrand: 'visa',
      cardLast4: '4242',
      cardExpMonth: 12,
      cardExpYear: 2030,
      monthlyFee: 49,
      pricePerLead: 90,
      deliveryPaused: true,
    });
    expect(body.invoices).toEqual([]);
  });

  it('returns 404 with "Clinic not found." for an unknown but well-formed uuid', async () => {
    const res = await agent()
      .get('/admin/clinics/00000000-0000-0000-0000-000000000000/billing')
      .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .expect(404);

    const body = res.body as { error: { message: string } };
    expect(body.error.message).toBe('Clinic not found.');
  });

  it('returns 400 for a malformed id', async () => {
    await agent()
      .get('/admin/clinics/not-a-uuid/billing')
      .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .expect(400);
  });

  it('returns 403 when called with a patient token', async () => {
    await agent()
      .get(`/admin/clinics/${clinicId}/billing`)
      .set('Cookie', `access_token=${patientToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .expect(403);
  });

  it('returns 401 when called with no token', async () => {
    await agent()
      .get(`/admin/clinics/${clinicId}/billing`)
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .expect(401);
  });
});
