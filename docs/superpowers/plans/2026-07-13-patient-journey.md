# MedAlign Patient Journey — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the patient-journey slice: health assessment (PHI-encrypted, RLS-scoped), clinic matching, and leads with email + webhook delivery, matching the .NET API contract with the agreed security fixes.

**Architecture:** Hexagonal NestJS on the Foundation slice. New modules `clinics`, `patients`, `assessments`, `recommendations`, `leads`, plus `infrastructure/geo`. Reuses `PrismaService` (`withUserContext`/`asSystem`), `EncryptionPort`, the audit triggers, and the exception filter. Full design: `docs/superpowers/specs/2026-07-13-patient-journey-design.md` (source of truth — read it).

**Tech Stack:** NestJS, Prisma 7 + Supabase Postgres, argon2/JWT (from Foundation), node `crypto` (HMAC), `@sendgrid/mail`, `undici`/node `fetch` for the webhook, Jest + supertest.

## Global Constraints

- Node 24; pnpm; TypeScript strict, no `any`. Prettier + ESLint clean; `pnpm typecheck` clean.
- App-managed auth; RLS keys off `current_setting('app.current_user_id')`; user-scoped DB access via `withUserContext`, anonymous/system via `asSystem`. Never bypass RLS for user-scoped reads.
- PHI encrypted at rest via `EncryptionPort` (token `ENCRYPTION_PORT`), format from Foundation.
- Roles: `patient | clinic | admin | superadmin`.
- Enums: `assessment_category = hormone|peptide|med_spa|wellness`. Budget order `[100_200,200_500,500_1k,1k_plus]`. Wait order `[same_week,1_2_weeks,2_4_weeks,1_month_plus]`. Haversine radius `3958.8`.
- Session id `session_<32 hex>`; lead id `lead_<32 hex>`.
- Every new table: RLS enabled + `FORCE ROW LEVEL SECURITY`; audit triggers on `patients`, `patient_assessments`, `leads`.
- TDD: failing test first, real Postgres for anything touching RLS/SQL. Conventional commits. **No `Co-Authored-By`/Anthropic/Claude trailers.**
- Update `openapi.json` (`pnpm openapi`) whenever an endpoint is added/changed.

---

### Task 1: Config + ClaimTokenService

**Files:** Create `src/infrastructure/config/env.schema.ts` (modify: add `CLAIM_TOKEN_SECRET` min 32), `src/modules/assessments/domain/claim-token.service.ts`, `.spec.ts`. Modify `test/.env.test`, `.env.example`.

**Interfaces:**
- Produces: `ClaimTokenService { issue(sessionId: string): string; verify(sessionId: string, token: string): boolean }` (token `CLAIM_TOKEN_SERVICE` or inject the class). `token = base64url(HMAC-SHA256(sessionId, CLAIM_TOKEN_SECRET))`; `verify` uses `crypto.timingSafeEqual`.

- [ ] **Step 1 (test):** `issue(sid)` is stable for the same sid+secret; `verify(sid, issue(sid))` true; `verify(sid, tampered)` false; `verify(otherSid, issue(sid))` false; empty/short token false (no throw).
- [ ] **Step 2:** run `pnpm test claim-token` → FAIL.
- [ ] **Step 3:** add `CLAIM_TOKEN_SECRET: z.string().min(32)` to env schema; implement service with node `crypto.createHmac('sha256', secret).update(sid).digest()` → base64url; `verify` recomputes and `timingSafeEqual` (guard unequal lengths → false).
- [ ] **Step 4:** `pnpm test` green; add the key to `.env.example` and `test/.env.test` (a 32+ char fake value).
- [ ] **Step 5:** commit `feat(assessments): add claim-token service and CLAIM_TOKEN_SECRET config`.

---

### Task 2: Schema + migration (patient-journey tables)

