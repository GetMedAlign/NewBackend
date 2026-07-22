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

  it('records an updated email and lets a test read it back', async () => {
    const id = await stripe.createCustomer('Vitality', 'a@b.test', 'clinic-1');
    await stripe.updateCustomerEmail(id, 'new@b.test');
    expect(stripe.emailFor(id)).toBe('new@b.test');
  });

  it('lets a test force an attach failure', async () => {
    const id = await stripe.createCustomer('Vitality', 'a@b.test', 'clinic-1');
    stripe.failNextAttach('Your card was declined.');
    await expect(stripe.attachPaymentMethod(id, 'pm_bad')).rejects.toThrow(
      'Your card was declined.',
    );
  });

  it('createAndFinalizeInvoice returns a deterministic invoice and records the call', async () => {
    const cus = await stripe.createCustomer('Vitality', 'a@b.test', 'clinic-1');
    const r = await stripe.createAndFinalizeInvoice({
      customerId: cus,
      clinicName: 'Vitality',
      leadCount: 3,
      pricePerLead: 90,
      platformFee: 49,
      platformFeeLabel: 'Monthly platform fee',
      processingFee: 1.6,
      periodStart: '2025-04-01',
      periodEnd: '2025-05-01',
    });
    expect(r.stripeInvoiceId).toMatch(/^in_fake_/);
    expect(r.invoiceUrl).toContain(r.stripeInvoiceId);
    expect(stripe.invoicesCreated).toHaveLength(1);
    expect(stripe.invoicesCreated[0]).toMatchObject({
      customerId: cus,
      leadCount: 3,
      totalCents: expect.any(Number),
    });
  });

  it('createAndFinalizeInvoice can be forced to fail', async () => {
    const cus = await stripe.createCustomer('V', 'a@b.test', 'c1');
    stripe.failNextInvoice('stripe invoice error');
    await expect(
      stripe.createAndFinalizeInvoice({
        customerId: cus,
        clinicName: 'V',
        leadCount: 0,
        pricePerLead: 90,
        platformFee: 49,
        platformFeeLabel: 'x',
        processingFee: 0.25,
        periodStart: '2025-04-01',
        periodEnd: '2025-05-01',
      }),
    ).rejects.toThrow('stripe invoice error');
  });
});
