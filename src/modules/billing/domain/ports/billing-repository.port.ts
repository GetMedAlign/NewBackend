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

/** A clinic due an invoice for the given period (spec §3 eligibility SQL). */
export interface EligibleClinic {
  clinicId: string;
  clinicName: string;
  createdAt: Date;
  stripeCustomerId: string;
  billingEmail: string | null;
}

/** An active clinic with an invoice 30+ days past its due date (spec §4). */
export interface OverdueClinic {
  clinicId: string;
  clinicName: string;
  billingEmail: string | null;
  overdueTotal: number;
  overdueDueDate: Date | null;
}

/** An active clinic opted into the weekly lead-count summary (spec §5). */
export interface WeeklySummaryClinic {
  clinicId: string;
  clinicName: string;
  businessEmail: string | null;
}

/** Raw counts behind `GET /admin/revenue/stats` (spec §2/§3), before `computeRevenueStats`. */
export interface RevenueCounts {
  activeClinicCount: number;
  overdueCount: number;
  leadsThisMonth: number;
}

/** One raw clinic row behind `GET /admin/revenue/clinics` (spec §1.2/§4), before revenue-math mapping. */
export interface ClinicRevenueRaw {
  clinicId: string;
  clinicName: string;
  status: string; // clinics.status
  billingStatus: string; // clinics.billing_status
  leadsThisMonth: number;
}

/** One mapped clinic row for `GET /admin/revenue/clinics` (spec §1.2), after revenue-math mapping. */
export interface AdminClinicRevenueRow {
  clinicId: string;
  clinicName: string;
  leadsThisMonth: number;
  leadRevenue: number;
  monthlyFee: number;
  total: number;
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
  /**
   * Cancels the clinic's subscription in a single guarded UPDATE (spec §6).
   * Returns 'already_cancelled' when the clinic's subscription_cancelled_at
   * is already set (0 rows affected but the clinic exists, which the ClinicGuard
   * guarantees); 'ok' otherwise.
   */
  cancelSubscription(
    ctx: ClinicCtx,
    cancelledAt: Date,
    activeThrough: Date,
  ): Promise<'ok' | 'already_cancelled'>;
  getAdminClinicBilling(
    ctx: AdminBillingCtx,
    clinicId: string,
  ): Promise<AdminClinicBillingResult | null>;
  /**
   * Stores a newly created Stripe customer id on the clinic row, under the
   * caller's admin context (never `asSystem`), which the `clinics_admin_all` RLS
   * policy permits.
   */
  setClinicStripeCustomerId(
    ctx: AdminBillingCtx,
    clinicId: string,
    customerId: string,
  ): Promise<void>;

  /**
   * Clinics due an invoice for [periodStart, periodEnd) (spec §3): active,
   * has a Stripe customer, created before periodEnd, subscription still
   * active through periodStart (or never cancelled), and with no existing
   * invoices row for this exact period yet. This last clause is what makes
   * re-running `GenerateInvoicesJob` for an already-invoiced period a no-op.
   * Runs `asSystem` since the job acts for no user.
   */
  listInvoiceEligibleClinics(periodStart: Date, periodEnd: Date): Promise<EligibleClinic[]>;
  /** Leads received within [periodStart, periodEnd) for one clinic. `asSystem`. */
  countLeadsInPeriod(clinicId: string, periodStart: Date, periodEnd: Date): Promise<number>;
  /** Total prior invoices for one clinic, used for the 2026 promo window. `asSystem`. */
  countInvoicesForClinic(clinicId: string): Promise<number>;
  /**
   * Stores one generated invoice row (`status = 'open'`) in a single
   * transaction. `asSystem` since the job acts for no user.
   */
  insertGeneratedInvoice(row: {
    clinicId: string;
    stripeInvoiceId: string;
    periodStart: Date;
    periodEnd: Date;
    leadCount: number;
    pricePerLead: number;
    platformFee: number;
    totalAmount: number;
    dueDate: Date;
    invoiceUrl: string | null;
    pdfUrl: string | null;
  }): Promise<void>;

  /**
   * Active clinics with an invoice ('open' or 'overdue') whose due_date is
   * 30+ days in the past (spec §4), one row per clinic (the most recent
   * such invoice). `asSystem` since the job acts for no user. Idempotent by
   * construction: a clinic already suspended is no longer `active`, so a
   * re-run excludes it.
   */
  listSuspendableClinics(now: Date): Promise<OverdueClinic[]>;
  /**
   * Suspends one clinic for non-payment in a single transaction: sets
   * `status = 'suspended'`, `suspension_reason = 'overdue_payment'`,
   * `notify_on_lead = false`, and marks that clinic's `open` invoices
   * `overdue`. `asSystem` since the job acts for no user.
   */
  suspendClinicForNonPayment(clinicId: string): Promise<void>;

  /**
   * True if an `invoices` row exists with this Stripe invoice id. Lets the
   * Stripe webhook handler no-op cleanly (still 200) on an unknown id
   * instead of erroring (spec §5).
   */
  invoiceExistsByStripeId(stripeInvoiceId: string): Promise<boolean>;
  /**
   * `invoice.paid` webhook (spec §5), one transaction, `asSystem`: marks the
   * invoice `status='paid'`/`paid_at=now()`, sets the clinic
   * `billing_status='current'`, then conditionally reinstates the clinic
   * (`status='active'`, `suspension_reason=NULL`, `notify_on_lead=true`)
   * ONLY if it was suspended for `overdue_payment` AND its subscription was
   * never cancelled. A cancelled clinic is never auto-reactivated, and a
   * clinic suspended for any other reason is left alone.
   */
  markInvoicePaid(stripeInvoiceId: string): Promise<void>;
  /**
   * `invoice.payment_failed` webhook (spec §5), one transaction, `asSystem`:
   * marks the invoice `status='overdue'` and the clinic
   * `billing_status='overdue'`.
   */
  markInvoicePaymentFailed(stripeInvoiceId: string): Promise<void>;

  /**
   * Active clinics that have opted into the weekly summary email (spec §5):
   * `status = 'active' AND weekly_summary = true`. `asSystem` since the job acts
   * for no user.
   */
  listWeeklySummaryClinics(): Promise<WeeklySummaryClinic[]>;
  /** Leads received on or after `since` for one clinic. `asSystem`. */
  countLeadsSince(clinicId: string, since: Date): Promise<number>;
  /** All-time lead count for one clinic. `asSystem`. */
  countAllLeads(clinicId: string): Promise<number>;

  /**
   * Raw counts behind `GET /admin/revenue/stats` (spec §3): active clinics,
   * overdue-billing clinics, and this-month leads, in one query.
   * Runs under `withUserContext({ userId, role })` (admin RLS, not `asSystem`).
   */
  getRevenueCounts(ctx: AdminBillingCtx, now: Date): Promise<RevenueCounts>;

  /**
   * Raw per-clinic rows behind `GET /admin/revenue/clinics` (spec §4): every
   * clinic joined to its this-month lead count (a single grouped query, no
   * N+1), ordered by clinic name ascending.
   * Runs under `withUserContext({ userId, role })` (admin RLS, not `asSystem`).
   */
  getClinicRevenueRows(ctx: AdminBillingCtx, now: Date): Promise<ClinicRevenueRaw[]>;
}

export const BILLING_REPOSITORY = Symbol('BillingRepositoryPort');
