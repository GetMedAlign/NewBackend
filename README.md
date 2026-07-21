# MedAlign Backend

The MedAlign backend, rebuilt as a hexagonal NestJS (TypeScript) service on Prisma + Supabase Postgres, with app-managed auth, Postgres Row-Level Security, DB-side audit logging, and field encryption.

- **Architecture:** [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **Design spec:** [`docs/superpowers/specs/2026-07-10-backend-foundation-design.md`](./docs/superpowers/specs/2026-07-10-backend-foundation-design.md)
- **Implementation plan:** [`docs/superpowers/plans/2026-07-10-backend-foundation.md`](./docs/superpowers/plans/2026-07-10-backend-foundation.md)

## Stack

NestJS · TypeScript (strict) · pnpm · Prisma · Supabase Postgres · argon2 · `@nestjs/jwt` · zod · Jest + supertest · SendGrid. Node 20.

## Quick start

```bash
pnpm install
cp .env.example .env.local        # fill in secrets
supabase start                    # local Postgres (Docker)
pnpm prisma migrate dev           # apply migrations (RLS + audit)
pnpm dev                          # http://localhost:3000
```

## Testing

```bash
pnpm test         # unit
pnpm test:int     # integration against local Supabase Postgres
pnpm test:e2e     # e2e against local Supabase Postgres
```

Integration tests run against a real local Postgres and verify RLS isolation, audit writes, encryption round-trips, and the full auth flow.

## API docs

- **Swagger UI**: `http://localhost:3000/docs` (served automatically when the server is running).
- **`openapi.json`**: committed to the repo root. Import directly into Postman via _File → Import → select `openapi.json`_.
- **Regenerate** (offline, no DB required):
  ```bash
  pnpm openapi
  ```
  This runs `scripts/generate-openapi.ts` with stub providers, so no database connection is needed.

> **CSRF & local testing:** the API uses double-submit CSRF (an `x-csrf-token` header must match the `csrf_token` cookie on non-GET requests). Enforcement is **skipped when `NODE_ENV=development`**, so Postman/curl can hit POST routes directly during local dev. CSRF is fully enforced in `test` and `production`.

## Auth API (Foundation slice)

Contract-compatible with the existing .NET service, so the frontend is unchanged:

```
POST /auth/signup
POST /auth/signin        -> { requiresTwoFactor: true }   (no token yet)
POST /auth/2fa/verify    -> sets HttpOnly session cookie
POST /auth/2fa/send      -> resend the email OTP
GET  /auth/me            -> current user + role
POST /auth/signout
GET  /health             -> { status: "ok" }
```

Roles: `patient | clinic | admin | superadmin`.

## Patient Journey API

The anonymous-assessment → recommendations → lead → patient dashboard flow:

```
POST /assessments                 -> { sessionId, claimToken }  (anonymous; consent required)
GET  /assessments/latest          -> claim an assessment via ?sessionId=&claimToken= (authenticated; 204 if not yours)
GET  /recommendations/:sessionId  -> ranked clinic matches for the session (public; no PHI)
POST /leads                        -> { leadId }  (anonymous or authenticated; delivers to the clinic)
GET  /patients/me                  -> current patient profile (authenticated)
PUT  /patients/me                  -> update the patient profile (authenticated)
GET  /patients/me/leads            -> the caller's submitted leads (authenticated)
```

The `claimToken` (returned from `POST /assessments`) is the only proof that binds an
anonymous `sessionId` to the caller. A stolen `sessionId` without a valid `claimToken`
cannot claim the assessment or attribute its lead; the token model is stricter than the
.NET original by design.

## Clinic Portal API

The clinic-facing portal lets clinic staff log in with the same `/auth/*` flow and receive a JWT that carries `clinicId` (role `clinic`).

```
GET  /clinic/portal/profile                              -> clinic profile (name, about, services, logoUrl, etc.)
PUT  /clinic/portal/profile                              -> partial update (name, about, webhookUrl, services, …)
GET  /clinic/portal/leads                                -> paginated lead list for the clinic
GET  /clinic/portal/leads/:leadId                        -> lead detail
PATCH /clinic/portal/leads/:leadId/status               -> update clinic_status (new|contacted|booked|converted|not_interested)
POST  /clinic/portal/leads/:leadId/contact-request      -> send an outreach email to the patient

POST /clinic/portal/webhook/rotate                       -> generate & store a new webhook secret → { webhookSecret }
GET  /clinic/portal/webhook-deliveries                  -> delivery history (last 50)
POST /clinic/portal/test-webhook                         -> fire a test payload to the given URL → WebhookDeliveryDto

POST /clinic/portal/media/logo/sign                      -> get a pre-signed upload URL for the clinic logo → { uploadUrl, token, path }
POST /clinic/portal/media/logo                           -> confirm logo upload (write path to DB) → { url }
POST /clinic/portal/media/photos/sign                    -> get pre-signed upload URLs for gallery photos → { uploads: [...] }
POST /clinic/portal/media/photos                         -> confirm photo uploads → { urls: [...] }
GET  /clinic/portal/media/photos                         -> list current gallery photo URLs → string[]
```

All `/clinic/portal/*` routes require role `clinic`. A `patient` JWT returns 403. A path under another clinic's storage prefix returns 403.

### New environment variables (Supabase Storage)

| Variable                    | Description                                                        |
| --------------------------- | ------------------------------------------------------------------ |
| `SUPABASE_URL`              | Supabase project URL (e.g. `https://<project>.supabase.co`)        |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (bypasses RLS for signed URL generation) |
| `SUPABASE_STORAGE_BUCKET`   | Storage bucket name for clinic media (e.g. `clinic-media`)         |

Placeholder values are provided in `.env` and `test/.env.test` for local development.

## Clinic Applications API (Slice 4)

Prospective clinics submit an application anonymously. An admin reviews and approves or denies it. On approval, the clinic record is provisioned and the contact receives a set-password link so they can immediately log into the Clinic Portal.

**Onboarding flow:** clinic submits application (anonymous) -> admin approves -> welcome email with a set-password link is sent -> clinic clicks the link, sets a password, signs in with 2FA -> `GET /clinic/portal/profile` returns the provisioned clinic.

**Application media (anonymous, no account required):**

```
POST /clinic-applications/media/logo/sign    -> { uploadUrl, token, path }  (pre-signed logo upload)
POST /clinic-applications/media/photos/sign  -> { uploads: [...] }          (pre-signed photo uploads, 1-8)
```

**Public application submit:**

```
POST /clinic-applications  -> { applicationId }  (anonymous; body: clinic + contact info, categories, services, optional logoUrl/photoUrls)
```

**Admin review (roles: admin, superadmin):**

```
GET /admin/applications          -> array of application summaries (newest first)
GET /admin/applications/:id      -> full application detail including categories and services
PUT /admin/applications/:id/status  -> { status: 'approved'|'denied', denyReason? }
                                        approved: { success: true, clinicId }
                                        denied:   { success: true }
```

Status transition rules: unknown status returns 400; already-approved application returns 409.

**Local testing seed:** the database seed includes a superadmin account at `superadmin@medalign-seed.example.com`. Use `pnpm seed:pj` to populate the local DB.

## Admin Clinics & Patients API (Slice 5)

Admin/superadmin management of existing clinics and patients: read/edit clinic records, pause lead delivery, keep internal notes, read/edit patients, soft-delete patients, and reset or set passwords for either. Ids are UUID strings.

**Clinics (roles: admin, superadmin):**

```
GET  /admin/clinics                          -> array of clinic summaries
GET  /admin/clinics/:id                      -> full clinic detail
PUT  /admin/clinics/:id                      -> partial update -> { success: true }
POST /admin/clinics/:id/pause-delivery       -> body: { paused: boolean } -> { success: true }
GET  /admin/clinics/:id/leads                -> the clinic's leads (admin lead-row shape)
GET  /admin/clinics/:id/notes                -> the clinic's admin notes (newest first)
POST /admin/clinics/:id/notes                -> body: { body: string } -> created note (author resolved from the caller's token, never the request body)
POST /admin/clinics/:id/send-password-reset  -> emails a reset link to the clinic's linked user -> { success: true }
POST /admin/clinics/:id/set-password         -> body: { newPassword } -> directly sets the linked user's password -> { success: true }
```

**Patients (roles: admin, superadmin):**

```
GET    /admin/patients                          -> array of patient summaries (rate-limited: 20/min, since it returns identifying info for every patient)
GET    /admin/patients/:id                      -> full patient detail
PUT    /admin/patients/:id                      -> partial update -> { success: true }
DELETE /admin/patients/:id                      -> soft-delete: sets is_deleted, deleted_at, and locks the linked user out of sign-in -> { success: true }
POST   /admin/patients/:id/send-password-reset  -> emails a reset link to the patient's linked user -> { success: true }
POST   /admin/patients/:id/set-password         -> body: { newPassword } -> directly sets the linked user's password -> { success: true }
```

Patient routes never decrypt encrypted assessment fields (`treatment_category` is the only plain-enum assessment column exposed) and write a `phi_access` audit record on every read.

**Local testing seed:** in addition to the superadmin account above, `pnpm seed:pj` seeds two `admin_notes` on `vitality-hormone-nyc` (authored by the superadmin) and a soft-deleted patient account, `patient-deleted@medalign-seed.example.com` / `SeedPatient1!`, whose linked user is locked out of sign-in (`locked_until` far in the future). Use it to exercise the admin patient list's deleted-state filtering and the sign-in lockout path.

## Billing API (Slice 6)

Per-clinic billing profile, default payment method (via Stripe), and an admin read-only billing view. This is billing subsystem 1: profile + fee estimate + card management. Invoicing/subscriptions are a future subsystem, so `invoices` is always `[]` and the subscription fields are always `null` for now.

**Clinic portal (role: clinic):**

```
GET  /clinic/portal/billing          -> billing profile + current-period lead count + estimated platform fee + promo months remaining
PUT  /clinic/portal/billing          -> partial update (billingEmail, billingContactName, address, taxId, ...) -> { success: true }
                                         a changed billingEmail is synced to the clinic's Stripe customer, best-effort

GET  /clinic/portal/payment-method   -> default card, read live from Stripe -> { brand, last4, exp_month, exp_year, stripePaymentMethodId } or null
POST /clinic/portal/payment-method   -> body: { paymentMethodId }  (from Stripe.js) -> attaches it as the Stripe default -> the same card DTO
DELETE /clinic/portal/payment-method -> detaches the default payment method (best-effort) -> { success: true }
```

**Admin (roles: admin, superadmin):**

```
GET /admin/clinics/:id/billing  -> { info: { stripeCustomerId, billingEmail, cardBrand, cardLast4, cardExpMonth, cardExpYear, monthlyFee, pricePerLead, deliveryPaused }, invoices: [] }
```

Cards are never stored in the database; every read goes to Stripe live. `estimatedPlatformFee` is only the flat monthly platform fee, prorated for a clinic's first partial month and waived under the 2026 Welcome Promotion. Per-lead pricing is not included in this field; `currentPeriodLeadCount` is returned separately as a raw count.

### New environment variable (Stripe)

| Variable            | Description                                                                   |
| ------------------- | ----------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY` | Stripe **test-mode** secret key. Used for customer/payment-method/card calls. |

**One-time backfill:** run `pnpm backfill:stripe` once after deploying this slice (and once against production after the migrations are applied) to create a Stripe customer for every existing clinic that doesn't have one yet. Safe to re-run; it skips clinics that already have a `stripe_customer_id`.

## Auth additions

Password reset endpoints added in Slice 4 (shared infrastructure, also used by future Admin-initiated resets):

```
POST /auth/forgot-password  -> { success: true }  (always 200; account-enumeration-safe)
POST /auth/reset-password   -> { success: true }  (body: { email, token, newPassword }; 400 on invalid/expired/consumed token)
```

Password reset tokens are single-use, expire after 60 minutes, and stored only as a SHA-256 hash.

## Rebuild roadmap

1. **Foundation**: scaffold, config, Prisma + RLS, audit, encryption, auth vertical slice.
2. Patient journey: assessments, matching, leads.
3. Clinics & clinic portal.
4. Clinic Applications and onboarding (Slice 4): application submit, admin review, approval provisioning, password reset.
5. Admin Clinics & Patients (Slice 5): admin clinic list/edit/notes/pause-delivery, admin patient list/edit/soft-delete, password reset/set for both.
6. Billing subsystem 1 (Slice 6): billing profile, fee estimate, Stripe-backed default payment method, admin billing view. Background jobs, email, and invoicing/subscriptions land in a later billing subsystem. _(in progress)_
7. Cutover: data migration from SQL Server, go-live. _(planned)_
