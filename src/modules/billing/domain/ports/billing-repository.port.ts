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

/** Admin identity a `getAdminClinicBilling` call runs under (admin RLS, not `asSystem`). */
export interface AdminBillingCtx {
  userId: string;
  role: string;
}

export interface AdminBillingRow {
  clinicId: string;
  status: string; // clinics.status
  stripeCustomerId: string | null; // billing_profiles.stripe_customer_id ?? clinics.stripe_customer_id
  billingEmail: string | null;
}

export interface AdminInvoiceRow {
  id: string;
  period_start: string;
  period_end: string;
  lead_count: number;
  total_amount: number;
  status: string;
  due_date: string | null;
  paid_at: string | null;
  invoice_url: string | null;
}

export interface AdminClinicBillingResult {
  row: AdminBillingRow;
  invoices: AdminInvoiceRow[];
}

export interface BillingRepositoryPort {
  getClinicContext(ctx: ClinicCtx): Promise<ClinicBillingContext | null>;
  getProfile(ctx: ClinicCtx): Promise<BillingProfileRow | null>;
  countInvoices(ctx: ClinicCtx): Promise<number>;
  countCurrentMonthLeads(ctx: ClinicCtx, now: Date): Promise<number>;
  upsertProfile(ctx: ClinicCtx, input: UpdateBillingProfileInput): Promise<UpsertProfileResult>;
  getClinicStripeCustomerId(ctx: ClinicCtx): Promise<ClinicStripeCustomer | null>;
  setBillingStatus(ctx: ClinicCtx, status: string): Promise<void>;
  getAdminClinicBilling(
    ctx: AdminBillingCtx,
    clinicId: string,
  ): Promise<AdminClinicBillingResult | null>;
}

export const BILLING_REPOSITORY = Symbol('BillingRepositoryPort');
