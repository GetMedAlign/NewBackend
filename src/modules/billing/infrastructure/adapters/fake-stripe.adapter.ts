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
  private attachError: string | null = null;

  /** Test helper: make the next attachPaymentMethod throw with this message. */
  failNextAttach(message: string): void {
    this.attachError = message;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createCustomer(_clinicName: string, email: string, _clinicId: string): Promise<string> {
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

  private card(): StripeCard {
    return { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 };
  }
}
