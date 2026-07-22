/**
 * Integration test for `SuspendOverdueAccountsJob` (spec §4) against a live
 * local Postgres (DATABASE_URL from test/.env.test), using the real
 * `PrismaBillingRepository` and a recording stub email sender.
 *
 * Seeds its own fixture clinics/invoices (deleted in afterAll) rather than
 * relying on the 6 demo-seeded clinics. As a defensive snapshot/restore
 * (mirroring test/billing/invoice-generation.int-spec.ts), this suite records
 * every pre-existing clinic's status/suspension_reason/notify_on_lead before
 * running and restores them afterward, so the shared local DB is left exactly
 * as found either way.
 */
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaBillingRepository } from '../../src/modules/billing/infrastructure/prisma-billing.repository';
import { SuspendOverdueAccountsJob } from '../../src/modules/billing/application/suspend-overdue-accounts.job';
import type { EmailSenderPort } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';

class RecordingEmailSender implements EmailSenderPort {
  readonly sent: Array<{ to: string; subject: string; body: string }> = [];

  async send(to: string, subject: string, body: string): Promise<void> {
    this.sent.push({ to, subject, body });
  }
}

type ClinicRow = {
  id: string;
  status: string;
  suspension_reason: string | null;
  notify_on_lead: boolean;
};

type InvoiceRow = {
  id: string;
  clinic_id: string;
  status: string;
};

