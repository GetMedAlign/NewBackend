import { FakeStripeWebhookVerifier } from '../stripe-webhook-verifier.adapter';

describe('FakeStripeWebhookVerifier', () => {
  const verifier = new FakeStripeWebhookVerifier();

  it('parses the JSON body into an event, trusting it', () => {
    const body = JSON.stringify({ type: 'invoice.paid', data: { object: { id: 'in_1' } } });
    const ev = verifier.constructEvent(body, 'sig-ignored');
    expect(ev.type).toBe('invoice.paid');
    expect(ev.data.object.id).toBe('in_1');
  });

  it('throws on a body that is not valid JSON', () => {
    expect(() => verifier.constructEvent('not json', 'sig')).toThrow();
  });
});
