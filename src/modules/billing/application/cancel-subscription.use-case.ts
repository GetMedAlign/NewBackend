import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { BILLING_REPOSITORY, type ClinicCtx } from '../domain/ports/billing-repository.port';
import { CancelSubscriptionResponseDto } from '../infrastructure/http/dto/cancel-subscription-response.dto';

type BillingRepositoryForCancel = {
  cancelSubscription(
    ctx: ClinicCtx,
    cancelledAt: Date,
    activeThrough: Date,
  ): Promise<'ok' | 'already_cancelled'>;
};

@Injectable()
export class CancelSubscriptionUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly repo: BillingRepositoryForCancel,
  ) {}

  async execute(ctx: ClinicCtx, now: Date): Promise<CancelSubscriptionResponseDto> {
    // Last day of the current month, 23:59:59 UTC — day 0 of next month is
    // the last day of this month (spec §6).
    const activeThrough = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
    );

    const result = await this.repo.cancelSubscription(ctx, now, activeThrough);
    if (result === 'already_cancelled') {
      throw new ConflictException('Subscription is already cancelled.');
    }

    return {
      cancelledAt: now.toISOString(),
      activeThrough: activeThrough.toISOString(),
    };
  }
}
