# Billing Jobs & Webhook Design (Slice 7 / Billing Subsystem 2)

**Date:** 2026-07-22
**Status:** Approved

## Goal

Make money actually move: generate monthly invoices, react to Stripe payment
events, suspend clinics that do not pay, and let a clinic cancel. Mirrors the
.NET `InvoiceGenerationJob`, `StripeWebhookController`, `AccountSuspensionJob`,
and the clinic-portal subscription-cancel endpoint.

## Scope

This is billing subsystem 2 of three. Subsystem 1 (merged) built the billing
data, the Stripe client for customers/payment-methods, and the read/manage
endpoints. This slice adds the money-movement lifecycle.

**In scope:**

- `InvoiceGenerationJob` and `AccountSuspensionJob` as invokable services (no
  in-process scheduler; see §2).
- An admin job-trigger endpoint the external scheduler calls.
- The Stripe webhook (`invoice.paid`, `invoice.payment_failed`).
- `POST /clinic/portal/subscription/cancel` (deferred from subsystem 1).
- `STRIPE_PORT.createAndFinalizeInvoice`.
- No new tables: subsystem 1 created `invoices` and the `clinics` subscription
  columns.

**Out of scope (subsystem 3):** `WeeklySummaryJob`, the `AdminRevenue` dashboard
(stats + clinic breakdown), and any in-browser admin job triggering.

## Architecture

The two jobs are plain injectable services, each with an `execute(): Promise<JobResult>`
method. There is **no in-process scheduler**. The schedule lives outside the app:
an external cron (Railway scheduled job or a GitHub Actions scheduled workflow)
calls the admin job-trigger endpoint on a cron expression. This is robust to
multiple app instances (only the triggered call runs), survives restarts (the
external scheduler retries), and the trigger endpoint doubles as the ops lever to
re-run a missed or failed job.

The jobs and the webhook act on behalf of **no user**, so they run as system
processes via `asSystem`, bypassing RLS. Because `asSystem` is not itself a
transaction, every multi-write unit (one clinic's invoice, one clinic's
suspension, one webhook event) is wrapped in `asSystem(client => client.$transaction(...))`
for atomicity.

The clinic-facing cancel endpoint runs under `withUserContext` (clinic scope)
like the rest of the clinic portal.

## Global Constraints

- Contract mirrors the .NET `InvoiceGenerationJob`, `StripeWebhookController`,
  `AccountSuspensionJob`, and clinic subscription-cancel. Exact amounts and rules
  are in §3–§6.
- Fee constants, verbatim: price per lead `$90`, platform fee `$49`, processing
  fee `0.5%` of subtotal.
- Ids are UUID strings. No `any`. `Symbol` DI tokens. Keep `openapi.json`
  current; update README. No `Co-Authored-By` / Anthropic / Claude commit
  trailers. Node 24, pnpm.
- Two new env vars, added to `.env.example` AND the committed `test/.env.test`:
  `STRIPE_WEBHOOK_SECRET`, `JOB_TRIGGER_SECRET`. (A missing required var in
  `test/.env.test` breaks CI while passing locally; a schema-vs-`test/.env.test`
  guard test already exists and must stay green.)
- The Stripe secret key and both new secrets are server-side only, never
  returned or logged.

---

## 1. The money math (pure, `invoice-amounts.ts`)

The highest-risk part; isolated as a pure, unit-tested module reusing subsystem
1's proration/promo helpers from `billing-fee.ts`.

```ts
export interface InvoiceAmounts {
  leadCount: number;
  pricePerLead: number; // 90
  platformFee: number; // prorated / promo-adjusted 49
  platformFeeLabel: string;
  processingFee: number; // round(subtotal * 0.005, 2)
  subtotal: number; // leadCount*90 + platformFee
  totalAmount: number; // subtotal + processingFee
}

export function computeInvoiceAmounts(input: {
  leadCount: number;
  clinicCreatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  priorInvoiceCount: number;
}): InvoiceAmounts;
```

Rules, verbatim from .NET `InvoiceGenerationJob.GenerateInvoiceForClinicAsync`:

