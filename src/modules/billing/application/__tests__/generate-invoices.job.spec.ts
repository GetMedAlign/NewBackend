import { GenerateInvoicesJob } from '../generate-invoices.job';
import type {
  BillingRepositoryPort,
  EligibleClinic,
} from '../../domain/ports/billing-repository.port';
import type { StripePort } from '../../domain/ports/stripe.port';
import type { EmailSenderPort } from '../../../auth/infrastructure/adapters/email-sender.port';

function makeRepo(
  overrides: Partial<BillingRepositoryPort> = {},
): jest.Mocked<
  Pick<
    BillingRepositoryPort,
    | 'listInvoiceEligibleClinics'
    | 'countLeadsInPeriod'
    | 'countInvoicesForClinic'
    | 'insertGeneratedInvoice'
  >
> {
  return {
    listInvoiceEligibleClinics: jest.fn().mockResolvedValue([]),
    countLeadsInPeriod: jest.fn().mockResolvedValue(0),
    countInvoicesForClinic: jest.fn().mockResolvedValue(0),
    insertGeneratedInvoice: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<
    Pick<
      BillingRepositoryPort,
      | 'listInvoiceEligibleClinics'
      | 'countLeadsInPeriod'
      | 'countInvoicesForClinic'
      | 'insertGeneratedInvoice'
    >
  >;
}

function makeStripe(
  overrides: Partial<StripePort> = {},
): jest.Mocked<Pick<StripePort, 'createAndFinalizeInvoice'>> {
  return {
    createAndFinalizeInvoice: jest.fn().mockResolvedValue({
      stripeInvoiceId: 'in_default',
      invoiceUrl: null,
      pdfUrl: null,
    }),
    ...overrides,
  } as jest.Mocked<Pick<StripePort, 'createAndFinalizeInvoice'>>;
}

function makeEmail(send: jest.Mock = jest.fn().mockResolvedValue(undefined)): EmailSenderPort {
  return { send };
}

const eligibleClinic: EligibleClinic = {
  clinicId: 'c1',
  clinicName: 'Vitality',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  stripeCustomerId: 'cus_1',
  billingEmail: 'b@c.test',
};

describe('GenerateInvoicesJob', () => {
  it('generates an invoice for an eligible clinic and returns counts', async () => {
    const repo = makeRepo({
      listInvoiceEligibleClinics: jest.fn().mockResolvedValue([eligibleClinic]),
      countLeadsInPeriod: jest.fn().mockResolvedValue(2),
      countInvoicesForClinic: jest.fn().mockResolvedValue(5),
    });
    const stripe = makeStripe({
      createAndFinalizeInvoice: jest.fn().mockResolvedValue({
        stripeInvoiceId: 'in_1',
        invoiceUrl: 'http://x',
        pdfUrl: null,
      }),
    });
    const email = makeEmail();
    const job = new GenerateInvoicesJob(
      repo as unknown as BillingRepositoryPort,
      stripe as unknown as StripePort,
      email,
    );

    const r = await job.execute(new Date('2025-05-05T00:00:00Z')); // invoices April

    expect(stripe.createAndFinalizeInvoice).toHaveBeenCalled();
    expect(repo.insertGeneratedInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: 'c1',
        stripeInvoiceId: 'in_1',
        leadCount: 2,
        pricePerLead: 90,
      }),
    );
    expect(r).toMatchObject({ job: 'invoice-generation', processed: 1, skipped: 0, failed: 0 });
  });

  it('computes the previous-month period and passes it through to Stripe and the insert', async () => {
    const repo = makeRepo({
      listInvoiceEligibleClinics: jest.fn().mockResolvedValue([eligibleClinic]),
      countLeadsInPeriod: jest.fn().mockResolvedValue(1),
      countInvoicesForClinic: jest.fn().mockResolvedValue(0),
    });
    const stripe = makeStripe();
    const job = new GenerateInvoicesJob(
      repo as unknown as BillingRepositoryPort,
      stripe as unknown as StripePort,
      makeEmail(),
    );

    await job.execute(new Date('2025-05-05T00:00:00Z'));

    const periodStart = new Date(Date.UTC(2025, 3, 1));
    const periodEnd = new Date(Date.UTC(2025, 4, 1));
    const dueDate = new Date(periodEnd.getTime() + 30 * 24 * 60 * 60 * 1000);

    expect(repo.listInvoiceEligibleClinics).toHaveBeenCalledWith(periodStart, periodEnd);
    expect(stripe.createAndFinalizeInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_1',
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      }),
    );
    expect(repo.insertGeneratedInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        periodStart,
        periodEnd,
        dueDate,
      }),
    );
  });

  it('counts a clinic whose Stripe call throws as failed, without stopping the others', async () => {
    const clinicOk: EligibleClinic = {
      ...eligibleClinic,
      clinicId: 'c-ok',
      stripeCustomerId: 'cus_ok',
    };
    const clinicBad: EligibleClinic = {
      ...eligibleClinic,
      clinicId: 'c-bad',
      stripeCustomerId: 'cus_bad',
    };
    const repo = makeRepo({
      listInvoiceEligibleClinics: jest.fn().mockResolvedValue([clinicBad, clinicOk]),
    });
    const stripe = makeStripe({
      createAndFinalizeInvoice: jest.fn().mockImplementation(({ customerId }) => {
        if (customerId === 'cus_bad') throw new Error('stripe is down');
        return Promise.resolve({ stripeInvoiceId: 'in_ok', invoiceUrl: null, pdfUrl: null });
      }),
    });
    const job = new GenerateInvoicesJob(
      repo as unknown as BillingRepositoryPort,
      stripe as unknown as StripePort,
      makeEmail(),
    );

    const r = await job.execute(new Date('2025-05-05T00:00:00Z'));

    expect(r).toMatchObject({ job: 'invoice-generation', processed: 1, skipped: 0, failed: 1 });
    expect(repo.insertGeneratedInvoice).toHaveBeenCalledTimes(1);
    expect(repo.insertGeneratedInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'c-ok' }),
    );
  });

  it('does not fail the clinic when the best-effort invoice email throws', async () => {
    const repo = makeRepo({
      listInvoiceEligibleClinics: jest.fn().mockResolvedValue([eligibleClinic]),
    });
    const stripe = makeStripe();
    const send = jest.fn().mockRejectedValue(new Error('smtp down'));
    const job = new GenerateInvoicesJob(
      repo as unknown as BillingRepositoryPort,
      stripe as unknown as StripePort,
      makeEmail(send),
    );

    const r = await job.execute(new Date('2025-05-05T00:00:00Z'));

    expect(r).toMatchObject({ job: 'invoice-generation', processed: 1, skipped: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends the invoice email to billingEmail', async () => {
    const repo = makeRepo({
      listInvoiceEligibleClinics: jest.fn().mockResolvedValue([eligibleClinic]),
    });
    const stripe = makeStripe();
    const send = jest.fn().mockResolvedValue(undefined);
    const job = new GenerateInvoicesJob(
      repo as unknown as BillingRepositoryPort,
      stripe as unknown as StripePort,
      makeEmail(send),
    );

    await job.execute(new Date('2025-05-05T00:00:00Z'));

    expect(send).toHaveBeenCalledWith('b@c.test', expect.any(String), expect.any(String));
  });

  it('returns all zeros when there are no eligible clinics', async () => {
    const repo = makeRepo();
    const stripe = makeStripe();
    const job = new GenerateInvoicesJob(
      repo as unknown as BillingRepositoryPort,
      stripe as unknown as StripePort,
      makeEmail(),
    );

    const r = await job.execute(new Date('2025-05-05T00:00:00Z'));

    expect(r).toEqual({ job: 'invoice-generation', processed: 0, skipped: 0, failed: 0 });
    expect(stripe.createAndFinalizeInvoice).not.toHaveBeenCalled();
  });
});
