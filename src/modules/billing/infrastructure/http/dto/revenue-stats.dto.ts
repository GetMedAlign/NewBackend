import { ApiProperty } from '@nestjs/swagger';

/** Returned by GET /admin/revenue/stats (spec §1.1). */
export class RevenueStatsDto {
  @ApiProperty({
    description: 'Flat headline MRR: activeClinicCount * 49 (not the invoiced amount)',
  })
  mrr!: number;

  @ApiProperty({ description: 'leadsThisMonth * 90' })
  leadRevenueMtd!: number;

  @ApiProperty({ description: 'mrr + leadRevenueMtd' })
  totalRevenueMtd!: number;

  @ApiProperty({ description: "Count of clinics with status = 'active'" })
  activeClinicCount!: number;

  @ApiProperty({ description: "Count of clinics with billing_status = 'overdue'" })
  overdueCount!: number;

  @ApiProperty({
    description: 'Count of leads received since the start of this calendar month (UTC)',
  })
  leadsThisMonth!: number;
}
