# Admin Clinics & Patients Design (Slice 5)

**Date:** 2026-07-20
**Status:** Approved

## Goal

Give admins management of the clinics and patients that already exist in the
system: read and edit clinic records, pause lead delivery, keep internal notes,
read and edit patient records, soft-delete patients, and reset or set passwords
for either. Mirrors the .NET `AdminClinicsController` and
`AdminPatientsController`.

## Scope

**In scope:** 15 endpoints across two controllers, the `admin_notes` table, two
new `clinics` columns, admin RLS policies for the tables these endpoints read,
and PHI access logging for the patient routes.

**Out of scope (deferred to Slice 6, Billing):**
`GET /admin/clinics/{id}/billing`. It depends on `billing_profiles` and
`invoices` tables and a Stripe client that do not exist yet. Building it here
would drag most of the Billing slice forward, and its invoice list would be
empty until the invoice generation job exists. Slice 6 covers the Stripe
client, billing profile and invoice tables, the Stripe webhook, payment method
management, the invoice generation job, and this endpoint together.

Also out of scope: `AdminRevenueController` and admin user management
(`AdminUserDto`, `CreateAdminRequest`), which are separate .NET controllers.

## Architecture

NestJS hexagonal on the Foundation auth/RLS layer, identical in shape to Slice 4.
Two modules, `admin-clinics` and `admin-patients`, each with
domain / application / infrastructure layers and `Symbol` DI tokens.

Admin routes use the existing `RolesGuard` + `@Roles('admin','superadmin')` and
run under `withUserContext({ userId, role })` so the `has_role` admin RLS
policies apply and audit rows attribute the acting admin. The admin's id and
role come only from `request.user` via `@CurrentUser()`, never from the request
body or path.

Password operations reuse the Slice 4 reset infrastructure
(`PASSWORD_RESET_REPOSITORY`, `hashResetToken`, `PASSWORD_HASHER`) rather than
introducing a second credential path.

## Global Constraints

- Contract mirrors the .NET admin controllers. Exhaustive field lists in §1.
- Ids are UUID strings, not the .NET integers. This is the established
  deviation from prior slices and applies to every `:id` path parameter and
  every `id` response field.
- All access is RLS-enforced under `withUserContext`. Admin identity comes ONLY
  from `request.user`.
- Admin RLS idiom, copy verbatim:
  `has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')`
- No `any` in production code. Keep `openapi.json` current; update README.
  No `Co-Authored-By` / Anthropic / Claude commit trailers. Node 24, pnpm.
- The admin patient endpoints MUST NOT decrypt any encrypted assessment field.

---

## 1. Contracts

Serialization is camelCase except where noted. Two response DTOs are
deliberately **mixed case** to match the existing TypeScript interfaces the
frontend already binds to; reproduce them exactly.

### 1.1 `AdminClinicDto`

Returned by `GET /admin/clinics` (array) and `GET /admin/clinics/:id` (object).
All camelCase.

`id`, `slug`, `name`, `category`, `specialty`, `location`, `city`, `stateCode`,
`zipCode`, `rating` (number), `reviewCount` (int), `about`, `differentiators`,
`services` (string[]), `allServices` (string[]), `waitTime`, `telehealth`
(bool), `offersLabWork` (bool), `websiteUrl` (nullable), `consultationFee`,
`monthlyProgram`, `financing` (bool), `insurance` (bool), `insuranceNotes`,
`providerName`, `credentials`, `photoCount` (int), `status`, `createdAt`,
`leadCount` (int), `lastLeadAt` (nullable), `billingStatus` (nullable),
`webhookHealth` (nullable), `suspensionReason` (nullable).

**Derivation rules, matching .NET `ToDto`:**

- `category` = the clinic's first category row, or `"wellness"` when it has none.
- `specialty` = lookup of `category` in this fixed map, falling back to the
  `category` value itself:
  `hormone` → `"Hormone Therapy"`, `peptide` → `"Peptide Therapy"`,
  `med_spa` → `"Med Spa & Aesthetics"`, `wellness` → `"Integrative Wellness"`.
