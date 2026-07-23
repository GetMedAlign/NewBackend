import { PLATFORM_FEE, PRICE_PER_LEAD } from './billing-fee';

export interface RevenueStats {
  mrr: number;
  leadRevenueMtd: number;
  totalRevenueMtd: number;
  activeClinicCount: number;
  overdueCount: number;
  leadsThisMonth: number;
}

export function computeRevenueStats(input: {
  activeClinicCount: number;
  overdueCount: number;
  leadsThisMonth: number;
}): RevenueStats {
  const mrr = input.activeClinicCount * PLATFORM_FEE;
  const leadRevenueMtd = input.leadsThisMonth * PRICE_PER_LEAD;
  return {
    mrr,
    leadRevenueMtd,
    totalRevenueMtd: mrr + leadRevenueMtd,
    activeClinicCount: input.activeClinicCount,
    overdueCount: input.overdueCount,
    leadsThisMonth: input.leadsThisMonth,
  };
}

export function clinicMonthlyFee(status: string, billingStatus: string): number {
  return status === 'suspended' || billingStatus === 'paused' ? 0 : PLATFORM_FEE;
}

export function clinicLeadRevenue(leadsThisMonth: number): number {
  return leadsThisMonth * PRICE_PER_LEAD;
}
