import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BILLING_REPOSITORY,
  type BillingRepositoryPort,
  type OverdueClinic,
} from '../domain/ports/billing-repository.port';
import {
  EMAIL_SENDER,
  type EmailSenderPort,
} from '../../auth/infrastructure/adapters/email-sender.port';
import type { JobResult } from './generate-invoices.job';

/**
 * Daily job (spec §4): suspends every `active` clinic that has an invoice
 * 30+ days past its due date — sets `status = 'suspended'`,
 * `suspension_reason = 'overdue_payment'`, `notify_on_lead = false`, marks
 * that clinic's `open` invoices `overdue`, and best-effort emails an
 * overdue warning to the clinic's billing contact.
 *
 * Runs entirely `asSystem` (via the repository) — it acts for no user.
 * Task 8 wires an admin endpoint to trigger `execute`.
 *
 * Idempotent: a clinic already `suspended` is no longer `active`, so
 * `listSuspendableClinics` excludes it on a re-run.
 */
@Injectable()
export class SuspendOverdueAccountsJob {
  private readonly logger = new Logger(SuspendOverdueAccountsJob.name);

  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repo: BillingRepositoryPort,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSenderPort,
  ) {}

  async execute(now: Date = new Date()): Promise<JobResult> {
    const clinics = await this.repo.listSuspendableClinics(now);

    let processed = 0;
    let failed = 0;
    const details: string[] = [];

    for (const clinic of clinics) {
      try {
        await this.suspendOne(clinic);
        processed += 1;
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        details.push(`${clinic.clinicId}: ${message}`);
        this.logger.error(
          `Failed to suspend clinic ${clinic.clinicId} (${clinic.clinicName})`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    const result: JobResult = { job: 'account-suspension', processed, skipped: 0, failed };
    if (details.length > 0) result.details = details;
    return result;
  }

  private async suspendOne(clinic: OverdueClinic): Promise<void> {
    await this.repo.suspendClinicForNonPayment(clinic.clinicId);

    // Best-effort: the clinic is already suspended, so an email failure
    // must not roll it back or count the clinic as failed.
    const to = clinic.billingEmail;
    if (to) {
      try {
        const dueDate = clinic.overdueDueDate
          ? clinic.overdueDueDate.toISOString().slice(0, 10)
          : 'a past date';
        await this.emailSender.send(
          to,
          `Your MedAlign account for ${clinic.clinicName} has been suspended`,
          `Your account for ${clinic.clinicName} has been suspended for non-payment. An invoice of $${clinic.overdueTotal.toFixed(2)} was due ${dueDate} and remains unpaid more than 30 days later. Please settle your outstanding balance to restore access.`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to send suspension-warning email to ${to} for clinic ${clinic.clinicId} (clinic already suspended)`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }
}