- `services` = service codes where `is_top_service` is true, ordered by
  `display_order`.
- `allServices` = all service codes, ordered by `is_top_service` descending
  (top services first), then `display_order`.
- `about`, `differentiators`, `insuranceNotes`, `providerName`, `credentials`
  serialize `null` as `""` (empty string), matching .NET.
- `leadCount` = count of that clinic's leads. `lastLeadAt` = max `received_at`
  of those leads, or `null` when the clinic has no leads.
- `createdAt` and `lastLeadAt` format as `yyyy-MM-dd`.

Clinic list is ordered by `name` ascending.

### 1.2 `UpdateClinicRequest`

Body of `PUT /admin/clinics/:id`. Every field optional; a field absent or
`null` leaves the column unchanged (`if (x is not null)` semantics in .NET).

`name`, `status`, `about`, `differentiators`, `providerName`, `credentials`,
`websiteUrl`, `city`, `stateCode`, `zipCode`, `telehealth` (bool),
`offersLabWork` (bool), `financing` (bool), `insurance` (bool),
`insuranceNotes`, `consultationFee`, `monthlyProgram`, `waitTime`, `rating`
(number), `reviewCount` (int), `isListedInDirectory` (bool), `logoUrl`.

**Mapping to columns** (request field → column): `telehealth` →
`telehealth_available`, `financing` → `financing_available`, `insurance` →
`accepts_insurance`, `consultationFee` → `consultation_fee_band`,
`monthlyProgram` → `monthly_program_band`, `waitTime` → `new_patient_wait`.
The rest map by name.

**`status`** is only applied when it is one of exactly these four values,
matching the .NET `ClinicStatus` enum:

- `active`
- `paused` — delivery manually paused by an admin
- `suspended` — auto-suspended, for example for overdue billing
- `inactive` — soft-deactivated; replaces hard delete

An unrecognized value is **ignored**, leaving the column unchanged, rather than
rejected with a 400. This matches .NET's `Enum.TryParse` guard. Our
`clinics.status` column is plain `text` with no CHECK constraint, so this
validation lives in application code; define the set as a single exported
constant used by both the DTO validator and the update use case.

`rating` is `Decimal(2,1)` in Prisma and must serialize as a JSON **number**,
not a string. Prisma returns a `Decimal` object, so convert explicitly.

**Derived `location`:** when `city` or `stateCode` is present in the request,
recompute `location` as `"{city}, {stateCode}"` from the post-update values.

Response: `{ "success": true }`.

### 1.3 `PauseDeliveryRequest`

Body of `POST /admin/clinics/:id/pause-delivery`: `{ "paused": boolean }`.

- `paused: true` → set `status = 'paused'` and `notify_on_lead = false`.
- `paused: false` → **only if** current `status` is `'paused'`, set
  `status = 'active'` and `notify_on_lead = true`. If the clinic is not
  currently paused, change nothing.

Response: `{ "success": true }`.

### 1.4 `AdminLeadRowDto` — MIXED CASE

Returned by `GET /admin/clinics/:id/leads` as an array, ordered by
`received_at` descending. Field names exactly as written:

- `lead_id` (snake)
- `received_at` (snake) — ISO 8601 round-trip format
- `patientFirstName` (camel)
- `patientEmail` (camel)
- `patientZip` (camel) — `null` serializes as `""`
- `treatmentCategory` (camel)
- `delivery_status` (snake)
- `clinic_status` (snake)

### 1.5 `AdminNoteDto`

`id`, `createdAt` (ISO 8601), `authorName`, `body`. All camelCase.
Returned as an array by `GET /admin/clinics/:id/notes` ordered by `created_at`
descending, and as a single object by `POST /admin/clinics/:id/notes`.

### 1.6 `AddNoteRequest`

`{ "body": string }`. Required, max length 4000.

### 1.7 `AdminPatientDto`

