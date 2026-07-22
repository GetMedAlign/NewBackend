import { Inject, Injectable, Logger } from '@nestjs/common';
import { computeInvoiceAmounts } from '../domain/invoice-amounts';
import {
  BILLING_REPOSITORY,
  type BillingRepositoryPort,
  type EligibleClinic,
} from '../domain/ports/billing-repository.port';
import { STRIPE_PORT, type StripePort } from '../domain/ports/stripe.port';
import {
  EMAIL_SENDER,
  type EmailSenderPort,
} from '../../auth/infrastructure/adapters/email-sender.port';

const DUE_DATE_OFFSET_MS = 30 * 24 * 60 * 60 * 1000;

export interface JobResult {
  job: string;
  processed: number;
  skipped: number;
  failed: number;
  details?: string[];
}

/**
 * Monthly job (spec §3): invoices the PREVIOUS calendar month for every
 * eligible clinic — active, has a Stripe customer, created before the
 * period, subscription still active, and not already invoiced for this
 * period (that last clause, enforced in `listInvoiceEligibleClinics`, is
 * what makes a re-run for an already-processed month a no-op).
 *
 * Runs entirely `asSystem` (via the repository) — it acts for no user.
 * Task 8 wires an admin endpoint to trigger `execute`.
 */
@Injectable()
export class GenerateInvoicesJob {
  private readonly logger = new Logger(GenerateInvoicesJob.name);

  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repo: BillingRepositoryPort,
    @Inject(STRIPE_PORT) private readonly stripe: StripePort,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSenderPort,
  ) {}

  async execute(now: Date = new Date()): Promise<JobResult> {
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const dueDate = new Date(periodEnd.getTime() + DUE_DATE_OFFSET_MS);

    const clinics = await this.repo.listInvoiceEligibleClinics(periodStart, periodEnd);

    let processed = 0;
    let failed = 0;
    const details: string[] = [];

    for (const clinic of clinics) {
      try {
        await this.generateOne(clinic, periodStart, periodEnd, dueDate);
        processed += 1;
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        details.push(`${clinic.clinicId}: ${message}`);
        this.logger.error(
          `Failed to generate invoice for clinic ${clinic.clinicId} (${clinic.clinicName})`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    const result: JobResult = { job: 'invoice-generation', processed, skipped: 0, failed };
    if (details.length > 0) result.details = details;
    return result;
  }

  private async generateOne(
    clinic: EligibleClinic,
    periodStart: Date,
    periodEnd: Date,
    dueDate: Date,
  ): Promise<void> {
    const [leadCount, priorInvoiceCount] = await Promise.all([
      this.repo.countLeadsInPeriod(clinic.clinicId, periodStart, periodEnd),
      this.repo.countInvoicesForClinic(clinic.clinicId),
    ]);

    const amounts = computeInvoiceAmounts({
      leadCount,
      clinicCreatedAt: clinic.createdAt,
      periodStart,
      periodEnd,
      priorInvoiceCount,
    });

    // No internal try/catch in the real StripeAdapter — a throw here is
    // caught by the per-clinic try/catch in execute(), which counts this
    // clinic as failed without aborting the rest of the batch.
    const invoice = await this.stripe.createAndFinalizeInvoice({
      customerId: clinic.stripeCustomerId,
      clinicName: clinic.clinicName,
      leadCount: amounts.leadCount,
      pricePerLead: amounts.pricePerLead,
      platformFee: amounts.platformFee,
      platformFeeLabel: amounts.platformFeeLabel,
      processingFee: amounts.processingFee,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    });

    await this.repo.insertGeneratedInvoice({
      clinicId: clinic.clinicId,
      stripeInvoiceId: invoice.stripeInvoiceId,
      periodStart,
      periodEnd,
      leadCount: amounts.leadCount,
      pricePerLead: amounts.pricePerLead,
      platformFee: amounts.platformFee,
      totalAmount: amounts.totalAmount,
      dueDate,
      invoiceUrl: invoice.invoiceUrl,
      pdfUrl: invoice.pdfUrl,
    });

    // Best-effort: the invoice is already stored, so an email failure must
    // not roll it back or count the clinic as failed.
    const to = clinic.billingEmail;
    if (to) {
      try {
        await this.emailSender.send(
          to,
          `Your MedAlign invoice for ${clinic.clinicName}`,
          `A new invoice for ${clinic.clinicName} covering ${periodStart.toISOString().slice(0, 10)} – ${periodEnd.toISOString().slice(0, 10)} is ready. Total due: $${amounts.totalAmount.toFixed(2)} by ${dueDate.toISOString().slice(0, 10)}.${invoice.invoiceUrl ? ` View it here: ${invoice.invoiceUrl}` : ''}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to send invoice-issued email to ${to} for clinic ${clinic.clinicId} (invoice already stored)`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }
}