describe('SuspendOverdueAccountsJob (integration)', () => {
  let service: PrismaService;
  let repo: PrismaBillingRepository;
  let clinicOverdueId: string;
  let clinicCurrentId: string;
  let fixtureClinicIds: string[];

  // fixedNow: overdue invoice's due_date (2025-04-01) + 30 days < fixedNow.
  const fixedNow = new Date('2025-05-05T00:00:00Z');
  const overdueDueDate = new Date('2025-04-01T00:00:00Z'); // 34 days before fixedNow
  const currentDueDate = new Date('2025-04-20T00:00:00Z'); // 15 days before fixedNow, not yet overdue

  // Defensive snapshot/restore (see file doc comment): every pre-existing
  // clinic's suspension-relevant columns before this suite runs, so any
  // clinic the job's eligibility query happens to touch is restored.
  let preExistingClinicState: ClinicRow[] = [];

  beforeAll(async () => {
    service = new PrismaService();
    await service.onModuleInit();
    repo = new PrismaBillingRepository(service);

    preExistingClinicState = await service.asSystem(
      (client) => client.$queryRaw<ClinicRow[]>`
        SELECT id, status, suspension_reason, notify_on_lead FROM clinics
      `,
    );

    const overdueRows = await service.asSystem(
      (client) => client.$queryRaw<{ id: string }[]>`
        INSERT INTO clinics (
          slug, name, rating, review_count, telehealth_available, financing_available,
          accepts_insurance, status, billing_status, notify_on_lead, business_email, created_at
        )
        VALUES (
          'suspend-clinic-overdue', 'Suspend Clinic Overdue', 4.2, 5, false, false, false,
          'active', 'current', true, 'overdue-business@fixture.test', '2024-01-01T00:00:00Z'
        )
        RETURNING id
      `,
    );
    clinicOverdueId = overdueRows[0]!.id;

    // Distinct billing_email, proving the COALESCE(bp.billing_email, business_email) column.
    await service.asSystem(
      (client) => client.$executeRaw`
        INSERT INTO billing_profiles (clinic_id, billing_email)
        VALUES (${clinicOverdueId}::uuid, 'overdue-billing@fixture.test')
      `,
    );

    await service.asSystem(
      (client) => client.$executeRaw`
        INSERT INTO invoices (
          clinic_id, stripe_invoice_id, period_start, period_end, lead_count,
          price_per_lead, platform_fee, total_amount, status, due_date
        )
        VALUES (
          ${clinicOverdueId}::uuid, 'in_overdue_fixture', '2025-03-01T00:00:00Z', '2025-04-01T00:00:00Z', 3,
          90, 0, 270.00, 'open', ${overdueDueDate}
        )
      `,
    );

    const currentRows = await service.asSystem(
      (client) => client.$queryRaw<{ id: string }[]>`
        INSERT INTO clinics (
          slug, name, rating, review_count, telehealth_available, financing_available,
          accepts_insurance, status, billing_status, notify_on_lead, business_email, created_at
        )
        VALUES (
          'suspend-clinic-current', 'Suspend Clinic Current', 4.0, 2, false, false, false,
          'active', 'current', true, 'current-business@fixture.test', '2024-01-01T00:00:00Z'
        )
        RETURNING id
      `,
    );
    clinicCurrentId = currentRows[0]!.id;

    await service.asSystem(
      (client) => client.$executeRaw`
        INSERT INTO invoices (
          clinic_id, stripe_invoice_id, period_start, period_end, lead_count,
          price_per_lead, platform_fee, total_amount, status, due_date
        )
        VALUES (
          ${clinicCurrentId}::uuid, 'in_current_fixture', '2025-03-01T00:00:00Z', '2025-04-01T00:00:00Z', 1,
          90, 0, 90.00, 'open', ${currentDueDate}
        )
      `,
    );

    fixtureClinicIds = [clinicOverdueId, clinicCurrentId];
  });

  afterAll(async () => {
    await service.asSystem(
      (client) =>
        client.$executeRaw`DELETE FROM invoices WHERE clinic_id = ANY(${fixtureClinicIds}::uuid[])`,
    );
    await service.asSystem(
      (client) =>
        client.$executeRaw`DELETE FROM billing_profiles WHERE clinic_id = ANY(${fixtureClinicIds}::uuid[])`,
    );
    await service.asSystem(
      (client) =>
        client.$executeRaw`DELETE FROM clinics WHERE id = ANY(${fixtureClinicIds}::uuid[])`,
    );

    // Restore any pre-existing clinic whose status/suspension fields the job
    // might have touched (see doc comment) — expected to be a no-op today.
    for (const row of preExistingClinicState) {
      await service.asSystem(
        (client) => client.$executeRaw`
          UPDATE clinics
          SET status = ${row.status}, suspension_reason = ${row.suspension_reason},
              notify_on_lead = ${row.notify_on_lead}
          WHERE id = ${row.id}::uuid
        `,
      );
    }

    await service.onModuleDestroy();
  });

  it('suspends the overdue clinic, leaves the current clinic untouched, and is idempotent on re-run', async () => {
    const email = new RecordingEmailSender();
    const job = new SuspendOverdueAccountsJob(repo, email);

    const first = await job.execute(fixedNow);

    expect(first).toMatchObject({ job: 'account-suspension', processed: 1, skipped: 0, failed: 0 });

    const clinicRows = await service.asSystem(
      (client) => client.$queryRaw<ClinicRow[]>`
        SELECT id, status, suspension_reason, notify_on_lead FROM clinics
        WHERE id = ANY(${fixtureClinicIds}::uuid[])
      `,
    );
    const overdueClinic = clinicRows.find((r) => r.id === clinicOverdueId);
    const currentClinic = clinicRows.find((r) => r.id === clinicCurrentId);

    expect(overdueClinic).toMatchObject({
      status: 'suspended',
      suspension_reason: 'overdue_payment',
      notify_on_lead: false,
    });
    // Untouched: still active, no suspension reason, notify_on_lead unchanged.
    expect(currentClinic).toMatchObject({
      status: 'active',
      suspension_reason: null,
      notify_on_lead: true,
    });

    const invoiceRows = await service.asSystem(
      (client) => client.$queryRaw<InvoiceRow[]>`
        SELECT id, clinic_id, status FROM invoices
        WHERE clinic_id = ANY(${fixtureClinicIds}::uuid[])
      `,
    );
    const overdueInvoice = invoiceRows.find((r) => r.clinic_id === clinicOverdueId);
    const currentInvoice = invoiceRows.find((r) => r.clinic_id === clinicCurrentId);
    expect(overdueInvoice?.status).toBe('overdue');
    expect(currentInvoice?.status).toBe('open'); // untouched

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe('overdue-billing@fixture.test');

    // Re-run: the overdue clinic is no longer `active` (it's `suspended`),
    // so listSuspendableClinics excludes it — a no-op.
    const second = await job.execute(fixedNow);
    expect(second).toMatchObject({
      job: 'account-suspension',
      processed: 0,
      skipped: 0,
      failed: 0,
    });
    expect(email.sent).toHaveLength(1); // no new email sent

    const clinicRowsAfterSecondRun = await service.asSystem(
      (client) => client.$queryRaw<ClinicRow[]>`
        SELECT id, status, suspension_reason, notify_on_lead FROM clinics
        WHERE id = ${clinicOverdueId}::uuid
      `,
    );
    expect(clinicRowsAfterSecondRun[0]).toMatchObject({
      status: 'suspended',
      suspension_reason: 'overdue_payment',
      notify_on_lead: false,
    });
  });
});
