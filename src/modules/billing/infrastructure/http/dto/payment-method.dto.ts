import { ApiProperty } from '@nestjs/swagger';

/**
 * Returned by GET and POST /clinic/portal/payment-method. Cards are read live
 * from Stripe and never stored (spec §1.3).
 *
 * The field-name casing is DELIBERATELY mixed to match the frontend's
 * existing interface: `brand`, `last4`, `stripePaymentMethodId` are
 * camelCase; `exp_month`, `exp_year` are snake_case. Do not normalize it.
 */
export class PaymentMethodDto {
  @ApiProperty()
  brand!: string;

  @ApiProperty()
  last4!: string;

  @ApiProperty()
  exp_month!: number;

  @ApiProperty()
  exp_year!: number;

  @ApiProperty()
  stripePaymentMethodId!: string;
}
