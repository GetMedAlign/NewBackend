/**
 * Integration test for `GenerateInvoicesJob` (spec §3) against a live local
 * Postgres (DATABASE_URL from test/.env.test), using the real
 * `PrismaBillingRepository`, a `FakeStripeAdapter` (never the real Stripe
 * network), and a recording stub email sender.
 *
 * Seeds its own fixture clinics/leads (deleted in afterAll) rather than
 * relying on the 6 demo-seeded clinics. Those demo clinics currently all have
 * a NULL stripe_customer_id, so `listInvoiceEligibleClinics` excludes them —
 * but as a defensive snapshot/restore (mirroring
 * test/db/billing-backfill.int-spec.ts), this suite records each clinic's
 * stripe_customer_id before running and restores any that the job's
 * eligibility query happened to sweep in, so the shared local DB is left
 * exactly as found either way.
 */
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaBillingRepository } from '../../src/modules/billing/infrastructure/prisma-billing.repository';
import { FakeStripeAdapter } from '../../src/modules/billing/infrastructure/adapters/fake-stripe.adapter';
import { GenerateInvoicesJob } from '../../src/modules/billing/application/generate-invoices.job';
import { computeInvoiceAmounts } from '../../src/modules/billing/domain/invoice-amounts';
import type { EmailSenderPort } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';

class RecordingEmailSender implements EmailSenderPort {
  readonly sent: Array<{ to: string; subject: string; body: string }> = [];

  async send(to: string, subject: string, body: string): Promise<void> {
    this.sent.push({ to, subject, body });
  }
}

type InvoiceRow = {
  id: string;
  clinic_id: string;
  status: string;
  lead_count: number;
  total_amount: string;
  due_date: Date;
  period_start: Date;
  period_end: Date;
};

