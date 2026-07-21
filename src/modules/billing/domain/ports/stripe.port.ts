export interface StripeCard {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}
export interface StripeDefaultPaymentMethod extends StripeCard {
  paymentMethodId: string;
}
export interface StripePort {
  createCustomer(clinicName: string, email: string, clinicId: string): Promise<string>;
  getDefaultPaymentMethod(customerId: string): Promise<StripeDefaultPaymentMethod | null>;
  attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<StripeCard>;
  detachDefaultPaymentMethod(customerId: string): Promise<void>;
  updateCustomerEmail(customerId: string, email: string): Promise<void>;
}
export const STRIPE_PORT = Symbol('StripePort');
