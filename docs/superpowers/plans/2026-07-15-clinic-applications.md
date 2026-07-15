# Clinic Applications & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prospective clinics apply, admins approve/deny, and approval provisions the clinic plus its portal login so the clinic can set a password and use the Clinic Portal immediately.

**Architecture:** NestJS hexagonal on the Foundation auth/RLS layer. Admin routes use the existing `RolesGuard` + `@Roles('admin','superadmin')` and run under `withUserContext({ userId, role })` so `has_role` admin RLS policies apply and audits attribute the admin. A hash-only `password_reset_tokens` store backs a shared forgot/reset flow. Application media reuses the Slice-3 Supabase `StoragePort` signed-URL adapter.

**Tech Stack:** NestJS 10, Prisma 7 + `@prisma/adapter-pg`, Postgres RLS, Supabase Storage, argon2 (`PASSWORD_HASHER`), `create_user` SQL function, `EMAIL_SENDER`.

## Global Constraints

- Contract mirrors the .NET `ClinicApplicationsController` + `AdminApplicationsController`. Exhaustive field lists live in the spec (`docs/superpowers/specs/2026-07-15-clinic-applications-design.md` §1, §3).
- Admin + applicant data access is RLS-enforced under `withUserContext`; anonymous applicant submit and `password_reset_tokens` access use `asSystem` only where justified. Admin id/role come ONLY from `request.user` (via `@CurrentUser()`), never the request.
- Reuse: `PrismaService.withUserContext(ctx, fn)`/`asSystem(fn)`, `RolesGuard`+`@Roles`, `PASSWORD_HASHER` (`hash`/`verify`), `create_user(email citext, password_hash text)`, `EMAIL_SENDER`, the clinic-media `STORAGE_PORT` (`createSignedUploadUrl`/`publicUrl`), and the Slice-3 clinic schema.
- Password reset tokens: raw = `randomBytes(32).toString('hex')`; store only `sha256(raw)`; single-use; time-limited. `forgot-password` is enumeration-safe (always returns success).
- Admin RLS idiom (copy verbatim): `has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')`.
- UUID ids. No `any`. Keep `openapi.json` current; update README. No `Co-Authored-By`/Anthropic/Claude commit trailers. Node 24, pnpm, `Symbol` DI tokens.

---

