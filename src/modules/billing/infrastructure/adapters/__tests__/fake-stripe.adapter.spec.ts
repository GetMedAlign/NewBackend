import { FakeStripeAdapter } from '../fake-stripe.adapter';

describe('FakeStripeAdapter', () => {
  let stripe: FakeStripeAdapter;
  beforeEach(() => {
    stripe = new FakeStripeAdapter();
  });

  it('creates a customer and returns a deterministic id', async () => {
    const id = await stripe.createCustomer('Vitality', 'billing@clinic.test', 'clinic-1');
    expect(id).toMatch(/^cus_/);
  });

  it('returns null default payment method for a fresh customer', async () => {
    const id = await stripe.createCustomer('Vitality', 'a@b.test', 'clinic-1');
    expect(await stripe.getDefaultPaymentMethod(id)).toBeNull();
  });

  it('attaches a card, then returns it as the default', async () => {
    const id = await stripe.createCustomer('Vitality', 'a@b.test', 'clinic-1');
    const card = await stripe.attachPaymentMethod(id, 'pm_visa');
    expect(card).toEqual({ brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 });
    const def = await stripe.getDefaultPaymentMethod(id);
    expect(def).toEqual({
      paymentMethodId: 'pm_visa',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });
  });

  it('detaches the default and then returns null', async () => {
    const id = await stripe.createCustomer('Vitality', 'a@b.test', 'clinic-1');
    await stripe.attachPaymentMethod(id, 'pm_visa');
    await stripe.detachDefaultPaymentMethod(id);
    expect(await stripe.getDefaultPaymentMethod(id)).toBeNull();
  });

  it('returns null for an unknown customer', async () => {
    expect(await stripe.getDefaultPaymentMethod('cus_nope')).toBeNull();
  });

  it('lets a test force an attach failure', async () => {
    const id = await stripe.createCustomer('Vitality', 'a@b.test', 'clinic-1');
    stripe.failNextAttach('Your card was declined.');
    await expect(stripe.attachPaymentMethod(id, 'pm_bad')).rejects.toThrow(
      'Your card was declined.',
    );
  });
});