- `platformFee` base is `49`. If `clinicCreatedAt > periodStart`, prorate:
  `round(49 * activeDays / totalDays, 2)`, where
  `totalDays = (periodEnd - periodStart)` in days and
  `activeDays = (periodEnd - clinicCreatedAt)` in days — **timestamp
  subtraction**, matching the subsystem-1 fix and .NET. The label becomes
  `"Platform fee (prorated — N of M days)"` with `N = ceil(activeDays)`,
  `M = totalDays` (integers).
- 2026 promo: if `clinicCreatedAt.getUTCFullYear() === 2026` and
  `priorInvoiceCount < 2`, `platformFee = 0` and the label is
  `"Monthly platform fee (2026 Welcome Promotion — waived)"`. The promo takes
  precedence over proration for the label.
- Default label (no proration, no promo): `"Monthly platform fee"`.
- `subtotal = leadCount * 90 + platformFee`.
- `processingFee = round(subtotal * 0.005, 2)`.
- `totalAmount = subtotal + processingFee`.

Rounding is 2-decimal half-up (`Math.round(x * 100) / 100`).

---

## 2. Job trigger endpoint

`POST /admin/jobs/run/:jobName` where `jobName ∈ { 'invoice-generation',
'account-suspension' }`. An unknown job name → 400.

**Auth: a shared secret, not a user session.** A dedicated `JobTriggerGuard`
requires an `X-Job-Secret` header whose value equals the `JOB_TRIGGER_SECRET`
env var, compared in **constant time** (`crypto.timingSafeEqual` over equal-length
buffers; unequal lengths reject without comparing). No `X-Job-Secret`, or a
mismatch, → 401. This is least-privilege (the holder can only run two idempotent
jobs), rotates by changing the env var, and lets an external cron authenticate
without a user token.

Every trigger writes an `audit_log` entry (`action_type = 'job_triggered'`,
`affected_record = <jobName>`, `notes = 'POST /admin/jobs/run/<jobName>'`, actor
null/`'system'`). The endpoint runs the job synchronously and returns its
`JobResult` summary (see §3/§4). The jobs are idempotent, so a replayed trigger
is safe.

`JobResult` shape: `{ job: string; processed: number; skipped: number; failed:
number; details?: string[] }`.

---

## 3. Invoice generation (`InvoiceGenerationJob`)

Invoices the **previous** calendar month. `periodEnd = start of the current
month (UTC)`, `periodStart = periodEnd - 1 month`.

**Eligible clinics** (all under `asSystem`): `status = 'active'` AND
`stripe_customer_id IS NOT NULL` AND `created_at < periodEnd` AND
(`subscription_active_through IS NULL` OR `subscription_active_through >
periodStart`) AND no existing `invoices` row for `(clinic_id, period_start,
period_end)`. This last clause makes the job **idempotent** — a re-run generates
nothing new.

For each eligible clinic, inside one `asSystem` transaction per clinic (so a
failure rolls back that clinic only; the outer loop try/catch records it and
continues):

1. `leadCount` = leads with `received_at ∈ [periodStart, periodEnd)`.
2. `priorInvoiceCount` = that clinic's total `invoices` rows (for the promo
   check).
3. `computeInvoiceAmounts(...)` (§1).
4. `STRIPE_PORT.createAndFinalizeInvoice(...)` → `{ stripeInvoiceId, invoiceUrl,
pdfUrl }`.
5. Insert an `invoices` row: `stripe_invoice_id`, `period_start`, `period_end`,
   `lead_count`, `price_per_lead = 90`, `platform_fee`, `total_amount`,
   `status = 'open'`, `due_date = periodEnd + 30 days`, `invoice_url`, `pdf_url`.
6. Best-effort email: `billing_profiles.billing_email ?? clinics.business_email`;
   if present and `invoiceUrl` is non-null, send the invoice-issued email. An
   email failure does not roll back the invoice.

Returns a `JobResult` with counts.

### `STRIPE_PORT.createAndFinalizeInvoice`

```ts
createAndFinalizeInvoice(input: {
  customerId: string;
  clinicName: string;
  leadCount: number;
  pricePerLead: number;
  platformFee: number;
  platformFeeLabel: string;
  processingFee: number;
  periodStart: string;   // yyyy-MM-dd
  periodEnd: string;
}): Promise<{ stripeInvoiceId: string; invoiceUrl: string | null; pdfUrl: string | null }>;
```

