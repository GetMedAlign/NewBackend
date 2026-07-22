import { Injectable } from '@nestjs/common';
import type {
  StripeCard,
  StripeDefaultPaymentMethod,
  StripePort,
} from '../../domain/ports/stripe.port';

interface FakeCustomer {
  email: string;
  defaultPaymentMethodId: string | null;
}

/** In-memory StripePort for integration and e2e tests. Never hits the network. */
@Injectable()
export class FakeStripeAdapter implements StripePort {
  private readonly customers = new Map<string, FakeCustomer>();
  private seq = 0;
  private invoiceSeq = 0;
  private attachError: string | null = null;
  private createCustomerError: string | null = null;
  private invoiceError: string | null = null;

  /** Recorder: every invoice created via createAndFinalizeInvoice, for test assertions. */
  readonly invoicesCreated: Array<{
    customerId: string;
    leadCount: number;
    totalCents: number;
  }> = [];

  /** Test helper: make the next attachPaymentMethod throw with this message. */
  failNextAttach(message: string): void {
    this.attachError = message;
  }

  /** Test helper: make the next createCustomer throw with this message. */
  failNextCreateCustomer(message: string): void {
    this.createCustomerError = message;
  }

  /** Test helper: make the next createAndFinalizeInvoice throw with this message. */
  failNextInvoice(message: string): void {
    this.invoiceError = message;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createCustomer(_clinicName: string, email: string, _clinicId: string): Promise<string> {
    if (this.createCustomerError !== null) {
      const msg = this.createCustomerError;
      this.createCustomerError = null;
      throw new Error(msg);
    }
    const id = `cus_fake_${++this.seq}`;
    this.customers.set(id, { email, defaultPaymentMethodId: null });
    return id;
  }

  async getDefaultPaymentMethod(customerId: string): Promise<StripeDefaultPaymentMethod | null> {
    const c = this.customers.get(customerId);
    if (!c || c.defaultPaymentMethodId === null) return null;
    return { paymentMethodId: c.defaultPaymentMethodId, ...this.card() };
  }

  async attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<StripeCard> {
    if (this.attachError !== null) {
      const msg = this.attachError;
      this.attachError = null;
      throw new Error(msg);
    }
    const c = this.customers.get(customerId);
    if (!c) throw new Error('No such customer');
    c.defaultPaymentMethodId = paymentMethodId;
    return this.card();
  }

  async detachDefaultPaymentMethod(customerId: string): Promise<void> {
    const c = this.customers.get(customerId);
    if (c) c.defaultPaymentMethodId = null;
  }

  async updateCustomerEmail(customerId: string, email: string): Promise<void> {
    const c = this.customers.get(customerId);
    if (c) c.email = email;
  }

  /** Test helper: read back the email currently recorded for a fake customer. */
  emailFor(customerId: string): string | undefined {
    return this.customers.get(customerId)?.email;
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
    if (this.invoiceError !== null) {
      const m = this.invoiceError;
      this.invoiceError = null;
      throw new Error(m);
    }
    const id = `in_fake_${++this.invoiceSeq}`;
    const totalCents = Math.round(
      (input.leadCount * input.pricePerLead + input.platformFee + input.processingFee) * 100,
    );
    this.invoicesCreated.push({
      customerId: input.customerId,
      leadCount: input.leadCount,
      totalCents,
    });
    return { stripeInvoiceId: id, invoiceUrl: `https://stripe.test/i/${id}`, pdfUrl: null };
  }

  private card(): StripeCard {
    return { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 };
  }
}
