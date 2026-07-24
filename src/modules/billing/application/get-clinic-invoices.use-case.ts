import { Inject, Injectable } from '@nestjs/common';
import {
  BILLING_REPOSITORY,
  type ClinicCtx,
  type ClinicInvoiceRow,
} from '../domain/ports/billing-repository.port';
import { ClinicInvoiceDto } from '../infrastructure/http/dto/clinic-invoice.dto';

type BillingRepositoryForClinicInvoices = {
  listClinicInvoices(ctx: ClinicCtx): Promise<ClinicInvoiceRow[]>;
};

@Injectable()
export class GetClinicInvoicesUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly repo: BillingRepositoryForClinicInvoices,
  ) {}

  async execute(ctx: ClinicCtx): Promise<ClinicInvoiceDto[]> {
    const rows = await this.repo.listClinicInvoices(ctx);
    return rows.map((row): ClinicInvoiceDto => {
      const dto = new ClinicInvoiceDto();
      dto.id = row.id;
      dto.period_start = row.period_start;
      dto.period_end = row.period_end;
      dto.lead_count = row.lead_count;
      dto.price_per_lead = row.price_per_lead;
      dto.platform_fee = row.platform_fee;
      dto.total_amount = row.total_amount;
      dto.status = row.status;
      dto.invoice_url = row.invoice_url;
      dto.pdf_url = row.pdf_url;
      dto.due_date = row.due_date;
      dto.paid_at = row.paid_at;
      return dto;
    });
  }
}
