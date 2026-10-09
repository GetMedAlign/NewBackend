# Localization Foundation: Design Spec

**Project:** MedAlign Florida Localization, sub-project 1 of 4 (foundation).
**Repo:** NewBackend (NestJS + Prisma 7 + Supabase/Postgres).
**Branch:** `feat/florida-localization-foundation`.
**Date:** 2026-10-09.

## Goal

Provide the data, coverage logic, and public read APIs that every other sub-project depends on: a `localization` module holding admin-manageable cities, admin-manageable marketing services with a service-code mapping, a coverage read-service that decides what is publishable, and the public endpoints the prerendered pages, sitemap, and admin screens will consume.

## Context

- Clinics already carry fine-grained **service codes** (`clinic_service.service_code`) plus a coarse **category** (`hormone | peptide | med_spa | wellness`), `city`, `state_code`, `telehealth_available`, `status`, `latitude/longitude`. The public directory lives at `GET /clinics` (filters: category, state, telehealth, serviceCode, search, zipCode, sortBy, page, pageSize). There is no exact `city` filter yet.
- The design (new-design prototype) introduces 11 flat marketing services that cut across the existing codes, 9 Florida cities with tri-state status, combo coverage, and a coverage control room. Per decisions: services + mapping live in the DB (admin-editable); city coverage = exact `clinic.city` match with telehealth surfaced statewide but not counted toward the publish gate; the main CTA starts the assessment (consumed later, not here).

## Architecture

New hexagonal module `src/modules/localization/`:

```
localization/
  domain/
    entities/ (location, marketing-service, service-code-map value objects)
    coverage.service.ts        // pure coverage logic, no I/O
    ports/localization-repository.port.ts
    dto/ (city, service, combo, coverage-matrix, notify response DTOs)
  application/
    get-cities.use-case.ts
    get-city.use-case.ts
    get-services.use-case.ts
    get-service.use-case.ts
    get-combo.use-case.ts
    get-coverage.use-case.ts
    capture-notify.use-case.ts
  infrastructure/
    prisma-localization.repository.ts
    http/localization.controller.ts
    http/dto/ (request + response DTOs with swagger)
  localization.module.ts
```

Coverage logic is a pure domain service (functions over in-memory records) so it is unit-testable without a DB. The repository loads active clinics + locations + services + mapping; use-cases compose repository reads with the coverage service.

## Data model (Prisma + migration)

All new tables use snake_case columns, `@map` in Prisma, and RLS consistent with existing tables: **public SELECT** allowed (anon) for rows the public may see, **writes restricted** to the service role / admin path (writes themselves land in sub-project 2). Enable RLS on every new table.

### `location`

| column                  | type        | notes                                                   |
| ----------------------- | ----------- | ------------------------------------------------------- |
| id                      | uuid pk     |                                                         |
| slug                    | text unique | e.g. `tampa`, `st-petersburg`                           |
| name                    | text        | `Tampa`                                                 |
| state_code              | text        | `FL`                                                    |
| status                  | text        | `available \| coming_soon \| hidden` (default `hidden`) |
| area                    | text        | approved local blurb                                    |
| intro                   | text        | approved page intro                                     |
| aliases                 | text[]      | finder matching, e.g. `{jax}`                           |
| near_slugs              | text[]      | adjacency for "nearby cities"                           |
| seo_title               | text        |                                                         |
| seo_description         | text        |                                                         |
| display_order           | int         |                                                         |
| created_at / updated_at | timestamptz |                                                         |

Public SELECT policy exposes `status <> 'hidden'` rows; `hidden` rows are invisible to anon.

### `marketing_service`

| column                  | type        | notes                                 |
| ----------------------- | ----------- | ------------------------------------- |
| id                      | uuid pk     |                                       |
| slug                    | text unique | e.g. `hormone-optimization`           |
| name                    | text        | `Hormone Optimization`                |
| description             | text        | approved copy                         |
| status                  | text        | `active \| hidden` (default `active`) |
| related_slugs           | text[]      | ordered related-service rail          |
| seo_title               | text        |                                       |
| seo_description         | text        |                                       |
| display_order           | int         |                                       |
| created_at / updated_at | timestamptz |                                       |

### `marketing_service_code`

| column               | type                         | notes                                    |
| -------------------- | ---------------------------- | ---------------------------------------- |
| id                   | uuid pk                      |                                          |
| marketing_service_id | uuid fk -> marketing_service | on delete cascade                        |
| service_code         | text                         | one of the existing clinic service codes |

Unique on `(marketing_service_id, service_code)`. A clinic offers a marketing service when it has **any** mapped `service_code`.

### `localization_setting`

Single-row table (enforced by a fixed `id = 'default'` text pk or a `singleton boolean unique`):

| column      | type        | notes                          |
| ----------- | ----------- | ------------------------------ |
| id          | text pk     | always `default`               |
| min_clinics | int         | publish threshold, default `2` |
| updated_at  | timestamptz |                                |

### `location_notify`

| column     | type        | notes                                          |
| ---------- | ----------- | ---------------------------------------------- |
| id         | uuid pk     |                                                |
| email      | text        |                                                |
| city_slug  | text        | city the visitor searched for (may be unknown) |
| created_at | timestamptz |                                                |

