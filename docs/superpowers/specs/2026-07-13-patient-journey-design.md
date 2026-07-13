# MedAlign Backend Rebuild — Patient Journey Slice Design Spec

|            |                                                     |
| ---------- | --------------------------------------------------- |
| **Author** | Brian (with Claude)                                 |
| **Date**   | 2026-07-13                                           |
| **Status** | Approved design, ready for planning                 |
| **Slice**  | Phase 1, sub-project 2 of 6: Patient journey        |

Builds on the Foundation slice (`2026-07-10-backend-foundation-design.md`): NestJS + hexagonal, Prisma 7 + Supabase Postgres, `withUserContext`/`asSystem`, RLS + audit triggers, `EncryptionPort` (AES-256-GCM), app-managed JWT-cookie auth. This slice reuses all of that.

## 1. Context and scope

The patient journey is: a patient completes a health assessment, gets matched to clinics, and submits a lead to one. It is the core product flow and the first slice that puts real PHI through the RLS/encryption machinery.

**In scope (endpoints match the .NET patient-journey controllers exactly, with the security/quality fixes below):**

- `POST /assessments` — anonymous or authenticated; encrypts PHI; returns `{ sessionId, claimToken }`.
- `GET /assessments/latest` — authenticated; returns the caller's latest assessment; can claim an anonymous assessment via `claimToken`.
- `GET /recommendations/{sessionId}` — anonymous; runs the matching algorithm; returns clinic matches (no PHI).
- `POST /leads` — anonymous or authenticated; creates the lead and delivers it (email + webhook).
- `GET /patients/me`, `PUT /patients/me`, `GET /patients/me/leads` — authenticated patient profile and lead history.
- A minimal read-only **clinic model + seed** (the fields matching/results/leads need), plus a **ZIP geolocation** table + seed. Full clinic management, the clinic portal, and admin stay in later slices and extend the clinic model.

**Out of scope (later slices):** clinic directory/detail browse endpoints, clinic creation/portal/admin, billing, webhook retry/backoff jobs, weekly summaries. Lead delivery here is a single attempt; retries are Slice 5.

**Contract note:** field shapes match the .NET DTOs. The only additive/behavioral changes are the deliberate fixes we agreed: the `claimToken` (new field on the submit response and an accepted input on claim/lead), real consent recording, PHI encryption, RLS scoping, and actually enforcing input validation.

## 2. Modules (hexagonal)

- `modules/clinics` — read-model entity + repository + seed. Domain-light for now; Slice 3 extends it.
- `modules/patients` — `Patient` entity, repository, profile use cases (`GetProfile`, `UpdateProfile`, `GetMyLeads`).
- `modules/assessments` — assessment domain + ports, submit and latest use cases, claim-token issue/verify, PHI encryption on write/read.
- `modules/recommendations` — the matching algorithm as a domain service, consuming clinic + assessment + geo ports.
- `modules/leads` — lead domain, create use case, delivery (email + webhook) adapters.
- `infrastructure/geo` — `ZipGeocoder` (ZIP to lat/long via `zip_codes`) and a `distanceMiles` Haversine helper.

Each module follows the Foundation pattern: pure domain + ports, application use cases, infrastructure adapters (Prisma repositories via `withUserContext`/`asSystem`, HTTP controllers, DTOs).

## 3. Data model (new Prisma migrations)

All ids uuid `gen_random_uuid()`, timestamps `timestamptz`. RLS enabled + FORCE on every new table. Audit triggers on `patient_assessments`, `leads`, `patients`.