**Files:** Modify `prisma/schema.prisma`; create `prisma/migrations/<ts>_patient_journey/migration.sql`; test `test/db/patient-journey-schema.int-spec.ts`.

**Interfaces:** Produces tables/models per spec §3: `patients`, `patient_assessments`, `assessment_goals|symptoms|chronic_conditions|prescriptions`, `clinics`, `clinic_categories`, `clinic_services`, `leads`, `webhook_deliveries`, `zip_codes`; enum `assessment_category`. Encrypted columns are `text` (ciphertext); Prisma maps them `String`.

- [ ] **Step 1 (test):** integration test asserts each table + the `assessment_category` enum (with 4 labels) exist (`information_schema`, `pg_type`), and that `patient_assessments.session_id` + `leads.lead_id` + `clinics.slug` + `zip_codes.zip` are unique.
- [ ] **Step 2:** `pnpm test:int patient-journey-schema` → FAIL.
- [ ] **Step 3:** author `schema.prisma` models per spec §3 (snake_case `@map`, `@db.Uuid`, timestamps `@db.Timestamptz`, FKs with the stated cascade/set-null). Create the migration via `prisma migrate diff` + hand-author SQL (Supabase-local workflow from Foundation); reset local schema + `prisma migrate deploy` all migrations; `prisma generate`.
- [ ] **Step 4:** int test green; unit/e2e from Foundation still green.
- [ ] **Step 5:** commit `feat(db): add patient-journey schema and migration`.

---

### Task 3: RLS policies + audit triggers (new tables)

**Files:** Modify the Task-2 migration (or a new `<ts>_patient_journey_rls` migration); tests `test/db/patient-journey-rls.int-spec.ts`, `test/db/patient-journey-audit.int-spec.ts`.

**Interfaces:** Produces RLS per spec §4 and grants for `app_authenticated`.

- [ ] **Step 1 (tests):** seed (via `asSystem`) two patient users + a patient row + assessments/leads for each. Under `withUserContext(userA)`: `patient_assessments`/`leads`/`patients` queries return only A's; `findUnique` of B's row → null; admin context → all. Anonymous assessment (`patient_id null`) not visible under any `withUserContext`, visible via `asSystem`. Audit test: an update to A's assessment/lead under `withUserContext(A)` writes an `audit_log` row (`actor_user_id=A`); direct `audit_log` insert as `app_authenticated` denied.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** SQL: `enable`+`FORCE ROW LEVEL SECURITY` on the new tables; grants (`SELECT/INSERT/UPDATE/DELETE` on `patients`, `patient_assessments` + children, `leads`; `SELECT` on `clinics`, `clinic_categories`, `clinic_services`, `zip_codes`; no `webhook_deliveries` grant — asSystem only) to `app_authenticated`. Policies:
  - `patients`: `USING (user_id = current_setting('app.current_user_id', true)::uuid)` for select/update; admin/superadmin all via `has_role`.
  - `patient_assessments` (+ child tables): `USING (patient_id IN (SELECT id FROM patients WHERE user_id = current_setting('app.current_user_id', true)::uuid))`; admin all. (Child tables policy via their `assessment_id -> patient_assessments`.)
  - `leads`: patient select where `patient_id IN (…caller's patient…)`; admin all.
  - `clinics`/`clinic_categories`/`clinic_services`/`zip_codes`: `USING (true)` for select to `app_authenticated` (public reference data; no PHI).
  Add audit trigger functions `audit_patients()`, `audit_patient_assessments()`, `audit_leads()` (mirror the Foundation `audit_users`: read session vars, coalesce role to `'system'`, strip encrypted/PHI free-text columns from the jsonb — do not copy `allergy_details`/`other_medications`/`patient_phone` into audit values), calling `append_audit_log`.
- [ ] **Step 4:** run reset + deploy; both int tests green; full suite green.
- [ ] **Step 5:** commit `feat(db): add RLS policies and audit triggers for patient-journey tables`.

---

### Task 4: Seeds (zip_codes + clinics)

