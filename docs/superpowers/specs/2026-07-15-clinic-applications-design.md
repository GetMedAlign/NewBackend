# Clinic Applications & Onboarding (Slice 4) — Design

**Goal:** Let prospective clinics apply to the platform, let admins review and
approve/deny applications, and on approval provision the clinic (record +
categories/services/photos) AND its portal login, so an approved clinic can set
a password and immediately use the Clinic Portal (Slice 3).

**Architecture:** NestJS hexagonal on the Foundation auth/RLS layer. Admin
routes are gated by the existing `RolesGuard` + `@Roles('admin','superadmin')`
and run under `withUserContext({ userId, role })` so Foundation's `has_role`
admin RLS policies apply and audit triggers attribute actions to the real admin.
A new `password_reset_tokens` store backs a shared forgot/reset-password flow.
Application media reuses the Slice-3 Supabase Storage signed-URL adapter.

## Global constraints (binding)

- Contract mirrors the .NET `ClinicApplicationsController` + `AdminApplicationsController`.
- Reuse Foundation/Slice-2/Slice-3 primitives: `withUserContext`/`asSystem`,
  `RolesGuard` + `@Roles`, `EMAIL_SENDER`, argon2 `PasswordHasherPort`,
  `create_user`, the clinic-media `StoragePort` (signed URLs), and the clinic
  schema/columns from Slice 3.
- All admin + applicant-owned data access is RLS-enforced under `withUserContext`;
  anonymous applicant reads/writes and system provisioning use `asSystem` only
  where justified. No `any`. No forbidden commit trailers. Keep `openapi.json`
  current. Node 24, pnpm, `Symbol` DI tokens.
- Password reset tokens are stored only as a hash; single-use; time-limited.
- Account-enumeration-safe: `forgot-password` returns success regardless of
  whether the email exists.

## 1. Endpoints

**Public — clinic applications**

- `POST /clinic-applications/media/logo/sign` (`{ contentType }`, image mime) and
  `POST /clinic-applications/media/photos/sign` (`{ count }`, 1-8) — mirror the
  Slice-3 media sign DTOs, but issue signed upload URL(s) + path(s) under a
  server-generated `applications/<random>/…` prefix (the applicant is anonymous,
  so there is no clinicId). The applicant uploads directly to storage, then
  submits the resulting public URLs (`logoUrl`, `photoUrls[]`) with the
  application. No draft row is persisted; the paths only scope the upload.
- `POST /clinic-applications` → submit an application (validated). Body mirrors
  the .NET application (see §3): clinic + contact info, offering fields,
  `categories[]`, `services[]` (each `{ serviceCode, isTopService }`),
  `logoUrl?`, `photoUrls?[]`. Creates a row with `status = 'pending'`. Returns
  `{ applicationId }`. Runs via `asSystem` (applicant is anonymous).

**Public — password**

- `POST /auth/forgot-password` (`{ email }`) → if the user exists, generate a
  reset token, store its hash, and email a `${APP_BASE_URL}/reset-password?email=&token=`
  link. Always returns `{ success: true }` (no enumeration).
- `POST /auth/reset-password` (`{ email, token, newPassword }`) → verify the
  token (hash match, not expired, not consumed) for that email, set the argon2
  password, mark the token consumed. Invalid/expired → 400.

**Admin — applications** (`/admin/applications`, `@Roles('admin','superadmin')`)

- `GET /admin/applications` → list applications (newest first; includes status).
- `GET /admin/applications/:id` → full application detail (+ categories/services).
- `PUT /admin/applications/:id/status` (`{ status: 'approved'|'denied', denyReason? }`):
  - **denied** → set `status='denied'`, `deny_reason`, `reviewed_at`,
    `reviewed_by_user_id`; email the applicant the denial. `{ success: true }`.
  - **approved** → in one transaction: create the clinic (slug from name, unique;
    map all offering fields; `billing_status='no_card'`, `webhook_health='unconfigured'`,
    `status='active'`, `notify_on_lead=true`) with its `clinic_categories`,
    `clinic_services` (top flag + display order), and `clinic_photos`; create the
    clinic login user (reuse `create_user`, then set role `clinic` + `clinic_id`,
    mark email confirmed); set `application.status='approved'`,
    `reviewed_*`, `created_clinic_id`; generate a password-set token and email a
    welcome + set-password link. Returns `{ success: true, clinicId }`.
    Unknown status → 400; application not found → 404; already-approved → 409.

## 2. Modules

- `modules/clinic-applications` — `ApplicationRepositoryPort`, submit/list/detail
  use cases, `ClinicApplicationsController` (public) + `AdminApplicationsController`,
  the approval provisioning use case, DTOs.
- `modules/auth` (extend) — `PasswordResetPort` + `password_reset_tokens`
  repository; `forgot-password` / `reset-password` use cases; controller routes.
- Reuse `modules/clinic-media` `StoragePort` for application media signing (add a
  public sign use case scoped to an `applications/<draftId>/` prefix).
- Provisioning reuses the Slice-3 clinic schema (clinics, clinic_categories,
  clinic_services, clinic_photos) and `create_user`.

## 3. Data model

