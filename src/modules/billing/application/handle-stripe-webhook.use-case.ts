import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { BILLING_REPOSITORY } from '../domain/ports/billing-repository.port';
import {
  STRIPE_WEBHOOK_VERIFIER,
  type StripeWebhookEvent,
  type StripeWebhookVerifier,
} from '../domain/ports/stripe-webhook-verifier.port';

type BillingRepositoryForWebhook = {
  invoiceExistsByStripeId(stripeInvoiceId: string): Promise<boolean>;
  markInvoicePaid(stripeInvoiceId: string): Promise<void>;
  markInvoicePaymentFailed(stripeInvoiceId: string): Promise<void>;
};

/**
 * Handles the `POST /stripe/webhook` events Stripe sends on invoice payment
 * outcomes (spec §5). Verifies the signature first — a bad signature is
 * mapped here to a `BadRequestException` (→ 400, no retry). Everything past
 * that point (repo/DB errors) is left to propagate untouched, so the
 * controller lets it surface as a 500 and Stripe retries the delivery.
 */
@Injectable()
export class HandleStripeWebhookUseCase {
  private readonly logger = new Logger(HandleStripeWebhookUseCase.name);

  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repo: BillingRepositoryForWebhook,
    @Inject(STRIPE_WEBHOOK_VERIFIER) private readonly verifier: StripeWebhookVerifier,
  ) {}

  async handle(rawBody: Buffer, signature: string): Promise<void> {
    let event: StripeWebhookEvent;
    try {
      event = this.verifier.constructEvent(rawBody, signature);
    } catch (err) {
      throw new BadRequestException(
        `Invalid Stripe webhook signature: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    switch (event.type) {
      case 'invoice.paid': {
        const stripeInvoiceId = event.data.object.id;
        if (!(await this.repo.invoiceExistsByStripeId(stripeInvoiceId))) {
          this.logger.warn(
            `invoice.paid received for unknown stripe_invoice_id=${stripeInvoiceId}`,
          );
          return;
        }
        await this.repo.markInvoicePaid(stripeInvoiceId);
        return;
      }
      case 'invoice.payment_failed': {
        const stripeInvoiceId = event.data.object.id;
        if (!(await this.repo.invoiceExistsByStripeId(stripeInvoiceId))) {
          this.logger.warn(
            `invoice.payment_failed received for unknown stripe_invoice_id=${stripeInvoiceId}`,
          );
          return;
        }
        await this.repo.markInvoicePaymentFailed(stripeInvoiceId);
        return;
      }
      default:
        this.logger.log(`Ignoring unhandled Stripe webhook event type=${event.type}`);
        return;
    }
  }
}
