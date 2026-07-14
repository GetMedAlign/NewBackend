# Clinic Portal (Slice 3) — Design

**Goal:** Give clinics a portal to log in, manage their profile and media, and
work the leads the patient journey generates. Mirrors the .NET
`ClinicPortalController` and `ClinicMediaController`, minus Stripe billing
(a later slice), and replaces multipart media upload with signed-URL upload.

**Architecture:** NestJS hexagonal (domain / application / infrastructure),
Prisma 7 + Postgres RLS, on the Foundation auth/security layer. Clinic users
reuse Foundation auth (email + password + 2FA); a `clinic_id` claim scopes all
clinic-owned data by RLS. Media uploads go directly to Supabase Storage via
backend-issued, path-scoped signed URLs.

## Global constraints (binding)

- Contract mirrors the .NET clinic portal endpoints and DTOs **exactly**,
  including JSON casing: the leads and webhook-delivery payloads use
  **snake_case** field names (matching the existing frontend `ClinicLead`
  interface); the profile, rotate, and test-webhook payloads use camelCase.
- Reuse Foundation primitives: `withUserContext`/`asSystem`, `EncryptionPort`
  (AES-256-GCM), `EMAIL_SENDER`, the Slice 2 SSRF-guarded webhook sender.
- All clinic-owned data access is RLS-enforced under `withUserContext`; system
  paths use `asSystem`. No `any` in production code. No forbidden commit
  trailers. Keep `openapi.json` current.
- Node 24, pnpm, hexagonal ports with `Symbol` DI tokens.

## 1. Endpoints

All routes are authenticated and require role `clinic` **and** a `clinicId`
claim (a global `ClinicGuard`/`@CurrentClinic()` yields the clinic id; a patient
or a clinic-less token → **403**). Base path `/clinic/portal`.

**Profile**
- `GET /clinic/portal/profile` → `ClinicPortalProfileDto` (camelCase). Includes
  `leadCount`, `lastLeadAt` (yyyy-MM-dd or null), `webhookSecretConfigured`
  (bool, never the secret), and read-only `billingStatus` / `webhookHealth` /
  `suspensionReason`. `specialty` maps `category` → label
  (`hormone→Hormone Therapy`, `peptide→Peptide Therapy`,
  `med_spa→Med Spa & Aesthetics`, `wellness→Integrative Wellness`).
  Clinic not found → 404.
- `PUT /clinic/portal/profile` (`UpdateClinicPortalProfileRequest`, all optional)
  → `{ success: true }`. Only provided fields update. If `webhookUrl` is
  present it must be absolute **HTTPS** else 400. `city`/`stateCode` change
  recomputes `location = "City, StateCode"`. `treatmentCategories` (if non-empty)
  replaces the category set. `topServices`/`allServices` (if present) replace the
  service set: top services get `is_top_service=true` and `display_order` by
  input order; the remaining `allServices` (minus top) get `is_top_service=false`.

**Leads** (snake_case JSON)
- `GET /clinic/portal/leads` → `ClinicLeadDto[]`, `received_at` desc. Each:
  `{ lead_id, received_at (ISO-8601), lead_source, patient: { first_name, email,
  zip_code }, assessment_summary: { treatmentCategory, topGoals[], topSymptoms[],
  budgetBand, telehealthPreference, startTimeline }, delivery_status,
  clinic_status }`. `topGoals`/`topSymptoms` split the lead's comma strings.
- `GET /clinic/portal/leads/:leadId` → one `ClinicLeadDto` (same shape). Not the
  caller's clinic / not found → 404.
- `PATCH /clinic/portal/leads/:leadId/status` (`{ status }`) → `{ success: true }`.
  `status` validated against `new|contacted|booked|converted|not_interested`
  (else 400). Only the lead's `clinic_status` changes.
- `POST /clinic/portal/leads/:leadId/contact-request` → emails the patient on the
  clinic's behalf (`EMAIL_SENDER`, patient email + first name + clinic name +
  website). Lead not the caller's / not found → 404. Send failure → 500. Success
  → `{ success: true }`.