Public INSERT policy allowed (rate-limited at the controller), SELECT restricted to admin.

### `clinics` directory change

Add an exact `city` filter to `GetClinicDirectoryUseCase` / repository / controller `GET /clinics?city=`. Case-insensitive exact match on `clinic.city`.

## Coverage service (pure domain logic)

Inputs: active clinics (`{ id, city, services: string[], telehealth, active }`), locations, marketing services + code map, `minClinics`.

Derived helpers:

- `codesFor(serviceSlug)` -> set of service codes from the mapping.
- `offersService(clinic, serviceSlug)` -> clinic has any code in `codesFor`.
- `localClinicsInCity(citySlug)` -> active clinics with `clinic.city` matching the city (exact, case-insensitive). **Does not include telehealth-only out-of-city clinics.**
- `telehealthForCity(citySlug)` -> active telehealth clinics not physically in the city (surfaced as "also available statewide"; informational only).
- `clinicsForService(serviceSlug)` -> active clinics offering it, any city.
- `clinicsForCombo(citySlug, serviceSlug)` -> local clinics in the city offering it.

Publish gates (uniform threshold `minClinics`, default 2):

- `cityPublished(slug)` = `location.status === 'available'` AND `localClinicsInCity(slug).length >= minClinics`.
- `servicePublished(slug)` = `marketing_service.status === 'active'` AND `clinicsForService(slug).length >= minClinics`.
- `comboPublished(city, service)` = `cityPublished(city)` is not required; combo publishes when `clinicsForCombo(city, service).length >= minClinics` AND city is `available` AND service is `active`.

Rules:

- **Telehealth counts where the clinic is physically located, not where it's excluded.** The city/combo gates count clinics physically in the city, including in-city clinics that also offer telehealth; an out-of-city telehealth clinic does not count toward that city's gate and is instead surfaced via `telehealthForCity`. The statewide service gate counts all active clinics offering the service, telehealth included. This preserves "no empty pages": a city served only by out-of-city telehealth stays below threshold and shows the coming-soon state.
- **Combo sparsity:** when a combo has local clinics but fewer than 3, nearby combos (via `near_slugs`) are offered as supplementary. This is presentation data returned by the combo use-case, not a change to the gate.
- `coverageMatrix()` returns, for each (service, city): local combo count and a state of `published | below_threshold | none`, plus per-city and per-service published flags and summary counts.

## Public read endpoints (`@Public()`)

All responses are plain DTOs (swagger-documented), no auth.

- `GET /localization/cities` -> list of non-hidden cities: `{ slug, name, status, area, counts: { clinics, services }, published }`.
- `GET /localization/cities/:slug` -> full city payload: copy, SEO, `published`, local clinics (id, name, address, services, telehealth), telehealth-statewide clinics, available services with counts, nearby published cities. Hidden city -> 404. Coming-soon or below-threshold -> `published: false` with the coming-soon payload (nearest published cities).
- `GET /localization/services` -> list of active services: `{ slug, name, description, published, cityCount }`.
- `GET /localization/services/:slug` -> full service payload: copy, SEO, `published`, clinics offering it (with city), cities-available with counts, related published services. Hidden -> 404.
- `GET /localization/combo/:city/:service` -> `{ published, local clinics, nearby clinics (if sparse), related links }`. 404 only if city hidden or service hidden; otherwise `published` flag drives the page.
- `GET /localization/coverage` -> the matrix + settings (`minClinics`) + summary counts. `@Public()` is acceptable (no PHI, only counts); the admin screen consumes it. Marked for the build to generate the prerender list + sitemap.
- `POST /localization/notify` -> body `{ email, citySlug? }`, stores a row, returns `{ ok: true }`. Validate email; basic throttle.

Each city/service/combo response includes a `meta` block `{ path, title, description, robots: boolean }` so the frontend build can set titles and the sitemap/robots directives from one source. `robots` is true only when `published`.

## Seeds

A seed script (idempotent upsert by slug) inserts the 9 cities, 11 services, the mapping, and the default setting. Seeds run in local/dev and as a one-off in prod.

### Cities

| slug            | name            | status      | area                                              | aliases                                          | near_slugs                           |
| --------------- | --------------- | ----------- | ------------------------------------------------- | ------------------------------------------------ | ------------------------------------ |
| tampa           | Tampa           | available   | South Tampa, Westshore and Downtown               | —                                                | st-petersburg, bradenton, sarasota   |
| st-petersburg   | St. Petersburg  | available   | Downtown St. Petersburg and the Old Northeast     | stpete, saintpetersburg, stpetersburg, saintpete | tampa, bradenton, sarasota           |
| jacksonville    | Jacksonville    | available   | Riverside, San Marco, Southside and the Beaches   | jax                                              | tampa, st-petersburg                 |
| miami           | Miami           | available   | Brickell, Midtown, Coral Gables and Coconut Grove | —                                                | fort-lauderdale, naples              |
| fort-lauderdale | Fort Lauderdale | available   | Las Olas, Victoria Park and Harbor Beach          | ftlauderdale, ftl                                | miami, naples                        |
| fort-myers      | Fort Myers      | available   | McGregor and South Fort Myers                     | ftmyers                                          | naples, sarasota                     |
| sarasota        | Sarasota        | available   | Downtown Sarasota and Siesta Key                  | —                                                | bradenton, st-petersburg, fort-myers |
| naples          | Naples          | coming_soon | Old Naples and Pelican Bay                        | —                                                | fort-myers, miami                    |
| bradenton       | Bradenton       | available   | Downtown Bradenton and the Riverwalk              | —                                                | sarasota, tampa, st-petersburg       |

