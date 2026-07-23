import { GetRevenueClinicsUseCase } from '../get-revenue-clinics.use-case';

describe('GetRevenueClinicsUseCase', () => {
  const repo = { getClinicRevenueRows: jest.fn() };
  const useCase = new GetRevenueClinicsUseCase(repo);
  beforeEach(() => jest.resetAllMocks());

  it('maps each clinic, zeroing the fee for suspended/paused', async () => {
    repo.getClinicRevenueRows.mockResolvedValue([
      {
        clinicId: 'c1',
        clinicName: 'Apex',
        status: 'active',
        billingStatus: 'current',
        leadsThisMonth: 2,
      },
      {
        clinicId: 'c2',
        clinicName: 'Vitality',
        status: 'suspended',
        billingStatus: 'overdue',
        leadsThisMonth: 1,
      },
    ]);
    const rows = await useCase.execute(
      { userId: 'a1', role: 'admin' },
      new Date('2026-07-15T00:00:00Z'),
    );
    expect(rows[0]).toEqual({
      clinicId: 'c1',
      clinicName: 'Apex',
      leadsThisMonth: 2,
      leadRevenue: 180,
      monthlyFee: 49,
      total: 229,
      billingStatus: 'current',
    });
    expect(rows[1]).toEqual({
      clinicId: 'c2',
      clinicName: 'Vitality',
      leadsThisMonth: 1,
      leadRevenue: 90,
      monthlyFee: 0,
      total: 90,
      billingStatus: 'overdue',
    });
  });
});
