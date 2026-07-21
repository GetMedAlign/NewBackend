import { UpdateClinicBillingUseCase } from '../update-clinic-billing.use-case';

describe('UpdateClinicBillingUseCase', () => {
  const repo = { upsertProfile: jest.fn() };
  const stripe = { updateCustomerEmail: jest.fn() };
  const useCase = new UpdateClinicBillingUseCase(repo, stripe);
  const ctx = { clinicId: 'c1' };
  beforeEach(() => jest.resetAllMocks());

  it('upserts the profile and returns success', async () => {
    repo.upsertProfile.mockResolvedValue({ oldEmail: 'old@c.test', stripeCustomerId: 'cus_1' });
    await expect(useCase.execute(ctx, { billingContactName: 'Dana' })).resolves.toEqual({
      success: true,
    });
    expect(repo.upsertProfile).toHaveBeenCalledWith(ctx, { billingContactName: 'Dana' });
    expect(stripe.updateCustomerEmail).not.toHaveBeenCalled();
  });

  it('syncs a changed billing email to Stripe', async () => {
    repo.upsertProfile.mockResolvedValue({ oldEmail: 'old@c.test', stripeCustomerId: 'cus_1' });
    await useCase.execute(ctx, { billingEmail: 'new@c.test' });
    expect(stripe.updateCustomerEmail).toHaveBeenCalledWith('cus_1', 'new@c.test');
  });

  it('does not sync when the email is unchanged', async () => {
    repo.upsertProfile.mockResolvedValue({ oldEmail: 'same@c.test', stripeCustomerId: 'cus_1' });
    await useCase.execute(ctx, { billingEmail: 'same@c.test' });
    expect(stripe.updateCustomerEmail).not.toHaveBeenCalled();
  });

  it('still succeeds when the Stripe email sync throws (best-effort)', async () => {
    repo.upsertProfile.mockResolvedValue({ oldEmail: null, stripeCustomerId: 'cus_1' });
    stripe.updateCustomerEmail.mockRejectedValue(new Error('stripe down'));
    await expect(useCase.execute(ctx, { billingEmail: 'new@c.test' })).resolves.toEqual({
      success: true,
    });
  });

  it('skips the sync when the clinic has no Stripe customer', async () => {
    repo.upsertProfile.mockResolvedValue({ oldEmail: null, stripeCustomerId: null });
    await useCase.execute(ctx, { billingEmail: 'new@c.test' });
    expect(stripe.updateCustomerEmail).not.toHaveBeenCalled();
  });
});