(`intro` and `seo_*` seeded with approved-pending copy derived from the prototype; flagged for medical/content review.)

### Services (slug, name, related)

| slug                      | name                        | related_slugs                                                        |
| ------------------------- | --------------------------- | -------------------------------------------------------------------- |
| hormone-optimization      | Hormone Optimization        | sexual-health, longevity-anti-aging, metabolic-health                |
| peptide-metabolic-therapy | Peptide & Metabolic Therapy | metabolic-health, weight-loss-medicine, biohacking-performance       |
| med-spa-aesthetics        | Med Spa & Aesthetics        | regenerative-medicine, iv-infusion-therapy, longevity-anti-aging     |
| functional-medicine       | Functional Medicine         | metabolic-health, longevity-anti-aging, hormone-optimization         |
| metabolic-health          | Metabolic Health            | weight-loss-medicine, peptide-metabolic-therapy, functional-medicine |
| iv-infusion-therapy       | IV & Infusion Therapy       | biohacking-performance, functional-medicine, longevity-anti-aging    |
| weight-loss-medicine      | Weight Loss Medicine        | metabolic-health, peptide-metabolic-therapy, hormone-optimization    |
| longevity-anti-aging      | Longevity & Anti-Aging      | hormone-optimization, biohacking-performance, functional-medicine    |
| sexual-health             | Sexual Health               | hormone-optimization, longevity-anti-aging, metabolic-health         |
| regenerative-medicine     | Regenerative Medicine       | med-spa-aesthetics, biohacking-performance, iv-infusion-therapy      |
| biohacking-performance    | Biohacking & Performance    | longevity-anti-aging, iv-infusion-therapy, peptide-metabolic-therapy |

Descriptions seeded verbatim from the prototype's `DESC` array (approved-pending).

### Service-to-code mapping (PROPOSED, pending client confirmation)

| marketing service         | service codes                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| hormone-optimization      | trt, bhrt, menopause_hrt                                                                       |
| peptide-metabolic-therapy | peptide_anti_aging, peptide_weight_loss, muscle_repair, energy_clarity, muscle_growth          |
| med-spa-aesthetics        | injectables, skin_rejuvenation, laser, body_contouring, facials, microneedling, chemical_peels |
| functional-medicine       | gi_rehab, micronutrient_testing                                                                |
| metabolic-health          | weight_management, micronutrient_testing, energy_clarity                                       |
| iv-infusion-therapy       | iv_therapy, vitamin_injections                                                                 |
| weight-loss-medicine      | weight_loss, peptide_weight_loss, weight_management                                            |
| longevity-anti-aging      | peptide_anti_aging, bhrt, micronutrient_testing                                                |
| sexual-health             | ed, trt, menopause_hrt                                                                         |
| regenerative-medicine     | muscle_repair                                                                                  |
| biohacking-performance    | energy_clarity, muscle_growth, muscle_repair                                                   |

A code may map to several services (overlap is intentional). `regenerative-medicine` maps thinly today and will rarely publish until a dedicated code exists; noted for the client. Because the mapping lives in the DB, the client/admin can adjust it later without a deploy.

## Testing

- **Coverage service (unit):** threshold gating (below / at / above `minClinics`) for city, service, combo; telehealth excluded from gates but present in city listing; combo sparsity supplements from `near_slugs`; hidden/coming_soon short-circuit; empty inputs.
- **Repository (integration):** seeds load; `city` filter on directory; mapping resolves codes; non-hidden filter on public city read.
- **Endpoints:** response shapes, `meta.robots` matches `published`, hidden -> 404, notify insert + validation, `@Public()` reachable without auth.
- Follow the full CI flow before any commit: lint + format:check + typecheck + build + jest.

## Out of scope (later sub-projects)

- Admin write endpoints + admin UI for cities/services/mapping/threshold, and the rebuild trigger (sub-project 2).
- Prerendered pages, sitemap/robots generation, finder, analytics events, and the SEO enhancements (JSON-LD structured data: MedicalBusiness/LocalBusiness, BreadcrumbList, FAQPage; canonical tags; Open Graph; Google Search Console + sitemap submission; clean drop of disabled pages) (sub-project 3).
- NPI/NPPES auto-approval onboarding (sub-project 4).

## Open items for the client

1. Confirm the service-to-code mapping above.
2. Confirm `min_clinics` (default 2).
3. Approve city/service descriptions, intros, and FAQ copy before the pages launch (copy is approved-pending in seeds).
4. Confirm city coverage = exact city match with telehealth surfaced statewide (as designed here).
