# Matching Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the legacy .NET-ported recommendation scoring with the client's weighted 0-100 model plus a membership-tier ranking nudge, an eligibility gate, a patient-entered distance cap, and a top-5 result set.

**Architecture:** Add a clinic membership tier (schema) and a patient preferred-distance field (schema + DTO), then rewrite the pure `recommendation.service.ts` scoring/ranking. All scoring stays I/O-free; wiring flows through the existing `GetRecommendationsUseCase`.

**Tech Stack:** NestJS 10, Prisma 7 (+ `@prisma/adapter-pg`), Postgres. Verify with `npm run typecheck`, `npm run lint`, `npm run build`, `npm run openapi`. Unit tests are written but run in CI (jest is unreliable in this shell); do not block on running jest locally.

## Global Constraints (from the approved spec)

Spec: `docs/superpowers/specs/QUEUED-2026-07-31-matching-engine-point-system-tiers.md`. Read it before Task 1.

- **Weights sum to 100:** Primary goal 25, Secondary goals 10, Symptoms 20, Desired treatment/service interest 20, Lifestyle 10 (soft), Patient preferences 5, Location/distance/telehealth 10.
- **Eligibility gate:** a clinic is only recommended if it aligns with the patient (candidates are already category-filtered by `findMatchable`, so the gate is: fit score at or above a floor OR at least one desired/implied service matched). A clear non-match is never recommended, regardless of tier.
- **Tier nudge:** Starter, Growth, Preferred (low to high). Applied to RANKING ONLY, after the fit score, among clinics that already pass the gate. Growth gets a small nudge, Preferred slightly more. The nudge must be small enough that a strong lower-tier match still outranks a weak higher-tier one. The DISPLAYED `score` stays the raw 0-100 fit (never the boosted number, never tier).
- **Health background (step 7) is NOT scored.** No change needed here (it is not in the scoring inputs); do not add it.
- **Distance cap:** in-person selected uses the patient's preferred distance, defaulting to 25 miles; telehealth ignores distance; "either is fine" applies the cap. Preferred distance is a NEW patient field (default 25 when absent).
- **Preferences bucket (5%):** implement via timeline-to-start vs the clinic's existing `newPatientWait`. The AM/PM appointment-time sub-item is DEFERRED (needs a clinic-side field the client has not confirmed); structure the code so it can be added, but do not add a clinic field now. Leave a code comment noting this.
- **Lifestyle bucket (10%): soft signal.** Clinics have no lifestyle attributes, so give a modest baseline partial credit to eligible clinics; never exclude on it. Keep it simple; comment that it is a placeholder for a richer signal.
- **Return up to 5 matches** (fewer if fewer eligible).
- No em dashes in code comments. Keep the committed OpenAPI spec updated (`npm run openapi`).

## Task 1: Clinic membership tier (schema + read model)

**Files:** `prisma/schema.prisma`, a new migration under `prisma/migrations/`, `src/modules/clinics/domain/clinic.entity.ts`, `src/modules/clinics/infrastructure/prisma-clinic.repository.ts`.

- [ ] **Step 1:** Add a Prisma enum `MembershipTier { starter growth preferred @@map("membership_tier") }` and a `membershipTier MembershipTier @default(starter) @map("membership_tier")` column on `model Clinic` (near `billingStatus`, ~line 228).
- [ ] **Step 2:** Create the migration SQL (enum type + column with default `'starter'`; existing rows get the default). Follow the existing migration style in `prisma/migrations/`. Run `npx prisma generate` so the client picks it up.
- [ ] **Step 3:** Add `membershipTier: 'starter' | 'growth' | 'preferred'` to `ClinicReadModel` and map it in `toReadModel` (the `findMany`/`findUnique` rows already include all scalar columns, so no query change needed beyond mapping the field).
- [ ] **Step 4:** Verify `npm run typecheck` and `npm run build`. Commit `feat(clinics): add membership tier field`.

## Task 2: Patient preferred distance (schema + DTO + entity)

**Files:** `prisma/schema.prisma` (Assessment model, ~line 151), a migration, the assessment submit DTO, `src/modules/assessments/domain/assessment.entity.ts`, and the assessment repository mapping.

- [ ] **Step 1:** Add `preferredDistanceMiles Int? @map("preferred_distance_miles")` to `model Assessment`. Create the migration (nullable column, no backfill needed). `npx prisma generate`.
- [ ] **Step 2:** Add an optional `preferredDistanceMiles?: number` (validated as a positive int, e.g. 1-500) to the assessment submit DTO (find it under `src/modules/assessments/`). Persist it in the create path.
- [ ] **Step 3:** Add `preferredDistanceMiles: number | null` to the `Assessment` entity and map it in the repository read. The frontend will send this from step 8 later; the field is optional and defaults to 25 in scoring when null.
- [ ] **Step 4:** Verify `npm run typecheck` and `npm run build`. Commit `feat(assessments): add optional preferred distance field`.

## Task 3: Rewrite per-clinic scoring to the weighted 0-100 model

**Files:** `src/modules/recommendations/domain/recommendation.service.ts`, `src/modules/recommendations/domain/recommendation.service.spec.ts` (replace legacy tests).

**Interfaces produced:** `score(assessment, clinic, patientGeo, distMiles?): number` still returns a number, now 0-100 (raw fit). Add a helper the rank step can reuse for eligibility (e.g. a private predicate or return the component breakdown). Keep the service `@Injectable` and I/O-free.

