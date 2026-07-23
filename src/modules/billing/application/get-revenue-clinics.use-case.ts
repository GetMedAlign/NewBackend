import { Inject, Injectable } from '@nestjs/common';
import {
  BILLING_REPOSITORY,
  type AdminBillingCtx,
  type ClinicRevenueRaw,
} from '../domain/ports/billing-repository.port';
import { clinicLeadRevenue, clinicMonthlyFee } from '../domain/revenue-math';
import { ClinicRevenueRowDto } from '../infrastructure/http/dto/clinic-revenue-row.dto';

type BillingRepositoryForRevenueClinics = {
  getClinicRevenueRows(ctx: AdminBillingCtx, now: Date): Promise<ClinicRevenueRaw[]>;
};

@Injectable()
export class GetRevenueClinicsUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly repo: BillingRepositoryForRevenueClinics,
  ) {}

  async execute(ctx: AdminBillingCtx, now: Date): Promise<ClinicRevenueRowDto[]> {
    const rows = await this.repo.getClinicRevenueRows(ctx, now);
    return rows.map((row) => {
      const leadRevenue = clinicLeadRevenue(row.leadsThisMonth);
      const monthlyFee = clinicMonthlyFee(row.status, row.billingStatus);

      const dto = new ClinicRevenueRowDto();
      dto.clinicId = row.clinicId;
      dto.clinicName = row.clinicName;
      dto.leadsThisMonth = row.leadsThisMonth;
      dto.leadRevenue = leadRevenue;
      dto.monthlyFee = monthlyFee;
      dto.total = leadRevenue + monthlyFee;
      dto.billingStatus = row.billingStatus;
      return dto;
    });
  }
}