**Files:** Create `prisma/seed/zip-codes.ts` (+ data file ported from `MedAlign-Backend/src/MedAlign.Api/Seed/Zipcodes`), `prisma/seed/clinics.ts`, `prisma/seed/patient-journey.seed.ts` (idempotent upserts), package script `seed:pj`; test `test/db/seed.int-spec.ts`.

**Interfaces:** Produces seeded `zip_codes` (enough US zips to cover the seeded clinics + test zips) and ~6 `clinics` across categories with categories/services/geo/bands/ratings, a couple with `notify_on_lead=true` + a `business_email` + `webhook_url`.

- [ ] **Step 1 (test):** after running the seed, `zip_codes` has the test zips (e.g. `10001`, `90001`) with plausible lat/long, and `clinics` has active clinics in each `assessment_category` with at least one telehealth + one in-person, distinct budget bands.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** port a compact zip dataset (zip, lat, long, city, state) into a committed data file; write idempotent `upsert` seeds; `clinic.webhook_secret` stored via `EncryptionPort.encrypt`. Wire `pnpm seed:pj`.
- [ ] **Step 4:** run seed; int test green.
- [ ] **Step 5:** commit `feat(db): seed zip codes and clinics for patient journey`.

---

### Task 5: Geo + ServiceMapping

**Files:** Create `src/infrastructure/geo/zip-geocoder.ts` (+ `.int-spec.ts`), `src/infrastructure/geo/distance.ts` (+ `.spec.ts`), `src/modules/recommendations/domain/service-mapping.ts` (+ `.spec.ts`).

**Interfaces:**
- `distanceMiles(aLat:number,aLng:number,bLat:number,bLng:number): number` (Haversine, R=3958.8).
- `ZipGeocoder { lookup(zip: string): Promise<{ lat:number; lng:number; state:string } | null> }` (reads `zip_codes` via `asSystem`).
- `impliedServices(goalCodes:string[], symptomCodes:string[]): Set<string>` from the goal/symptom maps ported verbatim from `MedAlign-Backend/.../Services/ServiceMapping.cs`.

- [ ] **Step 1 (tests):** `distanceMiles` for known coords (e.g. NYC↔LA ≈ 2445 mi, tolerance) and 0 for identical points; `impliedServices(['boost_energy'],[])` contains the exact mapped codes; `ZipGeocoder.lookup('10001')` returns coords, unknown zip → null.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement Haversine; port the two mapping tables verbatim; geocoder queries `zip_codes` via `asSystem` (parameterized).
- [ ] **Step 4:** unit + int green.
- [ ] **Step 5:** commit `feat(geo): add zip geocoder, haversine, and service mapping`.

---

### Task 6: Clinics read repository

**Files:** Create `src/modules/clinics/domain/clinic.entity.ts`, `ports/clinic-repository.port.ts`, `src/modules/clinics/infrastructure/prisma-clinic.repository.ts`, `clinics.module.ts`; test `test/clinics/clinic-repository.int-spec.ts`.

**Interfaces:**
- `ClinicReadModel` (all matchable fields incl. `categories:string[]`, `services:string[]`, `latitude/longitude/state`, bands, `rating`, `reviewCount`, `financingAvailable`, `acceptsInsurance`, `telehealthAvailable`, `newPatientWait`, `status`, `billingStatus`, `slug/name/about/providerName/websiteUrl/city/state`, `businessEmail`, `webhookUrl`, `notifyOnLead`, `webhookSecretEncrypted`).
- `ClinicRepositoryPort { findMatchable(category: string): Promise<ClinicReadModel[]>; findById(id: string): Promise<ClinicReadModel | null>; findBySlug(slug: string): Promise<ClinicReadModel | null> }` (token `CLINIC_REPOSITORY`). `findMatchable` applies the hard filter: `status='active'` AND `billing_status NOT IN ('no_card','overdue')` AND a `clinic_categories` row = category. Runs via `asSystem` (reference data; recommendations is anonymous).

