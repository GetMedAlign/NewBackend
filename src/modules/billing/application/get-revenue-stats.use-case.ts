import { Inject, Injectable } from '@nestjs/common';
import {
  BILLING_REPOSITORY,
  type AdminBillingCtx,
  type RevenueCounts,
} from '../domain/ports/billing-repository.port';
import { computeRevenueStats } from '../domain/revenue-math';
import { RevenueStatsDto } from '../infrastructure/http/dto/revenue-stats.dto';

type BillingRepositoryForRevenueStats = {
  getRevenueCounts(ctx: AdminBillingCtx, now: Date): Promise<RevenueCounts>;
};

@Injectable()
export class GetRevenueStatsUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly repo: BillingRepositoryForRevenueStats,
  ) {}

  async execute(ctx: AdminBillingCtx, now: Date): Promise<RevenueStatsDto> {
    const counts = await this.repo.getRevenueCounts(ctx, now);
    const stats = computeRevenueStats(counts);

    const dto = new RevenueStatsDto();
    dto.mrr = stats.mrr;
    dto.leadRevenueMtd = stats.leadRevenueMtd;
    dto.totalRevenueMtd = stats.totalRevenueMtd;
    dto.activeClinicCount = stats.activeClinicCount;
    dto.overdueCount = stats.overdueCount;
    dto.leadsThisMonth = stats.leadsThisMonth;
    return dto;
  }
}
