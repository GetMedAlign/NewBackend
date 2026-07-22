/**
 * E2E for POST /admin/jobs/run/:jobName (spec §2).
 *
 * Covers:
 *   - Correct X-Job-Secret (from test/.env.test = job_secret_fake) triggering
 *     `invoice-generation` -> 200 with a JobResult (`job: 'invoice-generation'`),
 *     plus an audit_log row (action_type='job_triggered',
 *     affected_record='invoice-generation').
 *   - No X-Job-Secret header -> 401.
 *   - Wrong X-Job-Secret -> 401.
 *   - Unknown jobName with the correct secret -> 400.
 *
 * The route is `@Public()` (bypasses the JWT cookie guard) and CSRF-excluded
 * (see app.module.ts), so no cookies/CSRF token are needed here — only the
 * shared secret header.
 *
 * STRIPE_PORT is overridden with FakeStripeAdapter so triggering
 * invoice-generation never touches the real Stripe network. The demo-seeded
 * clinics all have a NULL stripe_customer_id (see
 * test/billing/invoice-generation.int-spec.ts), so listInvoiceEligibleClinics
 * excludes them and the real run below is expected to process 0 clinics —
 * but this suite still snapshots/restores clinic state and deletes any
 * invoice rows the run happens to create, defensively mirroring the prior
 * job specs, so the shared local DB is left exactly as found either way.
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
import { PrismaClient } from '../../generated/prisma/client';

const CORRECT_SECRET = 'job_secret_fake'; // from test/.env.test JOB_TRIGGER_SECRET

interface AuditRow {
  actor_user_id: string | null;
  actor_role: string;
  action_type: string;
  affected_record: string;
}

interface InvoiceIdRow {
  id: string;
}

describe('POST /admin/jobs/run/:jobName (e2e)', () => {
  let app: INestApplication;

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  // Defensive snapshot/restore (see file doc comment): every clinic's
  // stripe_customer_id and the full set of invoice ids before this suite
  // runs, so anything the job's eligibility query sweeps in is undone.
  let preExistingCustomerIds: { id: string; stripe_customer_id: string | null }[] = [];
  let preExistingInvoiceIds: Set<string> = new Set();

  beforeAll(async () => {
    preExistingCustomerIds = await seedPrisma.$queryRaw<
      { id: string; stripe_customer_id: string | null }[]
    >`SELECT id, stripe_customer_id FROM clinics`;
    const invoiceRows = await seedPrisma.$queryRaw<InvoiceIdRow[]>`SELECT id FROM invoices`;
    preExistingInvoiceIds = new Set(invoiceRows.map((r) => r.id));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STRIPE_PORT)
      .useValue(new FakeStripeAdapter())
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    // Undo anything the invoice-generation run happened to write.
    const invoiceRowsAfter = await seedPrisma.$queryRaw<InvoiceIdRow[]>`SELECT id FROM invoices`;
    const newInvoiceIds = invoiceRowsAfter
      .map((r) => r.id)
      .filter((id) => !preExistingInvoiceIds.has(id));
    if (newInvoiceIds.length > 0) {
      await seedPrisma.$executeRaw`DELETE FROM invoices WHERE id = ANY(${newInvoiceIds}::uuid[])`;
    }
    for (const row of preExistingCustomerIds) {
      await seedPrisma.$executeRaw`
        UPDATE clinics SET stripe_customer_id = ${row.stripe_customer_id} WHERE id = ${row.id}::uuid
      `;
    }

    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  it('triggers invoice-generation with the correct secret: 200 + JobResult + audit_log row', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/admin/jobs/run/invoice-generation')
      .set('X-Job-Secret', CORRECT_SECRET)
      .expect(200);

    expect(res.body).toMatchObject({ job: 'invoice-generation' });
    expect(typeof res.body.processed).toBe('number');
    expect(typeof res.body.failed).toBe('number');

    const auditRows = await seedPrisma.$queryRaw<AuditRow[]>`
      SELECT actor_user_id, actor_role, action_type, affected_record
      FROM audit_log
      WHERE action_type = 'job_triggered' AND affected_record = 'invoice-generation'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actor_user_id).toBeNull();
    expect(auditRows[0]!.actor_role).toBe('system');
    expect(auditRows[0]!.affected_record).toBe('invoice-generation');
  });

  it('triggers account-suspension with the correct secret: 200 + JobResult + audit_log row', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/admin/jobs/run/account-suspension')
      .set('X-Job-Secret', CORRECT_SECRET)
      .expect(200);

    expect(res.body).toMatchObject({ job: 'account-suspension' });
    expect(typeof res.body.processed).toBe('number');
    expect(typeof res.body.failed).toBe('number');

    const auditRows = await seedPrisma.$queryRaw<AuditRow[]>`
      SELECT actor_user_id, actor_role, action_type, affected_record
      FROM audit_log
      WHERE action_type = 'job_triggered' AND affected_record = 'account-suspension'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actor_user_id).toBeNull();
    expect(auditRows[0]!.actor_role).toBe('system');
    expect(auditRows[0]!.affected_record).toBe('account-suspension');
  });

  it('rejects with 401 when the X-Job-Secret header is missing', async () => {
    await supertest(app.getHttpServer()).post('/admin/jobs/run/invoice-generation').expect(401);
  });

  it('rejects with 401 for a wrong X-Job-Secret', async () => {
    await supertest(app.getHttpServer())
      .post('/admin/jobs/run/invoice-generation')
      .set('X-Job-Secret', 'wrong-secret')
      .expect(401);
  });

  it('rejects with 400 for an unknown jobName, even with the correct secret', async () => {
    await supertest(app.getHttpServer())
      .post('/admin/jobs/run/nope')
      .set('X-Job-Secret', CORRECT_SECRET)
      .expect(400);
  });
});
