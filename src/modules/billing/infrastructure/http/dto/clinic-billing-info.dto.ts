import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClinicBillingInfoDto {
  @ApiPropertyOptional({ nullable: true })
  billingEmail!: string | null;

  @ApiPropertyOptional({ nullable: true })
  billingContactName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressLine1!: string | null;

  @ApiPropertyOptional({ nullable: true })
  addressLine2!: string | null;

  @ApiPropertyOptional({ nullable: true })
  city!: string | null;

  @ApiPropertyOptional({ nullable: true })
  stateCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  zipCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  taxId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  stripeCustomerId!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Always null in this subsystem; populated once subscriptions land.',
  })
  subscriptionCancelledAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Always null in this subsystem; populated once subscriptions land.',
  })
  subscriptionActiveThrough!: string | null;

  @ApiProperty({
    description: "Count of this clinic's leads received since the start of this month",
  })
  currentPeriodLeadCount!: number;

  @ApiProperty({ description: 'Estimated platform fee for the current billing period' })
  estimatedPlatformFee!: number;

  @ApiProperty({ description: 'Remaining months of the 2026 Welcome Promotion fee waiver' })
  promoMonthsRemaining!: number;
}
