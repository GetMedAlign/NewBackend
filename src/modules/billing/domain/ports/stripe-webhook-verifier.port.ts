export interface StripeWebhookEvent {
  type: string;
  data: { object: { id: string; [k: string]: unknown } };
}
export interface StripeWebhookVerifier {
  constructEvent(rawBody: Buffer | string, signature: string): StripeWebhookEvent;
}
export const STRIPE_WEBHOOK_VERIFIER = Symbol('StripeWebhookVerifier');
