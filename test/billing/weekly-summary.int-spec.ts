/**
 * Integration test for `WeeklySummaryJob` (spec §5) against a live local
 * Postgres (DATABASE_URL from test/.env.test), using the real
 * `PrismaBillingRepository` and a recording stub email sender.
 *
 * Seeds its own fixture clinics/leads (deleted in afterAll) rather than
 * relying on the 6 demo-seeded clinics. As a defensive snapshot/restore
 * (mirroring test/billing/invoice-generation.int-spec.ts and
 * account-suspension.int-spec.ts), this suite records every pre-existing
 * clinic's status/weekly_summary/business_email before running and restores
 * them afterward, so the shared local DB is left exactly as found either way.
 */
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaBillingRepository } from '../../src/modules/billing/infrastructure/prisma-billing.repository';
import { WeeklySummaryJob } from '../../src/modules/billing/application/weekly-summary.job';
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
  weekly_summary: boolean;
  business_email: string | null;
};

describe('WeeklySummaryJob (integration)', () => {
  let service: PrismaService;
  let repo: PrismaBillingRepository;
  let clinicOptedInId: string;
  let clinicOptedOutId: string;
  let clinicSuspendedOptedInId: string;
  let fixtureClinicIds: string[];

  const fixedNow = new Date('2026-07-20T00:00:00Z');
  const withinWeek = new Date('2026-07-18T00:00:00Z'); // 2 days before fixedNow
  const beforeWeek = new Date('2026-07-01T00:00:00Z'); // outside the 7-day window

  // Defensive snapshot/restore (see file doc comment): every pre-existing
  // clinic's status/weekly_summary/business_email before this suite runs, so
  // any clinic the job's eligibility query happens to touch is restored.
  let preExistingClinicState: ClinicRow[] = [];

  beforeAll(async () => {
    service = new PrismaService();
    await service.onModuleInit();
    repo = new PrismaBillingRepository(service);

    preExistingClinicState = await service.asSystem(
      (client) => client.$queryRaw<ClinicRow[]>`
        SELECT id, status, weekly_summary, business_email FROM clinics
      `,
    );

    const optedInRows = await service.asSystem(
      (client) => client.$queryRaw<{ id: string }[]>`
        INSERT INTO clinics (
          slug, name, rating, review_count, telehealth_available, financing_available,
          accepts_insurance, status, billing_status, notify_on_lead, weekly_summary,
          business_email, created_at
        )
        VALUES (
          'weekly-summary-opted-in', 'Weekly Summary Opted In', 4.5, 10, false, false, false,
          'active', 'current', true, true, 'opted-in-business@fixture.test', '2024-01-01T00:00:00Z'
        )
        RETURNING id
      `,
    );
    clinicOptedInId = optedInRows[0]!.id;

    const optedOutRows = await service.asSystem(
      (client) => client.$queryRaw<{ id: string }[]>`
        INSERT INTO clinics (
          slug, name, rating, review_count, telehealth_available, financing_available,
          accepts_insurance, status, billing_status, notify_on_lead, weekly_summary,
          business_email, created_at
        )
        VALUES (
          'weekly-summary-opted-out', 'Weekly Summary Opted Out', 4.0, 5, false, false, false,
          'active', 'current', true, false, 'opted-out-business@fixture.test', '2024-01-01T00:00:00Z'
        )
        RETURNING id
      `,
    );
    clinicOptedOutId = optedOutRows[0]!.id;

    const suspendedOptedInRows = await service.asSystem(
      (client) => client.$queryRaw<{ id: string }[]>`
        INSERT INTO clinics (
          slug, name, rating, review_count, telehealth_available, financing_available,
          accepts_insurance, status, billing_status, notify_on_lead, weekly_summary,
          business_email, created_at
        )
        VALUES (
          'weekly-summary-suspended', 'Weekly Summary Suspended', 3.5, 2, false, false, false,
          'suspended', 'overdue', false, true, 'suspended-business@fixture.test', '2024-01-01T00:00:00Z'
        )
        RETURNING id
      `,
    );
    clinicSuspendedOptedInId = suspendedOptedInRows[0]!.id;

    fixtureClinicIds = [clinicOptedInId, clinicOptedOutId, clinicSuspendedOptedInId];

    // Leads for the opted-in clinic: 2 within the past week, 1 before it.
    await service.asSystem(
      (client) => client.$executeRaw`
        INSERT INTO leads (
          lead_id, clinic_id, patient_first_name, patient_email, treatment_category,
          lead_source, delivery_status, clinic_status, received_at
        )
        VALUES
          ('weekly-summary-lead-1', ${clinicOptedInId}::uuid, 'Pat', 'pat1@fixture.test', 'weight_loss',
           'directory', 'delivered', 'new', ${withinWeek}),
          ('weekly-summary-lead-2', ${clinicOptedInId}::uuid, 'Sam', 'pat2@fixture.test', 'weight_loss',
           'directory', 'delivered', 'new', ${withinWeek}),
          ('weekly-summary-lead-3-old', ${clinicOptedInId}::uuid, 'Jo', 'pat3@fixture.test', 'weight_loss',
           'directory', 'delivered', 'new', ${beforeWeek})
      `,
    );

    // A lead for the opted-out clinic, which must never be emailed or counted.
    await service.asSystem(
      (client) => client.$executeRaw`
        INSERT INTO leads (
          lead_id, clinic_id, patient_first_name, patient_email, treatment_category,
          lead_source, delivery_status, clinic_status, received_at
        )
        VALUES
          ('weekly-summary-lead-4-opted-out', ${clinicOptedOutId}::uuid, 'Ali', 'pat4@fixture.test',
           'weight_loss', 'directory', 'delivered', 'new', ${withinWeek})
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

    // Restore any pre-existing clinic whose columns the job might have
    // touched (see doc comment) — expected to be a no-op today, since this
    // job never writes to clinics.
    for (const row of preExistingClinicState) {
      await service.asSystem(
        (client) => client.$executeRaw`
          UPDATE clinics
          SET status = ${row.status}, weekly_summary = ${row.weekly_summary},
              business_email = ${row.business_email}
          WHERE id = ${row.id}::uuid
        `,
      );
    }

    await service.onModuleDestroy();
  });

  it('emails only the active, opted-in clinic its weekly and total lead counts', async () => {
    const email = new RecordingEmailSender();
    const job = new WeeklySummaryJob(repo, email);

    const result = await job.execute(fixedNow);

    const sentToOptedIn = email.sent.filter((s) => s.to === 'opted-in-business@fixture.test');
    const sentToOptedOut = email.sent.filter((s) => s.to === 'opted-out-business@fixture.test');
    const sentToSuspended = email.sent.filter((s) => s.to === 'suspended-business@fixture.test');

    expect(sentToOptedIn).toHaveLength(1);
    // 2 leads within the past week (the 3rd is outside the window).
    expect(sentToOptedIn[0]!.body).toContain('2');
    expect(sentToOptedOut).toHaveLength(0);
    expect(sentToSuspended).toHaveLength(0);

    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);
  });
});