### Task 1: Schema + migration

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/20260715100000_clinic_applications/migration.sql`; Test `test/db/clinic-applications-schema.int-spec.ts`.

**Interfaces produced:**

- `clinic_applications` (all columns per spec §3, `status` default `'pending'`, `created_clinic_id uuid null` FK → `clinics` `ON DELETE SET NULL`).
- `application_categories` (`application_id fk ON DELETE CASCADE`, `category assessment_category`, pk `(application_id, category)`).
- `application_services` (`application_id fk ON DELETE CASCADE`, `service_code`, `is_top_service bool`, `display_order int`).
- `password_reset_tokens` (`id uuid pk`, `user_id uuid fk users ON DELETE CASCADE`, `token_hash text`, `expires_at timestamptz`, `consumed_at timestamptz null`, `created_at`).
- Prisma models `ClinicApplication`, `ApplicationCategory`, `ApplicationService`, `PasswordResetToken` with `@@map`, plus relations.

- [ ] **Step 1 (test):** int spec asserting `to_regclass` is non-null for all four tables and key columns/defaults exist (mirror `test/db/clinic-portal-schema.int-spec.ts`).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** add models + hand-write the raw-SQL migration in the existing style (see `prisma/migrations/20260714100000_clinic_portal/migration.sql`); `pnpm prisma generate`.
- [ ] **Step 4:** `pnpm prisma migrate deploy` (local 54322); int PASS; typecheck/lint/format clean.
- [ ] **Step 5:** commit `feat(db): add clinic applications and password-reset schema`.

---

### Task 2: RLS + admin policies

**Files:** Create `prisma/migrations/20260715110000_clinic_applications_rls/migration.sql`; Test `test/db/clinic-applications-rls.int-spec.ts`.

**Interfaces:** ENABLE + FORCE RLS on all four new tables. Grants + policies for role `app_authenticated`:

- `clinic_applications`/`application_categories`/`application_services`: `GRANT SELECT, INSERT, UPDATE ON ... TO app_authenticated`; an `_admin_all` policy `FOR ALL` USING+WITH CHECK with the admin `has_role` idiom (from Global Constraints).
- Provisioning writes under admin context need admin WRITE on the clinic tables: add `clinics_admin_all`, `clinic_categories_admin_all`, `clinic_services_admin_all`, `clinic_photos_admin_all` (`FOR ALL`, admin `has_role` idiom, USING+WITH CHECK), keeping existing public-select + clinic policies intact.
- `password_reset_tokens`: ENABLE+FORCE RLS, NO `app_authenticated` policy (system-only; accessed via `asSystem`).

- [ ] **Step 1 (test):** int: an admin context (`withUserContext({ userId: <admin>, role: 'admin' })`) can INSERT/SELECT a `clinic_applications` row and INSERT a `clinics` row; a `clinic`/`patient`/anon context selecting `clinic_applications` returns 0 rows and cannot insert (rejected). Seed an admin via `create_user` + `user_roles` role `admin`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** write + apply the migration.
- [ ] **Step 4:** all green.
- [ ] **Step 5:** commit `feat(db): add admin RLS for clinic applications`.

---

### Task 3: Seeds (superadmin + sample applications)

**Files:** Modify `prisma/seed/patient-journey.seed.ts` (or add `prisma/seed/admin.seed.ts` imported by it); Test `test/db/clinic-applications-seed.int-spec.ts`.

**Interfaces:** Export `SEEDED_ADMIN_USER = { email, password }` (role `superadmin`) and seed ≥2 `pending` `clinic_applications` with categories/services. Idempotent (check-before-create; the admin user gets exactly the `superadmin` role, mirroring the Slice-3 clinic-user seed).

- [ ] **Step 1 (test):** int: after seeding, a `superadmin`-role user exists (`has_role(user_id,'superadmin')` true, exact role set `['superadmin']`); ≥2 `pending` applications exist with category+service rows.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement idempotent seeds; document the admin email/password in a top comment.
- [ ] **Step 4:** `pnpm seed:pj` clean + idempotent; int green.
- [ ] **Step 5:** commit `feat(db): seed superadmin and sample applications`.

---

### Task 4: Password-reset infrastructure

**Files:** `src/modules/auth/domain/ports/password-reset-repository.port.ts`, `application/{forgot-password,reset-password}.use-case.ts`, `infrastructure/persistence/prisma-password-reset.repository.ts`, `infrastructure/http/dtos/{forgot-password,reset-password}.dto.ts`, controller routes on the existing auth controller; unit + `test/auth/password-reset.int-spec.ts` + e2e.

**Interfaces:**

- `PasswordResetRepositoryPort` (token `PASSWORD_RESET_REPOSITORY`), all via `asSystem`: `issue(userId, tokenHash, expiresAt): Promise<void>`; `findValidByEmail(email, tokenHash): Promise<{ id, userId } | null>` (join users by citext email; not expired, not consumed); `consume(id): Promise<void>`; and a user lookup `findUserIdByEmail(email): Promise<string | null>`.
- Token service (pure): `generate(): { raw, hash }` where `raw = randomBytes(32).hex`, `hash = sha256(raw)`; TTL 60 minutes.
- `POST /auth/forgot-password` (`{ email }`, `@Public`): if the user exists, issue a token and `EMAIL_SENDER.send(email, 'Reset your password', link)` where `link = ${APP_BASE_URL}/reset-password?email=<enc>&token=<raw>`; ALWAYS return `{ success: true }` (no enumeration; wrap the lookup so a missing user still returns success and writes nothing).
- `POST /auth/reset-password` (`{ email, token, newPassword }`, `@Public`): `findValidByEmail(email, sha256(token))`; if null → 400; else `PASSWORD_HASHER.hash(newPassword)`, update `users.password_hash` (via `asSystem`), `consume(id)`. Return `{ success: true }`.

- [ ] **Step 1 (tests):** unit — token generate produces distinct raw/hash and hash = sha256(raw); reset rejects an unknown/expired/consumed token (mock repo). Integration — issue→findValid→consume round-trip; a consumed token fails the second time; an expired token fails; `forgot-password` for a non-existent email writes NO token. E2e — `forgot-password` returns success for any email; a full reset with a valid token lets the user sign in with the new password.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement; register `PASSWORD_RESET_REPOSITORY`; wire routes into the auth module/controller.
- [ ] **Step 4:** green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(auth): add forgot/reset password with hashed single-use tokens`.

---

### Task 5: Application media sign (public)

**Files:** `src/modules/clinic-applications/application/{sign-application-logo,sign-application-photos}.use-case.ts`, `infrastructure/http/clinic-applications.controller.ts` (public) + media DTOs, `clinic-applications.module.ts`; unit + e2e.