- **`clinic_applications`**: `id uuid pk`, `clinic_name`, `contact_email`,
  `business_email text null`, `city text null`, `state_code text null`,
  `zip_code text null`, `website_url text null`, `telehealth_available bool`,
  `offers_lab_work bool`, `new_patient_wait text null`, `npi_number text null`,
  `state_license_number text null`, `consultation_fee_band text null`,
  `monthly_program_band text null`, `financing_available bool`,
  `insurance_accepted bool`, `insurance_notes text null`, `about text null`,
  `differentiators text null`, `provider_name text null`, `credentials text null`,
  `logo_url text null`, `photo_urls jsonb null`, `status text` (`pending|approved|denied`,
  default `pending`), `deny_reason text null`, `reviewed_at timestamptz null`,
  `reviewed_by_user_id uuid null`, `created_clinic_id uuid null fk clinics`,
  `created_at`, `updated_at`. RLS + FORCE.
- **`application_categories`**: `application_id fk`, `category assessment_category`.
- **`application_services`**: `application_id fk`, `service_code`, `is_top_service bool`,
  `display_order int`.
- **`password_reset_tokens`**: `id uuid pk`, `user_id uuid fk users`,
  `token_hash text` (SHA-256 of the random token), `expires_at timestamptz`,
  `consumed_at timestamptz null`, `created_at`. RLS + FORCE (system-only via
  `asSystem`; no `app_authenticated` policy).

## 4. Security

- **Admin RLS:** admin routes run under `withUserContext({ userId: adminId, role })`.
  Add `has_role`-based admin policies (SELECT/ALL) to `clinic_applications`,
  `application_categories`, `application_services`, and (for provisioning writes)
  `clinics`/`clinic_categories`/`clinic_services`/`clinic_photos` where admin
  write is not yet covered — mirroring Foundation's `*_admin_all` pattern with
  the `nullif(current_setting('app.current_user_id',true),'')::uuid` idiom.
  A non-admin (patient/clinic/anon) context reaches none of the admin data.
- **Provisioning writes** (clinic + user creation on approval) run inside the
  admin `withUserContext` transaction so they are atomic and audited; `create_user`
  is `SECURITY DEFINER` (runs as owner) and is unaffected.
- **Password reset tokens:** the raw token is a `randomBytes(32)` hex string
  returned only in the emailed link; only its SHA-256 hash is stored. Verification
  looks the token up by its stored SHA-256 hash (indexed equality) bound to the
  user's email, and enforces expiry + single use. A constant-time byte compare is
  not required here: the compared value is the SHA-256 of a 256-bit random,
  single-use, 60-minute token, so a timing side-channel on the hash reveals nothing
  usable. `password_reset_tokens` is written/read via `asSystem` (no user context
  at reset time).
- **Application media:** signing issues URLs only under a server-generated
  `applications/<random>/` prefix; the path is never taken from the request, so
  an applicant cannot target another prefix. Reuses the Slice-3 signed-upload
  path. (Because applications are public/anonymous, media here is not clinic-scoped;
  the uploaded objects become the clinic's on approval.)
- **Applicant submit** is anonymous (`asSystem`), rate-limited by the global
  throttler; no PHI is involved (business data only).

## 5. Testing

- **Unit:** application→clinic field mapping (all offering fields, categories,
  services top/order, photos); slug generation + uniqueness fallback; reset-token
  generate/verify (valid, expired, consumed, wrong email); status-transition
  validation (unknown→400, already-approved→409).
- **Integration (real Postgres):** admin RLS — an admin context reads/writes
  applications and provisions clinics; a clinic/patient/anon context sees zero
  application rows and cannot write them. Approval creates clinic + categories +
  services + photos + clinic user (role exactly `clinic`, `clinic_id` set) in one
  atomic transaction (a forced failure rolls all of it back). Reset token is
  single-use (second reset with the same token → rejected) and expired tokens are
  rejected. `forgot-password` for a non-existent email still returns success and
  writes no token.
- **E2e:** full onboarding journey — `POST /clinic-applications` (anon) →
  admin `PUT /admin/applications/:id/status approved` → the provisioned clinic
  user completes `POST /auth/reset-password` with the token → signs in
  (signin + 2FA) → `GET /clinic/portal/profile` returns the new clinic (ties into
  Slice 3). Security: a non-admin token on `/admin/applications/*` → 403;
  `forgot-password` is enumeration-safe.

## 6. Definition of done

All suites green (unit/int/e2e), `build`/`lint`/`typecheck`/`format:check` clean,
`openapi.json` regenerated with the new endpoints, README endpoint list updated,
seeds (a superadmin user + a couple of sample pending applications) runnable. No
`any`; no forbidden trailers.

## 7. Deferred (later slices)

- **AdminClinics / AdminPatients management** (list/update/pause/leads/notes,
  patient soft-delete, admin-initiated set-password/send-password-reset), and
  `clinic_notes`. The password-reset infrastructure built here is reused there.
- **Billing (Stripe):** the Stripe-customer-on-approval step (approval sets
  `billing_status='no_card'` and skips Stripe) and Stripe-backed billing views.

## 8. Deviations from .NET (all intentional)

1. UUID ids (not int).
2. Application media is signed-URL client-direct (not multipart).
3. Own `password_reset_tokens` store replaces ASP.NET Identity's stateless token.
4. Stripe customer creation on approval is deferred to the Billing slice.