- [ ] **Step 1 (test):** with seeded clinics, `findMatchable('hormone')` returns only active, billing-ok, hormone clinics with categories+services populated; excludes an overdue clinic; `findById`/`findBySlug` round-trip.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement the repo (join categories/services). Do NOT decrypt `webhook_secret` here; expose the ciphertext for the leads module to decrypt when signing.
- [ ] **Step 4:** int green.
- [ ] **Step 5:** commit `feat(clinics): add read-model repository with matchable filter`.

---

### Task 7: Assessments — submit + latest

**Files:** `src/modules/assessments/domain/` (entity, ports `assessment-repository.port.ts`), `application/submit-assessment.use-case.ts`, `get-latest-assessment.use-case.ts`, `infrastructure/prisma-assessment.repository.ts`, `http/assessments.controller.ts` + DTOs, `assessments.module.ts`; unit specs + `test/assessments/*.int-spec.ts` + e2e additions.

**Interfaces:**
- `AssessmentRepositoryPort { create(data): Promise<{ id:string; sessionId:string }>; findBySessionId(sid): Promise<Assessment|null>; findLatestByPatient(userId): Promise<Assessment|null>; linkToPatient(sessionId, userId): Promise<void> }`. Writes encrypt PHI columns via `EncryptionPort`; reads decrypt. Anonymous create + `findBySessionId` via `asSystem`; authenticated create/latest via `withUserContext`.
- `SubmitAssessmentUseCase.execute(input, actor: { userId?: string })`: validate consent (`consentGiven` true else `ConsentRequiredError`; `consentVersion` in allowlist `['1.0']` else `InvalidConsentVersionError`); generate `session_<hex>`; set `patient_id` if `actor.userId` (ensure a `patients` row exists, create if missing); persist assessment + children; issue `claimToken`; return `{ sessionId, claimToken }`.
- `GetLatestAssessmentUseCase.execute({ userId, sessionId?, claimToken? })`: return the caller's latest; if none and `sessionId`+valid `claimToken` for an unclaimed assessment, link it (`linkToPatient`) then return it; else 204.