- [ ] **Step 1:** Rewrite `score` to sum seven bucket helpers, each returning 0..weight, matching the spec:
  - `scorePrimaryGoal` (25): the patient's top-ranked goal (`selectedGoals[0]`) mapped via `impliedServices`/`service-mapping` to whether the clinic covers it. Full 25 on cover, 0 otherwise (or partial if the mapping yields multiple service targets, proportional).
  - `scoreSecondaryGoals` (10): fraction of the remaining `selectedGoals` (index 1+) the clinic covers.
  - `scoreSymptoms` (20): fraction of `selectedSymptoms` the clinic addresses (via `impliedServices`), weighted by `symptomSeverities` so higher-severity symptoms count more. Neutral partial when no symptoms.
  - `scoreTreatmentInterest` (20): category alignment (always true post-filter, so give a base) plus the fraction of the patient's desired/implied services the clinic offers.
  - `scoreLifestyle` (10): SOFT signal, modest baseline (for example 5) for eligible clinics; never excludes. Comment that this is a placeholder.
  - `scorePreferences` (5): timeline-to-start vs `newPatientWait` (reuse the existing wait-time alignment logic, rescaled to 0-5). AM/PM deferred, comment it.
  - `scoreLocation` (10): distance-cap logic. Resolve the cap = `assessment.preferredDistanceMiles ?? 25`. Telehealth pref `yes`: full/partial based on clinic telehealth (distance ignored). `no` (in-person): scaled by distance within the cap (nearer is higher, beyond the cap is 0). `either`: max of the in-person-within-cap score and the telehealth score.
  Clamp each bucket to its max and the total to 0-100. Round to an integer.
- [ ] **Step 2:** Add an `isEligible(assessment, clinic, distMiles?): boolean` (or fold into rank): eligible when the fit score is at or above a named floor constant (e.g. `ELIGIBILITY_FLOOR = 40`) OR the clinic offers at least one of the patient's desired/implied services; AND, for in-person-only patients, the clinic is within the distance cap. A clear non-match returns false.
- [ ] **Step 3:** Replace `recommendation.service.spec.ts` with unit tests for each bucket (full, partial, zero), the total staying 0-100, and `isEligible` true/false cases. Do not keep the old .NET point-value assertions.
- [ ] **Step 4:** Verify `npm run typecheck`, `npm run lint`, `npm run build`. Commit `feat(recommendations): weighted 0-100 scoring with eligibility gate`.

## Task 4: Ranking with tier nudge and top-5

**Files:** `src/modules/recommendations/domain/recommendation.service.ts` (the `rank` method), `recommendation.service.spec.ts` (add rank tests).

- [ ] **Step 1:** Rewrite `rank` to: compute each clinic's raw fit + distance once, FILTER to eligible clinics only, then sort by an effective ranking score that applies the tier nudge, then take the top 5, then `toDto` with the RAW fit as `score`.
  - Tier nudge (ranking only): `effective = fit * tierMultiplier`, where `tierMultiplier` = 1.0 starter, 1.05 growth, 1.10 preferred (define as named constants). The nudge never changes the displayed `score`.
  - Keep the deterministic tiebreak after effective score: rating desc, then id asc.
  - `.slice(0, 5)`.
- [ ] **Step 2:** Add rank unit tests: (a) a strong lower-tier clinic (high fit) outranks a weak higher-tier clinic (low fit); (b) among near-equal fits, the higher tier wins; (c) an ineligible clinic (clear non-match) never appears even at Preferred tier; (d) at most 5 returned; (e) displayed `score` equals the raw fit, not the boosted value.
- [ ] **Step 3:** Verify `npm run typecheck`, `npm run lint`, `npm run build`. Commit `feat(recommendations): membership-tier ranking nudge and top-5`.

## Task 5: Wire-through, DTO, and OpenAPI

**Files:** `src/modules/recommendations/domain/clinic-match.dto.ts` (doc/comment update if needed), `get-recommendations.use-case.ts` (only if it needs changes; the assessment already carries `preferredDistanceMiles` and `zipCode`, and clinics now carry `membershipTier`), `get-recommendations.use-case.spec.ts` (update expectations), the committed OpenAPI artifact.

- [ ] **Step 1:** Confirm the use-case passes everything needed (assessment + clinics + geo); it should need no change since tier and preferred distance ride on the entities. Update `clinic-match.dto.ts` comments to say `score` is 0-100 raw fit and results are capped at 5. Do NOT add a tier field to the DTO (tier must never reach the patient).
- [ ] **Step 2:** Update `get-recommendations.use-case.spec.ts` to reflect the top-5 cap and new scoring shape (mock clinics/assessment; assert eligibility + count + no tier leakage).
- [ ] **Step 3:** Regenerate the committed OpenAPI spec: `npm run openapi`.
- [ ] **Step 4:** Verify `npm run typecheck`, `npm run lint`, `npm run build`. Commit `feat(recommendations): finalize match DTO docs and regenerate OpenAPI`.

## Self-Review Notes
- Reasons remain client-side; the DTO gains no tier field (tier never leaves the backend ranking).
- Preferred distance and tier are optional/defaulted so existing data keeps working (existing clinics default to starter; assessments without a preferred distance default to a 25-mile cap in scoring).
- AM/PM appointment matching is deliberately deferred pending a client decision on a clinic-side field; timeline-to-start already scores with existing data.
- The frontend step-8 "preferred distance" input is a separate Medalign-frontend change; this plan makes the backend accept and use the field.
