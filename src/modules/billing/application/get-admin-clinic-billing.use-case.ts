import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BILLING_REPOSITORY,
  type AdminBillingCtx,
  type AdminClinicBillingResult,
} from '../domain/ports/billing-repository.port';
import { STRIPE_PORT, type StripeDefaultPaymentMethod } from '../domain/ports/stripe.port';
import {
  AdminClinicBillingDto,
  AdminClinicBillingInfoDto,
  AdminClinicInvoiceDto,
} from '../infrastructure/http/dto/admin-clinic-billing.dto';

/** Flat monthly platform fee constant (spec §1.7). */
const MONTHLY_FEE = 49;
/** Per-lead price constant (spec §1.7). */
const PRICE_PER_LEAD = 90;

type BillingRepositoryForAdminGet = {
  getAdminClinicBilling(
    ctx: AdminBillingCtx,
    clinicId: string,
  ): Promise<AdminClinicBillingResult | null>;
};

type StripeForAdminGet = {
  getDefaultPaymentMethod(customerId: string): Promise<StripeDefaultPaymentMethod | null>;
};

@Injectable()
export class GetAdminClinicBillingUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly repo: BillingRepositoryForAdminGet,
    @Inject(STRIPE_PORT)
    private readonly stripe: StripeForAdminGet,
  ) {}

  async execute(ctx: AdminBillingCtx, clinicId: string): Promise<AdminClinicBillingDto> {
    const result = await this.repo.getAdminClinicBilling(ctx, clinicId);
    if (!result) {
      throw new NotFoundException('Clinic not found.');
    }

    const { row, invoices } = result;
    const card =
      row.stripeCustomerId !== null
        ? await this.stripe.getDefaultPaymentMethod(row.stripeCustomerId)
        : null;

    const info = new AdminClinicBillingInfoDto();
    info.stripeCustomerId = row.stripeCustomerId;
    info.billingEmail = row.billingEmail;
    info.cardBrand = card?.brand ?? null;
    info.cardLast4 = card?.last4 ?? null;
    info.cardExpMonth = card?.expMonth ?? null;
    info.cardExpYear = card?.expYear ?? null;
    info.monthlyFee = MONTHLY_FEE;
    info.pricePerLead = PRICE_PER_LEAD;
    info.deliveryPaused = row.status === 'paused';

    const dto = new AdminClinicBillingDto();
    dto.info = info;
    dto.invoices = invoices.map((inv): AdminClinicInvoiceDto => {
      const invoiceDto = new AdminClinicInvoiceDto();
      invoiceDto.id = inv.id;
      invoiceDto.period_start = inv.period_start;
      invoiceDto.period_end = inv.period_end;
      invoiceDto.lead_count = inv.lead_count;
      invoiceDto.total_amount = inv.total_amount;
      invoiceDto.status = inv.status;
      invoiceDto.due_date = inv.due_date;
      invoiceDto.paid_at = inv.paid_at;
      invoiceDto.invoice_url = inv.invoice_url;
      return invoiceDto;
    });
    return dto;
  }
}
