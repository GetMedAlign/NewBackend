import { PRICE_PER_LEAD, proratedPlatformFee } from './billing-fee';

export interface InvoiceAmounts {
  leadCount: number;
  pricePerLead: number;
  platformFee: number;
  platformFeeLabel: string;
  processingFee: number;
  subtotal: number;
  totalAmount: number;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

export function computeInvoiceAmounts(input: {
  leadCount: number;
  clinicCreatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  priorInvoiceCount: number;
}): InvoiceAmounts {
  const { leadCount, clinicCreatedAt, periodStart, periodEnd, priorInvoiceCount } = input;

  const proration = proratedPlatformFee(clinicCreatedAt, periodStart, periodEnd);
  let platformFee = proration.fee;
  let platformFeeLabel = proration.prorated
    ? `Platform fee (prorated — ${Math.ceil(proration.activeDays)} of ${proration.totalDays} days)`
    : 'Monthly platform fee';

  // 2026 Welcome Promotion: first two invoices have the platform fee waived.
  if (clinicCreatedAt.getUTCFullYear() === 2026 && priorInvoiceCount < 2) {
    platformFee = 0;
    platformFeeLabel = 'Monthly platform fee (2026 Welcome Promotion — waived)';
  }

  const subtotal = round2(leadCount * PRICE_PER_LEAD + platformFee);
  const processingFee = round2(subtotal * 0.005);
  const totalAmount = round2(subtotal + processingFee);

  return {
    leadCount,
    pricePerLead: PRICE_PER_LEAD,
    platformFee,
    platformFeeLabel,
    processingFee,
    subtotal,
    totalAmount,
  };
}