**Webhook management**
- `GET /clinic/portal/webhook-deliveries` → `WebhookDeliveryDto[]` (snake_case)
  for the caller clinic's leads, most-recent first, capped at 50:
  `{ lead_id, attempted_at, status, http_status_code, error_message }`.
- `POST /clinic/portal/webhook/rotate` → generates a new secret, stores it
  AES-256-GCM encrypted, returns `{ webhookSecret }` in **plaintext once**.
- `POST /clinic/portal/test-webhook` (`{ webhookUrl }`) → sends a signed test
  payload to `webhookUrl` through the Slice 2 SSRF guard (HTTPS-only, IP-pinned,
  no redirects, timeout), records a `webhook_deliveries` row, and returns the
  delivery outcome `{ status, http_status_code?, error_message? }`. `webhookUrl`
  must be absolute HTTPS (else 400).

**Media** (see §5)
- `POST /clinic/portal/media/logo/sign` → `{ uploadUrl, token, path }`.
- `POST /clinic/portal/media/logo` (`{ path }`) → `{ url }`.
- `POST /clinic/portal/media/photos/sign` (`{ count }`) → `{ uploads: [{ uploadUrl, token, path }] }`.
- `POST /clinic/portal/media/photos` (`{ paths: string[] }`) → `{ urls: string[] }`.
- `GET /clinic/portal/media/photos` → `string[]` (URLs, `display_order` asc).

## 2. Modules

- `modules/auth` (extend): `clinic_id` on the user identity + JWT claim;
  `withUserContext` sets `app.current_clinic_id`; `ClinicGuard` + `@CurrentClinic()`.
- `modules/clinic-portal` — profile + leads + webhook-management use cases,
  `ClinicPortalController`, `ClinicRepository` writes (profile/services/
  categories), `ClinicLeadRepository` (clinic-scoped lead reads + status update +
  delivery reads). Reuses the Slice 2 `WEBHOOK_SENDER`.
- `modules/clinic-media` — `StoragePort` (`SUPABASE_STORAGE`), sign/confirm/list
  use cases, `ClinicMediaController`, `clinic_photos` repository.
- `modules/clinics` (extend): read model already exists; add the new columns.

## 3. Data model

- **`users`**: add `clinic_id uuid null` FK → `clinics(id)` `ON DELETE SET NULL`.
  A `clinic`-role user carries a non-null `clinic_id`.
- **`clinics`** add columns: `differentiators text null`, `offers_lab_work bool
  not null default false`, `insurance_notes text null`, `credentials text null`,
  `npi_number text null`, `state_license_number text null`, `logo_url text null`,
  `photo_count int not null default 0`, `weekly_summary bool not null default
  false`, `location text null`, `webhook_health text not null default 'unknown'`
  (`unknown|healthy|degraded|failing`), `suspension_reason text null`,
  `created_at timestamptz not null default now()`.
- **`clinic_photos`** (new): `id uuid pk`, `clinic_id uuid fk clinics ON DELETE
  CASCADE`, `url text not null`, `display_order int not null`. RLS + FORCE.
- **`webhook_deliveries`** (exists): read by the owning clinic; add a
  clinic-scoped select policy.
- Seeds: link 1-2 seed clinics to new `clinic`-role users (known password for
  local/e2e), and populate the new clinic columns.

## 4. Security

- **Auth/authz:** clinic login is the existing signin + 2FA. The JWT gains
  `clinicId`. `ClinicGuard` requires role `clinic` + non-null `clinicId`;
  everything else on `/clinic/portal/*` → 403. Portal endpoints operate only on
  `@CurrentClinic()` — never a clinic id from the request body/route.
- **RLS (role `clinic`):** `withUserContext` sets `app.current_clinic_id`.
  Policies: `clinics` self select+update where `id = current_clinic_id`; `leads`
  self select + `clinic_status`-only update where `clinic_id = current_clinic_id`;
  `webhook_deliveries` select for the caller clinic's leads; `clinic_photos`
  self all. Patient policies unchanged; `asSystem` bypasses. Integration tests
  prove clinic A cannot read/write clinic B's rows.
