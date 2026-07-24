import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One row of `invoices` for the authenticated clinic, snake_case per the frontend `ClinicInvoice` type. */
export class ClinicInvoiceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  period_start!: string;

  @ApiProperty()
  period_end!: string;

  @ApiProperty()
  lead_count!: number;

  @ApiProperty()
  price_per_lead!: number;

  @ApiProperty()
  platform_fee!: number;

  @ApiProperty()
  total_amount!: number;

  @ApiProperty({ description: 'draft | open | paid | overdue | void' })
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  invoice_url!: string | null;

  @ApiPropertyOptional({ nullable: true })
  pdf_url!: string | null;

  @ApiPropertyOptional({ nullable: true })
  due_date!: string | null;

  @ApiPropertyOptional({ nullable: true })
  paid_at!: string | null;
}
