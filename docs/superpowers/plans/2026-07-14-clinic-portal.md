# Clinic Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the clinic-side portal (auth, profile, leads, webhook management, media) so clinics can work the leads the patient journey generates.

**Architecture:** NestJS hexagonal on the Foundation auth/RLS layer. Clinic users reuse Foundation signin + 2FA; a `clinicId` JWT claim scopes clinic-owned data via RLS keyed on `app.current_clinic_id`. Media uploads go direct to Supabase Storage via backend-issued, path-scoped signed URLs.

**Tech Stack:** NestJS 10, Prisma 7 + `@prisma/adapter-pg`, Postgres RLS, Supabase Storage, argon2/JWT (Foundation), AES-256-GCM `EncryptionPort`, the Slice 2 SSRF `WEBHOOK_SENDER`.

## Global Constraints

- Contract mirrors the .NET clinic portal exactly. **Leads and webhook-delivery payloads are snake_case**; profile/rotate/test-webhook payloads are camelCase. Full DTO field lists live in the spec (`docs/superpowers/specs/2026-07-14-clinic-portal-design.md` §1).
- All clinic-owned data access is RLS-enforced under `withUserContext` (which does `SET LOCAL ROLE app_authenticated`); system paths use `asSystem`. Portal endpoints use only `@CurrentClinic()`, never a clinic id from the request.
- Reuse Foundation: `PrismaService.withUserContext(ctx, fn)` / `asSystem(fn)`, `ENCRYPTION_PORT` (AES-256-GCM), `EMAIL_SENDER`, `WEBHOOK_SENDER` (`send(url, payload, secret) => {ok,status?,error?}`).
- Clinic ids are UUID strings. No `any` in production code. Keep `openapi.json` current; update README. No `Co-Authored-By`/Anthropic/Claude commit trailers. Node 24, pnpm.
- Webhook secret AES-256-GCM encrypted at rest; returned plaintext only by `rotate`, once.

---

### Task 1: Schema + migration (users.clinic_id, clinic columns, clinic_photos)

**Files:**

- Modify: `prisma/schema.prisma` (User, Clinic models; new ClinicPhoto model)
- Create: `prisma/migrations/20260714100000_clinic_portal/migration.sql`
- Test: `test/db/clinic-portal-schema.int-spec.ts`

**Interfaces produced:**

- `users.clinic_id uuid null` FK → `clinics(id)` `ON DELETE SET NULL`.
- `clinics` + `differentiators text?`, `offers_lab_work bool not null default false`, `insurance_notes text?`, `credentials text?`, `npi_number text?`, `state_license_number text?`, `logo_url text?`, `photo_count int not null default 0`, `weekly_summary bool not null default false`, `location text?`, `webhook_health text not null default 'unknown'`, `suspension_reason text?`, `created_at timestamptz not null default now()`.
- `clinic_photos`: `id uuid pk default gen_random_uuid()`, `clinic_id uuid not null` FK → clinics `ON DELETE CASCADE`, `url text not null`, `display_order int not null`. Prisma model `ClinicPhoto` (`@@map("clinic_photos")`), relation on Clinic `photos ClinicPhoto[]`; `User.clinicId String? @map("clinic_id") @db.Uuid` with relation to Clinic.

- [ ] **Step 1 (test):** integration spec asserting `to_regclass('public.clinic_photos')` is not null, and `users`/`clinics` have the new columns (`information_schema.columns`), and `users.clinic_id` FK exists.
- [ ] **Step 2:** run — FAIL (migration absent).
- [ ] **Step 3:** add the models to `schema.prisma`; hand-write `migration.sql` matching the Foundation migration SQL style (raw `ALTER TABLE`/`CREATE TABLE`). Regenerate client (`pnpm prisma generate`).
- [ ] **Step 4:** apply migration to local DB (`pnpm prisma migrate deploy` against `127.0.0.1:54322`); run the int spec — PASS.
- [ ] **Step 5:** commit `feat(db): add clinic portal schema and migration`.

---

### Task 2: RLS + clinic-scoped policies

**Files:**

- Create: `prisma/migrations/20260714110000_clinic_portal_rls/migration.sql`
- Modify: `src/infrastructure/prisma/request-context.ts` (add `clinicId?: string | null`), `src/infrastructure/prisma/prisma.service.ts` (set `app.current_clinic_id`)
- Test: `test/db/clinic-portal-rls.int-spec.ts`

**Interfaces:**