- **`patients`** (1:1 with a `patient`-role user): `id`, `user_id uuid unique fk users`, `zip_code text null`, `date_of_birth date null`, `created_at`, `last_assessment_at timestamptz null`, `is_deleted bool default false`, `deleted_at timestamptz null`.
- **`patient_assessments`**: `id`, `session_id text unique` (format `session_<32 hex>`), `patient_id uuid null fk patients`, `treatment_category assessment_category` (enum `hormone|peptide|med_spa|wellness`), plus the lifestyle/PHI columns. Encrypted (via `EncryptionPort`, stored as text ciphertext): `symptom_duration`, `exercise_frequency`, `diet`, `sleep_hours`, `stress_level`, `alcohol_use`, `appointment_preference`, `biological_sex`, `allergy_details`, `other_medications`. Plain: `has_prior_treatment bool null`, `willing_lab_work bool null`, `willing_structured_program bool null`, `start_timeline text null`, `budget_band text` (required), `telehealth_preference text` (required), `pregnant_or_planning bool null`, `taking_prescriptions bool null`, `had_prior_therapy bool null`, `medication_allergies bool null`, `zip_code text`, `consent_given bool`, `consent_version text`, `consent_given_at timestamptz`, `submitted_at timestamptz`.
- **`assessment_goals`** (`assessment_id`, `goal_code`), **`assessment_symptoms`** (`assessment_id`, `symptom_code`, `severity int` 1-5), **`assessment_chronic_conditions`** (`assessment_id`, `condition_code` encrypted), **`assessment_prescriptions`** (`assessment_id`, `prescription_code` encrypted). All FK cascade on assessment delete.
- **`clinics`** (read-model): `id`, `slug text unique`, `name`, `about text null`, `provider_name text null`, `website_url text null`, `rating numeric(2,1)`, `review_count int`, `latitude double null`, `longitude double null`, `city text null`, `state_code text null`, `telehealth_available bool`, `new_patient_wait text null`, `consultation_fee_band text null`, `monthly_program_band text null`, `financing_available bool`, `accepts_insurance bool`, `status text` (`active|...`), `billing_status text` (`current|no_card|overdue|...`), `business_email text null`, `webhook_url text null`, `webhook_secret text null` (encrypted), `notify_on_lead bool`.
- **`clinic_categories`** (`clinic_id`, `category assessment_category`), **`clinic_services`** (`clinic_id`, `service_code text`).
- **`leads`**: `id`, `lead_id text unique` (format `lead_<32 hex>`), `clinic_id uuid fk clinics`, `assessment_id uuid null fk`, `patient_id uuid null fk`, `patient_first_name`, `patient_email`, `patient_zip text null`, `treatment_category text`, `top_goals text null`, `top_symptoms text null`, `budget_band text null`, `telehealth_preference text null`, `appointment_preference text null`, `start_timeline text null`, `patient_phone text null` (encrypted), `inquiry_message text null`, `lead_source text` (`assessment|direct`), `delivery_status text` (`pending|emailed|sent_to_crm|failed`), `clinic_status text` (`new|contacted|booked|converted|not_interested`), `received_at`, `delivered_at timestamptz null`.
- **`webhook_deliveries`**: `id`, `lead_id uuid fk leads`, `url text`, `status text` (`success|failed`), `response_code int null`, `error text null`, `attempted_at`.
- **`zip_codes`**: `zip text pk`, `latitude double`, `longitude double`, `city text`, `state_code text`. Seeded from the .NET zipcode dataset (`MedAlign-Backend/.../Seed/Zipcodes`).

## 4. Security

- **Claim token.** `POST /assessments` returns `sessionId` and a `claimToken`, where `claimToken = base64url(HMAC-SHA256(session_id, CLAIM_TOKEN_SECRET))` (a new required env var, validated at boot like the others). It is stateless and needs no expiry: it only ever grants claiming an assessment that is still unclaimed, and becomes inert once `patient_id` is set. Authenticated submissions set `patient_id` at creation from the JWT (no linking needed). Claiming an anonymous assessment to an account (`GET /assessments/latest` back-fill) or attaching it to a lead requires a `claimToken` that matches the session id (constant-time compare), and the assessment must still be unclaimed. A leaked/observed `session_id` alone cannot claim PHI.
- **RLS.** `patients`: self where `user_id = current_setting('app.current_user_id')::uuid`; admin/superadmin all. `patient_assessments`: `patient_id in (select id from patients where user_id = current_user)`; admin all; anonymous rows (`patient_id null`) are readable only via `asSystem`. `leads`: patient reads own (`patient_id` maps to caller); admin all (clinic read is Slice 3). Authenticated reads use `withUserContext`; anonymous submit/recommendations use `asSystem` scoped by `session_id`.
- **PHI response minimization.** `GET /recommendations/{sessionId}` returns only clinic match data, never assessment PHI.
- **Webhook SSRF guard.** Outbound lead webhook: require absolute HTTPS; resolve the host and reject any loopback/private/link-local/ULA/metadata (169.254/fd00/RFC1918) address; pin the connection to the validated IP (defeat DNS rebinding); disable redirects; short timeout. Payload is HMAC-SHA256 signed with the clinic's `webhook_secret` in an `X-MedAlign-Signature` header.
- **Consent + validation.** `consent_given` must be true (else 400); `consent_version` validated against a server allowlist of active versions; `consent_given_at` server-set; a consent audit entry recorded. All assessment input is validated (severity 1-5, `treatment_category`/`budget_band`/`telehealth_preference` enums, `^\d{5}$` ZIP, collection caps <= 20 goals/symptoms/conditions/prescriptions, `allergy_details`/`other_medications` max length) via DTO validation with `whitelist`/`forbidNonWhitelisted`.