`id`, `name`, `email`, `dob` (nullable, `yyyy-MM-dd`), `zipCode`, `createdAt`
(`yyyy-MM-dd`), `lastAssessmentAt` (nullable, `yyyy-MM-dd`),
`treatmentCategory` (nullable), `matchCount` (int), `isDeleted` (bool),
`deletedAt` (nullable, `yyyy-MM-dd`). All camelCase.

**Derivation:**

- `name` = the user's `name`, falling back to the user's `email`, falling back
  to `""`.
- `zipCode` serializes `null` as `""`.
- `treatmentCategory` = `treatment_category` of the patient's most recent
  assessment ordered by `consent_given_at` descending, or `null` when the
  patient has no assessments. This is a plain enum column; **no decryption**.
- `matchCount` = count of that patient's leads.

List ordered by `created_at` descending. The list includes soft-deleted
patients, flagged by `isDeleted`, matching .NET.

### 1.8 `UpdateAdminPatientRequest`

Body of `PUT /admin/patients/:id`. All optional: `name`, `dob`, `zipCode`.

- `name` updates `users.name` for the patient's user, not a patient column.
- `dob` is applied only when it parses as a date; an unparseable value is
  ignored rather than rejected, matching .NET's `DateOnly.TryParse` guard.
- Returns `409 Conflict` when the patient is already soft-deleted.

Response: `{ "success": true }`.

### 1.9 `AdminSetUserPasswordRequest`

Body of both `set-password` routes: `{ "newPassword": string }`, minimum
length 8.

Response: `{ "success": true }`.

### 1.10 Error responses

- Missing clinic → `404`, message `"Clinic not found."`
- Missing patient → `404`, message `"Patient not found."`
- Clinic has no linked user account (either password route) → `404`, message
  `"No user account found for this clinic."`
- Update or delete of an already-deleted patient → `409`.

These flow through the existing `AllExceptionsFilter` envelope.

---

## 2. Endpoints

All 15 require `@Roles('admin','superadmin')`.

### 2.1 Clinics — base path `/admin/clinics`

| Method | Path | Behavior |
|---|---|---|
| GET | `/` | List all clinics as `AdminClinicDto`, ordered by name. Lead stats resolved in one grouped query, not N+1. |
| GET | `/:id` | One clinic as `AdminClinicDto`. 404 if absent. |
| PUT | `/:id` | Partial update per §1.2. 404 if absent. |
| POST | `/:id/pause-delivery` | Per §1.3. 404 if absent. |
| GET | `/:id/leads` | `AdminLeadRowDto[]` per §1.4. 404 if the clinic is absent. |
| GET | `/:id/notes` | `AdminNoteDto[]`. 404 if the clinic is absent. |
| POST | `/:id/notes` | Create a note, return the created `AdminNoteDto`. 404 if the clinic is absent. |
| POST | `/:id/send-password-reset` | Issue a reset token for the clinic's user and email the link. 404 if no linked user. |
| POST | `/:id/set-password` | Set the clinic user's password directly. 404 if no linked user. |

**Note authorship:** `author_user_id` comes from the authenticated admin's
token. `author_name` is the admin's `users.name`, falling back to `"Admin"`,
and is stored denormalized so a note survives its author's account being
removed. This matches .NET.

**`send-password-reset`** reuses the Slice 4 flow exactly: generate
`randomBytes(32).hex`, store only its sha256, 60-minute expiry, single use, and
email `${APP_BASE_URL}/reset-password?email=<enc>&token=<raw>`. Unlike
`/auth/forgot-password`, this route is **not** enumeration-safe — it returns
404 when no account exists, because the caller is already an authenticated
admin and needs to know the operation failed.

### 2.2 Patients — base path `/admin/patients`

| Method | Path | Behavior |
|---|---|---|
| GET | `/` | `AdminPatientDto[]` per §1.7. Tighter rate limit (§4.3). |
| GET | `/:id` | One `AdminPatientDto`. 404 if absent. |
| PUT | `/:id` | Partial update per §1.8. 404 if absent, 409 if deleted. |
| DELETE | `/:id` | Soft delete per §3.3. 404 if absent, 409 if already deleted. |
| POST | `/:id/send-password-reset` | As above, for the patient's user. 404 if absent. |
| POST | `/:id/set-password` | Set the patient user's password directly. 404 if absent. |

