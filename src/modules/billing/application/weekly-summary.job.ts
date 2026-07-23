import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BILLING_REPOSITORY,
  type BillingRepositoryPort,
  type WeeklySummaryClinic,
} from '../domain/ports/billing-repository.port';
import {
  EMAIL_SENDER,
  type EmailSenderPort,
} from '../../auth/infrastructure/adapters/email-sender.port';
import type { JobResult } from './generate-invoices.job';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Weekly job (spec §5): emails every `active` clinic that has opted into
 * `weekly_summary` its lead counts — this week and all-time — at its
 * `business_email`.
 *
 * Runs entirely `asSystem` (via the repository) — it acts for no user. This
 * job is read-only (it counts leads and sends an email), so it needs no
 * transaction.
 *
 * A clinic with no `business_email` is `skipped` (there is nothing to send
 * it, and that is not a failure). A clinic whose email send throws is
 * `failed`, and the loop continues to the next clinic.
 */
@Injectable()
export class WeeklySummaryJob {
  private readonly logger = new Logger(WeeklySummaryJob.name);

  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repo: BillingRepositoryPort,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSenderPort,
  ) {}

  async execute(now: Date = new Date()): Promise<JobResult> {
    const weekAgo = new Date(now.getTime() - WEEK_MS);
    const clinics = await this.repo.listWeeklySummaryClinics();

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const details: string[] = [];

    for (const clinic of clinics) {
      try {
        const sent = await this.summarizeOne(clinic, weekAgo);
        if (sent) {
          processed += 1;
        } else {
          skipped += 1;
        }
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        details.push(`${clinic.clinicId}: ${message}`);
        this.logger.error(
          `Failed to send weekly summary to clinic ${clinic.clinicId} (${clinic.clinicName})`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    const result: JobResult = { job: 'weekly-summary', processed, skipped, failed };
    if (details.length > 0) result.details = details;
    return result;
  }

  /** Returns whether the summary email was sent (`false` when the clinic has no business email). */
  private async summarizeOne(clinic: WeeklySummaryClinic, weekAgo: Date): Promise<boolean> {
    const to = clinic.businessEmail;
    if (!to) return false;

    const [leadsThisWeek, totalLeads] = await Promise.all([
      this.repo.countLeadsSince(clinic.clinicId, weekAgo),
      this.repo.countAllLeads(clinic.clinicId),
    ]);

    await this.emailSender.send(
      to,
      'Your MedAlign weekly summary',
      `Here's your weekly MedAlign summary for ${clinic.clinicName}: you received ${leadsThisWeek} new lead${leadsThisWeek === 1 ? '' : 's'} this week, out of ${totalLeads} lead${totalLeads === 1 ? '' : 's'} all-time.`,
    );
    return true;
  }
}
