import { estimatePlatformFee, PLATFORM_FEE } from '../billing-fee';

describe('estimatePlatformFee', () => {
  it('charges the full fee for a clinic that existed before this month (non-2026)', () => {
    const r = estimatePlatformFee({
      clinicCreatedAt: new Date('2025-01-10T00:00:00Z'),
      now: new Date('2026-03-15T00:00:00Z'),
      invoiceCount: 5,
    });
    expect(r.estimatedPlatformFee).toBe(PLATFORM_FEE);
    expect(r.promoMonthsRemaining).toBe(0);
  });

  it('waives the fee for a 2026 clinic with fewer than 2 invoices', () => {
    const r = estimatePlatformFee({
      clinicCreatedAt: new Date('2026-02-01T00:00:00Z'),
      now: new Date('2026-05-15T00:00:00Z'),
      invoiceCount: 1,
    });
    expect(r.estimatedPlatformFee).toBe(0);
    expect(r.promoMonthsRemaining).toBe(1);
  });

  it('charges a 2026 clinic once it has 2+ invoices', () => {
    const r = estimatePlatformFee({
      clinicCreatedAt: new Date('2026-02-01T00:00:00Z'),
      now: new Date('2026-06-15T00:00:00Z'),
      invoiceCount: 2,
    });
    expect(r.estimatedPlatformFee).toBe(PLATFORM_FEE);
    expect(r.promoMonthsRemaining).toBe(0);
  });

  it('prorates a mid-month signup (non-2026)', () => {
    // April has 30 days; created on the 16th 00:00 UTC => active from 16th to 30th = 14 days
    const r = estimatePlatformFee({
      clinicCreatedAt: new Date('2025-04-16T00:00:00Z'),
      now: new Date('2025-04-20T00:00:00Z'),
      invoiceCount: 0,
    });
    // round(49 * 14/30, 2) = round(22.8666..) = 22.87
    expect(r.estimatedPlatformFee).toBeCloseTo(22.87, 2);
    expect(r.promoMonthsRemaining).toBe(0);
  });

  it('a mid-month 2026 signup with <2 invoices is still waived to 0', () => {
    const r = estimatePlatformFee({
      clinicCreatedAt: new Date('2026-04-16T00:00:00Z'),
      now: new Date('2026-04-20T00:00:00Z'),
      invoiceCount: 0,
    });
    expect(r.estimatedPlatformFee).toBe(0);
    expect(r.promoMonthsRemaining).toBe(2);
  });
});
