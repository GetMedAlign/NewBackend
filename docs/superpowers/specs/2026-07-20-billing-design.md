# Billing Design (Slice 6, Subsystem 1)

**Date:** 2026-07-20
**Status:** Approved

## Goal

Make a clinic's billing visible and let clinics manage their payment method:
view and edit the billing profile, add and remove a card, and see an estimated
monthly platform fee. Give admins a per-clinic billing view. Provision a Stripe
customer for every clinic. Card data is read live from Stripe and never stored.

Mirrors the .NET clinic-portal billing endpoints, the `AdminClinicsController`
billing endpoint (deferred from Slice 5), and the Stripe customer/payment-method
half of `IStripeService`.

## Scope

Billing is three subsystems. This spec covers **subsystem 1 only**: billing data,
the Stripe client for customers and payment methods, and the read/manage
endpoints. It needs no scheduler and moves no money.

**In scope:**

- `billing_profiles` and `invoices` tables, and three new `clinics` columns.
- A `STRIPE_PORT` abstraction with a real (test-mode) adapter and a fake adapter
  for tests.
- Stripe customer creation wired into the existing clinic-approval flow, plus a
  one-off backfill for already-approved clinics.
- Clinic-facing: `GET`/`PUT /clinic/portal/billing`, and
  `GET`/`POST`/`DELETE /clinic/portal/payment-method`.
- Admin-facing: `GET /admin/clinics/{id}/billing` (the endpoint deferred from
  Slice 5).

**Out of scope (subsystem 2, the next slice):**

- `POST /clinic/portal/subscription/cancel`. It sets lifecycle state that only
  subsystem 2's jobs and webhook enforce; shipping it alone would let a clinic
  cancel while still receiving leads and being invoiced. The `clinics`
  subscription columns are added now so the billing DTO contract is stable, but
  they stay null and unused until then.
- The invoice generation job, the Stripe webhook, account suspension, and any
  clinic-facing invoice list. The `invoices` table is created now but stays
  empty; the admin billing endpoint reads it and correctly returns an empty
  list.

**Out of scope (subsystem 3):** `AdminRevenueController`, job triggers, weekly
summary.

## Architecture

New `billing` module, NestJS hexagonal on the Foundation auth/RLS layer, same
shape as prior slices, with `Symbol` DI tokens.

A `STRIPE_PORT` (token `STRIPE_PORT`) abstracts Stripe so tests never call the
real API:

- **`StripeAdapter`** wraps the `stripe` Node SDK against a test-mode secret key.
  Prod-armed, test-seamable, mirroring how `SupabaseStorageAdapter` is built.
- **`FakeStripeAdapter`** is an in-memory implementation used by the integration
  and e2e suites: it records customers and attached payment methods in a `Map`
  and returns deterministic card data. This mirrors `LoggingEmailSender` standing
  in for `EMAIL_SENDER` in dev/test.

Card data (brand, last4, expiry) is read live from Stripe on each request and
never persisted, so no card data enters our database. The only Stripe identifier
stored is the opaque `stripe_customer_id`, held plaintext exactly as .NET does
(the secret key is the sensitive value, not the customer id).

All billing-table access runs under `withUserContext`. Admin routes use the
existing admin RLS; clinic routes use the `app.current_clinic_id` scope from the
Clinic Portal slice. The clinic id and, for admin routes, the admin id come only
from the verified session, never from the request.

## Global Constraints

- Contract mirrors the .NET clinic-portal billing endpoints and
  `AdminClinicsController.GetBilling`. Exhaustive field lists are in §1.
- Ids are UUID strings, not the .NET integers.
- All access is RLS-enforced under `withUserContext`. Clinic id from
  `@CurrentClinic()`, admin id/role from `@CurrentUser()`, never from the request.
- Fee constants, copied verbatim: price per lead `$90`, platform fee `$49`.
- Card data is never stored. `stripe_customer_id` is stored plaintext.
- The Stripe secret key is server-side only, never returned to any client.
- No `any` in production code. `Symbol` DI tokens. Keep `openapi.json` current;
  update README. No `Co-Authored-By` / Anthropic / Claude commit trailers.
  Node 24, pnpm.

---

## 1. Contracts

Serialization is camelCase except where a field explicitly carries a snake_case
name, matching the .NET DTOs' `[JsonPropertyName]` attributes. Two DTOs are mixed
case; reproduce them exactly.

### 1.1 `ClinicBillingInfoDto` — `GET /clinic/portal/billing`

