import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { SavePaymentMethodUseCase } from '../save-payment-method.use-case';

describe('SavePaymentMethodUseCase', () => {
  const repo = { getClinicStripeCustomerId: jest.fn(), setBillingStatus: jest.fn() };
  const stripe = { attachPaymentMethod: jest.fn() };
  const useCase = new SavePaymentMethodUseCase(repo, stripe);
  const ctx = { clinicId: 'c1' };
  beforeEach(() => jest.resetAllMocks());

  it('throws 422 when the clinic has no Stripe customer', async () => {
    repo.getClinicStripeCustomerId.mockResolvedValue({
      stripeCustomerId: null,
      billingStatus: 'no_card',
    });
    await expect(useCase.execute(ctx, 'pm_1')).rejects.toThrow(
      'No Stripe customer found for this clinic. Contact support.',
    );
    await expect(useCase.execute(ctx, 'pm_1')).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(stripe.attachPaymentMethod).not.toHaveBeenCalled();
  });

  it('attaches and flips no_card to current', async () => {
    repo.getClinicStripeCustomerId.mockResolvedValue({
      stripeCustomerId: 'cus_1',
      billingStatus: 'no_card',
    });
    stripe.attachPaymentMethod.mockResolvedValue({
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });
    const dto = await useCase.execute(ctx, 'pm_1');
    expect(stripe.attachPaymentMethod).toHaveBeenCalledWith('cus_1', 'pm_1');
    expect(repo.setBillingStatus).toHaveBeenCalledWith(ctx, 'current');
    expect(dto).toEqual({
      brand: 'visa',
      last4: '4242',
      exp_month: 12,
      exp_year: 2030,
      stripePaymentMethodId: 'pm_1',
    });
  });

  it('does not change billing status when already current', async () => {
    repo.getClinicStripeCustomerId.mockResolvedValue({
      stripeCustomerId: 'cus_1',
      billingStatus: 'current',
    });
    stripe.attachPaymentMethod.mockResolvedValue({
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });
    await useCase.execute(ctx, 'pm_1');
    expect(repo.setBillingStatus).not.toHaveBeenCalled();
  });

  it('surfaces a Stripe attach failure as a 400', async () => {
    repo.getClinicStripeCustomerId.mockResolvedValue({
      stripeCustomerId: 'cus_1',
      billingStatus: 'no_card',
    });
    stripe.attachPaymentMethod.mockRejectedValue(new Error('Your card was declined.'));
    await expect(useCase.execute(ctx, 'pm_bad')).rejects.toThrow('Your card was declined.');

    stripe.attachPaymentMethod.mockRejectedValue(new Error('Your card was declined.'));
    await expect(useCase.execute(ctx, 'pm_bad')).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.setBillingStatus).not.toHaveBeenCalled();
  });
});