Real adapter: create a draft invoice (`collection_method: 'send_invoice'`,
`days_until_due: 30`, `auto_advance: false`), add invoice items pinned to that
invoice id (a lead-cost line when `leadCount > 0`, a platform-fee line, a
processing-fee line — amounts in integer cents), then finalize. The .NET comment
is preserved as guidance: pin items to the invoice id, never create pending items
that Stripe could sweep into another draft. Fake adapter: returns a deterministic
`{ stripeInvoiceId: 'in_fake_N', invoiceUrl: 'https://stripe.test/i/in_fake_N',
pdfUrl: null }` and records the call so tests can assert it.

---

## 4. Account suspension (`AccountSuspensionJob`)

Daily. Under `asSystem`:

1. Find clinic ids with an `invoices` row where `status IN ('open','overdue')`
   AND `due_date + 30 days < now`.
2. Among those, load `active` clinics.
3. For each, in one transaction: set `status = 'suspended'`, `suspension_reason
= 'overdue_payment'`, `notify_on_lead = false`; set that clinic's `open`
   invoices to `overdue`; best-effort email the overdue warning to
   `billing_email ?? business_email` for the most recent overdue invoice.

Returns a `JobResult`. Idempotent: a clinic already `suspended` is not in the
`active` set, so a re-run does nothing.

---

## 5. Stripe webhook (`POST /stripe/webhook`, public)

Verifies the Stripe signature over the **raw request body**. Nest is configured
so this route receives the raw body (`rawBody: true` on the app, read via
`req.rawBody`); the global JSON parser must not consume it first for this path.

**Signature verification is behind a `STRIPE_WEBHOOK_VERIFIER` port** so tests do
not need real Stripe crypto:

```ts
export interface StripeWebhookVerifier {
  constructEvent(rawBody: Buffer | string, signature: string): StripeWebhookEvent;
}
// StripeWebhookEvent = { type: string; data: { object: { id: string; ... } } }
```

The real verifier calls `stripe.webhooks.constructEvent(rawBody, signature,
STRIPE_WEBHOOK_SECRET)` and throws on a bad signature. The fake verifier (tests)
parses the body as JSON and trusts it. A verification failure → **400** (no body
processing).

Handlers, matching .NET, idempotent (Stripe redelivers; no event-id dedupe
store), each in one `asSystem` transaction:

- **`invoice.paid`**: find our `invoices` row by `stripe_invoice_id`; if none,
  log and return 200 (nothing to do). Else set `status = 'paid'`, `paid_at =
now`, and the clinic's `billing_status = 'current'`. If the clinic's
  `suspension_reason = 'overdue_payment'` AND `subscription_cancelled_at IS
NULL`, reinstate delivery: `status = 'active'`, `suspension_reason = null`,
  `notify_on_lead = true`. **A cancelled clinic is never auto-reactivated.**
- **`invoice.payment_failed`**: find our row by `stripe_invoice_id`; if none, log
  and return 200. Else set the invoice `status = 'overdue'` and the clinic's
  `billing_status = 'overdue'`.
- Any other event type: log and return 200.

An unexpected exception inside a handler → 500 (Stripe will retry). A valid but
unmatched event → 200.

---

## 6. Subscription cancel (`POST /clinic/portal/subscription/cancel`, clinic)

Under `withUserContext` (clinic scope), on the existing clinic-billing
controller. Mirrors .NET:

- 409 `ConflictException` "Subscription is already cancelled." if
  `subscription_cancelled_at` is already set.
- Else set `subscription_cancelled_at = now`, `subscription_active_through = end
of the current month (last day, 23:59:59 UTC)`, `billing_status =
'cancelled'`, `notify_on_lead = false`.
- Response: `{ cancelledAt: <ISO>, activeThrough: <ISO> }` (`CancelSubscriptionResponse`,
  camelCase per the .NET DTO).

The clinic keeps receiving leads until `subscription_active_through` only in the
sense that the generation job's eligibility check honors it; this slice does not
add mid-period lead gating beyond what the jobs enforce.

