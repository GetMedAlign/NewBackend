export const PLATFORM_FEE = 49;
export const PRICE_PER_LEAD = 90;

export interface EstimatedFee {
  estimatedPlatformFee: number;
  promoMonthsRemaining: number;
}

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function startOfNextMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function estimatePlatformFee(input: {
  clinicCreatedAt: Date;
  now: Date;
  invoiceCount: number;
}): EstimatedFee {
  const { clinicCreatedAt, now, invoiceCount } = input;
  const periodStart = startOfMonthUtc(now);
  const periodEnd = startOfNextMonthUtc(now);

  let fee = PLATFORM_FEE;
  if (clinicCreatedAt.getTime() > periodStart.getTime()) {
    const totalDays = (periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY;
    const activeDays = (periodEnd.getTime() - clinicCreatedAt.getTime()) / MS_PER_DAY;
    fee = Math.round(PLATFORM_FEE * (activeDays / totalDays) * 100) / 100;
  }

  let promoMonthsRemaining = 0;
  if (clinicCreatedAt.getUTCFullYear() === 2026) {
    promoMonthsRemaining = Math.max(0, 2 - invoiceCount);
    if (promoMonthsRemaining > 0) fee = 0;
  }

  return { estimatedPlatformFee: fee, promoMonthsRemaining };
}
