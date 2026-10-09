# Localization Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `localization` backend module (cities, marketing services, service-code mapping, coverage logic, public read APIs, seeds) that every other Florida-localization sub-project depends on.

**Architecture:** New hexagonal NestJS module `src/modules/localization` with a pure `CoverageService` domain service, a `PrismaLocalizationRepository` that reads via `prisma.asSystem(...)`, thin use-cases that compose repo reads with coverage logic into swagger DTOs, and `@Public()` read endpoints. New tables are created by hand-authored raw-SQL migrations with RLS, and populated by an idempotent seed script. The existing `GET /clinics` directory gains an exact `city` filter.

**Tech Stack:** NestJS 10, Prisma 7 (`prisma-client` generator, output `generated/prisma`, `pg`/`PrismaPg` adapter), Supabase/Postgres, class-validator/Swagger, Jest (ts-jest), pnpm.

## Global Constraints

- Generated Prisma client is imported from the generated output, NOT `@prisma/client`: `../../../../generated/prisma/client` from a module `infrastructure/` file, `../../generated/prisma/client` from `prisma/seed/`.
- UUID PKs: `@default(dbgenerated("gen_random_uuid()")) @db.Uuid`. Timestamps: `@db.Timestamptz` with `@default(now())`.
- NO `text[]` columns. Model one-to-many sets as join tables with composite PKs (follow `ClinicService`).
- Migrations are hand-authored raw SQL under `prisma/migrations/<timestamp>_<name>/migration.sql`. Apply with `pnpm prisma migrate deploy` then `pnpm prisma generate`. NEVER `migrate dev` (except the historical init). Two migrations per slice: schema, then `_rls`.
- `DATABASE_URL` MUST point at the LOCAL Supabase DB (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`, after `supabase start`) for migrate/seed/integration tests. Do not run migrations against production.
- RLS on every new table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, `GRANT ... TO app_authenticated`, admin policies named `<table>_admin_all` using `has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')` OR `'superadmin'`. Public data is read through `prisma.asSystem(...)` (superuser bypasses RLS).
- `status` columns are plain `String` in Prisma (enum-via-string), guarded by a SQL `CHECK` constraint.
- Public endpoints carry `@Public()` (from `../../../../infrastructure/security/public.decorator`); global auth is fail-closed.
- Copy in seeds (city `area`/`intro`, service `description`, SEO text) is APPROVED-PENDING, lifted from the prototype, flagged for the client's medical/content review. No ratings, prices, or credentials anywhere.
- City coverage = exact city match (resolved from `clinic.city` text to a location slug); telehealth clinics are surfaced on a published city page but DO NOT count toward any publish gate.
- Uniform publish threshold `min_clinics` (default 2) applied to city, service, and combo gates.
- Run the full CI flow before every commit: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm test`. Integration tests: `pnpm test:int`.

## Canonical data (used by seeds in Task 3 and tests)

**Cities** (`slug | name | status | area | aliases | nearSlugs`):

| slug            | name            | status      | area                                              | aliases                                          | nearSlugs                            |
| --------------- | --------------- | ----------- | ------------------------------------------------- | ------------------------------------------------ | ------------------------------------ |
| tampa           | Tampa           | available   | South Tampa, Westshore and Downtown               | (none)                                           | st-petersburg, bradenton, sarasota   |
| st-petersburg   | St. Petersburg  | available   | Downtown St. Petersburg and the Old Northeast     | stpete, saintpetersburg, stpetersburg, saintpete | tampa, bradenton, sarasota           |
| jacksonville    | Jacksonville    | available   | Riverside, San Marco, Southside and the Beaches   | jax                                              | tampa, st-petersburg                 |
| miami           | Miami           | available   | Brickell, Midtown, Coral Gables and Coconut Grove | (none)                                           | fort-lauderdale, naples              |
| fort-lauderdale | Fort Lauderdale | available   | Las Olas, Victoria Park and Harbor Beach          | ftlauderdale, ftl                                | miami, naples                        |
| fort-myers      | Fort Myers      | available   | McGregor and South Fort Myers                     | ftmyers                                          | naples, sarasota                     |
| sarasota        | Sarasota        | available   | Downtown Sarasota and Siesta Key                  | (none)                                           | bradenton, st-petersburg, fort-myers |
| naples          | Naples          | coming_soon | Old Naples and Pelican Bay                        | (none)                                           | fort-myers, miami                    |
| bradenton       | Bradenton       | available   | Downtown Bradenton and the Riverwalk              | (none)                                           | sarasota, tampa, st-petersburg       |

`intro` for each city = `MedAlign lists active clinics serving <area>. Compare the services each one offers and take the next step when you are ready.` `seoTitle` = `Specialized Clinics in <name>, FL | MedAlign`. `seoDescription` = `Find active, vetted clinics in <name>, Florida. Compare services and get matched on your goals.`

**Services** (`slug | name | description | relatedSlugs`), `status` all `active`, `displayOrder` by array index:

| slug                      | name                        | description                                                                                                                               | relatedSlugs                                                         |
| ------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| hormone-optimization      | Hormone Optimization        | Clinics that evaluate and manage hormone levels, typically starting with lab work and continuing with monitoring by a licensed clinician. | sexual-health, longevity-anti-aging, metabolic-health                |
| peptide-metabolic-therapy | Peptide & Metabolic Therapy | Clinician supervised programs that use prescribed peptides as part of a broader metabolic or recovery plan.                               | metabolic-health, weight-loss-medicine, biohacking-performance       |
| med-spa-aesthetics        | Med Spa & Aesthetics        | Non-surgical aesthetic treatments such as injectables and skin procedures, performed or supervised by licensed providers.                 | regenerative-medicine, iv-infusion-therapy, longevity-anti-aging     |
| functional-medicine       | Functional Medicine         | An approach that looks at history, lifestyle and lab work together to build an individualized care plan.                                  | metabolic-health, longevity-anti-aging, hormone-optimization         |
| metabolic-health          | Metabolic Health            | Programs focused on markers like blood sugar, weight and energy, usually combining labs, nutrition and clinical follow up.                | weight-loss-medicine, peptide-metabolic-therapy, functional-medicine |
| iv-infusion-therapy       | IV & Infusion Therapy       | Intravenous fluids and nutrients administered in a clinical setting under licensed supervision.                                           | biohacking-performance, functional-medicine, longevity-anti-aging    |
| weight-loss-medicine      | Weight Loss Medicine        | Medically supervised weight management, which may include prescriptions, nutrition support and regular check-ins.                         | metabolic-health, peptide-metabolic-therapy, hormone-optimization    |
| longevity-anti-aging      | Longevity & Anti-Aging      | Preventive programs built around tracking health markers over time and adjusting care based on results.                                   | hormone-optimization, biohacking-performance, functional-medicine    |
| sexual-health             | Sexual Health               | Confidential evaluation of sexual health concerns and treatment options with a licensed clinician.                                        | hormone-optimization, longevity-anti-aging, metabolic-health         |
| regenerative-medicine     | Regenerative Medicine       | Treatments intended to support the body's own repair processes, offered in a clinical setting.                                            | med-spa-aesthetics, biohacking-performance, iv-infusion-therapy      |
| biohacking-performance    | Biohacking & Performance    | Performance focused programs combining testing, recovery and lifestyle protocols under clinical guidance.                                 | longevity-anti-aging, iv-infusion-therapy, peptide-metabolic-therapy |

`seoTitle` for a service = `<name> Clinics in Florida | MedAlign`. `seoDescription` = `<description>` truncated to 155 chars.

**Service-to-code mapping** (`serviceSlug -> serviceCodes`):

```
hormone-optimization       -> trt, bhrt, menopause_hrt
peptide-metabolic-therapy  -> peptide_anti_aging, peptide_weight_loss, muscle_repair, energy_clarity, muscle_growth
med-spa-aesthetics         -> injectables, skin_rejuvenation, laser, body_contouring, facials, microneedling, chemical_peels
functional-medicine        -> gi_rehab, micronutrient_testing
metabolic-health           -> weight_management, micronutrient_testing, energy_clarity
iv-infusion-therapy        -> iv_therapy, vitamin_injections
weight-loss-medicine       -> weight_loss, peptide_weight_loss, weight_management
longevity-anti-aging       -> peptide_anti_aging, bhrt, micronutrient_testing
sexual-health              -> ed, trt, menopause_hrt
regenerative-medicine      -> muscle_repair
biohacking-performance     -> energy_clarity, muscle_growth, muscle_repair
```

---

### Task 1: Prisma models + schema & RLS migrations

**Files:**

- Modify: `prisma/schema.prisma` (append 7 models)
- Create: `prisma/migrations/20261009120000_localization_foundation/migration.sql`
- Create: `prisma/migrations/20261009120100_localization_rls/migration.sql`
- Test: `test/db/localization-rls.int-spec.ts`

**Interfaces:**

- Produces tables `location`, `location_alias`, `location_near`, `marketing_service`, `marketing_service_code`, `marketing_service_related`, `localization_setting`, `location_notify`, and the Prisma models `Location`, `LocationAlias`, `LocationNear`, `MarketingService`, `MarketingServiceCode`, `MarketingServiceRelated`, `LocalizationSetting`, `LocationNotify`.

- [ ] **Step 1: Append the Prisma models**

In `prisma/schema.prisma`, append:

```prisma
model Location {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug            String   @unique
  name            String
  stateCode       String   @map("state_code")
  status          String   @default("hidden")
  area            String   @default("")
  intro           String   @default("")
  seoTitle        String   @default("") @map("seo_title")
  seoDescription  String   @default("") @map("seo_description")
  displayOrder    Int      @default(0) @map("display_order")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  aliases   LocationAlias[]
  nearCities LocationNear[]

  @@map("location")
}

model LocationAlias {
  locationId String @map("location_id") @db.Uuid
  alias      String

  location Location @relation(fields: [locationId], references: [id], onDelete: Cascade)

  @@id([locationId, alias])
  @@map("location_alias")
}

model LocationNear {
  locationId   String @map("location_id") @db.Uuid
  nearSlug     String @map("near_slug")
  displayOrder Int    @default(0) @map("display_order")

  location Location @relation(fields: [locationId], references: [id], onDelete: Cascade)

  @@id([locationId, nearSlug])
  @@map("location_near")
}

model MarketingService {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug           String   @unique
  name           String
  description    String   @default("")
  status         String   @default("active")
  seoTitle       String   @default("") @map("seo_title")
  seoDescription String   @default("") @map("seo_description")
  displayOrder   Int      @default(0) @map("display_order")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  codes   MarketingServiceCode[]
  related MarketingServiceRelated[]

  @@map("marketing_service")
}

model MarketingServiceCode {
  marketingServiceId String @map("marketing_service_id") @db.Uuid
  serviceCode        String @map("service_code")

  service MarketingService @relation(fields: [marketingServiceId], references: [id], onDelete: Cascade)

  @@id([marketingServiceId, serviceCode])
  @@map("marketing_service_code")
}

model MarketingServiceRelated {
  marketingServiceId String @map("marketing_service_id") @db.Uuid
  relatedSlug        String @map("related_slug")
  displayOrder       Int    @default(0) @map("display_order")

  service MarketingService @relation(fields: [marketingServiceId], references: [id], onDelete: Cascade)

  @@id([marketingServiceId, relatedSlug])
  @@map("marketing_service_related")
}

model LocalizationSetting {
  id         String   @id @default("default")
  minClinics Int      @default(2) @map("min_clinics")
  updatedAt  DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@map("localization_setting")
}

model LocationNotify {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email     String
  citySlug  String?  @map("city_slug")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@map("location_notify")
}
```

- [ ] **Step 2: Write the schema migration SQL**

Create `prisma/migrations/20261009120000_localization_foundation/migration.sql`:

```sql
CREATE TABLE "location" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug"            TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "state_code"      TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'hidden',
    "area"            TEXT NOT NULL DEFAULT '',
    "intro"           TEXT NOT NULL DEFAULT '',
    "seo_title"       TEXT NOT NULL DEFAULT '',
    "seo_description" TEXT NOT NULL DEFAULT '',
    "display_order"   INTEGER NOT NULL DEFAULT 0,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "location_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "location_status_check" CHECK ("status" IN ('available','coming_soon','hidden'))
);
CREATE UNIQUE INDEX "location_slug_key" ON "location"("slug");