- Consumes: `withUserContext(ctx, fn)`; `RequestContext { userId?; role?; ip?; clinicId? }`.
- Produces: RLS so a `clinic`-context caller (role `app_authenticated`, `app.current_clinic_id` set) sees only its own rows.

**Policies (all keyed on `current_setting('app.current_clinic_id', true)::uuid`), with `GRANT` to `app_authenticated` + `ENABLE`/`FORCE RLS`:**

- `clinics`: `clinic_self_select` (`id = current_clinic_id`), `clinic_self_update` (`id = current_clinic_id`). Keep existing public-read policy.
- `leads`: `leads_clinic_select` (`clinic_id = current_clinic_id`); `leads_clinic_update` (`clinic_id = current_clinic_id`) — column privilege: `GRANT UPDATE (clinic_status) ON leads TO app_authenticated` (clinic may change only `clinic_status`).
- `webhook_deliveries`: `webhook_deliveries_clinic_select` for rows whose `lead_id` belongs to a lead with `clinic_id = current_clinic_id`.
- `clinic_photos`: `clinic_photos_self_all` (`clinic_id = current_clinic_id`).

- [ ] **Step 1 (test):** integration: seed 2 clinics + leads; under `withUserContext({ clinicId: A, role: 'clinic' })` prove: can read own clinic row + own leads + own deliveries + own photos; CANNOT read clinic B's (0 rows); can update own lead `clinic_status`; a raw attempt to update a non-`clinic_status` column as the clinic context is rejected (no privilege). Cross-context probe: clinic B context reading clinic A's lead → 0 rows.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** add `clinicId` to `RequestContext`; in `withUserContext` add `SELECT set_config('app.current_clinic_id', ${ctx.clinicId ?? ''}, true)`. Write the RLS migration; apply it.
- [ ] **Step 4:** all green.
- [ ] **Step 5:** commit `feat(db): add clinic-scoped RLS policies`.

---

### Task 3: Seeds (clinic users + new columns)

**Files:**

- Modify: `prisma/seed/clinics.ts` (populate new columns), `prisma/seed/patient-journey.seed.ts` (or a new `clinic-portal.seed.ts`) to create clinic users
- Test: `test/db/clinic-portal-seed.int-spec.ts`

**Interfaces:**

- Produces: for ≥2 seed clinics, a `clinic`-role user with `clinic_id` set and a known password (argon2-hashed via the Foundation hasher) for e2e login. New clinic columns populated (logo_url null, photo_count 0, webhook_health 'unknown', etc.).

- [ ] **Step 1 (test):** integration: after seeding, assert a `clinic`-role user exists with a non-null `clinic_id`, and `has_role(user_id, 'clinic')` is true; the linked clinic has the new columns populated.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** extend seeds. Create clinic users via the same path signup uses (`create_user` then assign `clinic` role + set `clinic_id`), or direct inserts consistent with Foundation. Use a fixed seed email/password documented in the seed file.
- [ ] **Step 4:** `pnpm seed:pj` runs clean; int green.
- [ ] **Step 5:** commit `feat(db): seed clinic users and portal columns`.

---

### Task 4: Auth extension — clinicId claim end-to-end + ClinicGuard

**Files:**

- Modify: `src/modules/auth/domain/ports/token-service.port.ts` (`TokenClaims` + `clinicId?: string | null`), `src/modules/auth/infrastructure/adapters/jwt-token.service.ts` (carry `clinicId`), `src/infrastructure/security/current-user.decorator.ts` (`AuthenticatedUser` + `clinicId?: string | null`), `src/infrastructure/security/jwt-cookie.guard.ts` (populate `clinicId`), `src/modules/auth/application/verify-two-factor.use-case.ts` (issue `clinicId`), the user repository (`getClinicId(userId): Promise<string | null>`)
- Create: `src/infrastructure/security/clinic.guard.ts`, `src/infrastructure/security/current-clinic.decorator.ts`
- Test: `jwt-token.service.spec.ts` (extend), `verify-two-factor.use-case.spec.ts` (extend), `test/clinic-portal/clinic-guard.e2e-spec.ts`

**Interfaces:**

