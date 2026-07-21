import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Body of PUT /clinic/portal/billing. Every field optional; a field absent
 * (or null) leaves the corresponding billing_profiles column unchanged
 * (spec §1.2, partial-update semantics).
 */
export class UpdateClinicBillingDto {
  @ApiPropertyOptional({ description: 'Billing contact email. Synced to Stripe when changed.' })
  @IsOptional()
  @IsString()
  billingEmail?: string;

  @ApiPropertyOptional({ description: 'Billing contact name' })
  @IsOptional()
  @IsString()
  billingContactName?: string;

  @ApiPropertyOptional({ description: 'Billing address line 1' })
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @ApiPropertyOptional({ description: 'Billing address line 2' })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional({ description: 'Billing city' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Billing two-letter state code' })
  @IsOptional()
  @IsString()
  stateCode?: string;

  @ApiPropertyOptional({ description: 'Billing ZIP code' })
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiPropertyOptional({ description: 'Tax ID / EIN' })
  @IsOptional()
  @IsString()
  taxId?: string;
}
