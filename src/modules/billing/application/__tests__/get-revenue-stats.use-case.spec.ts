import { GetRevenueStatsUseCase } from '../get-revenue-stats.use-case';

describe('GetRevenueStatsUseCase', () => {
  const repo = { getRevenueCounts: jest.fn() };
  const useCase = new GetRevenueStatsUseCase(repo);
  beforeEach(() => jest.resetAllMocks());

  it('returns the computed revenue stats', async () => {
    repo.getRevenueCounts.mockResolvedValue({
      activeClinicCount: 4,
      overdueCount: 1,
      leadsThisMonth: 7,
    });
    const dto = await useCase.execute(
      { userId: 'a1', role: 'admin' },
      new Date('2026-07-15T00:00:00Z'),
    );
    expect(dto).toEqual({
      mrr: 196,
      leadRevenueMtd: 630,
      totalRevenueMtd: 826,
      activeClinicCount: 4,
      overdueCount: 1,
      leadsThisMonth: 7,
    });
    expect(repo.getRevenueCounts).toHaveBeenCalledWith(
      { userId: 'a1', role: 'admin' },
      new Date('2026-07-15T00:00:00Z'),
    );
  });
});
