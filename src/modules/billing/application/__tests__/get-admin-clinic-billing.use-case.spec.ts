import { NotFoundException } from '@nestjs/common';
import { GetAdminClinicBillingUseCase } from '../get-admin-clinic-billing.use-case';

describe('GetAdminClinicBillingUseCase', () => {
  const repo = { getAdminClinicBilling: jest.fn() };
  const stripe = { getDefaultPaymentMethod: jest.fn() };
  const useCase = new GetAdminClinicBillingUseCase(repo, stripe);
  const ctx = { userId: 'admin-1', role: 'admin' };
  beforeEach(() => jest.resetAllMocks());

  it('throws 404 when the clinic does not exist', async () => {
    repo.getAdminClinicBilling.mockResolvedValue(null);
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow(NotFoundException);
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow('Clinic not found.');
  });

  it('reads the live card and returns info plus invoices', async () => {
    repo.getAdminClinicBilling.mockResolvedValue({
      row: {
        clinicId: 'c1',
        status: 'paused',
        stripeCustomerId: 'cus_1',
        billingEmail: 'b@c.test',
      },
      invoices: [
        {
          id: 'i1',
          period_start: '2026-05-01',
          period_end: '2026-06-01',
          lead_count: 4,
          total_amount: 409,
          status: 'open',
          due_date: '2026-07-01',
          paid_at: null,
          invoice_url: 'http://x',
        },
      ],
    });
    stripe.getDefaultPaymentMethod.mockResolvedValue({
      paymentMethodId: 'pm_1',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });

    const dto = await useCase.execute(ctx, 'c1');
    expect(dto.info).toEqual({
      stripeCustomerId: 'cus_1',
      billingEmail: 'b@c.test',
      cardBrand: 'visa',
      cardLast4: '4242',
      cardExpMonth: 12,
      cardExpYear: 2030,
      monthlyFee: 49,
      pricePerLead: 90,
      deliveryPaused: true,
    });
    expect(dto.invoices).toHaveLength(1);
  });

  it('returns null card fields when there is no Stripe customer', async () => {
    repo.getAdminClinicBilling.mockResolvedValue({
      row: { clinicId: 'c1', status: 'active', stripeCustomerId: null, billingEmail: null },
      invoices: [],
    });
    const dto = await useCase.execute(ctx, 'c1');
    expect(dto.info.cardBrand).toBeNull();
    expect(dto.info.deliveryPaused).toBe(false);
    expect(stripe.getDefaultPaymentMethod).not.toHaveBeenCalled();
  });
});