---

## 3. Data model

### 3.1 New table `admin_notes`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk default `gen_random_uuid()` | |
| `clinic_id` | `uuid not null` | FK → `clinics(id)` `ON DELETE CASCADE` |
| `author_user_id` | `uuid not null` | FK → `users(id)` `ON DELETE RESTRICT` |
| `author_name` | `text not null` | Denormalized snapshot |
| `body` | `text not null` | |
| `created_at` | `timestamptz not null default now()` | |

Index on `(clinic_id, created_at desc)` to serve the notes list.

Prisma model `AdminNote` with `@@map("admin_notes")`, relation on `Clinic` as
`notes AdminNote[]`.

Notes are append-only: there is no edit or delete endpoint, matching .NET.

### 3.2 New `clinics` columns

- `zip_code text` (nullable) — present in the .NET update request and list DTO,
  missing from our schema.
- `is_listed_in_directory boolean not null default true` — existing clinics
  default to listed, preserving current directory behavior.

### 3.3 Patient soft delete

`DELETE /admin/patients/:id` performs, in one transaction:

1. `patients.is_deleted = true`, `patients.deleted_at = now()`.
2. The patient user's `users.locked_until` set to the exact sentinel
   `9999-12-31T23:59:59Z`. Use this literal rather than Postgres `infinity`,
   which does not round-trip cleanly through Prisma's `DateTime`.

Both columns already exist. Sign-in enforcement is already in place:
`sign-in.use-case.ts:51` throws `AccountLockedError` when `locked_until` is in
the future, so no new enforcement path is needed.

**Verified property to pin with a test:** `reset-password.use-case.ts` updates
the password hash and consumes the token but does **not** clear
`locked_until`. A soft-deleted patient therefore cannot restore their own
access via forgot-password. This holds today but is incidental to that use
case's implementation, so it gets an explicit regression test rather than being
left to chance.

There is no restore endpoint; soft delete is terminal, matching .NET.

---

## 4. Security

### 4.1 New admin RLS policies

The endpoints read tables that currently have no admin policy. Add `_admin_all`
policies (`FOR ALL`, USING + WITH CHECK, verbatim `has_role` idiom from Global
Constraints) plus the matching `GRANT`s to `app_authenticated` on:

- `patients`
- `patient_assessments`
- `leads`
- `admin_notes` (also `ENABLE` + `FORCE ROW LEVEL SECURITY`)

Slice 4 already added `clinics_admin_all` and `users_admin_all`; those are
reused, not redefined. Existing patient-owner and clinic-scoped policies stay
intact.

### 4.2 PHI access logging

A NestJS interceptor on the patients controller, the analog of .NET's
`PhiAccessFilter`, writes one `audit_log` row per request with
`action_type = 'phi_access'`, capturing actor user id, actor role, IP, HTTP
method, path, and the `:id` route parameter as `affected_record`.

Per the design decision, these records land in the existing `audit_log` table
rather than a separate `phi_access_log`, since `audit_log` already carries every
needed field and is already RLS-protected and append-only. A PHI access report
is a filtered query on `action_type`; add an index on
`(action_type, created_at desc)` to serve it.

A failed audit write is logged server-side but does not fail the request,
matching .NET's try/catch. This is a deliberate availability-over-completeness
choice for a log that supplements, rather than replaces, the write-path audit
triggers.

### 4.3 Rate limiting

`GET /admin/patients` carries a tighter `@Throttle` than the global default,
mirroring .NET's `phi` rate-limit policy, since it returns identifying
information for every patient in one call.

### 4.4 Accepted risk: admin set-password

`POST /admin/clinics/:id/set-password` and
`POST /admin/patients/:id/set-password` let an admin set a user's password to a
value the admin chooses, mirroring .NET. This was raised during design and
accepted deliberately for contract parity.

