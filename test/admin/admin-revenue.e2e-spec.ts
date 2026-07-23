/**
 * E2E tests for GET /admin/revenue/stats.
 *
 * Strategy: boot the full AppModule (mirrors test/admin/admin-clinics-read.e2e-spec.ts),
 * craft an admin token via JwtTokenService, and override STRIPE_PORT with a
 * FakeStripeAdapter (the billing module wires it even though this endpoint
 * never calls Stripe) so no test ever touches the network.
 *
 * Covers:
 *   - Admin token → 200 with the six numeric fields present and
 *     totalRevenueMtd === mrr + leadRevenueMtd.
 *   - Patient token → 403 (RolesGuard).
 *
 * No clinics/leads are seeded here. The shared local DB already has demo
 * clinics/leads, and asserting the shape + arithmetic invariant is enough to
 * cover the wiring without needing to snapshot/restore any state.
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

interface RevenueStatsDtoShape {
  mrr: number;
  leadRevenueMtd: number;
  totalRevenueMtd: number;
  activeClinicCount: number;
  overdueCount: number;
  leadsThisMonth: number;
}

interface ClinicRevenueRowDtoShape {
  clinicId: string;
  clinicName: string;
  leadsThisMonth: number;
  leadRevenue: number;
  monthlyFee: number;
  total: number;
  billingStatus: string;
}

describe('GET /admin/revenue/stats (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenServicePort;
  let adminToken: string;
  let patientToken: string;
  let csrfToken: string;

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  let adminUserId: string;
  let patientUserId: string;

  const unique = Date.now();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(new StubEmailSender())
      .overrideProvider(WEBHOOK_SENDER)
      .useValue(new StubWebhookSender())
      .overrideProvider(STORAGE_PORT)
      .useValue(mockStorage)
      .overrideProvider(STRIPE_PORT)
      .useValue(new FakeStripeAdapter())
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
      throw new Error('Seeded superadmin not found. Run pnpm seed:pj against the test DB first.');
    }
    adminUserId = adminRows[0]!.id;

    const patientEmail = `admin-revenue-e2e-patient-${unique.toString()}@test.example.com`;
    const patientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${patientEmail}::citext, 'test-hash') AS id
    `;
    patientUserId = patientRows[0]!.id;

    adminToken = tokenService.issue({ sub: adminUserId, role: 'superadmin' });
    patientToken = tokenService.issue({ sub: patientUserId, role: 'patient' });

    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
    expect(csrfToken).toBeTruthy();
  });

  afterAll(async () => {
    await seedPrisma.$executeRaw`DELETE FROM users WHERE id = ${patientUserId}::uuid`;
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());

  it('returns 200 with the six numeric fields and the correct arithmetic', async () => {
    const res = await agent()
      .get('/admin/revenue/stats')
      .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .expect(200);

    const body = res.body as RevenueStatsDtoShape;
    expect(typeof body.mrr).toBe('number');
    expect(typeof body.leadRevenueMtd).toBe('number');
    expect(typeof body.totalRevenueMtd).toBe('number');
    expect(typeof body.activeClinicCount).toBe('number');
    expect(typeof body.overdueCount).toBe('number');
    expect(typeof body.leadsThisMonth).toBe('number');
    expect(body.mrr).toBe(body.activeClinicCount * 49);
    expect(body.leadRevenueMtd).toBe(body.leadsThisMonth * 90);
    expect(body.totalRevenueMtd).toBe(body.mrr + body.leadRevenueMtd);
  });

  it('returns 403 when called with a patient token', async () => {
    await agent()
      .get('/admin/revenue/stats')
      .set('Cookie', `access_token=${patientToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .expect(403);
  });

  it('returns 401 when called with no token', async () => {
    await agent()
      .get('/admin/revenue/stats')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .expect(401);
  });
});

/**
 * E2E tests for GET /admin/revenue/clinics.
 *
 * Reuses the same app/token setup as the stats suite above. To assert the
 * fee-zeroed suspended/paused case deterministically, one seeded demo clinic
 * is flipped to billing_status = 'paused' for the duration of this suite and
 * restored to its original values afterwards, so the shared local DB ends
 * exactly at 6 clinics / 0 invoices with that clinic's original row intact.
 */
