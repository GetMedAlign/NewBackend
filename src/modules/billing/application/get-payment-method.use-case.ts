import { Inject, Injectable } from '@nestjs/common';
import {
  BILLING_REPOSITORY,
  type ClinicCtx,
  type ClinicStripeCustomer,
} from '../domain/ports/billing-repository.port';
import { STRIPE_PORT, type StripeDefaultPaymentMethod } from '../domain/ports/stripe.port';
import { PaymentMethodDto } from '../infrastructure/http/dto/payment-method.dto';

type BillingRepositoryForGet = {
  getClinicStripeCustomerId(ctx: ClinicCtx): Promise<ClinicStripeCustomer | null>;
};

type StripeForGet = {
  getDefaultPaymentMethod(customerId: string): Promise<StripeDefaultPaymentMethod | null>;
};

@Injectable()
export class GetPaymentMethodUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly repo: BillingRepositoryForGet,
    @Inject(STRIPE_PORT)
    private readonly stripe: StripeForGet,
  ) {}

  async execute(ctx: ClinicCtx): Promise<PaymentMethodDto | null> {
    const customer = await this.repo.getClinicStripeCustomerId(ctx);
    if (!customer || customer.stripeCustomerId === null) {
      return null;
    }

    const card = await this.stripe.getDefaultPaymentMethod(customer.stripeCustomerId);
    if (!card) {
      return null;
    }

    const dto = new PaymentMethodDto();
    dto.brand = card.brand;
    dto.last4 = card.last4;
    dto.exp_month = card.expMonth;
    dto.exp_year = card.expYear;
    dto.stripePaymentMethodId = card.paymentMethodId;
    return dto;
  }
}