---

## 7. Security

- Jobs and the webhook run under `asSystem` (system processes) — they act for no
  user and must bypass RLS to see all clinics. Every multi-write unit is one
  `asSystem` transaction.
- The trigger endpoint is shared-secret-guarded with a constant-time compare;
  the webhook is signature-verified; both secrets are server-side only.
- `invoices` and `clinics` already carry their RLS policies (subsystem 1 /
  earlier slices); `asSystem` bypasses them, which is correct for these system
  writes and is not a widening of user-facing access.
- The cancel endpoint takes the clinic id only from `@CurrentClinic()`.

---

## 8. Module structure

```
src/modules/billing/
  domain/invoice-amounts.ts                       §1 (pure)
  domain/ports/stripe.port.ts                     + createAndFinalizeInvoice
  domain/ports/stripe-webhook-verifier.port.ts    §5
  application/generate-invoices.job.ts            §3
  application/suspend-overdue-accounts.job.ts     §4
  application/handle-stripe-webhook.use-case.ts   §5
  application/cancel-subscription.use-case.ts     §6
  infrastructure/adapters/stripe.adapter.ts       + createAndFinalizeInvoice
  infrastructure/adapters/fake-stripe.adapter.ts  + createAndFinalizeInvoice
  infrastructure/adapters/stripe-webhook-verifier.adapter.ts  real + fake
  infrastructure/prisma-billing.repository.ts     + job/webhook/cancel queries
  infrastructure/http/stripe-webhook.controller.ts   POST /stripe/webhook
  infrastructure/http/billing-jobs.controller.ts     POST /admin/jobs/run/:jobName
  infrastructure/http/job-trigger.guard.ts           shared-secret guard
  infrastructure/http/dto/*.dto.ts

src/modules/billing/infrastructure/http/clinic-billing.controller.ts  + cancel route
```

The cancel route joins the existing clinic-billing controller. The webhook and
job-trigger controllers are new. The two job services live in `application/`.

---

## 9. Testing

- **Unit (pure):** `computeInvoiceAmounts` across full-month, mid-month
  proration, 2026 promo (0/1/2 prior invoices), lead-cost + processing-fee
  totals, and the label strings.
- **Integration/e2e against the fakes** (fake Stripe adapter + fake webhook
  verifier):
  - Generation: seed active clinics with customers + leads, run the job, assert
    one `invoices` row per eligible clinic with the right amounts and
    `status = 'open'`; run again and assert **no new rows** (idempotency);
    ineligible clinics (no customer, inactive, cancelled-before-period) get
    none.
  - Suspension: seed a clinic with an invoice 31 days past due, run, assert
    `status = 'suspended'` + `suspension_reason` + invoice `overdue`; a current
    clinic is untouched; a re-run is a no-op.
  - Webhook: `invoice.paid` marks paid + `current` and reinstates a
    non-payment-suspended clinic but **not** a cancelled one;
    `invoice.payment_failed` marks overdue; a bad signature → 400; an unknown
    `stripe_invoice_id` → 200 no-op.
  - Trigger endpoint: correct `X-Job-Secret` runs the job and returns the
    summary; missing/wrong secret → 401; unknown job name → 400; an
    `audit_log` `job_triggered` row is written.
  - Cancel: sets the fields and returns the ISO timestamps; a second call → 409.

---

## 10. Deploy notes

- No migrations (subsystem 1 created `invoices` and the subscription columns).
- Two new env vars: `STRIPE_WEBHOOK_SECRET` (from the Stripe dashboard's webhook
  signing secret) and `JOB_TRIGGER_SECRET` (a generated random string). Add both
  to Railway and to `test/.env.test`.
- Register the Stripe webhook endpoint URL in the Stripe dashboard for the
  `invoice.paid` and `invoice.payment_failed` events.
- Configure the external scheduler: monthly `POST /admin/jobs/run/invoice-generation`
  (1st, 00:00 UTC) and daily `POST /admin/jobs/run/account-suspension` (06:00
  UTC), each sending the `X-Job-Secret` header.
- Frontend: a subscription-cancel action on the clinic billing screen; no other
  UI (the jobs and webhook are backend-only).
