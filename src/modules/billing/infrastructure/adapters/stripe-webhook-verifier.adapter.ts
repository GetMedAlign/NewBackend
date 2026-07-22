import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Env } from '../../../../infrastructure/config/env.schema';
import type {
  StripeWebhookEvent,
  StripeWebhookVerifier,
} from '../../domain/ports/stripe-webhook-verifier.port';

/** Real StripeWebhookVerifier backed by the `stripe` Node SDK. Used only outside tests. */
@Injectable()
export class StripeWebhookVerifierAdapter implements StripeWebhookVerifier {
  private readonly stripe: Stripe;
  private readonly secret: string;
  constructor(config: ConfigService<Env, true>) {
    this.stripe = new Stripe(config.getOrThrow('STRIPE_SECRET_KEY', { infer: true }), {
      apiVersion: '2026-06-24.dahlia',
    });
    this.secret = config.getOrThrow('STRIPE_WEBHOOK_SECRET', { infer: true });
  }
  constructEvent(rawBody: Buffer | string, signature: string): StripeWebhookEvent {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.secret);
    return event as unknown as StripeWebhookEvent;
  }
}

/** Test verifier: trusts the JSON body, no signature check. */
@Injectable()
export class FakeStripeWebhookVerifier implements StripeWebhookVerifier {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructEvent(rawBody: Buffer | string, _signature: string): StripeWebhookEvent {
    const parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8'));
    return parsed as StripeWebhookEvent;
  }
}