**Interfaces:**

- Consumes the clinic-media `STORAGE_PORT` (`createSignedUploadUrl(path)`), imported by `ClinicApplicationsModule`.
- `POST /clinic-applications/media/logo/sign` (`{ contentType }` in `image/png|jpeg|webp` else 400) → `{ uploadUrl, token, path }`, path `applications/<randomUUID>/logo.<ext>`.
- `POST /clinic-applications/media/photos/sign` (`{ count }` 1-8 else 400) → `{ uploads: [{ uploadUrl, token, path }] }`, each path `applications/<randomUUID>/<uuid>` (build concurrently via `Promise.all`). Both `@Public`; the `<random>` prefix is server-generated (never from the request).

- [ ] **Step 1 (tests):** unit — invalid contentType/count → 400; paths start `applications/`; storage seam called with the right path. E2e — anon `POST /media/logo/sign` → 200 with `path` starting `applications/`; `photos/sign {count:2}` → 2 uploads.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement; wire `ClinicApplicationsModule` (imports the media module's `STORAGE_PORT` provider) into `AppModule`.
- [ ] **Step 4:** green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(clinic-applications): add public application media sign endpoints`.

---

### Task 6: Application submit (public)

**Files:** `src/modules/clinic-applications/domain/ports/application-repository.port.ts`, `application/submit-application.use-case.ts`, `infrastructure/prisma-application.repository.ts`, controller `POST /clinic-applications` + submit DTO; unit + `test/clinic-applications/submit.int-spec.ts` + e2e.

**Interfaces:**

- `ApplicationRepositoryPort` (token `APPLICATION_REPOSITORY`): `create(input): Promise<{ applicationId: string }>` — inserts the application + its `application_categories` + `application_services` in one `asSystem` transaction (applicant is anonymous), `status='pending'`.
- `SubmitApplicationDto` — all application fields per spec §3 (clinic/contact info, offering fields, `categories: string[]`, `services: { serviceCode: string; isTopService: boolean }[]`, `logoUrl?`, `photoUrls?: string[]`), class-validator (required: `clinicName`, `contactEmail`).
- `POST /clinic-applications` (`@Public`) → `{ applicationId }`.

- [ ] **Step 1 (tests):** unit — maps DTO → repo input incl. categories/services. Integration — `create` persists the application + categories + services (`asSystem`), status `pending`. E2e — anon submit with a valid body → 201 `{ applicationId }`; missing `clinicName` → 400.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement; register `APPLICATION_REPOSITORY`.
- [ ] **Step 4:** green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(clinic-applications): add public application submit`.

---

### Task 7: Admin applications read (list + detail)

**Files:** `src/modules/clinic-applications/application/{list-applications,get-application}.use-case.ts`, `infrastructure/http/admin-applications.controller.ts` + DTOs; extend `ApplicationRepositoryPort`; unit + `test/clinic-applications/admin-read.int-spec.ts` + e2e.

**Interfaces:**

- Extend `ApplicationRepositoryPort` (all via `withUserContext({ userId, role })` so admin RLS applies): `list(ctx): Promise<ApplicationSummary[]>` (newest first), `findById(ctx, id): Promise<ApplicationDetail | null>` (+ categories/services).
- `AdminApplicationsController` `@Controller('admin/applications')` + `@Roles('admin','superadmin')` + the global guards; admin id/role from `@CurrentUser()`: `GET /` → `ApplicationSummary[]`; `GET /:id` → `ApplicationDetail` (404 if absent).

- [ ] **Step 1 (tests):** unit — summary/detail mapping. Integration — admin context lists/reads applications; a non-admin context lists 0 (RLS). E2e — an admin token (crafted via TOKEN_SERVICE with role `admin`, or seeded admin login) `GET /admin/applications` → 200; a patient token → 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(admin): add applications list and detail`.

---

### Task 8: Approval provisioning (approve/deny)

**Files:** `src/modules/clinic-applications/application/review-application.use-case.ts`, extend `ApplicationRepositoryPort` with an atomic provisioning method, `admin-applications.controller.ts` (add PUT), status DTO; unit + `test/clinic-applications/approval.int-spec.ts` + e2e.

**Interfaces:**

- `PUT /admin/applications/:id/status` (`{ status: 'approved'|'denied', denyReason? }`, `@IsIn`) → unknown status 400; app not found 404; already `approved`/`denied` → 409.
- `ReviewApplicationUseCase` orchestrates; provisioning is ONE `withUserContext({ userId: adminId, role })` transaction in the repo method `approve(ctx, applicationId): Promise<{ clinicId: string; clinicUserId: string }>`:
  1. create the `clinics` row: slug from clinic name (`ToSlug`; if taken, suffix `-<shortid>`), map every offering field from the application (spec §3), `billing_status='no_card'`, `webhook_health='unconfigured'`, `status='active'`, `notify_on_lead=true`, `location = "City, StateCode"`, `logo_url`/`photo_count` from the application media;
  2. insert `clinic_categories` (from `application_categories`) and `clinic_services` (`is_top_service`, `display_order`) and `clinic_photos` (from `application.photo_urls`);
  3. create the clinic login user: `create_user(contactEmail, <argon2 hash of a random throwaway password>)` → userId; set its role to `clinic` (delete default `patient` role, insert `clinic`) and `users.clinic_id = clinicId`, `email_confirmed = true`;
  4. update the application: `status='approved'`, `reviewed_at=now()`, `reviewed_by_user_id=adminId`, `created_clinic_id=clinicId`.
     (Note: `create_user` is SECURITY DEFINER and runs regardless of RLS; the clinic/user/app writes are admin-RLS-allowed by Task 2.) Then, OUTSIDE the transaction, issue a password-reset token (Task 4's `PASSWORD_RESET_REPOSITORY.issue`) for the new user and `EMAIL_SENDER.send` a welcome + set-password link. A welcome-email failure does NOT roll back the provisioning.
- Deny: `deny(ctx, id, reason, adminId)` sets `status='denied'`, `deny_reason`, `reviewed_*`; then `EMAIL_SENDER.send` the denial. Returns success.

- [ ] **Step 1 (tests):** unit — slug generation + collision suffix; the review use case routes approve vs deny; welcome-email failure is swallowed. Integration — approve creates clinic + categories + services + photos + a clinic-role user (`clinic_id` set, role set exactly `['clinic']`) + sets the application to approved/created_clinic_id, ALL atomic (force an error mid-way → nothing persists); deny sets denied + reason and provisions nothing; re-reviewing an approved application → 409. E2e — admin approves a seeded pending application → 200 `{ clinicId }`; the new clinic user then completes `POST /auth/reset-password` and signs in.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(admin): approve/deny applications with clinic + login provisioning`.

---

### Task 9: Wiring, full onboarding e2e, docs

**Files:** verify `src/app.module.ts` imports `ClinicApplicationsModule`; create `test/clinic-applications.e2e-spec.ts`; update `README.md`; regen `openapi.json`.

- [ ] **Step 1 (e2e):** full onboarding journey against the seeded DB with the storage seam: anon `POST /clinic-applications/media/logo/sign` + submit `POST /clinic-applications` → admin (seeded superadmin) signs in and `PUT /admin/applications/:id/status approved` → the provisioned clinic user does `POST /auth/reset-password` with the emailed token (capture via the email seam) → signs in (signin + 2FA) → `GET /clinic/portal/profile` returns the new clinic. Security: a non-admin token on `/admin/applications/*` → 403; `POST /auth/forgot-password` for any email → 200.
- [ ] **Step 2:** FAIL (wiring/gaps).
- [ ] **Step 3:** wire modules; fix integration gaps.
- [ ] **Step 4:** `pnpm test && pnpm test:int && pnpm test:e2e && pnpm build && pnpm lint && pnpm typecheck && pnpm format:check` green; `pnpm openapi`; README endpoint list updated.
- [ ] **Step 5:** commit `feat(clinic-applications): wire modules and full onboarding e2e`.

---

## Self-Review

- **Spec coverage:** §1 public applications → Tasks 5,6; §1 admin applications → Tasks 7,8; §1 password → Task 4; §3 data model → Task 1 (+seeds 3); §4 admin RLS → Task 2, password-token security → Task 4, media prefix → Task 5; §5 testing → per task + 9; §6 DoD → 9. Deferred AdminClinics/AdminPatients + Stripe correctly excluded.
- **Placeholders:** none — each task names files, ports/tokens, endpoint contracts, exact values; exhaustive application/clinic field lists reference spec §3 (single source of truth).
- **Type consistency:** ports declared once and consumed unchanged (`APPLICATION_REPOSITORY`, `PASSWORD_RESET_REPOSITORY`, reused `STORAGE_PORT`/`PASSWORD_HASHER`/`EMAIL_SENDER`); the admin `has_role(nullif(...))` idiom is identical across Task 2 policies; the `withUserContext({ userId, role })` admin-context shape is consistent in Tasks 2, 7, 8.