CREATE TABLE "location_alias" (
    "location_id" UUID NOT NULL,
    "alias"       TEXT NOT NULL,
    CONSTRAINT "location_alias_pkey" PRIMARY KEY ("location_id","alias"),
    CONSTRAINT "location_alias_location_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "location_near" (
    "location_id"   UUID NOT NULL,
    "near_slug"     TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "location_near_pkey" PRIMARY KEY ("location_id","near_slug"),
    CONSTRAINT "location_near_location_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "marketing_service" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug"            TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "description"     TEXT NOT NULL DEFAULT '',
    "status"          TEXT NOT NULL DEFAULT 'active',
    "seo_title"       TEXT NOT NULL DEFAULT '',
    "seo_description" TEXT NOT NULL DEFAULT '',
    "display_order"   INTEGER NOT NULL DEFAULT 0,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "marketing_service_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketing_service_status_check" CHECK ("status" IN ('active','hidden'))
);
CREATE UNIQUE INDEX "marketing_service_slug_key" ON "marketing_service"("slug");

CREATE TABLE "marketing_service_code" (
    "marketing_service_id" UUID NOT NULL,
    "service_code"         TEXT NOT NULL,
    CONSTRAINT "marketing_service_code_pkey" PRIMARY KEY ("marketing_service_id","service_code"),
    CONSTRAINT "marketing_service_code_service_fkey" FOREIGN KEY ("marketing_service_id") REFERENCES "marketing_service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "marketing_service_code_code_idx" ON "marketing_service_code"("service_code");

CREATE TABLE "marketing_service_related" (
    "marketing_service_id" UUID NOT NULL,
    "related_slug"         TEXT NOT NULL,
    "display_order"        INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "marketing_service_related_pkey" PRIMARY KEY ("marketing_service_id","related_slug"),
    CONSTRAINT "marketing_service_related_service_fkey" FOREIGN KEY ("marketing_service_id") REFERENCES "marketing_service"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "localization_setting" (
    "id"          TEXT NOT NULL DEFAULT 'default',
    "min_clinics" INTEGER NOT NULL DEFAULT 2,
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "localization_setting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "localization_setting_singleton_check" CHECK ("id" = 'default'),
    CONSTRAINT "localization_setting_min_check" CHECK ("min_clinics" >= 1)
);

CREATE TABLE "location_notify" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "email"      TEXT NOT NULL,
    "city_slug"  TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "location_notify_pkey" PRIMARY KEY ("id")
);
```

- [ ] **Step 3: Write the RLS migration SQL**

Create `prisma/migrations/20261009120100_localization_rls/migration.sql`:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON
  location, location_alias, location_near,
  marketing_service, marketing_service_code, marketing_service_related,
  localization_setting, location_notify
  TO app_authenticated;

-- Enable + force RLS on every new table.
ALTER TABLE location                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE location                  FORCE  ROW LEVEL SECURITY;
ALTER TABLE location_alias            ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_alias            FORCE  ROW LEVEL SECURITY;
ALTER TABLE location_near             ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_near             FORCE  ROW LEVEL SECURITY;
ALTER TABLE marketing_service         ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_service         FORCE  ROW LEVEL SECURITY;
ALTER TABLE marketing_service_code    ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_service_code    FORCE  ROW LEVEL SECURITY;
ALTER TABLE marketing_service_related ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_service_related FORCE  ROW LEVEL SECURITY;
ALTER TABLE localization_setting      ENABLE ROW LEVEL SECURITY;
ALTER TABLE localization_setting      FORCE  ROW LEVEL SECURITY;
ALTER TABLE location_notify           ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_notify           FORCE  ROW LEVEL SECURITY;

-- Admin / superadmin full access (sub-project 2 writes rely on this).
-- Repeat this block for each of the 8 tables, substituting the table name
-- and policy name <table>_admin_all.
CREATE POLICY location_admin_all ON location
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

CREATE POLICY location_alias_admin_all ON location_alias
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));

CREATE POLICY location_near_admin_all ON location_near
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));

CREATE POLICY marketing_service_admin_all ON marketing_service
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));

CREATE POLICY marketing_service_code_admin_all ON marketing_service_code
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));

CREATE POLICY marketing_service_related_admin_all ON marketing_service_related
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));

CREATE POLICY localization_setting_admin_all ON localization_setting
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));

CREATE POLICY location_notify_admin_all ON location_notify
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));
```

Note: public reads and the public notify insert in later tasks go through `prisma.asSystem(...)` (the connection superuser bypasses RLS), so no anon policy is needed. The admin policies make sub-project 2 writes work and keep RLS from being a blank allow.

- [ ] **Step 4: Apply the migrations and regenerate the client**

Run:

```bash
pnpm prisma migrate deploy
pnpm prisma generate
```

Expected: both migrations applied, client regenerated with the new models, no errors.

- [ ] **Step 5: Write the RLS integration test**

Create `test/db/localization-rls.int-spec.ts` (follows `test/db/*-rls.int-spec.ts` style, builds its own Pool/adapter and the real `PrismaService`):

```ts
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

describe('localization RLS', () => {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const raw = new PrismaClient({ adapter });
  let prisma: PrismaService;

  beforeAll(async () => {
    await raw.$executeRawUnsafe(
      `INSERT INTO location (slug, name, state_code, status) VALUES ('rls-test-city','RLS Test','FL','available') ON CONFLICT (slug) DO NOTHING`,
    );
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });
  afterAll(async () => {
    await raw.$executeRawUnsafe(`DELETE FROM location WHERE slug = 'rls-test-city'`);
    await prisma.onModuleDestroy();
    await raw.$disconnect();
    await pool.end();
  });

  it('asSystem reads locations (RLS bypassed for system path)', async () => {
    const rows = await prisma.asSystem(
      (c) =>
        c.$queryRaw<{ slug: string }[]>`SELECT slug FROM location WHERE slug = 'rls-test-city'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('a non-admin user context sees no location rows (policy denies)', async () => {
    const rows = await prisma.withUserContext(
      { userId: null, role: 'patient', ip: null },
      (tx) =>
        tx.$queryRaw<{ slug: string }[]>`SELECT slug FROM location WHERE slug = 'rls-test-city'`,
    );
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run the integration test to verify it passes**

Run: `pnpm test:int -- localization-rls`
Expected: PASS (requires local Supabase running and migrations applied).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261009120000_localization_foundation prisma/migrations/20261009120100_localization_rls test/db/localization-rls.int-spec.ts
git commit -m "feat(localization): schema + RLS migrations for localization foundation"
```

---

### Task 2: Coverage domain service (pure)

**Files:**

- Create: `src/modules/localization/domain/coverage.types.ts`
- Create: `src/modules/localization/domain/coverage.service.ts`
- Test: `src/modules/localization/domain/coverage.service.spec.ts`

**Interfaces:**

- Produces types `RawClinicRecord`, `ClinicRecord`, `LocationRecord`, `ServiceRecord`, `ServiceCodeMap`, `CoverageCellState`, and `@Injectable()` `CoverageService` with methods:
  - `resolveCitySlug(cityText: string, locations: LocationRecord[]): string | null`
  - `toClinicRecords(raws: RawClinicRecord[], locations: LocationRecord[]): ClinicRecord[]`
  - `localClinicsInCity(clinics: ClinicRecord[], citySlug: string): ClinicRecord[]`
  - `telehealthForCity(clinics: ClinicRecord[], citySlug: string): ClinicRecord[]`
  - `clinicsForService(clinics: ClinicRecord[], codes: string[]): ClinicRecord[]`
  - `clinicsForCombo(clinics: ClinicRecord[], citySlug: string, codes: string[]): ClinicRecord[]`
  - `cityPublished(location: LocationRecord, clinics: ClinicRecord[], minClinics: number): boolean`
  - `servicePublished(service: ServiceRecord, clinics: ClinicRecord[], codes: string[], minClinics: number): boolean`
  - `comboPublished(location: LocationRecord, service: ServiceRecord, clinics: ClinicRecord[], codes: string[], minClinics: number): boolean`

- [ ] **Step 1: Write the types file**

Create `src/modules/localization/domain/coverage.types.ts`:

```ts
export type LocationStatus = 'available' | 'coming_soon' | 'hidden';
export type ServiceStatus = 'active' | 'hidden';
export type CoverageCellState = 'published' | 'below_threshold' | 'none';

export interface RawClinicRecord {
  id: string;
  name: string;
  cityText: string;
  stateCode: string;
  services: string[];
  telehealth: boolean;
}

export interface ClinicRecord {
  id: string;
  name: string;
  cityText: string; // original clinic city text, for display
  city: string; // resolved location slug, or '' when unmatched
  stateCode: string;
  services: string[];
  telehealth: boolean;
}

export interface LocationRecord {
  slug: string;
  name: string;
  stateCode: string;
  status: LocationStatus;
  area: string;
  intro: string;
  aliases: string[];
  nearSlugs: string[];
  seoTitle: string;
  seoDescription: string;
  displayOrder: number;
}

export interface ServiceRecord {
  slug: string;
  name: string;
  description: string;
  status: ServiceStatus;
  relatedSlugs: string[];
  seoTitle: string;
  seoDescription: string;
  displayOrder: number;
}

export type ServiceCodeMap = Record<string, string[]>; // serviceSlug -> service codes
```

- [ ] **Step 2: Write the failing test**

Create `src/modules/localization/domain/coverage.service.spec.ts`:

```ts
import { CoverageService } from './coverage.service';
import type { ClinicRecord, LocationRecord, ServiceRecord } from './coverage.types';

const loc = (over: Partial<LocationRecord> = {}): LocationRecord => ({
  slug: 'tampa',
  name: 'Tampa',
  stateCode: 'FL',
  status: 'available',
  area: '',
  intro: '',
  aliases: ['tpa'],
  nearSlugs: ['sarasota'],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 0,
  ...over,
});
const svc = (over: Partial<ServiceRecord> = {}): ServiceRecord => ({
  slug: 'hormone-optimization',
  name: 'Hormone Optimization',
  description: '',
  status: 'active',
  relatedSlugs: [],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 0,
  ...over,
});
const clinic = (over: Partial<ClinicRecord> = {}): ClinicRecord => ({
  id: 'c1',
  name: 'C1',
  cityText: 'Tampa',
  city: 'tampa',
  stateCode: 'FL',
  services: ['trt'],
  telehealth: false,
  ...over,
});

describe('CoverageService', () => {
  const s = new CoverageService();
  const codes = ['trt', 'bhrt'];

  it('resolveCitySlug matches name, slug, and alias case-insensitively', () => {
    const locs = [loc()];
    expect(s.resolveCitySlug('Tampa', locs)).toBe('tampa');
    expect(s.resolveCitySlug('tampa', locs)).toBe('tampa');
    expect(s.resolveCitySlug('TPA', locs)).toBe('tampa');
    expect(s.resolveCitySlug('Orlando', locs)).toBeNull();
  });

  it('localClinicsInCity excludes telehealth-only out-of-city clinics', () => {
    const clinics = [
      clinic({ id: 'a', city: 'tampa' }),
      clinic({ id: 'b', city: 'miami', telehealth: true }),
    ];
    expect(s.localClinicsInCity(clinics, 'tampa').map((c) => c.id)).toEqual(['a']);
  });

  it('clinicsForService matches any mapped code', () => {
    const clinics = [
      clinic({ id: 'a', services: ['bhrt'] }),
      clinic({ id: 'b', services: ['ed'] }),
    ];
    expect(s.clinicsForService(clinics, codes).map((c) => c.id)).toEqual(['a']);
  });

  it('cityPublished requires status available AND local count >= min (telehealth excluded)', () => {
    const clinics = [
      clinic({ id: 'a', city: 'tampa' }),
      clinic({ id: 'b', city: 'miami', telehealth: true }),
    ];
    expect(s.cityPublished(loc(), clinics, 1)).toBe(true);
    expect(s.cityPublished(loc(), clinics, 2)).toBe(false);
    expect(s.cityPublished(loc({ status: 'coming_soon' }), clinics, 1)).toBe(false);
  });

  it('servicePublished requires status active AND count >= min', () => {
    const clinics = [
      clinic({ id: 'a', services: ['trt'] }),
      clinic({ id: 'b', services: ['bhrt'] }),
    ];
    expect(s.servicePublished(svc(), clinics, codes, 2)).toBe(true);
    expect(s.servicePublished(svc({ status: 'hidden' }), clinics, codes, 2)).toBe(false);
    expect(s.servicePublished(svc(), clinics, codes, 3)).toBe(false);
  });

  it('comboPublished requires available city, active service, and local matching count >= min', () => {
    const clinics = [
      clinic({ id: 'a', city: 'tampa', services: ['trt'] }),
      clinic({ id: 'b', city: 'tampa', services: ['bhrt'] }),
      clinic({ id: 'c', city: 'miami', services: ['trt'] }),
    ];
    expect(s.comboPublished(loc(), svc(), clinics, codes, 2)).toBe(true);
    expect(s.comboPublished(loc({ status: 'coming_soon' }), svc(), clinics, codes, 2)).toBe(false);
    expect(s.comboPublished(loc(), svc(), clinics, codes, 3)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- coverage.service`
Expected: FAIL (`CoverageService` not found).

- [ ] **Step 4: Write the implementation**

Create `src/modules/localization/domain/coverage.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type {
  ClinicRecord,
  LocationRecord,
  RawClinicRecord,
  ServiceRecord,
} from './coverage.types';

@Injectable()
export class CoverageService {
  private norm(s: string): string {
    return (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/(florida|fl)$/, '');
  }

  resolveCitySlug(cityText: string, locations: LocationRecord[]): string | null {
    const n = this.norm(cityText);
    if (!n) return null;
    const match = locations.find(
      (l) =>
        this.norm(l.name) === n ||
        this.norm(l.slug) === n ||
        l.aliases.some((a) => this.norm(a) === n),
    );
    return match ? match.slug : null;
  }

  toClinicRecords(raws: RawClinicRecord[], locations: LocationRecord[]): ClinicRecord[] {
    return raws.map((r) => ({
      id: r.id,
      name: r.name,
      cityText: r.cityText,
      city: this.resolveCitySlug(r.cityText, locations) ?? '',
      stateCode: r.stateCode,
      services: r.services,
      telehealth: r.telehealth,
    }));
  }

  localClinicsInCity(clinics: ClinicRecord[], citySlug: string): ClinicRecord[] {
    return clinics.filter((c) => c.city === citySlug);
  }

  telehealthForCity(clinics: ClinicRecord[], citySlug: string): ClinicRecord[] {
    return clinics.filter((c) => c.telehealth && c.city !== citySlug);
  }

  clinicsForService(clinics: ClinicRecord[], codes: string[]): ClinicRecord[] {
    const set = new Set(codes);
    return clinics.filter((c) => c.services.some((code) => set.has(code)));
  }

  clinicsForCombo(clinics: ClinicRecord[], citySlug: string, codes: string[]): ClinicRecord[] {
    const set = new Set(codes);
    return clinics.filter((c) => c.city === citySlug && c.services.some((code) => set.has(code)));
  }

  cityPublished(location: LocationRecord, clinics: ClinicRecord[], minClinics: number): boolean {
    return (
      location.status === 'available' &&
      this.localClinicsInCity(clinics, location.slug).length >= minClinics
    );
  }

  servicePublished(
    service: ServiceRecord,
    clinics: ClinicRecord[],
    codes: string[],
    minClinics: number,
  ): boolean {
    return (
      service.status === 'active' && this.clinicsForService(clinics, codes).length >= minClinics
    );
  }

  comboPublished(
    location: LocationRecord,
    service: ServiceRecord,
    clinics: ClinicRecord[],
    codes: string[],
    minClinics: number,
  ): boolean {
    return (
      location.status === 'available' &&
      service.status === 'active' &&
      this.clinicsForCombo(clinics, location.slug, codes).length >= minClinics
    );
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- coverage.service`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
git add src/modules/localization/domain/coverage.types.ts src/modules/localization/domain/coverage.service.ts src/modules/localization/domain/coverage.service.spec.ts
git commit -m "feat(localization): pure coverage domain service with unit tests"
```

---

### Task 3: Seed script + data

**Files:**

- Create: `src/modules/localization/domain/localization-seed-data.ts` (shared constants, imported by seed + tests)
- Create: `prisma/seed/localization.seed.ts`
- Modify: `package.json` (add `seed:localization` script)
- Test: `test/localization/localization-seed.int-spec.ts`

**Interfaces:**

- Produces `CITY_SEED`, `SERVICE_SEED`, `SERVICE_CODE_MAP` constants, and exported async `seedLocalization(prisma: PrismaClient): Promise<void>` (idempotent).

- [ ] **Step 1: Write the seed data constants**

Create `src/modules/localization/domain/localization-seed-data.ts` with the full canonical data from the "Canonical data" section above:

```ts
export interface CitySeed {
  slug: string;
  name: string;
  status: 'available' | 'coming_soon' | 'hidden';
  area: string;
  aliases: string[];
  nearSlugs: string[];
}
export interface ServiceSeed {
  slug: string;
  name: string;
  description: string;
  relatedSlugs: string[];
  codes: string[];
}

export const CITY_SEED: CitySeed[] = [
  {
    slug: 'tampa',
    name: 'Tampa',
    status: 'available',
    area: 'South Tampa, Westshore and Downtown',
    aliases: [],
    nearSlugs: ['st-petersburg', 'bradenton', 'sarasota'],
  },
  {
    slug: 'st-petersburg',
    name: 'St. Petersburg',
    status: 'available',
    area: 'Downtown St. Petersburg and the Old Northeast',
    aliases: ['stpete', 'saintpetersburg', 'stpetersburg', 'saintpete'],
    nearSlugs: ['tampa', 'bradenton', 'sarasota'],
  },
  {
    slug: 'jacksonville',
    name: 'Jacksonville',
    status: 'available',
    area: 'Riverside, San Marco, Southside and the Beaches',
    aliases: ['jax'],
    nearSlugs: ['tampa', 'st-petersburg'],
  },
  {
    slug: 'miami',
    name: 'Miami',
    status: 'available',
    area: 'Brickell, Midtown, Coral Gables and Coconut Grove',
    aliases: [],
    nearSlugs: ['fort-lauderdale', 'naples'],
  },
  {
    slug: 'fort-lauderdale',
    name: 'Fort Lauderdale',
    status: 'available',
    area: 'Las Olas, Victoria Park and Harbor Beach',
    aliases: ['ftlauderdale', 'ftl'],
    nearSlugs: ['miami', 'naples'],
  },
  {
    slug: 'fort-myers',
    name: 'Fort Myers',
    status: 'available',
    area: 'McGregor and South Fort Myers',
    aliases: ['ftmyers'],
    nearSlugs: ['naples', 'sarasota'],
  },
  {
    slug: 'sarasota',
    name: 'Sarasota',
    status: 'available',
    area: 'Downtown Sarasota and Siesta Key',
    aliases: [],
    nearSlugs: ['bradenton', 'st-petersburg', 'fort-myers'],
  },
  {
    slug: 'naples',
    name: 'Naples',
    status: 'coming_soon',
    area: 'Old Naples and Pelican Bay',
    aliases: [],
    nearSlugs: ['fort-myers', 'miami'],
  },
  {
    slug: 'bradenton',
    name: 'Bradenton',
    status: 'available',
    area: 'Downtown Bradenton and the Riverwalk',
    aliases: [],
    nearSlugs: ['sarasota', 'tampa', 'st-petersburg'],
  },
];

export const SERVICE_SEED: ServiceSeed[] = [
  {
    slug: 'hormone-optimization',
    name: 'Hormone Optimization',
    description:
      'Clinics that evaluate and manage hormone levels, typically starting with lab work and continuing with monitoring by a licensed clinician.',
    relatedSlugs: ['sexual-health', 'longevity-anti-aging', 'metabolic-health'],
    codes: ['trt', 'bhrt', 'menopause_hrt'],
  },
  {
    slug: 'peptide-metabolic-therapy',
    name: 'Peptide & Metabolic Therapy',
    description:
      'Clinician supervised programs that use prescribed peptides as part of a broader metabolic or recovery plan.',
    relatedSlugs: ['metabolic-health', 'weight-loss-medicine', 'biohacking-performance'],
    codes: [
      'peptide_anti_aging',
      'peptide_weight_loss',
      'muscle_repair',
      'energy_clarity',
      'muscle_growth',
    ],
  },
  {
    slug: 'med-spa-aesthetics',
    name: 'Med Spa & Aesthetics',
    description:
      'Non-surgical aesthetic treatments such as injectables and skin procedures, performed or supervised by licensed providers.',
    relatedSlugs: ['regenerative-medicine', 'iv-infusion-therapy', 'longevity-anti-aging'],
    codes: [
      'injectables',
      'skin_rejuvenation',
      'laser',
      'body_contouring',
      'facials',
      'microneedling',
      'chemical_peels',
    ],
  },
  {
    slug: 'functional-medicine',
    name: 'Functional Medicine',
    description:
      'An approach that looks at history, lifestyle and lab work together to build an individualized care plan.',
    relatedSlugs: ['metabolic-health', 'longevity-anti-aging', 'hormone-optimization'],
    codes: ['gi_rehab', 'micronutrient_testing'],
  },
  {
    slug: 'metabolic-health',
    name: 'Metabolic Health',
    description:
      'Programs focused on markers like blood sugar, weight and energy, usually combining labs, nutrition and clinical follow up.',
    relatedSlugs: ['weight-loss-medicine', 'peptide-metabolic-therapy', 'functional-medicine'],
    codes: ['weight_management', 'micronutrient_testing', 'energy_clarity'],
  },
  {
    slug: 'iv-infusion-therapy',
    name: 'IV & Infusion Therapy',
    description:
      'Intravenous fluids and nutrients administered in a clinical setting under licensed supervision.',
    relatedSlugs: ['biohacking-performance', 'functional-medicine', 'longevity-anti-aging'],
    codes: ['iv_therapy', 'vitamin_injections'],
  },
  {
    slug: 'weight-loss-medicine',
    name: 'Weight Loss Medicine',
    description:
      'Medically supervised weight management, which may include prescriptions, nutrition support and regular check-ins.',
    relatedSlugs: ['metabolic-health', 'peptide-metabolic-therapy', 'hormone-optimization'],
    codes: ['weight_loss', 'peptide_weight_loss', 'weight_management'],
  },
  {
    slug: 'longevity-anti-aging',
    name: 'Longevity & Anti-Aging',
    description:
      'Preventive programs built around tracking health markers over time and adjusting care based on results.',
    relatedSlugs: ['hormone-optimization', 'biohacking-performance', 'functional-medicine'],
    codes: ['peptide_anti_aging', 'bhrt', 'micronutrient_testing'],
  },
  {
    slug: 'sexual-health',
    name: 'Sexual Health',
    description:
      'Confidential evaluation of sexual health concerns and treatment options with a licensed clinician.',
    relatedSlugs: ['hormone-optimization', 'longevity-anti-aging', 'metabolic-health'],
    codes: ['ed', 'trt', 'menopause_hrt'],
  },
  {
    slug: 'regenerative-medicine',
    name: 'Regenerative Medicine',
    description:
      "Treatments intended to support the body's own repair processes, offered in a clinical setting.",
    relatedSlugs: ['med-spa-aesthetics', 'biohacking-performance', 'iv-infusion-therapy'],
    codes: ['muscle_repair'],
  },
  {
    slug: 'biohacking-performance',
    name: 'Biohacking & Performance',
    description:
      'Performance focused programs combining testing, recovery and lifestyle protocols under clinical guidance.',
    relatedSlugs: ['longevity-anti-aging', 'iv-infusion-therapy', 'peptide-metabolic-therapy'],
    codes: ['energy_clarity', 'muscle_growth', 'muscle_repair'],
  },
];

export function citySeoTitle(name: string): string {
  return `Specialized Clinics in ${name}, FL | MedAlign`;
}
export function citySeoDescription(name: string): string {
  return `Find active, vetted clinics in ${name}, Florida. Compare services and get matched on your goals.`;
}
export function cityIntro(area: string): string {
  return `MedAlign lists active clinics serving ${area}. Compare the services each one offers and take the next step when you are ready.`;
}
export function serviceSeoTitle(name: string): string {
  return `${name} Clinics in Florida | MedAlign`;
}
export function serviceSeoDescription(desc: string): string {
  return desc.length <= 155 ? desc : desc.slice(0, 152) + '...';
}
```

- [ ] **Step 2: Write the seed function**

Create `prisma/seed/localization.seed.ts` (idempotent upsert by slug; join rows via delete-then-createMany in `$transaction`, following `patient-journey.seed.ts`):

```ts
import { PrismaClient } from '../../generated/prisma/client';
import {
  CITY_SEED,
  SERVICE_SEED,
  citySeoTitle,
  citySeoDescription,
  cityIntro,
  serviceSeoTitle,
  serviceSeoDescription,
} from '../../src/modules/localization/domain/localization-seed-data';

export async function seedLocalization(prisma: PrismaClient): Promise<void> {
  // Setting (singleton).
  await prisma.localizationSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', minClinics: 2 },
  });

  // Cities.
  for (let i = 0; i < CITY_SEED.length; i++) {
    const c = CITY_SEED[i];
    const data = {
      name: c.name,
      stateCode: 'FL',
      status: c.status,
      area: c.area,
      intro: cityIntro(c.area),
      seoTitle: citySeoTitle(c.name),
      seoDescription: citySeoDescription(c.name),
      displayOrder: i,
    };
    const location = await prisma.location.upsert({
      where: { slug: c.slug },
      update: data,
      create: { slug: c.slug, ...data },
    });
    await prisma.$transaction([
      prisma.locationAlias.deleteMany({ where: { locationId: location.id } }),
      prisma.locationAlias.createMany({
        data: c.aliases.map((alias) => ({ locationId: location.id, alias })),
      }),
      prisma.locationNear.deleteMany({ where: { locationId: location.id } }),
      prisma.locationNear.createMany({
        data: c.nearSlugs.map((nearSlug, order) => ({
          locationId: location.id,
          nearSlug,
          displayOrder: order,
        })),
      }),
    ]);
  }

  // Services + mapping + related.
  for (let i = 0; i < SERVICE_SEED.length; i++) {
    const s = SERVICE_SEED[i];
    const data = {
      name: s.name,
      description: s.description,
      status: 'active',
      seoTitle: serviceSeoTitle(s.name),
      seoDescription: serviceSeoDescription(s.description),
      displayOrder: i,
    };
    const service = await prisma.marketingService.upsert({
      where: { slug: s.slug },
      update: data,
      create: { slug: s.slug, ...data },
    });
    await prisma.$transaction([
      prisma.marketingServiceCode.deleteMany({ where: { marketingServiceId: service.id } }),
      prisma.marketingServiceCode.createMany({
        data: s.codes.map((serviceCode) => ({ marketingServiceId: service.id, serviceCode })),
      }),
      prisma.marketingServiceRelated.deleteMany({ where: { marketingServiceId: service.id } }),
      prisma.marketingServiceRelated.createMany({
        data: s.relatedSlugs.map((relatedSlug, order) => ({
          marketingServiceId: service.id,
          relatedSlug,
          displayOrder: order,
        })),
      }),
    ]);
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedLocalization(prisma);
    // eslint-disable-next-line no-console
    console.log('Localization seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

// Run directly (ts-node) but not when imported by tests.
if (require.main === module) {
  void main();
}
```

- [ ] **Step 3: Add the package.json script**

In `package.json` `scripts`, add (next to the other `seed:*` scripts):

```json
"seed:localization": "ts-node -r dotenv/config -P tsconfig.json prisma/seed/localization.seed.ts",
```

- [ ] **Step 4: Write the failing integration test**

Create `test/localization/localization-seed.int-spec.ts`:

```ts
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { seedLocalization } from '../../prisma/seed/localization.seed';

describe('seedLocalization', () => {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  beforeAll(async () => {
    await seedLocalization(prisma);
    await seedLocalization(prisma); // idempotent: run twice
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it('seeds 9 cities with Naples coming_soon', async () => {
    const cities = await prisma.location.findMany();
    expect(cities).toHaveLength(9);
    expect(cities.find((c) => c.slug === 'naples')?.status).toBe('coming_soon');
  });

  it('seeds 11 services and maps hormone-optimization to trt/bhrt/menopause_hrt', async () => {
    const services = await prisma.marketingService.findMany();
    expect(services).toHaveLength(11);
    const hormone = services.find((s) => s.slug === 'hormone-optimization');
    const codes = await prisma.marketingServiceCode.findMany({
      where: { marketingServiceId: hormone!.id },
    });
    expect(codes.map((c) => c.serviceCode).sort()).toEqual(['bhrt', 'menopause_hrt', 'trt']);
  });

  it('does not duplicate alias rows when run twice', async () => {
    const stpete = await prisma.location.findUnique({ where: { slug: 'st-petersburg' } });
    const aliases = await prisma.locationAlias.findMany({ where: { locationId: stpete!.id } });
    expect(aliases).toHaveLength(4);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails, implement already done, then passes**

Run: `pnpm test:int -- localization-seed`
Expected: FAIL before Steps 1-2 exist, PASS after (idempotent, counts correct).

- [ ] **Step 6: Commit**

```bash
git add src/modules/localization/domain/localization-seed-data.ts prisma/seed/localization.seed.ts package.json test/localization/localization-seed.int-spec.ts
git commit -m "feat(localization): seed data + idempotent localization seed script"
```

---

### Task 4: Repository port + Prisma repository

**Files:**

- Create: `src/modules/localization/domain/ports/localization-repository.port.ts`
- Create: `src/modules/localization/infrastructure/prisma-localization.repository.ts`
- Test: `test/localization/localization-repository.int-spec.ts`

**Interfaces:**

- Consumes: `RawClinicRecord`, `LocationRecord`, `ServiceRecord`, `ServiceCodeMap` (Task 2).
- Produces: `LocalizationRepositoryPort` + `LOCALIZATION_REPOSITORY` Symbol with methods:
  - `loadActiveClinics(): Promise<RawClinicRecord[]>`
  - `getLocations(includeHidden: boolean): Promise<LocationRecord[]>`
  - `getLocationBySlug(slug: string): Promise<LocationRecord | null>`
  - `getServices(includeHidden: boolean): Promise<ServiceRecord[]>`
  - `getServiceBySlug(slug: string): Promise<ServiceRecord | null>`
  - `getServiceCodeMap(): Promise<ServiceCodeMap>`
  - `getMinClinics(): Promise<number>`
  - `insertNotify(email: string, citySlug: string | null): Promise<void>`

- [ ] **Step 1: Write the port**

Create `src/modules/localization/domain/ports/localization-repository.port.ts`:

```ts
import type {
  LocationRecord,
  RawClinicRecord,
  ServiceCodeMap,
  ServiceRecord,
} from '../coverage.types';

export interface LocalizationRepositoryPort {
  loadActiveClinics(): Promise<RawClinicRecord[]>;
  getLocations(includeHidden: boolean): Promise<LocationRecord[]>;
  getLocationBySlug(slug: string): Promise<LocationRecord | null>;
  getServices(includeHidden: boolean): Promise<ServiceRecord[]>;
  getServiceBySlug(slug: string): Promise<ServiceRecord | null>;
  getServiceCodeMap(): Promise<ServiceCodeMap>;
  getMinClinics(): Promise<number>;
  insertNotify(email: string, citySlug: string | null): Promise<void>;
}

export const LOCALIZATION_REPOSITORY = Symbol('LocalizationRepositoryPort');
```

- [ ] **Step 2: Write the Prisma repository**

Create `src/modules/localization/infrastructure/prisma-localization.repository.ts`. All reads go through `this.prisma.asSystem(...)`; aliases/near/related are aggregated in SQL with `array_agg`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { LocalizationRepositoryPort } from '../domain/ports/localization-repository.port';
import type {
  LocationRecord,
  LocationStatus,
  RawClinicRecord,
  ServiceCodeMap,
  ServiceRecord,
  ServiceStatus,
} from '../domain/coverage.types';

interface LocationRow {
  slug: string;
  name: string;
  stateCode: string;
  status: string;
  area: string;
  intro: string;
  seoTitle: string;
  seoDescription: string;
  displayOrder: number;
  aliases: string[] | null;
  nearSlugs: string[] | null;
}
interface ServiceRow {
  slug: string;
  name: string;
  description: string;
  status: string;
  seoTitle: string;
  seoDescription: string;
  displayOrder: number;
  relatedSlugs: string[] | null;
}
interface ClinicRow {
  id: string;
  name: string;
  cityText: string | null;
  stateCode: string | null;
  telehealth: boolean;
  services: string[] | null;
}

@Injectable()
export class PrismaLocalizationRepository implements LocalizationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async loadActiveClinics(): Promise<RawClinicRecord[]> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<ClinicRow[]>`
        SELECT c.id,
               c.name,
               c.city           AS "cityText",
               c.state_code     AS "stateCode",
               c.telehealth_available AS "telehealth",
               array_remove(array_agg(cs.service_code), NULL) AS "services"
          FROM clinics c
          LEFT JOIN clinic_services cs ON cs.clinic_id = c.id
         WHERE c.status = 'active'
           AND c.is_listed_in_directory = true
           AND c.billing_status NOT IN ('no_card','overdue')
         GROUP BY c.id`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      cityText: r.cityText ?? '',
      stateCode: r.stateCode ?? '',
      services: r.services ?? [],
      telehealth: r.telehealth,
    }));
  }

  async getLocations(includeHidden: boolean): Promise<LocationRecord[]> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<LocationRow[]>`
        SELECT l.slug, l.name, l.state_code AS "stateCode", l.status,
               l.area, l.intro, l.seo_title AS "seoTitle", l.seo_description AS "seoDescription",
               l.display_order AS "displayOrder",
               (SELECT array_agg(a.alias) FROM location_alias a WHERE a.location_id = l.id) AS "aliases",
               (SELECT array_agg(n.near_slug ORDER BY n.display_order) FROM location_near n WHERE n.location_id = l.id) AS "nearSlugs"
          FROM location l
         ${includeHidden ? this.prisma.empty : this.prisma.notHidden('l')}
         ORDER BY l.display_order`,
    );
    return rows.map((r) => this.toLocation(r));
  }

  async getLocationBySlug(slug: string): Promise<LocationRecord | null> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<LocationRow[]>`
        SELECT l.slug, l.name, l.state_code AS "stateCode", l.status,
               l.area, l.intro, l.seo_title AS "seoTitle", l.seo_description AS "seoDescription",
               l.display_order AS "displayOrder",
               (SELECT array_agg(a.alias) FROM location_alias a WHERE a.location_id = l.id) AS "aliases",
               (SELECT array_agg(n.near_slug ORDER BY n.display_order) FROM location_near n WHERE n.location_id = l.id) AS "nearSlugs"
          FROM location l
         WHERE l.slug = ${slug} AND l.status <> 'hidden'
         LIMIT 1`,
    );
    return rows[0] ? this.toLocation(rows[0]) : null;
  }

  async getServices(includeHidden: boolean): Promise<ServiceRecord[]> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<ServiceRow[]>`
        SELECT s.slug, s.name, s.description, s.status,
               s.seo_title AS "seoTitle", s.seo_description AS "seoDescription", s.display_order AS "displayOrder",
               (SELECT array_agg(r.related_slug ORDER BY r.display_order) FROM marketing_service_related r WHERE r.marketing_service_id = s.id) AS "relatedSlugs"
          FROM marketing_service s
         ${includeHidden ? this.prisma.empty : this.prisma.activeOnly('s')}
         ORDER BY s.display_order`,
    );
    return rows.map((r) => this.toService(r));
  }

  async getServiceBySlug(slug: string): Promise<ServiceRecord | null> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<ServiceRow[]>`
        SELECT s.slug, s.name, s.description, s.status,
               s.seo_title AS "seoTitle", s.seo_description AS "seoDescription", s.display_order AS "displayOrder",
               (SELECT array_agg(r.related_slug ORDER BY r.display_order) FROM marketing_service_related r WHERE r.marketing_service_id = s.id) AS "relatedSlugs"
          FROM marketing_service s
         WHERE s.slug = ${slug} AND s.status <> 'hidden'
         LIMIT 1`,
    );
    return rows[0] ? this.toService(rows[0]) : null;
  }

  async getServiceCodeMap(): Promise<ServiceCodeMap> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<{ slug: string; serviceCode: string }[]>`
        SELECT s.slug, msc.service_code AS "serviceCode"
          FROM marketing_service s
          JOIN marketing_service_code msc ON msc.marketing_service_id = s.id`,
    );
    const map: ServiceCodeMap = {};
    for (const r of rows) {
      (map[r.slug] ??= []).push(r.serviceCode);
    }
    return map;
  }

  async getMinClinics(): Promise<number> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<{ minClinics: number }[]>`
        SELECT min_clinics AS "minClinics" FROM localization_setting WHERE id = 'default' LIMIT 1`,
    );
    return rows[0] ? Number(rows[0].minClinics) : 2;
  }

  async insertNotify(email: string, citySlug: string | null): Promise<void> {
    await this.prisma.asSystem(
      (c) =>
        c.$executeRaw`INSERT INTO location_notify (email, city_slug) VALUES (${email}, ${citySlug})`,
    );
  }

  private toLocation(r: LocationRow): LocationRecord {
    return {
      slug: r.slug,
      name: r.name,
      stateCode: r.stateCode,
      status: r.status as LocationStatus,
      area: r.area,
      intro: r.intro,
      aliases: r.aliases ?? [],
      nearSlugs: r.nearSlugs ?? [],
      seoTitle: r.seoTitle,
      seoDescription: r.seoDescription,
      displayOrder: Number(r.displayOrder),
    };
  }

  private toService(r: ServiceRow): ServiceRecord {
    return {
      slug: r.slug,
      name: r.name,
      description: r.description,
      status: r.status as ServiceStatus,
      relatedSlugs: r.relatedSlugs ?? [],
      seoTitle: r.seoTitle,
      seoDescription: r.seoDescription,
      displayOrder: Number(r.displayOrder),
    };
  }
}
```

Note: the repository uses two tiny SQL fragment helpers to keep the hidden-filter readable. Add them to `PrismaService` in Step 2b.

- [ ] **Step 2b: Add SQL fragment helpers to PrismaService**

In `src/infrastructure/prisma/prisma.service.ts`, import `Prisma` from the generated client (if not already) and add:

```ts
readonly empty = Prisma.empty;
notHidden(alias: string): Prisma.Sql {
  return Prisma.sql`WHERE ${Prisma.raw(alias)}.status <> 'hidden'`;
}
activeOnly(alias: string): Prisma.Sql {
  return Prisma.sql`WHERE ${Prisma.raw(alias)}.status = 'active'`;
}
```

(If exposing helpers on `PrismaService` is undesirable, inline the fragments in the repository instead using a local `const notHidden = includeHidden ? Prisma.empty : Prisma.sql\`WHERE l.status <> 'hidden'\``. Either is acceptable; keep it in one place.)

- [ ] **Step 3: Write the failing integration test**

Create `test/localization/localization-repository.int-spec.ts`:

```ts
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { seedLocalization } from '../../prisma/seed/localization.seed';
import { PrismaLocalizationRepository } from '../../src/modules/localization/infrastructure/prisma-localization.repository';

describe('PrismaLocalizationRepository', () => {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });
  let prisma: PrismaService;
  let repo: PrismaLocalizationRepository;

  beforeAll(async () => {
    await seedLocalization(seedPrisma);
    prisma = new PrismaService();
    await prisma.onModuleInit();
    repo = new PrismaLocalizationRepository(prisma);
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  it('getLocations(false) excludes hidden and returns aliases + nearSlugs', async () => {
    const cities = await repo.getLocations(false);
    const stpete = cities.find((c) => c.slug === 'st-petersburg');
    expect(stpete?.aliases).toContain('jax' as never); // sanity: alias arrays populate
    expect(stpete?.nearSlugs[0]).toBe('tampa');
    expect(cities.every((c) => c.status !== 'hidden')).toBe(true);
  });

  it('getServiceCodeMap resolves the hormone mapping', async () => {
    const map = await repo.getServiceCodeMap();
    expect([...map['hormone-optimization']].sort()).toEqual(['bhrt', 'menopause_hrt', 'trt']);
  });

  it('getMinClinics returns the seeded default', async () => {
    expect(await repo.getMinClinics()).toBe(2);
  });

  it('insertNotify stores a row', async () => {
    await repo.insertNotify('test@example.com', 'orlando');
    const rows = await prisma.asSystem(
      (c) =>
        c.$queryRaw<
          { email: string }[]
        >`SELECT email FROM location_notify WHERE email = 'test@example.com'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
```

Fix the alias assertion to a correct one before running (st-petersburg aliases are `stpete` etc., not `jax`):

```ts
expect(stpete?.aliases).toContain('stpete');
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:int -- localization-repository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/localization/domain/ports/localization-repository.port.ts src/modules/localization/infrastructure/prisma-localization.repository.ts src/infrastructure/prisma/prisma.service.ts test/localization/localization-repository.int-spec.ts
git commit -m "feat(localization): repository port + prisma repository with coverage reads"
```

---

### Task 5: Response DTOs + use-cases

**Files:**

- Create: `src/modules/localization/domain/localization.dto.ts`
- Create: `src/modules/localization/application/get-cities.use-case.ts`
- Create: `src/modules/localization/application/get-city.use-case.ts`
- Create: `src/modules/localization/application/get-services.use-case.ts`
- Create: `src/modules/localization/application/get-service.use-case.ts`
- Create: `src/modules/localization/application/get-combo.use-case.ts`
- Create: `src/modules/localization/application/get-coverage.use-case.ts`
- Create: `src/modules/localization/application/capture-notify.use-case.ts`
- Test: `src/modules/localization/application/__tests__/get-city.use-case.spec.ts`
- Test: `src/modules/localization/application/__tests__/get-coverage.use-case.spec.ts`
- Test: `src/modules/localization/application/__tests__/capture-notify.use-case.spec.ts`

**Interfaces:**

- Consumes: `LOCALIZATION_REPOSITORY`/`LocalizationRepositoryPort` (Task 4), `CoverageService` (Task 2).
- Produces the DTO classes and `@Injectable()` use-cases consumed by the controller (Task 6): `GetCitiesUseCase.execute()`, `GetCityUseCase.execute(slug)`, `GetServicesUseCase.execute()`, `GetServiceUseCase.execute(slug)`, `GetComboUseCase.execute(citySlug, serviceSlug)`, `GetCoverageUseCase.execute()`, `CaptureNotifyUseCase.execute({ email, citySlug })`.

- [ ] **Step 1: Write the DTOs**

Create `src/modules/localization/domain/localization.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class MetaDto {
  @ApiProperty() path!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() robots!: boolean;
}

export class ClinicListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() address!: string;
  @ApiProperty({ type: [String] }) services!: string[];
  @ApiProperty() telehealth!: boolean;
}

export class NamedCountDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() count!: number;
}

export class CityListItemDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() status!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty() clinicCount!: number;
}

export class CityListDto {
  @ApiProperty({ type: [CityListItemDto] }) cities!: CityListItemDto[];
}

export class CityDetailDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() status!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty() area!: string;
  @ApiProperty() intro!: string;
  @ApiProperty({ type: [ClinicListItemDto] }) clinics!: ClinicListItemDto[];
  @ApiProperty({ type: [ClinicListItemDto] }) telehealthClinics!: ClinicListItemDto[];
  @ApiProperty({ type: [NamedCountDto] }) services!: NamedCountDto[];
  @ApiProperty({ type: [NamedCountDto] }) nearbyCities!: NamedCountDto[];
  @ApiProperty({ type: MetaDto }) meta!: MetaDto;
}

export class ServiceListItemDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty() cityCount!: number;
}

export class ServiceListDto {
  @ApiProperty({ type: [ServiceListItemDto] }) services!: ServiceListItemDto[];
}

export class ServiceDetailDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty({ type: [ClinicListItemDto] }) clinics!: ClinicListItemDto[];
  @ApiProperty({ type: [NamedCountDto] }) cities!: NamedCountDto[];
  @ApiProperty({ type: [NamedCountDto] }) relatedServices!: NamedCountDto[];
  @ApiProperty({ type: MetaDto }) meta!: MetaDto;
}

export class ComboDetailDto {
  @ApiProperty() citySlug!: string;
  @ApiProperty() serviceSlug!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty({ type: [ClinicListItemDto] }) clinics!: ClinicListItemDto[];
  @ApiProperty({ type: [ClinicListItemDto] }) nearbyClinics!: ClinicListItemDto[];
  @ApiProperty({ type: MetaDto }) meta!: MetaDto;
}

export class CoverageCellDto {
  @ApiProperty() citySlug!: string;
  @ApiProperty() count!: number;
  @ApiProperty() state!: string; // published | below_threshold | none
}

export class CoverageRowDto {
  @ApiProperty() serviceSlug!: string;
  @ApiProperty() serviceName!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty({ type: [CoverageCellDto] }) cells!: CoverageCellDto[];
}

export class CoverageDto {
  @ApiProperty() minClinics!: number;
  @ApiProperty({ type: [CityListItemDto] }) cities!: CityListItemDto[];
  @ApiProperty({ type: [CoverageRowDto] }) matrix!: CoverageRowDto[];
}

export class NotifyResponseDto {
  @ApiProperty() ok!: boolean;
}
```

- [ ] **Step 2: Write the failing use-case tests**

Create `src/modules/localization/application/__tests__/get-city.use-case.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { GetCityUseCase } from '../get-city.use-case';
import { CoverageService } from '../../domain/coverage.service';
import type { LocalizationRepositoryPort } from '../../domain/ports/localization-repository.port';
import type { LocationRecord, RawClinicRecord } from '../../domain/coverage.types';

const TAMPA: LocationRecord = {
  slug: 'tampa',
  name: 'Tampa',
  stateCode: 'FL',
  status: 'available',
  area: 'South Tampa',
  intro: 'intro',
  aliases: [],
  nearSlugs: [],
  seoTitle: 'Specialized Clinics in Tampa, FL | MedAlign',
  seoDescription: 'desc',
  displayOrder: 0,
};
const clinic = (id: string, city: string, services: string[]): RawClinicRecord => ({
  id,
  name: id,
  cityText: city,
  stateCode: 'FL',
  services,
  telehealth: false,
});

function makeRepo(over: Partial<LocalizationRepositoryPort> = {}): LocalizationRepositoryPort {
  return {
    loadActiveClinics: jest
      .fn()
      .mockResolvedValue([clinic('a', 'Tampa', ['trt']), clinic('b', 'Tampa', ['bhrt'])]),
    getLocations: jest.fn().mockResolvedValue([TAMPA]),
    getLocationBySlug: jest.fn().mockResolvedValue(TAMPA),
    getServices: jest.fn().mockResolvedValue([]),
    getServiceBySlug: jest.fn().mockResolvedValue(null),
    getServiceCodeMap: jest
      .fn()
      .mockResolvedValue({ 'hormone-optimization': ['trt', 'bhrt', 'menopause_hrt'] }),
    getMinClinics: jest.fn().mockResolvedValue(2),
    insertNotify: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('GetCityUseCase', () => {
  it('returns published city with meta.robots true when count >= min', async () => {
    const useCase = new GetCityUseCase(makeRepo(), new CoverageService());
    const result = await useCase.execute('tampa');
    expect(result.published).toBe(true);
    expect(result.meta.robots).toBe(true);
    expect(result.meta.path).toBe('/locations/tampa/');
    expect(result.clinics).toHaveLength(2);
  });

  it('returns published false + robots false when below threshold', async () => {
    const repo = makeRepo({
      loadActiveClinics: jest.fn().mockResolvedValue([clinic('a', 'Tampa', ['trt'])]),
    });
    const result = await new GetCityUseCase(repo, new CoverageService()).execute('tampa');
    expect(result.published).toBe(false);
    expect(result.meta.robots).toBe(false);
  });

  it('throws NotFound for a hidden/unknown city', async () => {
    const repo = makeRepo({ getLocationBySlug: jest.fn().mockResolvedValue(null) });
    await expect(
      new GetCityUseCase(repo, new CoverageService()).execute('nowhere'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

Create `src/modules/localization/application/__tests__/capture-notify.use-case.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { CaptureNotifyUseCase } from '../capture-notify.use-case';
import type { LocalizationRepositoryPort } from '../../domain/ports/localization-repository.port';

function makeRepo(): LocalizationRepositoryPort {
  return {
    loadActiveClinics: jest.fn(),
    getLocations: jest.fn(),
    getLocationBySlug: jest.fn(),
    getServices: jest.fn(),
    getServiceBySlug: jest.fn(),
    getServiceCodeMap: jest.fn(),
    getMinClinics: jest.fn(),
    insertNotify: jest.fn().mockResolvedValue(undefined),
  };
}

describe('CaptureNotifyUseCase', () => {
  it('rejects an invalid email', async () => {
    await expect(
      new CaptureNotifyUseCase(makeRepo()).execute({ email: 'nope', citySlug: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores a valid email and returns ok', async () => {
    const repo = makeRepo();
    const result = await new CaptureNotifyUseCase(repo).execute({
      email: 'a@b.com',
      citySlug: 'orlando',
    });
    expect(result).toEqual({ ok: true });
    expect(repo.insertNotify).toHaveBeenCalledWith('a@b.com', 'orlando');
  });
});
```

Create `src/modules/localization/application/__tests__/get-coverage.use-case.spec.ts`:

```ts
import { GetCoverageUseCase } from '../get-coverage.use-case';
import { CoverageService } from '../../domain/coverage.service';
import type { LocalizationRepositoryPort } from '../../domain/ports/localization-repository.port';
import type { LocationRecord, RawClinicRecord, ServiceRecord } from '../../domain/coverage.types';

const TAMPA: LocationRecord = {
  slug: 'tampa',
  name: 'Tampa',
  stateCode: 'FL',
  status: 'available',
  area: '',
  intro: '',
  aliases: [],
  nearSlugs: [],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 0,
};
const HORMONE: ServiceRecord = {
  slug: 'hormone-optimization',
  name: 'Hormone Optimization',
  description: '',
  status: 'active',
  relatedSlugs: [],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 0,
};
const clinic = (id: string, city: string, services: string[]): RawClinicRecord => ({
  id,
  name: id,
  cityText: city,
  stateCode: 'FL',
  services,
  telehealth: false,
});

describe('GetCoverageUseCase', () => {
  it('builds a matrix cell marked published when count >= min', async () => {
    const repo: LocalizationRepositoryPort = {
      loadActiveClinics: jest
        .fn()
        .mockResolvedValue([clinic('a', 'Tampa', ['trt']), clinic('b', 'Tampa', ['bhrt'])]),
      getLocations: jest.fn().mockResolvedValue([TAMPA]),
      getLocationBySlug: jest.fn(),
      getServiceBySlug: jest.fn(),
      getServices: jest.fn().mockResolvedValue([HORMONE]),
      getServiceCodeMap: jest.fn().mockResolvedValue({ 'hormone-optimization': ['trt', 'bhrt'] }),
      getMinClinics: jest.fn().mockResolvedValue(2),
      insertNotify: jest.fn(),
    };
    const result = await new GetCoverageUseCase(repo, new CoverageService()).execute();
    expect(result.minClinics).toBe(2);
    const cell = result.matrix[0].cells.find((c) => c.citySlug === 'tampa');
    expect(cell?.count).toBe(2);
    expect(cell?.state).toBe('published');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test -- localization`
Expected: FAIL (use-cases not found).

- [ ] **Step 4: Write the use-cases**

Create `src/modules/localization/application/get-city.use-case.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CoverageService } from '../domain/coverage.service';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { ClinicRecord, LocationRecord } from '../domain/coverage.types';
import type { CityDetailDto, ClinicListItemDto, NamedCountDto } from '../domain/localization.dto';

@Injectable()
export class GetCityUseCase {
  constructor(
    @Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort,
    private readonly coverage: CoverageService,
  ) {}

  async execute(slug: string): Promise<CityDetailDto> {
    const location = await this.repo.getLocationBySlug(slug);
    if (!location) throw new NotFoundException(`No city '${slug}'`);

    const [raws, locations, services, codeMap, minClinics] = await Promise.all([
      this.repo.loadActiveClinics(),
      this.repo.getLocations(true),
      this.repo.getServices(false),
      this.repo.getServiceCodeMap(),
      this.repo.getMinClinics(),
    ]);
    const clinics = this.coverage.toClinicRecords(raws, locations);
    const local = this.coverage.localClinicsInCity(clinics, location.slug);
    const telehealth = this.coverage.telehealthForCity(clinics, location.slug);
    const published = this.coverage.cityPublished(location, clinics, minClinics);

    const serviceCounts: NamedCountDto[] = services
      .map((s) => ({
        slug: s.slug,
        name: s.name,
        count: this.coverage.clinicsForCombo(clinics, location.slug, codeMap[s.slug] ?? []).length,
      }))
      .filter((x) => x.count > 0);

    const nearby: NamedCountDto[] = location.nearSlugs
      .map((ns) => locations.find((l) => l.slug === ns))
      .filter(
        (l): l is LocationRecord => !!l && this.coverage.cityPublished(l, clinics, minClinics),
      )
      .map((l) => ({
        slug: l.slug,
        name: l.name,
        count: this.coverage.localClinicsInCity(clinics, l.slug).length,
      }));

    return {
      slug: location.slug,
      name: location.name,
      status: location.status,
      published,
      area: location.area,
      intro: location.intro,
      clinics: local.map(toClinicDto),
      telehealthClinics: telehealth.map(toClinicDto),
      services: serviceCounts,
      nearbyCities: nearby,
      meta: {
        path: `/locations/${location.slug}/`,
        title: location.seoTitle,
        description: location.seoDescription,
        robots: published,
      },
    };
  }
}

export function toClinicDto(c: ClinicRecord): ClinicListItemDto {
  return {
    id: c.id,
    name: c.name,
    address: [c.cityText, c.stateCode].filter(Boolean).join(', '),
    services: c.services,
    telehealth: c.telehealth,
  };
}
```

Create `src/modules/localization/application/get-cities.use-case.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { CoverageService } from '../domain/coverage.service';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { CityListDto } from '../domain/localization.dto';

@Injectable()
export class GetCitiesUseCase {
  constructor(
    @Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort,
    private readonly coverage: CoverageService,
  ) {}

  async execute(): Promise<CityListDto> {
    const [raws, locations, minClinics] = await Promise.all([
      this.repo.loadActiveClinics(),
      this.repo.getLocations(false),
      this.repo.getMinClinics(),
    ]);
    const all = await this.repo.getLocations(true);
    const clinics = this.coverage.toClinicRecords(raws, all);
    return {
      cities: locations.map((l) => ({
        slug: l.slug,
        name: l.name,
        status: l.status,
        published: this.coverage.cityPublished(l, clinics, minClinics),
        clinicCount: this.coverage.localClinicsInCity(clinics, l.slug).length,
      })),
    };
  }
}
```

Create `src/modules/localization/application/get-services.use-case.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { CoverageService } from '../domain/coverage.service';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { ServiceListDto } from '../domain/localization.dto';

@Injectable()
export class GetServicesUseCase {
  constructor(
    @Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort,
    private readonly coverage: CoverageService,
  ) {}

  async execute(): Promise<ServiceListDto> {
    const [raws, locations, services, codeMap, minClinics] = await Promise.all([
      this.repo.loadActiveClinics(),
      this.repo.getLocations(true),
      this.repo.getServices(false),
      this.repo.getServiceCodeMap(),
      this.repo.getMinClinics(),
    ]);
    const clinics = this.coverage.toClinicRecords(raws, locations);
    return {
      services: services.map((s) => {
        const codes = codeMap[s.slug] ?? [];
        const matching = this.coverage.clinicsForService(clinics, codes);
        const cityCount = new Set(matching.map((c) => c.city).filter(Boolean)).size;
        return {
          slug: s.slug,
          name: s.name,
          description: s.description,
          published: this.coverage.servicePublished(s, clinics, codes, minClinics),
          cityCount,
        };
      }),
    };
  }
}
```

Create `src/modules/localization/application/get-service.use-case.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CoverageService } from '../domain/coverage.service';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { ServiceDetailDto, NamedCountDto } from '../domain/localization.dto';
import { toClinicDto } from './get-city.use-case';

@Injectable()
export class GetServiceUseCase {
  constructor(
    @Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort,
    private readonly coverage: CoverageService,
  ) {}

  async execute(slug: string): Promise<ServiceDetailDto> {
    const service = await this.repo.getServiceBySlug(slug);
    if (!service) throw new NotFoundException(`No service '${slug}'`);

    const [raws, locations, codeMap, minClinics] = await Promise.all([
      this.repo.loadActiveClinics(),
      this.repo.getLocations(true),
      this.repo.getServiceCodeMap(),
      this.repo.getMinClinics(),
    ]);
    const clinics = this.coverage.toClinicRecords(raws, locations);
    const codes = codeMap[service.slug] ?? [];
    const matching = this.coverage.clinicsForService(clinics, codes);
    const published = this.coverage.servicePublished(service, clinics, codes, minClinics);

    const cities: NamedCountDto[] = locations
      .filter((l) => l.status === 'available')
      .map((l) => ({
        slug: l.slug,
        name: l.name,
        count: matching.filter((c) => c.city === l.slug).length,
      }))
      .filter((x) => x.count > 0);

    const related: NamedCountDto[] = service.relatedSlugs
      .map((rs) => {
        const relCodes = codeMap[rs] ?? [];
        return {
          slug: rs,
          name: rs,
          count: this.coverage.clinicsForService(clinics, relCodes).length,
        };
      })
      .filter((x) => x.count >= minClinics);

    return {
      slug: service.slug,
      name: service.name,
      description: service.description,
      published,
      clinics: matching.map(toClinicDto),
      cities,
      relatedServices: related,
      meta: {
        path: `/services/${service.slug}/`,
        title: service.seoTitle,
        description: service.seoDescription,
        robots: published,
      },
    };
  }
}
```

Create `src/modules/localization/application/get-combo.use-case.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CoverageService } from '../domain/coverage.service';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { ComboDetailDto } from '../domain/localization.dto';
import { toClinicDto } from './get-city.use-case';

@Injectable()
export class GetComboUseCase {
  constructor(
    @Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort,
    private readonly coverage: CoverageService,
  ) {}

  async execute(citySlug: string, serviceSlug: string): Promise<ComboDetailDto> {
    const [location, service] = await Promise.all([
      this.repo.getLocationBySlug(citySlug),
      this.repo.getServiceBySlug(serviceSlug),
    ]);
    if (!location || !service) throw new NotFoundException('Unknown city or service');

    const [raws, locations, codeMap, minClinics] = await Promise.all([
      this.repo.loadActiveClinics(),
      this.repo.getLocations(true),
      this.repo.getServiceCodeMap(),
      this.repo.getMinClinics(),
    ]);
    const clinics = this.coverage.toClinicRecords(raws, locations);
    const codes = codeMap[service.slug] ?? [];
    const local = this.coverage.clinicsForCombo(clinics, location.slug, codes);
    const published = this.coverage.comboPublished(location, service, clinics, codes, minClinics);

    const nearby =
      local.length < 3
        ? location.nearSlugs.flatMap((ns) => this.coverage.clinicsForCombo(clinics, ns, codes))
        : [];

    return {
      citySlug: location.slug,
      serviceSlug: service.slug,
      published,
      clinics: local.map(toClinicDto),
      nearbyClinics: nearby.map(toClinicDto),
      meta: {
        path: `/locations/${location.slug}/${service.slug}/`,
        title: `${service.name} in ${location.name}, FL | MedAlign`,
        description: service.seoDescription,
        robots: published,
      },
    };
  }
}
```

Create `src/modules/localization/application/get-coverage.use-case.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { CoverageService } from '../domain/coverage.service';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { CoverageDto, CoverageRowDto } from '../domain/localization.dto';

@Injectable()
export class GetCoverageUseCase {
  constructor(
    @Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort,
    private readonly coverage: CoverageService,
  ) {}

  async execute(): Promise<CoverageDto> {
    const [raws, locations, services, codeMap, minClinics] = await Promise.all([
      this.repo.loadActiveClinics(),
      this.repo.getLocations(true),
      this.repo.getServices(true),
      this.repo.getServiceCodeMap(),
      this.repo.getMinClinics(),
    ]);
    const clinics = this.coverage.toClinicRecords(raws, locations);

    const cities = locations.map((l) => ({
      slug: l.slug,
      name: l.name,
      status: l.status,
      published: this.coverage.cityPublished(l, clinics, minClinics),
      clinicCount: this.coverage.localClinicsInCity(clinics, l.slug).length,
    }));

    const matrix: CoverageRowDto[] = services.map((s) => {
      const codes = codeMap[s.slug] ?? [];
      return {
        serviceSlug: s.slug,
        serviceName: s.name,
        published: this.coverage.servicePublished(s, clinics, codes, minClinics),
        cells: locations.map((l) => {
          const count = this.coverage.clinicsForCombo(clinics, l.slug, codes).length;
          const state =
            count === 0
              ? 'none'
              : count >= minClinics && l.status === 'available' && s.status === 'active'
                ? 'published'
                : 'below_threshold';
          return { citySlug: l.slug, count, state };
        }),
      };
    });

    return { minClinics, cities, matrix };
  }
}
```

Create `src/modules/localization/application/capture-notify.use-case.ts`:

```ts
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { NotifyResponseDto } from '../domain/localization.dto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class CaptureNotifyUseCase {
  constructor(@Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort) {}

  async execute(input: { email: string; citySlug: string | null }): Promise<NotifyResponseDto> {
    const email = (input.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 320) {
      throw new BadRequestException('A valid email is required');
    }
    await this.repo.insertNotify(email, input.citySlug ?? null);
    return { ok: true };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- localization`
Expected: PASS (get-city, get-coverage, capture-notify specs green).

- [ ] **Step 6: Commit**

```bash
git add src/modules/localization/domain/localization.dto.ts src/modules/localization/application
git commit -m "feat(localization): read use-cases + response DTOs"
```

---

### Task 6: Controller + module + app registration

**Files:**

- Create: `src/modules/localization/infrastructure/http/dto/notify-request.dto.ts`
- Create: `src/modules/localization/infrastructure/http/localization.controller.ts`
- Create: `src/modules/localization/localization.module.ts`
- Modify: `src/app.module.ts` (register `LocalizationModule`)
- Test: `src/modules/localization/infrastructure/http/localization.controller.spec.ts`

**Interfaces:**

- Consumes all Task 5 use-cases and `CoverageService`/`PrismaLocalizationRepository`.
- Produces the HTTP surface: `GET /localization/cities`, `/cities/:slug`, `/services`, `/services/:slug`, `/combo/:city/:service`, `/coverage`, `POST /localization/notify`.

- [ ] **Step 1: Write the request DTO**

Create `src/modules/localization/infrastructure/http/dto/notify-request.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class NotifyRequestDto {
  @ApiProperty({ example: 'you@example.com' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiPropertyOptional({ example: 'orlando' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  citySlug?: string;
}
```

- [ ] **Step 2: Write the controller**

Create `src/modules/localization/infrastructure/http/localization.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../infrastructure/security/public.decorator';
import { GetCitiesUseCase } from '../../application/get-cities.use-case';
import { GetCityUseCase } from '../../application/get-city.use-case';
import { GetServicesUseCase } from '../../application/get-services.use-case';
import { GetServiceUseCase } from '../../application/get-service.use-case';
import { GetComboUseCase } from '../../application/get-combo.use-case';
import { GetCoverageUseCase } from '../../application/get-coverage.use-case';
import { CaptureNotifyUseCase } from '../../application/capture-notify.use-case';
import { NotifyRequestDto } from './dto/notify-request.dto';
import {
  CityDetailDto,
  CityListDto,
  ComboDetailDto,
  CoverageDto,
  NotifyResponseDto,
  ServiceDetailDto,
  ServiceListDto,
} from '../../domain/localization.dto';

@ApiTags('localization')
@Controller('localization')
export class LocalizationController {
  constructor(
    private readonly getCities: GetCitiesUseCase,
    private readonly getCity: GetCityUseCase,
    private readonly getServices: GetServicesUseCase,
    private readonly getService: GetServiceUseCase,
    private readonly getCombo: GetComboUseCase,
    private readonly getCoverage: GetCoverageUseCase,
    private readonly captureNotify: CaptureNotifyUseCase,
  ) {}

  @Public()
  @Get('cities')
  @ApiOperation({ summary: 'List non-hidden Florida cities with publish state' })
  @ApiOkResponse({ type: CityListDto })
  listCities(): Promise<CityListDto> {
    return this.getCities.execute();
  }

  @Public()
  @Get('cities/:slug')
  @ApiOperation({ summary: 'City detail (clinics, services, nearby, SEO meta)' })
  @ApiParam({ name: 'slug' })
  @ApiOkResponse({ type: CityDetailDto })
  cityDetail(@Param('slug') slug: string): Promise<CityDetailDto> {
    return this.getCity.execute(slug);
  }

  @Public()
  @Get('services')
  @ApiOperation({ summary: 'List active marketing services with publish state' })
  @ApiOkResponse({ type: ServiceListDto })
  listServices(): Promise<ServiceListDto> {
    return this.getServices.execute();
  }

  @Public()
  @Get('services/:slug')
  @ApiOperation({ summary: 'Service detail (clinics, cities, related, SEO meta)' })
  @ApiParam({ name: 'slug' })
  @ApiOkResponse({ type: ServiceDetailDto })
  serviceDetail(@Param('slug') slug: string): Promise<ServiceDetailDto> {
    return this.getService.execute(slug);
  }

  @Public()
  @Get('combo/:city/:service')
  @ApiOperation({ summary: 'City + service combo detail' })
  @ApiParam({ name: 'city' })
  @ApiParam({ name: 'service' })
  @ApiOkResponse({ type: ComboDetailDto })
  comboDetail(
    @Param('city') city: string,
    @Param('service') service: string,
  ): Promise<ComboDetailDto> {
    return this.getCombo.execute(city, service);
  }

  @Public()
  @Get('coverage')
  @ApiOperation({ summary: 'Coverage matrix + threshold (drives prerender list and sitemap)' })
  @ApiOkResponse({ type: CoverageDto })
  coverage(): Promise<CoverageDto> {
    return this.getCoverage.execute();
  }

  @Public()
  @Post('notify')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({ summary: 'Capture a coming-soon notify email' })
  @ApiOkResponse({ type: NotifyResponseDto })
  notify(@Body() dto: NotifyRequestDto): Promise<NotifyResponseDto> {
    return this.captureNotify.execute({ email: dto.email, citySlug: dto.citySlug ?? null });
  }
}
```

- [ ] **Step 3: Write the module**

Create `src/modules/localization/localization.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { LOCALIZATION_REPOSITORY } from './domain/ports/localization-repository.port';
import { PrismaLocalizationRepository } from './infrastructure/prisma-localization.repository';
import { CoverageService } from './domain/coverage.service';
import { LocalizationController } from './infrastructure/http/localization.controller';
import { GetCitiesUseCase } from './application/get-cities.use-case';
import { GetCityUseCase } from './application/get-city.use-case';
import { GetServicesUseCase } from './application/get-services.use-case';
import { GetServiceUseCase } from './application/get-service.use-case';
import { GetComboUseCase } from './application/get-combo.use-case';
import { GetCoverageUseCase } from './application/get-coverage.use-case';
import { CaptureNotifyUseCase } from './application/capture-notify.use-case';

@Module({
  imports: [PrismaModule],
  controllers: [LocalizationController],
  providers: [
    { provide: LOCALIZATION_REPOSITORY, useClass: PrismaLocalizationRepository },
    CoverageService,
    GetCitiesUseCase,
    GetCityUseCase,
    GetServicesUseCase,
    GetServiceUseCase,
    GetComboUseCase,
    GetCoverageUseCase,
    CaptureNotifyUseCase,
  ],
  exports: [LOCALIZATION_REPOSITORY, CoverageService],
})
export class LocalizationModule {}
```

- [ ] **Step 4: Register in app.module.ts**

In `src/app.module.ts`, import `LocalizationModule` and append it to the `imports` array after `SchedulingModule`:

```ts
import { LocalizationModule } from './modules/localization/localization.module';
// ...
    SchedulingModule,
    LocalizationModule,
```

- [ ] **Step 5: Write the controller test**

Create `src/modules/localization/infrastructure/http/localization.controller.spec.ts`:

```ts
import { LocalizationController } from './localization.controller';

describe('LocalizationController', () => {
  const cities = { execute: jest.fn().mockResolvedValue({ cities: [] }) };
  const city = { execute: jest.fn().mockResolvedValue({ slug: 'tampa' }) };
  const services = { execute: jest.fn() };
  const service = { execute: jest.fn() };
  const combo = { execute: jest.fn() };
  const coverage = { execute: jest.fn() };
  const notify = { execute: jest.fn().mockResolvedValue({ ok: true }) };

  const controller = new LocalizationController(
    cities as never,
    city as never,
    services as never,
    service as never,
    combo as never,
    coverage as never,
    notify as never,
  );

  it('delegates cityDetail to the use-case', async () => {
    await controller.cityDetail('tampa');
    expect(city.execute).toHaveBeenCalledWith('tampa');
  });

  it('maps notify dto to the use-case input', async () => {
    const result = await controller.notify({ email: 'a@b.com', citySlug: 'orlando' });
    expect(notify.execute).toHaveBeenCalledWith({ email: 'a@b.com', citySlug: 'orlando' });
    expect(result).toEqual({ ok: true });
  });

  it('passes null citySlug when omitted', async () => {
    await controller.notify({ email: 'a@b.com' });
    expect(notify.execute).toHaveBeenCalledWith({ email: 'a@b.com', citySlug: null });
  });
});
```

- [ ] **Step 6: Run the tests + build to verify wiring**

Run: `pnpm test -- localization.controller` then `pnpm build`
Expected: tests PASS; `nest build` succeeds (module wiring valid).

- [ ] **Step 7: Commit**

```bash
git add src/modules/localization/infrastructure/http src/modules/localization/localization.module.ts src/app.module.ts
git commit -m "feat(localization): public read controller + module wiring"
```

---

### Task 7: `city` filter on the clinics directory

**Files:**

- Modify: `src/modules/clinics/application/get-clinic-directory.use-case.ts`
- Modify: `src/modules/clinics/domain/clinic-directory.types.ts` (add `city?: string` to the filter type)
- Modify: `src/modules/clinics/infrastructure/prisma-clinic.repository.ts` (add the `city` SQL condition)
- Modify: `src/modules/clinics/infrastructure/http/clinics.controller.ts` (add `city` query param)
- Test: `src/modules/clinics/application/get-clinic-directory.use-case.spec.ts` (add a case) or create if absent

**Interfaces:**

- Consumes the existing `ClinicDirectoryFilter` and `GetClinicDirectoryQuery` types.
- Produces an additional optional `city` filter threaded end to end.

- [ ] **Step 1: Write/extend the failing test**

In the directory use-case spec, add a case asserting `city` is passed through to the repository filter (mirror the existing `serviceCode` passthrough test; use the spec's existing repo mock). Example addition:

```ts
it('passes a trimmed city filter to the repository', async () => {
  const repo = makeRepo();
  const useCase = new GetClinicDirectoryUseCase(repo, zipGeocoderStub);
  await useCase.execute({ city: '  Tampa  ' });
  expect(repo.findDirectory).toHaveBeenCalledWith(expect.objectContaining({ city: 'Tampa' }));
});
```

(If no spec exists, create `get-clinic-directory.use-case.spec.ts` with a `makeRepo` factory of `jest.fn()`s typed to `ClinicRepositoryPort` and a stub `ZipGeocoder`, following `scheduling` spec conventions.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- get-clinic-directory`
Expected: FAIL (`city` not threaded).

- [ ] **Step 3: Thread the `city` filter**

In `clinic-directory.types.ts`, add `city?: string;` to `ClinicDirectoryFilter` (and to `GetClinicDirectoryQuery` if query and filter are separate types).

In `get-clinic-directory.use-case.ts`, where other string filters are normalized with `nonEmpty(...)`, add:

```ts
city: nonEmpty(query.city),
```

to the object passed to `clinicRepo.findDirectory({ ... })`.

In `prisma-clinic.repository.ts`, alongside the other `conditions.push(...)` filters, add:

```ts
if (filter.city !== undefined) {
  conditions.push(Prisma.sql`lower(c.city) = lower(${filter.city})`);
}
```

In `clinics.controller.ts`, add the query param to `getDirectory`:

```ts
@ApiQuery({ name: 'city', required: false })
// ...signature:
@Query('city') city?: string,
// ...pass-through:
return this.getClinicDirectory.execute({ /* ...existing..., */ city });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- get-clinic-directory`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/clinics
git commit -m "feat(clinics): add exact city filter to the public directory"
```

---

## Final verification (after all tasks)

Run the full CI flow and the integration suite:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build && pnpm test
pnpm test:int -- localization
```

Expected: all green. Prettier covers `.md` too, so format the plan/spec docs if they were edited.

## Self-Review

**Spec coverage:** location/marketing_service/marketing_service_code/localization_setting/location_notify tables (Task 1) + alias/near/related join tables (Task 1, replacing the spec's `text[]` to match codebase convention — documented deviation); RLS (Task 1); coverage service with telehealth-excluded uniform threshold + combo sparsity (Task 2); seeds with full city/service/mapping data (Task 3); repository reads via asSystem (Task 4); all public endpoints incl. coverage matrix + notify, each with the `meta{path,title,description,robots}` block (Tasks 5, 6); `clinics` city filter (Task 7). Telehealth surfaced-but-not-counted is implemented in `telehealthForCity` + excluded from `cityPublished`. All spec sections map to a task.

**Deviations from spec (intentional, to match codebase):** the spec described `aliases`/`near_slugs`/`related_slugs` as `text[]`; the plan uses join tables (`location_alias`, `location_near`, `marketing_service_related`) because the schema has no array columns. Behavior is identical.

**Placeholder scan:** none. Every code step has concrete code. Column-name note: the `Clinic` model has NO street-address column (only `city`, `state_code`, `zip_code`), so `loadActiveClinics` selects `city`/`state_code` and the DTO address is composed as `"<City>, FL"`. If the client later wants street-level addresses, that needs a new `clinics` column and is out of scope here.

**Type consistency:** `RawClinicRecord` (repo output) vs `ClinicRecord` (coverage input, `city` = slug) are distinct and bridged by `CoverageService.toClinicRecords`. `LOCALIZATION_REPOSITORY`/`LocalizationRepositoryPort`, `CoverageService` method names, and DTO class names are consistent across Tasks 4, 5, 6.
