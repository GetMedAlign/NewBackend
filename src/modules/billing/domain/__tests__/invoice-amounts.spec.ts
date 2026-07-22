import { computeInvoiceAmounts } from '../invoice-amounts';

const APRIL_START = new Date('2025-04-01T00:00:00Z');
const MAY_START = new Date('2025-05-01T00:00:00Z'); // periodEnd for April

describe('computeInvoiceAmounts', () => {
  it('full month, no leads, non-2026: fee 49, processing 0.245->0.25, total 49.25', () => {
    const r = computeInvoiceAmounts({
      leadCount: 0,
      clinicCreatedAt: new Date('2024-01-01T00:00:00Z'),
      periodStart: APRIL_START,
      periodEnd: MAY_START,
      priorInvoiceCount: 5,
    });
    expect(r.platformFee).toBe(49);
    expect(r.platformFeeLabel).toBe('Monthly platform fee');
    expect(r.subtotal).toBe(49);
    expect(r.processingFee).toBeCloseTo(0.25, 2); // round(49*0.005)=round(0.245)=0.25
    expect(r.totalAmount).toBeCloseTo(49.25, 2);
  });

  it('leads add 90 each and feed the processing fee', () => {
    const r = computeInvoiceAmounts({
      leadCount: 3,
      clinicCreatedAt: new Date('2024-01-01T00:00:00Z'),
      periodStart: APRIL_START,
      periodEnd: MAY_START,
      priorInvoiceCount: 5,
    });
    // subtotal = 3*90 + 49 = 319; processing = round(319*0.005)=round(1.595)=1.60; total 320.60
    expect(r.subtotal).toBe(319);
    expect(r.processingFee).toBeCloseTo(1.6, 2);
    expect(r.totalAmount).toBeCloseTo(320.6, 2);
  });

  it('mid-month signup prorates the platform fee with a labeled reason', () => {
    // created Apr 16 00:00 => activeDays 15 of 30 => 24.50
    const r = computeInvoiceAmounts({
      leadCount: 0,
      clinicCreatedAt: new Date('2025-04-16T00:00:00Z'),
      periodStart: APRIL_START,
      periodEnd: MAY_START,
      priorInvoiceCount: 3,
    });
    expect(r.platformFee).toBeCloseTo(24.5, 2);
    expect(r.platformFeeLabel).toBe('Platform fee (prorated — 15 of 30 days)');
  });

  it('2026 clinic with <2 prior invoices waives the platform fee', () => {
    const r = computeInvoiceAmounts({
      leadCount: 2,
      clinicCreatedAt: new Date('2026-02-10T00:00:00Z'),
      periodStart: new Date('2026-03-01T00:00:00Z'),
      periodEnd: new Date('2026-04-01T00:00:00Z'),
      priorInvoiceCount: 1,
    });
    expect(r.platformFee).toBe(0);
    expect(r.platformFeeLabel).toBe('Monthly platform fee (2026 Welcome Promotion — waived)');
    // subtotal = 2*90 + 0 = 180; processing = round(0.9)=0.90; total 180.90
    expect(r.subtotal).toBe(180);
    expect(r.totalAmount).toBeCloseTo(180.9, 2);
  });

  it('2026 clinic with 2+ prior invoices is charged (promo exhausted)', () => {
    const r = computeInvoiceAmounts({
      leadCount: 0,
      clinicCreatedAt: new Date('2026-02-10T00:00:00Z'),
      periodStart: new Date('2026-06-01T00:00:00Z'),
      periodEnd: new Date('2026-07-01T00:00:00Z'),
      priorInvoiceCount: 2,
    });
    expect(r.platformFee).toBe(49);
    expect(r.platformFeeLabel).toBe('Monthly platform fee');
  });
});