- [ ] **Step 1 (tests):** unit (mocked ports): submit rejects consent=false / bad version; submit encrypts PHI (assert `encrypt` called for the PHI fields); authenticated submit sets patient. Integration: submit persists ciphertext (raw column ≠ plaintext); `findBySessionId` decrypts. E2e: `POST /assessments` (anon) → `{sessionId, claimToken}` and an audit row; consent=false → 400; oversized goals array → 400.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement. DTO validation per spec §4 (enums, severities 1-5, ZIP `^\d{5}$`, caps ≤20, text max lengths, `whitelist`+`forbidNonWhitelisted`). Controller `POST /assessments` (`@Public`, sets `patient_id` from cookie JWT if present), `GET /assessments/latest` (authenticated, reads cookie user).
- [ ] **Step 4:** all green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(assessments): submit and latest endpoints with claim-token and PHI encryption`.

---

### Task 8: Recommendations — matching + endpoint

**Files:** `src/modules/recommendations/domain/recommendation.service.ts` (pure scoring), `application/get-recommendations.use-case.ts`, `http/recommendations.controller.ts` + `ClinicMatchDto`, `recommendations.module.ts`; `recommendation.service.spec.ts` (heavy) + `test/recommendations/*.e2e-spec.ts`.

**Interfaces:**
- `RecommendationService.score(assessment, clinic, geo): number` and `rank(assessment, clinics, patientGeo): ClinicMatchDto[]` (top 10, sort score desc then rating desc then id asc). Implements spec §5 exactly (7 components with the precise point values). `distanceMiles` from geo; patient geo from `ZipGeocoder.lookup(assessment.zipCode)`.
- `GetRecommendationsUseCase.execute(sessionId)`: 404 if session format invalid or assessment not found; else load matchable clinics for the category, geocode patient zip, rank, return `ClinicMatchDto[]`.
- Controller: `GET /recommendations/:sessionId` (`@Public`).

- [ ] **Step 1 (tests):** unit per component with fixed inputs asserting exact points (service match 20 when no implied / proportional to 40; budget exact=25, adjacent=10, far=0, +5 financing, +5 insurance, cap 30; geo yes/either/no thresholds; telehealth 15/5/0; quality formula + review bumps, 0-review=5, cap 15; wait `asap`/`within_month`/`few_months` incl. the -5 penalty; lab 5/0); a tie-break test (equal score → higher rating first, then lower id); a full-rank test returns ≤10 sorted. E2e: `GET /recommendations/{seededSessionId}` returns matches with the expected top clinic; invalid session → 404; response contains NO PHI.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement the pure service (no I/O) and the use case; map to `ClinicMatchDto` (location `"City, State"`, distanceMiles 1dp).
- [ ] **Step 4:** all green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(recommendations): add matching algorithm and endpoint`.

---

### Task 9: Leads — create + delivery

**Files:** `src/modules/leads/domain/` (entity, ports `lead-repository.port.ts`, `webhook-sender.port.ts`), `application/submit-lead.use-case.ts`, `infrastructure/prisma-lead.repository.ts`, `infrastructure/ssrf-webhook-sender.ts`, `http/leads.controller.ts` + DTO, `leads.module.ts`; unit specs + `test/leads/*.int-spec.ts` + e2e.

**Interfaces:**
- `LeadRepositoryPort { create(data): Promise<{ leadId:string }>; recordDelivery(leadId, {url,status,responseCode?,error?}): Promise<void>; setDeliveryStatus(leadId, status, deliveredAt?): Promise<void>; findByPatient(userId): Promise<LeadView[]> }`.
- `WebhookSenderPort { send(url:string, payload:object, secret:string): Promise<{ ok:boolean; status?:number; error?:string }> }`; `SsrfWebhookSender` implements the guard (spec §4): require absolute `https:`; DNS-resolve host, reject loopback/private/link-local/ULA/`169.254`/`fd00`/RFC1918; connect pinned to the resolved IP; no redirects; 10s timeout; `X-MedAlign-Signature: sha256=<HMAC(payload, secret)>`.
- `SubmitLeadUseCase.execute(input, actor)`: `ClinicNotFoundError` if clinic missing; resolve first name (input → JWT name → email prefix); link assessment/patient (authenticated → JWT patient; else `sessionId`+valid `claimToken` → assessment's patient, and if unclaimed + actor.userId back-fill); create lead (`delivery_status='pending'`, `clinic_status='new'`, `lead_source='assessment'`, encrypt `patient_phone` if present); if `clinic.notifyOnLead` and active: send email (decrypt not needed; SendGrid, HTML-escape values) if `businessEmail`, and `WebhookSender.send` if `webhookUrl` (decrypt `webhookSecret` via `EncryptionPort`); `recordDelivery` + `setDeliveryStatus` to `emailed`/`sent_to_crm`/`failed`. Controller `POST /leads` (`@Public`).

- [ ] **Step 1 (tests):** unit (mocked ports): clinic-not-found → error; name resolution precedence; sessionId without valid claimToken does NOT link an unclaimed assessment to the actor (security); delivery status transitions. Integration: `SsrfWebhookSender.send('https://169.254.169.254/…')` rejected without a network call; `send('http://…')` rejected (non-https); a valid https target gets the signed header (use a local test server). E2e: `POST /leads` creates a lead, records a `webhook_deliveries` row, sets delivery status; email sender invoked (mock EMAIL_SENDER).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement. The email sender is the Foundation `EMAIL_SENDER` port (mock in tests / dev-logger). HTML-escape all interpolated values.
- [ ] **Step 4:** all green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(leads): add lead creation with email and SSRF-guarded webhook delivery`.

---

### Task 10: Patients — profile + my-leads

**Files:** `src/modules/patients/domain/` (entity, `patient-repository.port.ts`), `application/{get-profile,update-profile,get-my-leads}.use-case.ts`, `infrastructure/prisma-patient.repository.ts`, `http/patients.controller.ts` + DTOs, `patients.module.ts`; unit + `test/patients/*.int-spec.ts` + e2e.

**Interfaces:**
- `PatientRepositoryPort { findByUserId(userId): Promise<Patient|null>; upsertProfile(userId, {name,dob?,zipCode?}): Promise<void> }` (name lives on the user; profile update sets user display name + patient dob/zip). `GetMyLeadsUseCase` consumes `LeadRepositoryPort.findByPatient` (Task 9). All via `withUserContext`.
- Controller (authenticated, not `@Public`): `GET /patients/me` → `{name,email,dob?,zipCode?}`; `PUT /patients/me` (`{name (≤200), dob?}`) → `{success:true}`; `GET /patients/me/leads` → `PatientLeadDto[]` (fields per spec/extraction, sorted by receivedAt desc).

- [ ] **Step 1 (tests):** integration under `withUserContext`: profile read/update round-trips and is RLS-scoped (cannot read another patient); my-leads returns only the caller's leads. E2e: `GET /patients/me` with cookie → 200; without cookie → 401 (fail-closed).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implement; wire into app.
- [ ] **Step 4:** all green; `pnpm openapi`.
- [ ] **Step 5:** commit `feat(patients): add profile and my-leads endpoints`.

---

### Task 11: Wiring, full-journey e2e, docs

**Files:** Modify `src/app.module.ts` (import the new modules); create `test/patient-journey.e2e-spec.ts`; modify `README.md` (endpoints) and regen `openapi.json`.

- [ ] **Step 1 (test):** e2e full journey against the seeded DB: `POST /assessments` (anon) → `{sessionId, claimToken}` → `GET /recommendations/{sessionId}` returns ranked matches → `POST /leads` (with sessionId+claimToken) creates a lead + delivery record → sign up + sign in (Foundation flow) → `GET /assessments/latest` claims the assessment via claimToken → `GET /patients/me/leads` shows the lead. Security assertion: a DIFFERENT signed-in user calling `GET /assessments/latest` with the same `sessionId` but NO/!valid `claimToken` does not receive the assessment.
- [ ] **Step 2:** FAIL (wiring missing).
- [ ] **Step 3:** register modules in `app.module`; fix any integration gaps.
- [ ] **Step 4:** `pnpm test && pnpm test:int && pnpm test:e2e && pnpm build && pnpm lint && pnpm typecheck && pnpm format:check` all green; `pnpm openapi`; update README endpoint list.
- [ ] **Step 5:** commit `feat(patient-journey): wire modules and full-journey e2e`.

---

## Self-Review

- **Spec coverage:** §1 endpoints → Tasks 7,8,9,10 (+wiring 11); §2 modules → 5–10; §3 data model → 2 (+seeds 4); §4 security: claim-token → 1,7,9; RLS → 3; encryption → 7,9; SSRF → 9; consent+validation → 7; §5 matching → 8; §6 lead delivery → 9; §7 testing → per task + 11; §8 DoD → satisfied at 11. Clinic read-model → 6; geo/service-map → 5.
- **Placeholders:** none — each task has concrete test cases, exact signatures, and the algorithm/guard specs. The scoring point values live in spec §5 (referenced verbatim as the Task 8 implementation target).
- **Type consistency:** ports declared once and consumed unchanged (`ClaimTokenService`, `ClinicRepositoryPort.findMatchable`, `AssessmentRepositoryPort`, `WebhookSenderPort`, `LeadRepositoryPort.findByPatient` used by Task 10). Enums/orders fixed in Global Constraints.
