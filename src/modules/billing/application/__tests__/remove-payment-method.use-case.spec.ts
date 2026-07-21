import { RemovePaymentMethodUseCase } from '../remove-payment-method.use-case';

describe('RemovePaymentMethodUseCase', () => {
  const repo = { getClinicStripeCustomerId: jest.fn(), setBillingStatus: jest.fn() };
  const stripe = { detachDefaultPaymentMethod: jest.fn() };
  const useCase = new RemovePaymentMethodUseCase(repo, stripe);
  const ctx = { clinicId: 'c1' };
  beforeEach(() => jest.resetAllMocks());

  it('detaches and sets no_card when a customer exists', async () => {
    repo.getClinicStripeCustomerId.mockResolvedValue({
      stripeCustomerId: 'cus_1',
      billingStatus: 'current',
    });
    await expect(useCase.execute(ctx)).resolves.toEqual({ success: true });
    expect(stripe.detachDefaultPaymentMethod).toHaveBeenCalledWith('cus_1');
    expect(repo.setBillingStatus).toHaveBeenCalledWith(ctx, 'no_card');
  });

  it('is a no-op success when there is no customer', async () => {
    repo.getClinicStripeCustomerId.mockResolvedValue({
      stripeCustomerId: null,
      billingStatus: 'no_card',
    });
    await expect(useCase.execute(ctx)).resolves.toEqual({ success: true });
    expect(stripe.detachDefaultPaymentMethod).not.toHaveBeenCalled();
    expect(repo.setBillingStatus).not.toHaveBeenCalled();
  });

  it('is a no-op success when the clinic row itself is missing', async () => {
    repo.getClinicStripeCustomerId.mockResolvedValue(null);
    await expect(useCase.execute(ctx)).resolves.toEqual({ success: true });
    expect(stripe.detachDefaultPaymentMethod).not.toHaveBeenCalled();
    expect(repo.setBillingStatus).not.toHaveBeenCalled();
  });

  it('still succeeds when the Stripe detach throws (best-effort)', async () => {
    repo.getClinicStripeCustomerId.mockResolvedValue({
      stripeCustomerId: 'cus_1',
      billingStatus: 'current',
    });
    stripe.detachDefaultPaymentMethod.mockRejectedValue(new Error('stripe down'));
    await expect(useCase.execute(ctx)).resolves.toEqual({ success: true });
    expect(repo.setBillingStatus).toHaveBeenCalledWith(ctx, 'no_card');
  });
});