describe('GET /admin/revenue/clinics (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenServicePort;
  let adminToken: string;
  let patientToken: string;
  let csrfToken: string;

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  let adminUserId: string;
  let patientUserId: string;

  let flippedClinicId: string;
  let flippedClinicOriginalStatus: string;
  let flippedClinicOriginalBillingStatus: string;

  const unique = Date.now();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(new StubEmailSender())
      .overrideProvider(WEBHOOK_SENDER)
      .useValue(new StubWebhookSender())
      .overrideProvider(STORAGE_PORT)
      .useValue(mockStorage)
      .overrideProvider(STRIPE_PORT)
      .useValue(new FakeStripeAdapter())
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
      throw new Error('Seeded superadmin not found. Run pnpm seed:pj against the test DB first.');
    }
    adminUserId = adminRows[0]!.id;

    const patientEmail = `admin-revenue-clinics-e2e-patient-${unique.toString()}@test.example.com`;
    const patientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${patientEmail}::citext, 'test-hash') AS id
    `;
    patientUserId = patientRows[0]!.id;

    adminToken = tokenService.issue({ sub: adminUserId, role: 'superadmin' });
    patientToken = tokenService.issue({ sub: patientUserId, role: 'patient' });

    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
    expect(csrfToken).toBeTruthy();

    // Snapshot one seeded demo clinic, then flip it to billing_status =
    // 'paused' so this suite has a deterministic fee-zeroed row to assert on.
    const snapshotRows = await seedPrisma.$queryRaw<
      { id: string; status: string; billing_status: string }[]
    >`
      SELECT id, status, billing_status FROM clinics ORDER BY name ASC LIMIT 1
    `;
    const snapshot = snapshotRows[0];
    if (!snapshot) {
      throw new Error('No seeded clinics found. Run pnpm seed:pj against the test DB first.');
    }
    flippedClinicId = snapshot.id;
    flippedClinicOriginalStatus = snapshot.status;
    flippedClinicOriginalBillingStatus = snapshot.billing_status;

    await seedPrisma.$executeRaw`
      UPDATE clinics SET billing_status = 'paused' WHERE id = ${flippedClinicId}::uuid
    `;
  });

  afterAll(async () => {
    // Restore the flipped clinic's original values so the shared local DB
    // ends exactly as it started.
    await seedPrisma.$executeRaw`
      UPDATE clinics
         SET status = ${flippedClinicOriginalStatus},
             billing_status = ${flippedClinicOriginalBillingStatus}
       WHERE id = ${flippedClinicId}::uuid
    `;
    await seedPrisma.$executeRaw`DELETE FROM users WHERE id = ${patientUserId}::uuid`;
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());

  it('returns 200 with rows ordered by clinic name, correct arithmetic, and a fee-zeroed paused clinic', async () => {
    const res = await agent()
      .get('/admin/revenue/clinics')
      .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .expect(200);

    const rows = res.body as ClinicRevenueRowDtoShape[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);

    const names = rows.map((row) => row.clinicName);
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sortedNames);

    for (const row of rows) {
      expect(typeof row.clinicId).toBe('string');
      expect(typeof row.clinicName).toBe('string');
      expect(typeof row.leadsThisMonth).toBe('number');
      expect(typeof row.leadRevenue).toBe('number');
      expect(typeof row.monthlyFee).toBe('number');
      expect(typeof row.total).toBe('number');
      expect(typeof row.billingStatus).toBe('string');
      expect(row.leadRevenue).toBe(row.leadsThisMonth * 90);
      expect(row.total).toBe(row.leadRevenue + row.monthlyFee);
    }

    const flippedRow = rows.find((row) => row.clinicId === flippedClinicId);
    expect(flippedRow).toBeDefined();
    expect(flippedRow!.monthlyFee).toBe(0);
    expect(flippedRow!.billingStatus).toBe('paused');
  });

  it('returns 403 when called with a patient token', async () => {
    await agent()
      .get('/admin/revenue/clinics')
      .set('Cookie', `access_token=${patientToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .expect(403);
  });

  it('returns 401 when called with no token', async () => {
    await agent()
      .get('/admin/revenue/clinics')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .expect(401);
  });
});
