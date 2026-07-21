import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Returned as `info` by GET /admin/clinics/:id/billing (spec §1.7).
 *
 * Unlike the clinic-facing GET /clinic/portal/billing endpoint,
 * `stripeCustomerId` here is the COALESCE of billing_profiles.stripe_customer_id
 * and clinics.stripe_customer_id — the admin view, not the clinic-only view.
 * Card fields are read live from Stripe only when a Stripe customer exists.
 */
export class AdminClinicBillingInfoDto {
  @ApiPropertyOptional({ nullable: true })
  stripeCustomerId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  billingEmail!: string | null;

  @ApiPropertyOptional({ nullable: true })
  cardBrand!: string | null;

  @ApiPropertyOptional({ nullable: true })
  cardLast4!: string | null;

  @ApiPropertyOptional({ nullable: true })
  cardExpMonth!: number | null;

  @ApiPropertyOptional({ nullable: true })
  cardExpYear!: number | null;

  @ApiProperty({ description: 'Flat monthly platform fee constant' })
  monthlyFee!: number;

  @ApiProperty({ description: 'Per-lead price constant' })
  pricePerLead!: number;

  @ApiProperty({ description: "Whether the clinic's lead delivery is currently paused" })
  deliveryPaused!: boolean;
}

/** One row of `invoices`, snake_case per spec §1.7. Empty until billing subsystem 2 lands. */
export class AdminClinicInvoiceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  period_start!: string;

  @ApiProperty()
  period_end!: string;

  @ApiProperty()
  lead_count!: number;

  @ApiProperty()
  total_amount!: number;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  due_date!: string | null;

  @ApiPropertyOptional({ nullable: true })
  paid_at!: string | null;

  @ApiPropertyOptional({ nullable: true })
  invoice_url!: string | null;
}

/** Returned by GET /admin/clinics/:id/billing (spec §1.7). */
export class AdminClinicBillingDto {
  @ApiProperty({ type: AdminClinicBillingInfoDto })
  info!: AdminClinicBillingInfoDto;

  @ApiProperty({ type: [AdminClinicInvoiceDto] })
  invoices!: AdminClinicInvoiceDto[];
}