Profile fields (camelCase, all nullable): `billingEmail`, `billingContactName`,
`addressLine1`, `addressLine2`, `city`, `stateCode`, `zipCode`, `taxId`,
`stripeCustomerId`.

Plus these named fields:

- `subscriptionCancelledAt` (nullable ISO 8601 string) — null until subsystem 2.
- `subscriptionActiveThrough` (nullable ISO 8601 string) — null until subsystem 2.
- `currentPeriodLeadCount` (int) — count of this clinic's leads with
  `received_at >= start of the current calendar month (UTC)`.
- `estimatedPlatformFee` (number) — see the fee rules below.
- `promoMonthsRemaining` (int) — see the fee rules below.

**Estimated platform fee rules (verbatim from .NET):**

- Base fee is `49`.
- If the clinic was created after the start of the current month (mid-month
  signup), prorate: `round(49 * activeDays / totalDays, 2)`, where
  `totalDays = days in the current month` and
  `activeDays = (end of month) - created_at` in days.
- If `created_at.year == 2026`: `promoMonthsRemaining = max(0, 2 - invoiceCount)`
  where `invoiceCount` is the clinic's total invoices. When
  `promoMonthsRemaining > 0`, `estimatedPlatformFee` is forced to `0` (the 2026
  Welcome Promotion waives the first two platform fees). For any non-2026 clinic
  `promoMonthsRemaining` is `0`.

Since `invoices` is empty in this subsystem, a 2026 clinic reports
`promoMonthsRemaining = 2` and `estimatedPlatformFee = 0`, which is correct.

### 1.2 `UpdateClinicBillingProfileRequest` — `PUT /clinic/portal/billing`

All optional, all strings: `billingEmail`, `billingContactName`, `addressLine1`,
`addressLine2`, `city`, `stateCode`, `zipCode`, `taxId`. A field absent or null
leaves the column unchanged (partial update, `if (x is not null)` semantics).

Upserts the `billing_profiles` row (creates it if the clinic has none). When
`billingEmail` is present and changed and the clinic has a `stripe_customer_id`,
sync the new email to Stripe via `updateCustomerEmail`, **best-effort**: a Stripe
failure is logged and the profile update still succeeds.

Response: `{ "success": true }`.

### 1.3 `ClinicPaymentMethodDto` — MIXED CASE

Returned by `GET` and `POST /clinic/portal/payment-method`. Field names exactly:

- `brand` (camel)
- `last4` (camel)
- `exp_month` (snake)
- `exp_year` (snake)
- `stripePaymentMethodId` (camel)

### 1.4 `GET /clinic/portal/payment-method`

Returns the clinic's default card as a `ClinicPaymentMethodDto`, read live from
Stripe. When the clinic has no `stripe_customer_id`, or Stripe has no default
card, respond with a body of `null` (200). Never a card from our database,
because we store none.

### 1.5 `POST /clinic/portal/payment-method`

Body `SavePaymentMethodRequest`: `{ "paymentMethodId": string }` (required).

Attaches the payment method to the clinic's Stripe customer and sets it as the
default. On success, if the clinic's `billing_status` is `no_card`, flip it to
`current`. Returns the resulting `ClinicPaymentMethodDto`.

- If the clinic has no `stripe_customer_id`: `422` with message `"No Stripe
customer found for this clinic. Contact support."` (matches .NET; with approval
  provisioning + backfill this should not occur, but the guard stays).
- If Stripe rejects the attach (for example a card requiring authentication):
  `400` with Stripe's error message.

### 1.6 `DELETE /clinic/portal/payment-method`

Detaches the clinic's default payment method (best-effort) and sets
`billing_status = no_card`. Idempotent: if there is no customer or no card, it
still returns success. Response: `{ "success": true }`.

### 1.7 `AdminClinicBillingInfoDto` and `AdminClinicBillingDto` — `GET /admin/clinics/{id}/billing`

`AdminClinicBillingDto` is `{ info: AdminClinicBillingInfoDto, invoices:
AdminClinicInvoiceDto[] }`.

`AdminClinicBillingInfoDto` (camelCase): `stripeCustomerId` (nullable),
`billingEmail` (nullable, from the billing profile), `cardBrand` (nullable),
`cardLast4` (nullable), `cardExpMonth` (nullable int), `cardExpYear` (nullable
int), `monthlyFee` (number, constant `49`), `pricePerLead` (number, constant
`90`), `deliveryPaused` (bool, `status == 'paused'`).

The card fields are read live from Stripe via `getDefaultPaymentMethod` when a
`stripe_customer_id` exists, else all null.

