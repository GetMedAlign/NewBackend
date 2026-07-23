import { computeRevenueStats, clinicMonthlyFee, clinicLeadRevenue } from '../revenue-math';

describe('computeRevenueStats', () => {
  it('derives mrr, lead revenue, and total from the counts', () => {
    const r = computeRevenueStats({ activeClinicCount: 4, overdueCount: 1, leadsThisMonth: 7 });
    expect(r.mrr).toBe(196); // 4 * 49
    expect(r.leadRevenueMtd).toBe(630); // 7 * 90
    expect(r.totalRevenueMtd).toBe(826); // 196 + 630
    expect(r.activeClinicCount).toBe(4);
    expect(r.overdueCount).toBe(1);
    expect(r.leadsThisMonth).toBe(7);
  });

  it('is all zeros for an empty system', () => {
    expect(
      computeRevenueStats({ activeClinicCount: 0, overdueCount: 0, leadsThisMonth: 0 }),
    ).toEqual({
      mrr: 0,
      leadRevenueMtd: 0,
      totalRevenueMtd: 0,
      activeClinicCount: 0,
      overdueCount: 0,
      leadsThisMonth: 0,
    });
  });
});

describe('clinicMonthlyFee', () => {
  it('is 49 for an active, current clinic', () => {
    expect(clinicMonthlyFee('active', 'current')).toBe(49);
  });
  it('is 0 when the clinic status is suspended', () => {
    expect(clinicMonthlyFee('suspended', 'overdue')).toBe(0);
  });
  it('is 0 when the billing status is paused', () => {
    expect(clinicMonthlyFee('active', 'paused')).toBe(0);
  });
});

describe('clinicLeadRevenue', () => {
  it('is leads times 90', () => {
    expect(clinicLeadRevenue(3)).toBe(270);
    expect(clinicLeadRevenue(0)).toBe(0);
  });
});
