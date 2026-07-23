import { GetClinicBillingUseCase } from '../get-clinic-billing.use-case';

describe('GetClinicBillingUseCase', () => {
  const repo = {
    getClinicContext: jest.fn(),
    getProfile: jest.fn(),
    countInvoices: jest.fn(),
    countCurrentMonthLeads: jest.fn(),
    upsertProfile: jest.fn(),
    getClinicStripeCustomerId: jest.fn(),
    setBillingStatus: jest.fn(),
    getAdminClinicBilling: jest.fn(),
    setClinicStripeCustomerId: jest.fn(),
    cancelSubscription: jest.fn(),
    listInvoiceEligibleClinics: jest.fn(),
    countLeadsInPeriod: jest.fn(),
    countInvoicesForClinic: jest.fn(),
    insertGeneratedInvoice: jest.fn(),
    listSuspendableClinics: jest.fn(),
    suspendClinicForNonPayment: jest.fn(),
    invoiceExistsByStripeId: jest.fn(),
    markInvoicePaid: jest.fn(),
    markInvoicePaymentFailed: jest.fn(),
    listWeeklySummaryClinics: jest.fn(),
    countLeadsSince: jest.fn(),
    countAllLeads: jest.fn(),
  };
  const useCase = new GetClinicBillingUseCase(repo);
  const ctx = { clinicId: 'c1' };
  beforeEach(() => jest.resetAllMocks());

  it('builds the billing info from profile, fee estimate, and lead count', async () => {
    repo.getClinicContext.mockResolvedValue({
      clinicId: 'c1',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      status: 'active',
      billingStatus: 'current',
      stripeCustomerId: 'cus_1',
    });
    repo.getProfile.mockResolvedValue({
      billingEmail: 'bill@c.test',
      billingContactName: 'Dana',
      addressLine1: '1 St',
      addressLine2: null,
      city: 'NYC',
      stateCode: 'NY',
      zipCode: '10001',
      taxId: null,
      stripeCustomerId: 'cus_1',
    });
    repo.countInvoices.mockResolvedValue(3);
    repo.countCurrentMonthLeads.mockResolvedValue(7);

    const dto = await useCase.execute(ctx, new Date('2026-03-15T00:00:00Z'));
    expect(dto).toMatchObject({
      billingEmail: 'bill@c.test',
      stripeCustomerId: 'cus_1',
      subscriptionCancelledAt: null,
      subscriptionActiveThrough: null,
      currentPeriodLeadCount: 7,
      estimatedPlatformFee: 49,
      promoMonthsRemaining: 0,
    });
  });

  it('returns empty-profile defaults when the clinic has no billing profile', async () => {
    repo.getClinicContext.mockResolvedValue({
      clinicId: 'c1',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      status: 'active',
      billingStatus: 'no_card',
      stripeCustomerId: null,
    });
    repo.getProfile.mockResolvedValue(null);
    repo.countInvoices.mockResolvedValue(0);
    repo.countCurrentMonthLeads.mockResolvedValue(0);

    const dto = await useCase.execute(ctx, new Date('2026-05-15T00:00:00Z'));
    expect(dto.billingEmail).toBeNull();
    expect(dto.estimatedPlatformFee).toBe(0); // 2026 promo
    expect(dto.promoMonthsRemaining).toBe(2);
  });

  it('uses the clinics stripe_customer_id, not the billing profile one', async () => {
    repo.getClinicContext.mockResolvedValue({
      clinicId: 'c1',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      status: 'active',
      billingStatus: 'current',
      stripeCustomerId: 'cus_from_clinic',
    });
    repo.getProfile.mockResolvedValue({
      billingEmail: null,
      billingContactName: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      stateCode: null,
      zipCode: null,
      taxId: null,
      stripeCustomerId: 'cus_from_profile',
    });
    repo.countInvoices.mockResolvedValue(0);
    repo.countCurrentMonthLeads.mockResolvedValue(0);

    const dto = await useCase.execute({ clinicId: 'c1' }, new Date('2026-03-15T00:00:00Z'));
    expect(dto.stripeCustomerId).toBe('cus_from_clinic');
  });
});
