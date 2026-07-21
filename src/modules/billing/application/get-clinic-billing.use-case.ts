import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BILLING_REPOSITORY,
  type BillingRepositoryPort,
  type ClinicCtx,
} from '../domain/ports/billing-repository.port';
import { estimatePlatformFee } from '../domain/billing-fee';
import { ClinicBillingInfoDto } from '../infrastructure/http/dto/clinic-billing-info.dto';

@Injectable()
export class GetClinicBillingUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly repo: BillingRepositoryPort,
  ) {}

  async execute(ctx: ClinicCtx, now: Date): Promise<ClinicBillingInfoDto> {
    const context = await this.repo.getClinicContext(ctx);
    if (!context) {
      throw new NotFoundException('Clinic not found');
    }

    const profile = await this.repo.getProfile(ctx);
    const invoiceCount = await this.repo.countInvoices(ctx);
    const currentPeriodLeadCount = await this.repo.countCurrentMonthLeads(ctx, now);

    const { estimatedPlatformFee, promoMonthsRemaining } = estimatePlatformFee({
      clinicCreatedAt: context.createdAt,
      now,
      invoiceCount,
    });

    const dto = new ClinicBillingInfoDto();
    dto.billingEmail = profile?.billingEmail ?? null;
    dto.billingContactName = profile?.billingContactName ?? null;
    dto.addressLine1 = profile?.addressLine1 ?? null;
    dto.addressLine2 = profile?.addressLine2 ?? null;
    dto.city = profile?.city ?? null;
    dto.stateCode = profile?.stateCode ?? null;
    dto.zipCode = profile?.zipCode ?? null;
    dto.taxId = profile?.taxId ?? null;
    dto.stripeCustomerId = profile?.stripeCustomerId ?? context.stripeCustomerId;
    dto.subscriptionCancelledAt = null;
    dto.subscriptionActiveThrough = null;
    dto.currentPeriodLeadCount = currentPeriodLeadCount;
    dto.estimatedPlatformFee = estimatedPlatformFee;
    dto.promoMonthsRemaining = promoMonthsRemaining;
    return dto;
  }
}
