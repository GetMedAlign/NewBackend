import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type {
  StripeCard,
  StripeDefaultPaymentMethod,
  StripePort,
} from '../../domain/ports/stripe.port';
import type { Env } from '../../../../infrastructure/config/env.schema';

/** Real StripePort backed by the `stripe` Node SDK. Used only outside tests. */
@Injectable()
export class StripeAdapter implements StripePort {
  private readonly logger = new Logger(StripeAdapter.name);
  private readonly stripe: Stripe;

  constructor(configService: ConfigService<Env, true>) {
    const secretKey = configService.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.stripe = new Stripe(secretKey, { apiVersion: '2026-06-24.dahlia' });
  }

  async createCustomer(clinicName: string, email: string, clinicId: string): Promise<string> {
    const customer = await this.stripe.customers.create({
      name: clinicName,
      email,
      metadata: { clinicId, source: 'medalign' },
    });
    return customer.id;
  }

  async getDefaultPaymentMethod(customerId: string): Promise<StripeDefaultPaymentMethod | null> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId, {
        expand: ['invoice_settings.default_payment_method'],
      });
      if (customer.deleted) {
        return null;
      }
      const paymentMethod = customer.invoice_settings.default_payment_method;
      if (!paymentMethod || typeof paymentMethod === 'string') {
        return null;
      }
      const card = paymentMethod.card;
      if (!card) {
        return null;
      }
      return {
        paymentMethodId: paymentMethod.id,
        brand: card.brand,
        last4: card.last4,
        expMonth: card.exp_month,
        expYear: card.exp_year,
      };
    } catch (error: unknown) {
      if (!this.isResourceMissing(error)) {
        this.logger.warn(
          `getDefaultPaymentMethod failed for customer ${customerId}: ${this.errorMessage(error)}`,
        );
      }
      return null;
    }
  }

  async attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<StripeCard> {
    const paymentMethod = await this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
    await this.stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
    const card = paymentMethod.card;
    if (!card) {
      throw new Error('Attached payment method has no card details');
    }
    return {
      brand: card.brand,
      last4: card.last4,
      expMonth: card.exp_month,
      expYear: card.exp_year,
    };
  }

  async detachDefaultPaymentMethod(customerId: string): Promise<void> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId, {
        expand: ['invoice_settings.default_payment_method'],
      });
      if (customer.deleted) {
        return;
      }
      const paymentMethod = customer.invoice_settings.default_payment_method;
      const paymentMethodId = typeof paymentMethod === 'string' ? paymentMethod : paymentMethod?.id;
      if (!paymentMethodId) {
        return;
      }
      await this.stripe.paymentMethods.detach(paymentMethodId);
    } catch (error: unknown) {
      this.logger.warn(
        `detachDefaultPaymentMethod failed for customer ${customerId}: ${this.errorMessage(error)}`,
      );
    }
  }

  async updateCustomerEmail(customerId: string, email: string): Promise<void> {
    await this.stripe.customers.update(customerId, { email });
  }

  async createAndFinalizeInvoice(input: {
    customerId: string;
    clinicName: string;
    leadCount: number;
    pricePerLead: number;
    platformFee: number;
    platformFeeLabel: string;
    processingFee: number;
    periodStart: string;
    periodEnd: string;
  }): Promise<{ stripeInvoiceId: string; invoiceUrl: string | null; pdfUrl: string | null }> {
    const invoice = await this.stripe.invoices.create({
      customer: input.customerId,
      collection_method: 'send_invoice',
      days_until_due: 30,
      auto_advance: false,
      description: `MedAlign — ${input.clinicName} — ${input.periodStart} to ${input.periodEnd}`,
    });

    // Pin every item to this invoice id (never create pending items — Stripe
    // could sweep those into a different draft invoice for this customer).
    if (input.leadCount > 0) {
      await this.stripe.invoiceItems.create({
        customer: input.customerId,
        invoice: invoice.id,
        amount: Math.round(input.leadCount * input.pricePerLead * 100),
        currency: 'usd',
        description: `${input.leadCount} patient lead(s) × $${input.pricePerLead}`,
      });
    }
    await this.stripe.invoiceItems.create({
      customer: input.customerId,
      invoice: invoice.id,
      amount: Math.round(input.platformFee * 100),
      currency: 'usd',
      description: input.platformFeeLabel,
    });
    await this.stripe.invoiceItems.create({
      customer: input.customerId,
      invoice: invoice.id,
      amount: Math.round(input.processingFee * 100),
      currency: 'usd',
      description: 'Processing fee (0.5%)',
    });

    const finalized = await this.stripe.invoices.finalizeInvoice(invoice.id, {
      auto_advance: false,
    });
    return {
      stripeInvoiceId: finalized.id,
      invoiceUrl: finalized.hosted_invoice_url ?? null,
      pdfUrl: finalized.invoice_pdf ?? null,
    };
  }

  private isResourceMissing(error: unknown): boolean {
    return error instanceof Stripe.errors.StripeError && error.code === 'resource_missing';
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