## 5. Matching algorithm (reproduce .NET `RecommendationService` exactly)

Load the assessment by `session_id`. If not found, 404.

**Implied services.** Build a `Set<string>` of service codes from the assessment's goals and symptoms via the goal-to-services and symptom-to-services maps (ported verbatim from `ServiceMapping`).

**Hard filters.** Consider only clinics where `status = active` AND `billing_status not in (no_card, overdue)` AND a `clinic_categories` row matches the assessment `treatment_category`.

**Score = sum of 7 components** (exact point values from the .NET service):

1. **Service match (max 40):** no implied services -> 20; else `(matchedImplied / totalImplied) * 40`.
2. **Budget (max 30):** budget `unknown` -> 15; clinic no band -> 10; else by index distance in `[100_200, 200_500, 500_1k, 1k_plus]`: 0 -> 25, 1 -> 10, 2+ -> 0; +5 if clinic pricier but `financing_available`; +5 if patient `100_200` and clinic `accepts_insurance`; cap 30.
3. **Geo:** telehealth pref `yes` -> 15 + 10 same-state (max 25); `either` -> max(in-person score, 15 + 10 same-state); `no` -> in-person by Haversine miles: <=10 -> 25, <=25 -> 15, <=50 -> 5, else 0. Haversine radius 3958.8.
4. **Telehealth alignment:** clinic has telehealth and pref `yes` -> 15; `either` -> 5; else 0.
5. **Quality (max 15):** base `(rating / 5) * 12`; review-confidence bump 0/<10, +1/<50, +2/<200, +3/>=200; 0 reviews -> 5; cap 15.
6. **Wait time:** timeline `just_researching`/empty or clinic wait empty -> 0; index in `[same_week, 1_2_weeks, 2_4_weeks, 1_month_plus]`: `asap` -> 8/3/0/-5; `within_month` -> 5/8/5/0; `few_months` -> 2.
7. **Lab work:** patient willing and clinic offers lab work -> 5; else 0.

Sort by score desc, then (fix over .NET) `rating desc, id asc` for deterministic ties. Take top 10. Map to `ClinicMatchDto` (clinicId, slug, name, score, location `"City, State"`, rating, reviewCount, topServices, categories, telehealthAvailable, newPatientWait, consultationFeeBand, monthlyProgramBand, financingAvailable, distanceMiles rounded to 1dp, about, providerName, websiteUrl).

## 6. Lead delivery

`POST /leads`: validate clinic exists; resolve first name (request -> JWT name -> email prefix); link assessment/patient (authenticated -> from JWT; else `sessionId` + `claimToken`); create the lead (`delivery_status = pending`, `clinic_status = new`, `lead_source = assessment`); then, if `clinic.notify_on_lead` and clinic active, attempt **once**: send the clinic email (SendGrid, HTML-escaped values, only if a business email exists) and POST the HMAC-signed webhook through the SSRF guard. Record a `webhook_deliveries` row and set `delivery_status` to `emailed` / `sent_to_crm` / `failed` and `delivered_at`. Retries are Slice 5.

## 7. Error handling and testing

Reuse the Foundation exception filter and typed domain errors (`AssessmentNotFound`, `InvalidClaimToken`, `ClinicNotFound`, `ConsentRequired`, `InvalidConsentVersion`). No PHI or secrets in logs or error bodies.

**TDD.** Unit: the scoring algorithm component-by-component with edge cases and the deterministic tie-break; the goal/symptom service maps; claim-token issue/verify (valid, wrong sid, tampered); assessment mapping encrypts PHI on write. Integration (real Postgres): RLS scoping (patient A cannot read B's assessment or leads; anonymous rows only via asSystem); the claim-token flow (A cannot claim B's sessionId even with the sessionId); PHI columns are ciphertext at rest; the SSRF guard rejects private/loopback/metadata hosts; email + webhook fire and record delivery. E2e: full journey (submit -> recommendations -> lead -> my-leads), consent-false 400, validation rejection, and the security case (stolen sessionId without claimToken cannot claim).

## 8. Definition of done

- Builds/lints/typechecks clean; format check passes.
- Migrations create the schema + RLS + FORCE + audit triggers + the clinic and zip seeds.
- All six endpoints match the .NET contract (plus `claimToken`), verified by e2e.
- The matching algorithm reproduces the .NET point values (unit-proven) and is deterministic.
- RLS, claim-token, encryption-at-rest, SSRF-guard, and lead-delivery integration tests pass.
- CI (the Slice-1 pipeline) is green.
