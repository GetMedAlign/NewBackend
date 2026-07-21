import { GetPaymentMethodUseCase } from '../get-payment-method.use-case';

describe('GetPaymentMethodUseCase', () => {
  const repo = { getClinicStripeCustomerId: jest.fn() };
  const stripe = { getDefaultPaymentMethod: jest.fn() };
  const useCase = new GetPaymentMethodUseCase(repo, stripe);
  const ctx = { clinicId: 'c1' };
  beforeEach(() => jest.resetAllMocks());

  it('returns null when the clinic has no stripeCustomerId', async () => {
    repo.getClinicStripeCustomerId.mockResolvedValue({
      stripeCustomerId: null,
      billingStatus: 'no_card',
    });
    await expect(useCase.execute(ctx)).resolves.toBeNull();
    expect(stripe.getDefaultPaymentMethod).not.toHaveBeenCalled();
  });

  it('returns null when the clinic row itself is missing', async () => {
    repo.getClinicStripeCustomerId.mockResolvedValue(null);
    await expect(useCase.execute(ctx)).resolves.toBeNull();
    expect(stripe.getDefaultPaymentMethod).not.toHaveBeenCalled();
  });

  it('returns null when Stripe returns no default card', async () => {
    repo.getClinicStripeCustomerId.mockResolvedValue({
      stripeCustomerId: 'cus_1',
      billingStatus: 'current',
    });
    stripe.getDefaultPaymentMethod.mockResolvedValue(null);
    await expect(useCase.execute(ctx)).resolves.toBeNull();
    expect(stripe.getDefaultPaymentMethod).toHaveBeenCalledWith('cus_1');
  });

  it('maps a Stripe default card to the mixed-case DTO', async () => {
    repo.getClinicStripeCustomerId.mockResolvedValue({
      stripeCustomerId: 'cus_1',
      billingStatus: 'current',
    });
    stripe.getDefaultPaymentMethod.mockResolvedValue({
      paymentMethodId: 'pm_1',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });

    await expect(useCase.execute(ctx)).resolves.toEqual({
      brand: 'visa',
      last4: '4242',
      exp_month: 12,
      exp_year: 2030,
      stripePaymentMethodId: 'pm_1',
    });
  });
});
