import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { BILLING_STATUS } from '../domain/billing-status';
import {
  BILLING_REPOSITORY,
  type ClinicCtx,
  type ClinicStripeCustomer,
} from '../domain/ports/billing-repository.port';
import { STRIPE_PORT, type StripeCard } from '../domain/ports/stripe.port';
import { PaymentMethodDto } from '../infrastructure/http/dto/payment-method.dto';

type BillingRepositoryForSave = {
  getClinicStripeCustomerId(ctx: ClinicCtx): Promise<ClinicStripeCustomer | null>;
  setBillingStatus(ctx: ClinicCtx, status: string): Promise<void>;
};

type StripeForSave = {
  attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<StripeCard>;
};

@Injectable()
export class SavePaymentMethodUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly repo: BillingRepositoryForSave,
    @Inject(STRIPE_PORT)
    private readonly stripe: StripeForSave,
  ) {}

  async execute(ctx: ClinicCtx, paymentMethodId: string): Promise<PaymentMethodDto> {
    const customer = await this.repo.getClinicStripeCustomerId(ctx);
    if (!customer || customer.stripeCustomerId === null) {
      throw new UnprocessableEntityException(
        'No Stripe customer found for this clinic. Contact support.',
      );
    }

    let card: StripeCard;
    try {
      card = await this.stripe.attachPaymentMethod(customer.stripeCustomerId, paymentMethodId);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }

    if (customer.billingStatus === BILLING_STATUS.NO_CARD) {
      await this.repo.setBillingStatus(ctx, BILLING_STATUS.CURRENT);
    }

    const dto = new PaymentMethodDto();
    dto.brand = card.brand;
    dto.last4 = card.last4;
    dto.exp_month = card.expMonth;
    dto.exp_year = card.expYear;
    dto.stripePaymentMethodId = paymentMethodId;
    return dto;
  }
}