- **Media path authorization:** the confirm endpoints reject any `path` whose
  prefix is not `logos/<callerClinicId>/` or `photos/<callerClinicId>/`, so a
  clinic cannot register another clinic's object. Signed upload tokens are issued
  only for the caller's own prefix.
- **Webhook secret:** stored AES-256-GCM encrypted; only ever returned in
  plaintext by `rotate`, once. `webhookSecretConfigured` exposes presence only.
- **SSRF:** `test-webhook` reuses the Slice 2 guarded sender unchanged.
- **PHI:** lead reads carry patient first name/email/zip and assessment summary
  to the owning clinic only (RLS), over the PHI-access path.

## 5. Media (signed-URL upload)

- New env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`
  (default `clinic-media`, **public-read**, write only via signed tokens). The
  bucket restricts image mime types and per-object size (logo ≤5MB, photo ≤10MB).
- `StoragePort`: `createSignedUploadUrl(path)` → `{ uploadUrl, token }`;
  `publicUrl(path)`; `remove(paths[])`. Supabase adapter uses the service-role
  key server-side; a test seam avoids live calls in unit/integration tests.
- **Logo:** `…/logo/sign` issues a signed URL for `logos/<clinicId>/<uuid>.<ext>`
  and returns `{ uploadUrl, token, path }`. Client uploads to Supabase. `…/logo`
  `{ path }` validates the prefix, deletes the previous `logo_url` object (if
  any), sets `logo_url = publicUrl(path)`, returns `{ url }`.
- **Photos:** `…/photos/sign` `{ count }` (1-8) returns `count` scoped signed
  URLs. Client uploads each. `…/photos` `{ paths[] }` (≤8, all prefix-checked)
  **replaces** the set: delete existing `clinic_photos` objects + rows, insert
  new rows in order, set `photo_count`, return `{ urls }`. `GET …/photos` lists
  URLs by `display_order`.
- **Deviation from .NET (accepted):** upload is client-direct via signed URL, not
  server-proxied multipart; the frontend upload flow changes accordingly.

## 6. Testing

- **Unit:** profile DTO mapping (incl. `specialty` label, `webhookSecretConfigured`,
  services/categories replace logic); lead-status validation; webhook rotate
  (encrypt) + test-webhook outcome mapping; media path-prefix authorization
  (reject another clinic's path); HTTPS validation for `webhookUrl`.
- **Integration (real Postgres):** clinic RLS isolation — clinic A cannot read
  B's profile/leads/deliveries/photos, and cannot update B's lead status;
  profile update round-trip; lead `clinic_status` update scoped; webhook secret
  ciphertext at rest; `clinic_photos` replace semantics. Storage behind a seam.
- **E2e:** clinic login (signin → 2FA → cookie with `clinicId`) → `GET profile`
  → `GET leads` → `PATCH` a lead status → `POST webhook/rotate`; a **patient**
  token on any `/clinic/portal/*` route → 403; media sign→confirm happy path
  with the storage seam, and a cross-clinic `path` on confirm → 403.

## 7. Definition of done

All suites green (unit/int/e2e), `build`/`lint`/`typecheck`/`format:check` clean,
`openapi.json` regenerated with the new endpoints, README endpoint list updated,
seeds runnable. New env vars documented. No `any`; no forbidden trailers.

## Deferred (later slices)

- **Billing (Stripe):** `GET/PUT /billing`, `/invoices`, `/payment-method`
  (GET/POST/DELETE), `/subscription/cancel`, and the billing/invoice/payment
  tables. The profile DTO's `billingStatus` is exposed read-only now.
- **Admin onboarding:** admin-driven clinic + clinic-user creation (this slice
  seeds clinic users). Clinic notes.

## Deviations from .NET (all accepted)

1. `clinicId` and clinic-scoped ids are UUID strings, not integers.
2. Media upload is signed-URL client-direct, not server multipart.
3. Billing endpoints and clinic-notes are out of scope for this slice.