- Consumes: `TokenServicePort.issue/verify`, `getPrimaryRole`, `withUserContext`.
- Produces: JWT `{ sub, role, clinicId? }`; `AuthenticatedUser { sub, role, clinicId? }`; `@CurrentClinic(): string` (the caller's clinic id); `ClinicGuard` — rejects (403) unless `role === 'clinic'` and `clinicId` is a non-empty string.

- [ ] **Step 1 (tests):** unit — token round-trips `clinicId` (and omits/null for patients); verify-2fa issues a token containing `clinicId` when the user has one (mock `getClinicId`). E2e — a `@Public`-free route guarded by `ClinicGuard` returns 403 for a patient token and passes for a clinic token.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** thread `clinicId` through claims/payload/guard; in verify-2fa fetch `getClinicId(user.id)` and pass to `issue`. Implement `ClinicGuard` (reads `request.user`) + `@CurrentClinic()`.
- [ ] **Step 4:** unit + e2e green.
- [ ] **Step 5:** commit `feat(auth): add clinicId claim and ClinicGuard`.

---

### Task 5: Clinic profile (GET/PUT)

**Files:** `src/modules/clinic-portal/` — `domain/ports/clinic-write-repository.port.ts`, `application/{get-clinic-profile,update-clinic-profile}.use-case.ts`, `infrastructure/prisma-clinic-write.repository.ts`, `infrastructure/http/clinic-portal.controller.ts` + `dtos/`, `clinic-portal.module.ts`; unit + `test/clinic-portal/profile.int-spec.ts` + e2e.

**Interfaces:**

- `ClinicWriteRepositoryPort` (token `CLINIC_WRITE_REPOSITORY`): `findProfile(clinicId): Promise<ClinicProfileView | null>` (joins categories/services + `leadCount`/`lastLeadAt`), `updateProfile(clinicId, patch): Promise<void>` (partial; replaces categories/services when provided). All via `withUserContext({ clinicId, role: 'clinic' })`.
- Controller (`@Controller('clinic/portal')`, `ClinicGuard`): `GET /profile` → `ClinicPortalProfileDto` (camelCase, spec §1 full field list incl. `specialty` label map, `webhookSecretConfigured`, read-only `billingStatus`/`webhookHealth`/`suspensionReason`); `PUT /profile` (`UpdateClinicPortalProfileRequest`, all optional) → `{ success: true }`, `webhookUrl` must be HTTPS (else 400), `location` recomputed on city/state change, top/all services replace logic per spec §1.

- [ ] **Step 1 (tests):** unit — profile mapping (specialty label; `webhookSecretConfigured` true iff ciphertext present; services split top/all; `location`); update service/category replace + HTTPS webhookUrl rejection. Integration — profile read/update round-trip under RLS; clinic A cannot read/update B (via the repo). E2e — clinic token `GET /clinic/portal/profile` 200; patient token 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement repo/use-cases/controller/module; wire into `AppModule`.
- [ ] **Step 4:** green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(clinic-portal): add profile endpoints`.

---

### Task 6: Clinic leads (list, detail, status, contact-request)

**Files:** `clinic-portal/domain/ports/clinic-lead-repository.port.ts`, `application/{list-clinic-leads,get-clinic-lead,update-lead-status,request-patient-contact}.use-case.ts`, `infrastructure/prisma-clinic-lead.repository.ts`, controller additions + snake_case DTOs; unit + `test/clinic-portal/leads.int-spec.ts` + e2e.

**Interfaces:**

- `ClinicLeadRepositoryPort` (token `CLINIC_LEAD_REPOSITORY`): `listByClinic(clinicId): Promise<ClinicLeadView[]>` (join assessment for goals/symptoms summary, `received_at` desc), `findByClinic(clinicId, leadId): Promise<ClinicLeadView | null>`, `updateStatus(clinicId, leadId, status): Promise<boolean>` (guarded `updateMany where lead_id & clinic_id`; false when 0 rows). All `withUserContext`.
- DTOs snake_case per spec §1: `ClinicLeadDto { lead_id, received_at, lead_source, patient{first_name,email,zip_code}, assessment_summary{treatmentCategory,topGoals[],topSymptoms[],budgetBand,telehealthPreference,startTimeline}, delivery_status, clinic_status }`.
- Endpoints: `GET /leads`, `GET /leads/:leadId` (404 if not caller's/absent), `PATCH /leads/:leadId/status` (`{status}` in `new|contacted|booked|converted|not_interested`, else 400 → `{success:true}`), `POST /leads/:leadId/contact-request` (emails patient via `EMAIL_SENDER`; 404 if not caller's; send failure → 500; success `{success:true}`).

- [ ] **Step 1 (tests):** unit — lead mapping (comma split, snake_case), status validation (reject unknown), contact-request builds the email with patient first name/email + clinic name/website. Integration — list/detail/status-update scoped to the caller clinic (A cannot read/update B's lead → 404/no-op). E2e — clinic lists leads, patches a status, contact-request path (email sender seam) returns `{success:true}`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement; register in module.
- [ ] **Step 4:** green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(clinic-portal): add lead endpoints`.

---

### Task 7: Webhook management (deliveries, rotate, test-webhook)

**Files:** `clinic-portal/application/{list-webhook-deliveries,rotate-webhook-secret,test-webhook}.use-case.ts`, repo method(s) on `ClinicWriteRepositoryPort` (or a small `ClinicWebhookRepositoryPort`), controller additions + DTOs; unit + `test/clinic-portal/webhook.int-spec.ts` + e2e.

**Interfaces:**

- Consumes: `WEBHOOK_SENDER.send(url, payload, secret)`, `ENCRYPTION_PORT`.
- `listWebhookDeliveries(clinicId): Promise<WebhookDeliveryDto[]>` (snake_case: `{ lead_id, attempted_at, status, http_status_code, error_message }`, newest first, cap 50, RLS-scoped).
- `rotateWebhookSecret(clinicId): Promise<{ webhookSecret: string }>` — generate a strong secret, store `EncryptionPort.encrypt(secret)` on `clinics.webhook_secret`, return plaintext once.
- `testWebhook(clinicId, webhookUrl): Promise<WebhookSendResult+outcome>` — validate HTTPS (else 400); load + decrypt the clinic's secret (rotate first if none? spec: sign with the configured secret; if no secret, 400 `{message}`); `WEBHOOK_SENDER.send(webhookUrl, testPayload, secret)`; record a `webhook_deliveries` row (via `asSystem`, as in Slice 2); return `{ status, http_status_code?, error_message? }`.

- [ ] **Step 1 (tests):** unit — rotate encrypts + returns plaintext once; test-webhook rejects non-HTTPS (400) and maps a sender `{ok:false,error}` to the outcome without throwing; deliveries mapping snake_case + cap 50. Integration — rotate persists ciphertext (not plaintext) at rest; deliveries RLS-scoped to caller clinic. E2e — clinic rotates secret (200, gets `webhookSecret`), then `GET webhook-deliveries` 200.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement; reuse `WEBHOOK_SENDER`; register.
- [ ] **Step 4:** green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(clinic-portal): add webhook management endpoints`.

---

### Task 8: Media — StoragePort + Supabase adapter + sign endpoints

**Files:** `src/modules/clinic-media/` — `domain/ports/storage.port.ts`, `application/{sign-logo-upload,sign-photo-uploads}.use-case.ts`, `infrastructure/supabase-storage.adapter.ts`, `infrastructure/http/clinic-media.controller.ts` + dtos, `clinic-media.module.ts`; env schema additions; unit + e2e (storage seam).

**Interfaces:**

- Env (`env.schema.ts`): `SUPABASE_URL: z.string().url()`, `SUPABASE_SERVICE_ROLE_KEY: z.string().min(1)`, `SUPABASE_STORAGE_BUCKET: z.string().default('clinic-media')`.
- `StoragePort` (token `STORAGE_PORT`): `createSignedUploadUrl(path): Promise<{ uploadUrl: string; token: string }>`, `publicUrl(path): string`, `remove(paths: string[]): Promise<void>`. Supabase adapter uses `@supabase/supabase-js` with the service-role key; a `resolveOverride`/seam constructor arg lets tests avoid live calls.
- Endpoints (`@Controller('clinic/portal/media')`, `ClinicGuard`): `POST /logo/sign` → `{ uploadUrl, token, path }` for `logos/<clinicId>/<uuid>.<ext>` (ext from a validated `{ contentType }` in `image/png|jpeg|webp`); `POST /photos/sign` (`{ count }` 1–8, else 400) → `{ uploads: [{ uploadUrl, token, path }] }` for `photos/<clinicId>/<uuid>`.

- [ ] **Step 1 (tests):** unit — sign builds a path under the caller's own prefix and rejects an invalid `contentType`/`count`; the adapter calls the storage seam with the right path. E2e — `POST /logo/sign` (clinic token) returns `{uploadUrl,token,path}` with `path` starting `logos/<clinicId>/`; patient token → 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** add env; implement port/adapter/use-cases/controller/module; add `@supabase/supabase-js` dep. Wire into `AppModule`.
- [ ] **Step 4:** green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(clinic-media): add storage port and signed-upload endpoints`.

---

### Task 9: Media — confirm + list (logo/photos), path authorization, clinic_photos

**Files:** `clinic-media/application/{confirm-logo,confirm-photos,list-photos}.use-case.ts`, `infrastructure/prisma-clinic-photo.repository.ts`, controller additions + dtos; unit + `test/clinic-media/media.int-spec.ts` + e2e.

**Interfaces:**

- `ClinicPhotoRepositoryPort` (token `CLINIC_PHOTO_REPOSITORY`): `setLogoUrl(clinicId, url)`, `replacePhotos(clinicId, urls: string[]): Promise<void>` (delete old rows + set `photo_count`), `listPhotos(clinicId): Promise<string[]>` (by `display_order`). Via `withUserContext`.
- Path authorization helper: reject any `path` whose prefix is not `logos/<callerClinicId>/` (logo) or `photos/<callerClinicId>/` (photos) → 403.
- Endpoints: `POST /logo` (`{ path }`) → validate prefix, `remove` previous `logo_url` object, `setLogoUrl(publicUrl(path))`, return `{ url }`; `POST /photos` (`{ paths: string[] }`, ≤8, all prefix-checked) → `remove` prior photo objects, `replacePhotos(publicUrl(each))`, return `{ urls }`; `GET /photos` → `string[]`.

- [ ] **Step 1 (tests):** unit — prefix authorization rejects another clinic's `path` (403) and accepts own; photos confirm caps at 8 and replaces; logo confirm removes the previous object. Integration — `replacePhotos` deletes prior rows + sets `photo_count`; RLS-scoped. E2e — sign→confirm logo happy path (storage seam) sets `logo_url`; a cross-clinic `path` on confirm → 403.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement; register.
- [ ] **Step 4:** green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(clinic-media): add media confirm and list endpoints`.

---

### Task 10: Wiring, full-journey e2e, docs

**Files:** verify `src/app.module.ts` imports `ClinicPortalModule` + `ClinicMediaModule`; create `test/clinic-portal.e2e-spec.ts`; update `README.md`; regen `openapi.json`.

- [ ] **Step 1 (e2e):** seed clinic user → `POST /auth/signin` + 2FA → authenticated clinic cookie (carries `clinicId`) → `GET /clinic/portal/profile` (200) → `GET /clinic/portal/leads` (the seeded lead from the patient-journey seed appears) → `PATCH …/status` to `contacted` → `POST …/webhook/rotate` (200) → media `logo/sign` + `logo` confirm (storage seam) sets `logo_url`. Security: a patient cookie on any `/clinic/portal/*` route → 403; a clinic confirming a `path` under another clinic's prefix → 403.
- [ ] **Step 2:** FAIL (wiring/gaps).
- [ ] **Step 3:** wire modules; fix integration gaps.
- [ ] **Step 4:** `pnpm test && pnpm test:int && pnpm test:e2e && pnpm build && pnpm lint && pnpm typecheck && pnpm format:check` green; `pnpm openapi`; README endpoint list + new env vars documented.
- [ ] **Step 5:** commit `feat(clinic-portal): wire modules and full clinic-journey e2e`.

---

## Self-Review

- **Spec coverage:** §1 endpoints → Tasks 5 (profile), 6 (leads), 7 (webhook), 8–9 (media); §2 modules → 4–9; §3 data model → 1 (+seeds 3); §4 security: clinic auth/guard → 4, RLS → 2, media path-auth → 9, webhook secret → 7, SSRF reuse → 7; §5 media → 8–9; §6 testing → per task + 10; §7 DoD → 10. Deferred billing/notes correctly excluded.
- **Placeholders:** none — each task names exact files, ports/tokens, endpoint contracts, and test cases; exhaustive DTO field lists are referenced to spec §1 (single source of truth) to avoid drift.
- **Type consistency:** `clinicId` claim shape threaded identically through Task 4 (`TokenClaims`/`AuthenticatedUser`/`RequestContext.clinicId`); repository tokens (`CLINIC_WRITE_REPOSITORY`, `CLINIC_LEAD_REPOSITORY`, `CLINIC_PHOTO_REPOSITORY`, `STORAGE_PORT`) declared once and consumed unchanged; snake_case vs camelCase fixed in Global Constraints and per-endpoint.