`AdminClinicInvoiceDto` — snake_case, ordered by `period_start` descending:
`id`, `period_start`, `period_end`, `lead_count` (int), `total_amount` (number),
`status`, `due_date` (nullable), `paid_at` (nullable), `invoice_url` (nullable).
Empty array until subsystem 2 populates `invoices`.

404 with message `"Clinic not found."` when the clinic does not exist.

### 1.8 Error responses

- Missing clinic (admin route) → `404`, `"Clinic not found."`
- No Stripe customer on `POST /payment-method` → `422`, `"No Stripe customer
found for this clinic. Contact support."`
- Stripe attach rejection → `400`, Stripe's message.

All flow through the existing `AllExceptionsFilter` envelope.

---

## 2. The Stripe port

`STRIPE_PORT` (Symbol) with this interface. Only the methods subsystem 1 needs:

- `createCustomer(clinicName: string, email: string, clinicId: string):
Promise<string>` — returns the Stripe customer id; sets metadata
  `{ clinicId, source: 'medalign' }`.
- `getDefaultPaymentMethod(customerId: string): Promise<{ paymentMethodId:
string; brand: string; last4: string; expMonth: number; expYear: number } |
null>` — null when the customer is missing or has no default card. Stripe
  `resource_missing` is treated as null, other Stripe errors are logged and
  return null.
- `attachPaymentMethod(customerId: string, paymentMethodId: string):
Promise<{ brand: string; last4: string; expMonth: number; expYear: number }>`
  — attaches and sets as the customer's default; throws on Stripe error so the
  route can surface a 400.
- `detachDefaultPaymentMethod(customerId: string): Promise<void>` — best-effort;
  a Stripe error is logged, not thrown.
- `updateCustomerEmail(customerId: string, email: string): Promise<void>`.

`StripeAdapter` reads `STRIPE_SECRET_KEY` from config and constructs the SDK
client. `FakeStripeAdapter` keeps an in-memory customer/payment-method map, honors
`createCustomer` and attach/detach/read deterministically, and lets tests assert
the `no_card`↔`current` transitions without a network call.

---

## 3. Data model

### 3.1 New table `billing_profiles`

One row per clinic. Columns: `id uuid pk default gen_random_uuid()`, `clinic_id
uuid not null unique` FK → `clinics(id)` `ON DELETE CASCADE`, `billing_email
text?`, `billing_contact_name text?`, `address_line1 text?`, `address_line2
text?`, `city text?`, `state_code text?`, `zip_code text?`, `tax_id text?`,
`stripe_customer_id text?`, `created_at timestamptz not null default now()`,
`updated_at timestamptz not null default now()`.

Prisma model `BillingProfile` with `@@map("billing_profiles")`; relation
`Clinic.billingProfile BillingProfile?`.

`stripe_customer_id` is duplicated on both `clinics` and `billing_profiles`
because .NET reads it from either; the clinic column is the source of truth
(written at approval), the profile column mirrors .NET's entity. The admin
endpoint reads `billing_profiles.stripe_customer_id ?? clinics.stripe_customer_id`.

### 3.2 New table `invoices`

Columns: `id uuid pk default gen_random_uuid()`, `clinic_id uuid not null` FK →
`clinics(id)` `ON DELETE CASCADE`, `stripe_invoice_id text?`, `period_start
timestamptz not null`, `period_end timestamptz not null`, `lead_count int not
null`, `price_per_lead numeric(10,2) not null`, `platform_fee numeric(10,2) not
null`, `total_amount numeric(10,2) not null`, `status text not null default
'draft'` (one of `draft`, `open`, `paid`, `overdue`, `void`), `due_date
timestamptz?`, `paid_at timestamptz?`, `invoice_url text?`, `pdf_url text?`,
`created_at timestamptz not null default now()`. Index on `(clinic_id,
period_start desc)`.

Prisma model `Invoice` with `@@map("invoices")`.

### 3.3 New `clinics` columns

- `stripe_customer_id text?` — written at approval and by the backfill.
- `subscription_active_through timestamptz?` — unused until subsystem 2.
- `subscription_cancelled_at timestamptz?` — unused until subsystem 2.

### 3.4 Billing status

`clinics.billing_status` already exists as text. This slice uses two of the .NET
`AdminBillingStatus` values: `no_card` and `current`. The full set (`current`,
`overdue`, `no_card`, `paused`, `cancelled`) is documented for reference; the
others are set by subsystem 2. Define the set as an exported constant.

---

## 4. Approval integration and backfill

### 4.1 Approval