**The risk:** an admin can set a patient's password, sign in as that patient,
and read their assessment PHI. The audit trail records the password change, but
the subsequent session is indistinguishable from a normal patient sign-in.

**Mitigations applied:**

- Both routes write an `audit_log` entry naming the acting admin.
- The patient route additionally writes a `phi_access` record.
- The routes remain restricted to `admin` and `superadmin`.
- Nothing in this slice decrypts assessment PHI, so the admin API itself never
  exposes it; the takeover path is the only route to it.

**Not mitigated:** an admin who uses this path can reach PHI without a further
audit signal. Revisit if a compliance review requires separation of duties.

---

## 5. Module structure

```
src/modules/admin-clinics/
  domain/ports/            admin-clinic-repository.port.ts, admin-note-repository.port.ts
  application/             list-clinics, get-clinic, update-clinic,
                           pause-delivery, list-clinic-leads, list-notes,
                           add-note, send-clinic-password-reset,
                           set-clinic-password  (one use case per file)
  infrastructure/http/     admin-clinics.controller.ts, dtos/
  infrastructure/persistence/  prisma-admin-clinic.repository.ts,
                               prisma-admin-note.repository.ts

src/modules/admin-patients/
  domain/ports/            admin-patient-repository.port.ts
  application/             list-patients, get-patient, update-patient,
                           soft-delete-patient, send-patient-password-reset,
                           set-patient-password
  infrastructure/http/     admin-patients.controller.ts, phi-access.interceptor.ts, dtos/
  infrastructure/persistence/  prisma-admin-patient.repository.ts
```

The `AdminClinicDto` derivation rules (§1.1) live in one shared mapper module
used by both the list and detail use cases, so the two cannot drift.

Password reset and password set use cases delegate to the Slice 4
`PASSWORD_RESET_REPOSITORY` and `PASSWORD_HASHER` ports. They do not
reimplement token generation or hashing.

---

## 6. Testing

Following the pattern of prior slices.

**DB integration** (`test/db/`):
- Schema spec: `admin_notes` exists with its FKs and index; `clinics.zip_code`
  and `clinics.is_listed_in_directory` exist with the stated default.
- RLS spec: under an admin context, select and insert succeed on `patients`,
  `patient_assessments`, `leads`, and `admin_notes`. Under `clinic` and
  `patient` contexts, `admin_notes` returns zero rows and insert is rejected,
  and a patient context cannot read another patient's row. Anonymous context
  reads zero.

**Unit** (`*.spec.ts`): each use case, with the derivation rules of §1.1 and
§1.7 covered directly — the `"wellness"` category fallback, the specialty map
including the fallback-to-code path, `allServices` ordering, the null-to-empty
-string conversions, the no-assessment and no-lead cases, and the
`pause-delivery` no-op when the clinic is not paused.

**E2E** (`test/admin/`): every endpoint's success path, its 404, the 409 paths
on patient update and delete, and a non-admin rejection for each of the 15
routes. Plus:
- A `phi_access` audit row is written for each patient route.
- The mixed-case `AdminLeadRowDto` field names are asserted literally.
- **Regression test:** a soft-deleted patient who completes a valid password
  reset still cannot sign in (`locked_until` survives the reset).

---

## 7. Deploy notes

- Two migrations to apply: the schema migration (`admin_notes` + two clinic
  columns) and the RLS migration (admin policies + grants + the `audit_log`
  index).
- No new environment variables. Reuses `EMAIL_SENDER`, `APP_BASE_URL`, and the
  Slice 4 reset infrastructure.
- Seed extension: sample admin notes on a seeded clinic, and at least one
  soft-deleted patient so the frontend can exercise the `isDeleted` state.
- Frontend: admin clinic list/detail/edit screens, a notes panel, an admin
  patient list/detail screen, and the password actions. The mixed-case lead row
  contract matches the existing TypeScript `AdminLeadRow` interface, so that
  binding is unchanged.