describe('GenerateInvoicesJob (integration)', () => {
  let service: PrismaService;
  let repo: PrismaBillingRepository;
  let clinicAId: string;
  let clinicBId: string;
  let clinicIneligibleId: string;
  let fixtureClinicIds: string[];

  // fixedNow invoices the previous calendar month: April 2025.
  const fixedNow = new Date('2025-05-05T00:00:00Z');
  const periodStart = new Date('2025-04-01T00:00:00.000Z');
  const periodEnd = new Date('2025-05-01T00:00:00.000Z');
  const expectedDueDate = new Date('2025-05-31T00:00:00.000Z');

  // Defensive snapshot/restore (see file doc comment): every clinic's
  // stripe_customer_id before this suite runs, so any pre-existing
  // (e.g. demo-seeded) clinic the job's eligibility query happens to touch is
  // restored, and the shared local DB is left exactly as found.
  let preExistingCustomerIds: { id: string; stripeCustomerId: string | null }[] = [];

  beforeAll(async () => {
    service = new PrismaService();
    await service.onModuleInit();
    repo = new PrismaBillingRepository(service);

    preExistingCustomerIds = await service.asSystem(
      (client) => client.$queryRaw<{ id: string; stripeCustomerId: string | null }[]>`
        SELECT id, stripe_customer_id AS "stripeCustomerId" FROM clinics
      `,
    );

    const clinicARows = await service.asSystem(
      (client) => client.$queryRaw<{ id: string }[]>`
        INSERT INTO clinics (
          slug, name, rating, review_count, telehealth_available, financing_available,
          accepts_insurance, status, billing_status, notify_on_lead, business_email,
          stripe_customer_id, created_at
        )
        VALUES (
          'invoice-gen-clinic-a', 'Invoice Gen Clinic A', 4.5, 10, true, false, false,
          'active', 'current', false, 'a-business@fixture.test', 'cus_fixture_a', '2024-01-01T00:00:00Z'
        )
        RETURNING id
      `,
    );
    clinicAId = clinicARows[0]!.id;

    // Clinic A gets a billing_profiles row with a distinct billing_email, so
    // the test also proves the COALESCE(bp.billing_email, business_email)
    // eligibility-query column picks the billing_profiles value first.
    await service.asSystem(
      (client) => client.$executeRaw`
        INSERT INTO billing_profiles (clinic_id, billing_email)
        VALUES (${clinicAId}::uuid, 'a-billing@fixture.test')
      `,
    );

    const clinicBRows = await service.asSystem(
      (client) => client.$queryRaw<{ id: string }[]>`
        INSERT INTO clinics (
          slug, name, rating, review_count, telehealth_available, financing_available,
          accepts_insurance, status, billing_status, notify_on_lead, business_email,
          stripe_customer_id, created_at
        )
        VALUES (
          'invoice-gen-clinic-b', 'Invoice Gen Clinic B', 4.0, 3, false, false, false,
          'active', 'current', false, 'b-business@fixture.test', 'cus_fixture_b', '2024-01-01T00:00:00Z'
        )
        RETURNING id
      `,
    );
    clinicBId = clinicBRows[0]!.id;

    // Ineligible: no stripe_customer_id.
    const clinicIneligibleRows = await service.asSystem(
      (client) => client.$queryRaw<{ id: string }[]>`
        INSERT INTO clinics (
          slug, name, rating, review_count, telehealth_available, financing_available,
          accepts_insurance, status, billing_status, notify_on_lead, business_email, created_at
        )
        VALUES (
          'invoice-gen-clinic-ineligible', 'Invoice Gen Clinic Ineligible', 3.5, 1, false, false, false,
          'active', 'no_card', false, 'c-business@fixture.test', '2024-01-01T00:00:00Z'
        )
        RETURNING id
      `,
    );
    clinicIneligibleId = clinicIneligibleRows[0]!.id;

    fixtureClinicIds = [clinicAId, clinicBId, clinicIneligibleId];

    // Leads for clinic A: 2 within the April 2025 period.
    await service.asSystem(
      (client) => client.$executeRaw`
        INSERT INTO leads (
          lead_id, clinic_id, patient_first_name, patient_email, treatment_category,
          lead_source, delivery_status, clinic_status, received_at
        )
        VALUES
          ('invoice-gen-a-lead-1', ${clinicAId}::uuid, 'Pat', 'pat1@fixture.test', 'weight_loss',
           'directory', 'delivered', 'new', '2025-04-10T00:00:00Z'),
          ('invoice-gen-a-lead-2', ${clinicAId}::uuid, 'Sam', 'pat2@fixture.test', 'weight_loss',
           'directory', 'delivered', 'new', '2025-04-20T00:00:00Z')
      `,
    );

    // One lead for clinic B within the period, plus one OUTSIDE the period
    // (March, should not be counted).
    await service.asSystem(
      (client) => client.$executeRaw`
        INSERT INTO leads (
          lead_id, clinic_id, patient_first_name, patient_email, treatment_category,
          lead_source, delivery_status, clinic_status, received_at
        )
        VALUES
          ('invoice-gen-b-lead-1', ${clinicBId}::uuid, 'Alex', 'pat3@fixture.test', 'peptides',
           'directory', 'delivered', 'new', '2025-04-15T00:00:00Z'),
          ('invoice-gen-b-lead-2-outside-period', ${clinicBId}::uuid, 'Jo', 'pat4@fixture.test', 'peptides',
           'directory', 'delivered', 'new', '2025-03-15T00:00:00Z')
      `,
    );
  });

  afterAll(async () => {
    await service.asSystem(
      (client) =>
        client.$executeRaw`DELETE FROM leads WHERE clinic_id = ANY(${fixtureClinicIds}::uuid[])`,
    );
    await service.asSystem(
      (client) =>
        client.$executeRaw`DELETE FROM clinics WHERE id = ANY(${fixtureClinicIds}::uuid[])`,
    );

    // Restore any pre-existing clinic whose stripe_customer_id the job might
    // have touched (see doc comment) — expected to be a no-op today.
    for (const row of preExistingCustomerIds) {
      await service.asSystem(
        (client) => client.$executeRaw`
          UPDATE clinics SET stripe_customer_id = ${row.stripeCustomerId} WHERE id = ${row.id}::uuid
        `,
      );
    }

    await service.onModuleDestroy();
  });

  it('generates one open invoice per eligible clinic, skips the ineligible one, and is idempotent on re-run', async () => {
    const stripe = new FakeStripeAdapter();
    const email = new RecordingEmailSender();
    const job = new GenerateInvoicesJob(repo, stripe, email);

    const first = await job.execute(fixedNow);

    expect(first).toMatchObject({ job: 'invoice-generation', processed: 2, skipped: 0, failed: 0 });

    const invoiceRows = await service.asSystem(
      (client) => client.$queryRaw<InvoiceRow[]>`
        SELECT id, clinic_id, status, lead_count, total_amount::text AS total_amount, due_date, period_start, period_end
        FROM invoices WHERE clinic_id = ANY(${[clinicAId, clinicBId, clinicIneligibleId]}::uuid[])
        ORDER BY clinic_id
      `,
    );
    expect(invoiceRows).toHaveLength(2);

    const invoiceA = invoiceRows.find((r) => r.clinic_id === clinicAId);
    const invoiceB = invoiceRows.find((r) => r.clinic_id === clinicBId);
    expect(invoiceA).toBeDefined();
    expect(invoiceB).toBeDefined();

    const expectedAmountsA = computeInvoiceAmounts({
      leadCount: 2,
      clinicCreatedAt: new Date('2024-01-01T00:00:00Z'),
      periodStart,
      periodEnd,
      priorInvoiceCount: 0,
    });

    expect(invoiceA!.status).toBe('open');
    expect(invoiceA!.lead_count).toBe(2);
    expect(Number(invoiceA!.total_amount)).toBe(expectedAmountsA.totalAmount);
    expect(invoiceA!.due_date.toISOString()).toBe(expectedDueDate.toISOString());
    expect(invoiceA!.period_start.toISOString()).toBe(periodStart.toISOString());
    expect(invoiceA!.period_end.toISOString()).toBe(periodEnd.toISOString());

    expect(invoiceB!.status).toBe('open');
    expect(invoiceB!.lead_count).toBe(1); // the March lead must not be counted
    expect(invoiceB!.due_date.toISOString()).toBe(expectedDueDate.toISOString());

    expect(stripe.invoicesCreated).toHaveLength(2);

    // Emails: clinic A's billing_profiles.billing_email wins over
    // business_email; clinic B has no billing_profiles row, so falls back to
    // clinics.business_email.
    expect(email.sent.map((s) => s.to).sort()).toEqual(
      ['a-billing@fixture.test', 'b-business@fixture.test'].sort(),
    );

    // Re-run for the same period: eligibility's NOT EXISTS clause excludes
    // both clinics now, so no new rows and no new Stripe/email calls.
    const second = await job.execute(fixedNow);
    expect(second).toMatchObject({
      job: 'invoice-generation',
      processed: 0,
      skipped: 0,
      failed: 0,
    });

    const invoiceRowsAfterSecondRun = await service.asSystem(
      (client) => client.$queryRaw<InvoiceRow[]>`
        SELECT id FROM invoices WHERE clinic_id = ANY(${[clinicAId, clinicBId]}::uuid[])
      `,
    );
    expect(invoiceRowsAfterSecondRun).toHaveLength(2);
    expect(stripe.invoicesCreated).toHaveLength(2);
    expect(email.sent).toHaveLength(2);

    // The clinic with no stripe_customer_id is never invoiced.
    const ineligibleInvoiceRows = await service.asSystem(
      (client) => client.$queryRaw<{ id: string }[]>`
        SELECT id FROM invoices WHERE clinic_id = ${clinicIneligibleId}::uuid
      `,
    );
    expect(ineligibleInvoiceRows).toHaveLength(0);
  });
});
