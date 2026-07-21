import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BILLING_REPOSITORY,
  type ClinicCtx,
  type UpdateBillingProfileInput,
  type UpsertProfileResult,
} from '../domain/ports/billing-repository.port';
import { STRIPE_PORT } from '../domain/ports/stripe.port';

type BillingRepositoryForUpdate = {
  upsertProfile(ctx: ClinicCtx, input: UpdateBillingProfileInput): Promise<UpsertProfileResult>;
};

type StripeForEmailSync = {
  updateCustomerEmail(customerId: string, email: string): Promise<void>;
};

@Injectable()
export class UpdateClinicBillingUseCase {
  private readonly logger = new Logger(UpdateClinicBillingUseCase.name);

  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly repo: BillingRepositoryForUpdate,
    @Inject(STRIPE_PORT)
    private readonly stripe: StripeForEmailSync,
  ) {}

  async execute(ctx: ClinicCtx, input: UpdateBillingProfileInput): Promise<{ success: boolean }> {
    const { oldEmail, stripeCustomerId } = await this.repo.upsertProfile(ctx, input);

    // billingEmail absent or explicitly null means "leave unchanged" (spec
    // §1.2); class-validator's @IsOptional() lets `null` reach here, so it
    // must be excluded from the sync decision, not just `undefined`.
    const newEmail = input.billingEmail;
    if (
      newEmail !== undefined &&
      newEmail !== null &&
      newEmail !== oldEmail &&
      stripeCustomerId !== null
    ) {
      try {
        await this.stripe.updateCustomerEmail(stripeCustomerId, newEmail);
      } catch (err) {
        this.logger.warn(
          `Best-effort Stripe email sync failed for clinic ${ctx.clinicId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return { success: true };
  }
}
