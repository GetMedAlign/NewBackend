import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Body of POST /clinic/portal/payment-method (spec §1.5). */
export class SavePaymentMethodDto {
  @ApiProperty({ description: 'Stripe PaymentMethod id to attach as the clinic default' })
  @IsString()
  @IsNotEmpty()
  paymentMethodId!: string;
}
