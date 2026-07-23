import { ApiProperty } from '@nestjs/swagger';

/** One row returned by GET /admin/revenue/clinics (spec §1.2). */
export class ClinicRevenueRowDto {
  @ApiProperty({ description: 'Clinic id (uuid)' })
  clinicId!: string;

  @ApiProperty({ description: 'Clinic name' })
  clinicName!: string;

  @ApiProperty({
    description:
      "Count of this clinic's leads received since the start of this calendar month (UTC)",
  })
  leadsThisMonth!: number;

  @ApiProperty({ description: 'leadsThisMonth * 90' })
  leadRevenue!: number;

  @ApiProperty({
    description: "0 when status = 'suspended' or billing_status = 'paused', else 49",
  })
  monthlyFee!: number;

  @ApiProperty({ description: 'leadRevenue + monthlyFee' })
  total!: number;

  @ApiProperty({ description: "The clinic's billing_status" })
  billingStatus!: string;
}