Extend the Slice 4 `ReviewApplicationUseCase`. After the existing atomic
clinic+login commit, on the approve path, create the Stripe customer
(`createCustomer(clinicName, contactEmail, clinicId)`) and store the returned id
on `clinics.stripe_customer_id`. This runs **after** the commit, best-effort,
exactly like the welcome email already does: a Stripe failure is logged and does
not roll back the approval. The `ApproveResult` gains a `stripeCustomerCreated`
boolean, mirroring the .NET `ApprovalResult`.

### 4.2 Backfill

A one-off script `prisma/scripts/backfill-stripe-customers.ts`
(`pnpm backfill:stripe`) that, for every clinic with `status` not deleted and a
null `stripe_customer_id`, creates a Stripe customer and stores the id. Idempotent
(skips clinics that already have one) and safe to re-run. It uses the same
`STRIPE_PORT`, so pointing it at the fake adapter is a no-op dry run.

---

## 5. Security

- New RLS policies, all under `withUserContext`:
  - `billing_profiles`: clinic self-scope (`clinic_id = current_clinic_id`) for
    select and the upsert; an admin `_all` policy for the admin read; `ENABLE` +
    `FORCE ROW LEVEL SECURITY`.
  - `invoices`: clinic select on own rows (`clinic_id = current_clinic_id`),
    admin `_all` for the admin read; `ENABLE` + `FORCE`. No clinic insert or
    update grant (invoices are system-written in subsystem 2).
- The admin idiom is copied verbatim from the prior slices.
- `stripe_customer_id` is stored plaintext. The `STRIPE_SECRET_KEY` env var is
  server-side only and never serialized to a client.
- Card data is never stored; the only place brand/last4/expiry exist is the live
  Stripe read and the response DTO.

---

## 6. Module structure

```
src/modules/billing/
  domain/ports/stripe.port.ts              STRIPE_PORT + interface
  domain/billing-fee.ts                    pure proration + 2026-promo math
  domain/ports/billing-repository.port.ts  BILLING_REPOSITORY
  application/get-clinic-billing.use-case.ts
  application/update-clinic-billing.use-case.ts
  application/get-payment-method.use-case.ts
  application/save-payment-method.use-case.ts
  application/remove-payment-method.use-case.ts
  application/get-admin-clinic-billing.use-case.ts
  infrastructure/adapters/stripe.adapter.ts
  infrastructure/adapters/fake-stripe.adapter.ts
  infrastructure/prisma-billing.repository.ts
  infrastructure/http/clinic-billing.controller.ts   (/clinic/portal/billing + /payment-method)
  infrastructure/http/dto/*.dto.ts
  billing.module.ts
```

The admin billing endpoint (`GET /admin/clinics/{id}/billing`) is added to the
existing `AdminClinicsController` (Slice 5), calling a billing use case, so all
`/admin/clinics` routes stay in one controller.

The fee math (§1.1) lives in one pure `billing-fee.ts` module, unit-tested
directly, so the estimate and any future invoice-time computation share one
implementation.

---

## 7. Testing

- **DB integration:** schema specs for the two tables and three columns; RLS
  specs proving a clinic sees only its own billing profile and invoices, an admin
  sees all, and a patient/anonymous context sees zero.
- **Unit:** `billing-fee.ts` across full-month, mid-month proration, a 2026
  clinic with 0/1/2 prior invoices, and a non-2026 clinic. Each use case with the
  Stripe port faked.
- **E2E** against the `FakeStripeAdapter`: the full card lifecycle (no card →
  `GET` returns null → `POST` attaches and flips `no_card` to `current` → `GET`
  returns the card → `DELETE` flips back to `no_card`), the billing-profile
  upsert and its best-effort email sync, the `422` no-customer path, and the
  admin billing endpoint returning card info plus an empty invoice list. Assert
  the mixed-case `ClinicPaymentMethodDto` keys literally.
- **Approval:** extend the Slice 4 approval e2e to assert a Stripe customer id is
  stored on approve, and that a forced Stripe failure still approves the clinic.

---

## 8. Deploy notes

- Two migrations: the schema (tables + columns) and the RLS policies.
- One new env var: `STRIPE_SECRET_KEY` (test mode for now). Add it to
  `.env.example` and the Railway config. The webhook secret is subsystem 2.
- Run `pnpm backfill:stripe` against production once, after deploy, to give
  existing clinics a Stripe customer.
- Frontend: the clinic billing screen and card form (Stripe.js produces the
  `paymentMethodId`) and the admin per-clinic billing view bind to these
  endpoints.
