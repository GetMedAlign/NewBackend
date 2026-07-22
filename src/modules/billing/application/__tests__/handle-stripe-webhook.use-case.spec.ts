import { BadRequestException } from '@nestjs/common';
import { HandleStripeWebhookUseCase } from '../handle-stripe-webhook.use-case';
import { FakeStripeWebhookVerifier } from '../../infrastructure/adapters/stripe-webhook-verifier.adapter';
import type { StripeWebhookVerifier } from '../../domain/ports/stripe-webhook-verifier.port';
import type { BillingRepositoryPort } from '../../domain/ports/billing-repository.port';

function makeRepo(
  overrides: Partial<BillingRepositoryPort> = {},
): jest.Mocked<
  Pick<
    BillingRepositoryPort,
    'invoiceExistsByStripeId' | 'markInvoicePaid' | 'markInvoicePaymentFailed'
  >
> {
  return {
    invoiceExistsByStripeId: jest.fn().mockResolvedValue(true),
    markInvoicePaid: jest.fn().mockResolvedValue(undefined),
    markInvoicePaymentFailed: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<
    Pick<
      BillingRepositoryPort,
      'invoiceExistsByStripeId' | 'markInvoicePaid' | 'markInvoicePaymentFailed'
    >
  >;
}

function stripeEventBody(type: string, id: string): Buffer {
  return Buffer.from(JSON.stringify({ type, data: { object: { id } } }));
}

describe('HandleStripeWebhookUseCase', () => {
  it('marks the invoice paid for a known invoice.paid event', async () => {
    const repo = makeRepo();
    const useCase = new HandleStripeWebhookUseCase(
      repo as unknown as BillingRepositoryPort,
      new FakeStripeWebhookVerifier(),
    );

    await useCase.handle(stripeEventBody('invoice.paid', 'in_123'), 'sig');

    expect(repo.invoiceExistsByStripeId).toHaveBeenCalledWith('in_123');
    expect(repo.markInvoicePaid).toHaveBeenCalledWith('in_123');
    expect(repo.markInvoicePaymentFailed).not.toHaveBeenCalled();
  });

  it('marks the invoice payment failed for a known invoice.payment_failed event', async () => {
    const repo = makeRepo();
    const useCase = new HandleStripeWebhookUseCase(
      repo as unknown as BillingRepositoryPort,
      new FakeStripeWebhookVerifier(),
    );

    await useCase.handle(stripeEventBody('invoice.payment_failed', 'in_456'), 'sig');

    expect(repo.invoiceExistsByStripeId).toHaveBeenCalledWith('in_456');
    expect(repo.markInvoicePaymentFailed).toHaveBeenCalledWith('in_456');
    expect(repo.markInvoicePaid).not.toHaveBeenCalled();
  });

  it('no-ops without throwing for invoice.paid with an unknown stripe invoice id', async () => {
    const repo = makeRepo({ invoiceExistsByStripeId: jest.fn().mockResolvedValue(false) });
    const useCase = new HandleStripeWebhookUseCase(
      repo as unknown as BillingRepositoryPort,
      new FakeStripeWebhookVerifier(),
    );

    await expect(
      useCase.handle(stripeEventBody('invoice.paid', 'in_unknown'), 'sig'),
    ).resolves.toBeUndefined();
    expect(repo.markInvoicePaid).not.toHaveBeenCalled();
  });

  it('no-ops without throwing for invoice.payment_failed with an unknown stripe invoice id', async () => {
    const repo = makeRepo({ invoiceExistsByStripeId: jest.fn().mockResolvedValue(false) });
    const useCase = new HandleStripeWebhookUseCase(
      repo as unknown as BillingRepositoryPort,
      new FakeStripeWebhookVerifier(),
    );

    await expect(
      useCase.handle(stripeEventBody('invoice.payment_failed', 'in_unknown'), 'sig'),
    ).resolves.toBeUndefined();
    expect(repo.markInvoicePaymentFailed).not.toHaveBeenCalled();
  });

  it('does nothing for an event type it does not handle', async () => {
    const repo = makeRepo();
    const useCase = new HandleStripeWebhookUseCase(
      repo as unknown as BillingRepositoryPort,
      new FakeStripeWebhookVerifier(),
    );

    await useCase.handle(stripeEventBody('customer.updated', 'in_1'), 'sig');

    expect(repo.invoiceExistsByStripeId).not.toHaveBeenCalled();
    expect(repo.markInvoicePaid).not.toHaveBeenCalled();
    expect(repo.markInvoicePaymentFailed).not.toHaveBeenCalled();
  });

  it('propagates a bad-signature failure from the verifier as a BadRequestException without touching the repo', async () => {
    const repo = makeRepo();
    const throwingVerifier: StripeWebhookVerifier = {
      constructEvent: () => {
        throw new Error('signature mismatch');
      },
    };
    const useCase = new HandleStripeWebhookUseCase(
      repo as unknown as BillingRepositoryPort,
      throwingVerifier,
    );

    await expect(useCase.handle(Buffer.from('{}'), 'bad-sig')).rejects.toThrow(BadRequestException);
    expect(repo.invoiceExistsByStripeId).not.toHaveBeenCalled();
    expect(repo.markInvoicePaid).not.toHaveBeenCalled();
    expect(repo.markInvoicePaymentFailed).not.toHaveBeenCalled();
  });
});
