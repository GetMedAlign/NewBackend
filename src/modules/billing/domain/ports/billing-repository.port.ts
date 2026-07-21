export interface ClinicBillingContext {
  clinicId: string;
  createdAt: Date;
  status: string; // clinics.status
  billingStatus: string; // clinics.billing_status
  stripeCustomerId: string | null;
}

export interface BillingProfileRow {
  billingEmail: string | null;
  billingContactName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateCode: string | null;
  zipCode: string | null;
  taxId: string | null;
  stripeCustomerId: string | null;
}

export interface ClinicCtx {
  clinicId: string;
}

export interface UpdateBillingProfileInput {
  billingEmail?: string;
  billingContactName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateCode?: string;
  zipCode?: string;
  taxId?: string;
}

export interface UpsertProfileResult {
  oldEmail: string | null;
  stripeCustomerId: string | null;
}

export interface ClinicStripeCustomer {
  stripeCustomerId: string | null;
  billingStatus: string;
}

export interface BillingRepositoryPort {
  getClinicContext(ctx: ClinicCtx): Promise<ClinicBillingContext | null>;
  getProfile(ctx: ClinicCtx): Promise<BillingProfileRow | null>;
  countInvoices(ctx: ClinicCtx): Promise<number>;
  countCurrentMonthLeads(ctx: ClinicCtx, now: Date): Promise<number>;
  upsertProfile(ctx: ClinicCtx, input: UpdateBillingProfileInput): Promise<UpsertProfileResult>;
  getClinicStripeCustomerId(ctx: ClinicCtx): Promise<ClinicStripeCustomer | null>;
  setBillingStatus(ctx: ClinicCtx, status: string): Promise<void>;
}

export const BILLING_REPOSITORY = Symbol('BillingRepositoryPort');
