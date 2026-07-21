import { Inject, Injectable, Logger } from '@nestjs/common';
import { BILLING_STATUS } from '../domain/billing-status';
import {
  BILLING_REPOSITORY,
  type ClinicCtx,
  type ClinicStripeCustomer,
} from '../domain/ports/billing-repository.port';
import { STRIPE_PORT } from '../domain/ports/stripe.port';

type BillingRepositoryForRemove = {
  getClinicStripeCustomerId(ctx: ClinicCtx): Promise<ClinicStripeCustomer | null>;
  setBillingStatus(ctx: ClinicCtx, status: string): Promise<void>;
};

type StripeForRemove = {
  detachDefaultPaymentMethod(customerId: string): Promise<void>;
};

@Injectable()
export class RemovePaymentMethodUseCase {
  private readonly logger = new Logger(RemovePaymentMethodUseCase.name);

  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly repo: BillingRepositoryForRemove,
    @Inject(STRIPE_PORT)
    private readonly stripe: StripeForRemove,
  ) {}

  async execute(ctx: ClinicCtx): Promise<{ success: boolean }> {
    const customer = await this.repo.getClinicStripeCustomerId(ctx);
    if (customer && customer.stripeCustomerId !== null) {
      try {
        await this.stripe.detachDefaultPaymentMethod(customer.stripeCustomerId);
      } catch (err) {
        this.logger.warn(
          `Best-effort Stripe detach failed for clinic ${ctx.clinicId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      await this.repo.setBillingStatus(ctx, BILLING_STATUS.NO_CARD);
    }

    return { success: true };
  }
}
