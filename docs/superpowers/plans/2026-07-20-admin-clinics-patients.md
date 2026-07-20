# Admin Clinics & Patients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins management of existing clinics and patients: read/edit clinic records, pause lead delivery, keep internal notes, read/edit patients, soft-delete patients, and reset or set passwords for either.

**Architecture:** NestJS hexagonal on the Foundation auth/RLS layer, same shape as Slice 4. Two modules (`admin-clinics`, `admin-patients`), each domain / application / infrastructure with `Symbol` DI tokens. Every route is `@Roles('admin','superadmin')` + `RolesGuard` and runs under `withUserContext({ userId, role, ip })` so the `has_role` admin RLS policies apply. Password operations delegate to the existing Slice 4 reset infrastructure. Patient routes additionally write a `phi_access` audit record via an interceptor.

**Tech Stack:** NestJS 10, Prisma 7 + `@prisma/adapter-pg`, Postgres RLS, argon2 (`PASSWORD_HASHER`), `EMAIL_SENDER`, `@nestjs/throttler`, Jest.

## Global Constraints

- Contract mirrors the .NET `AdminClinicsController` and `AdminPatientsController`. Exhaustive field lists live in the spec (`docs/superpowers/specs/2026-07-20-admin-clinics-patients-design.md` §1). Read the spec section named in each task; it is the authority on field names.
- Ids are **UUID strings**, not the .NET integers. Applies to every `:id` path param and every `id` response field.
- All data access is RLS-enforced under `withUserContext({ userId, role, ip })`. Admin id and role come ONLY from `@CurrentUser()`, never from the request body or path.
- Admin RLS idiom, copy verbatim into every new policy:
  `has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')`
- The admin patient endpoints MUST NOT decrypt any encrypted assessment field. `treatment_category` is a plain enum column and is the only assessment data exposed.
- No `any` in production code. Keep `openapi.json` current (`pnpm openapi`); update README. No `Co-Authored-By` / Anthropic / Claude commit trailers. Node 24, pnpm, `Symbol` DI tokens.
- **File layout convention** (matches `src/modules/clinic-applications/`, and supersedes the sketch in spec §5): repositories live at `infrastructure/prisma-*.repository.ts` (NOT `infrastructure/persistence/`), DTOs at `infrastructure/http/dto/` (singular `dto`), use-case unit tests at `application/__tests__/*.spec.ts`.
- Prisma client imports use `../../../../generated/prisma/client`. `PrismaService` is at `src/infrastructure/prisma/prisma.service.ts`.
- Verification per task: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` must all be clean before commit.

## File Structure

```
prisma/migrations/20260720100000_admin_clinics_patients/migration.sql   Task 1
prisma/migrations/20260720110000_admin_clinics_patients_rls/migration.sql Task 2

src/infrastructure/security/admin-ctx.ts       Task 3  AdminCtx, shared by both modules
src/infrastructure/format/date.ts              Task 3  formatDateOnly, shared by both modules

src/modules/admin-clinics/
  domain/clinic-dto.mapper.ts                    Task 3  pure derivation rules
  domain/ports/admin-clinic-repository.port.ts   Task 4
  domain/ports/admin-note-repository.port.ts     Task 6
  application/list-clinics.use-case.ts           Task 4
  application/get-clinic.use-case.ts             Task 4
  application/update-clinic.use-case.ts          Task 5
  application/pause-delivery.use-case.ts         Task 5
  application/list-clinic-leads.use-case.ts      Task 6
  application/list-notes.use-case.ts             Task 6
  application/add-note.use-case.ts               Task 6
  application/send-clinic-password-reset.use-case.ts  Task 7
  application/set-clinic-password.use-case.ts    Task 7
  infrastructure/prisma-admin-clinic.repository.ts    Tasks 4-7
  infrastructure/prisma-admin-note.repository.ts      Task 6
  infrastructure/http/admin-clinics.controller.ts     Tasks 4-7
  infrastructure/http/dto/*.dto.ts                    Tasks 4-7
  admin-clinics.module.ts                        Task 4

src/modules/admin-patients/
  domain/patient-dto.mapper.ts                   Task 9
  domain/ports/admin-patient-repository.port.ts  Task 9
  application/list-patients.use-case.ts          Task 9
  application/get-patient.use-case.ts            Task 9
  application/update-patient.use-case.ts         Task 10
  application/soft-delete-patient.use-case.ts    Task 10
  application/send-patient-password-reset.use-case.ts Task 11
  application/set-patient-password.use-case.ts   Task 11
  infrastructure/prisma-admin-patient.repository.ts   Tasks 9-11
  infrastructure/http/phi-access.interceptor.ts  Task 8
  infrastructure/http/admin-patients.controller.ts    Tasks 9-11
  infrastructure/http/dto/*.dto.ts               Tasks 9-11
  admin-patients.module.ts                       Task 9
```

Task 3 (`clinic-dto.mapper.ts`) and Task 9 (`patient-dto.mapper.ts`) isolate the derivation rules that both the list and detail paths share, so the two cannot drift.

---

### Task 1: Schema + migration

**Files:**

- Modify: `prisma/schema.prisma` (new `AdminNote` model; two `Clinic` columns; `Clinic.notes` relation)
- Create: `prisma/migrations/20260720100000_admin_clinics_patients/migration.sql`
- Test: `test/db/admin-schema.int-spec.ts`

**Interfaces produced:**

- Table `admin_notes`: `id uuid pk default gen_random_uuid()`, `clinic_id uuid not null` FK → `clinics(id)` `ON DELETE CASCADE`, `author_user_id uuid not null` FK → `users(id)` `ON DELETE RESTRICT`, `author_name text not null`, `body text not null`, `created_at timestamptz not null default now()`. Index `admin_notes_clinic_created_idx` on `(clinic_id, created_at DESC)`.
- `clinics.zip_code text` (nullable), `clinics.is_listed_in_directory boolean not null default true`.
- Prisma model `AdminNote` with `@@map("admin_notes")`; `Clinic.notes AdminNote[]`.

- [ ] **Step 1 (test):** create `test/db/admin-schema.int-spec.ts`, mirroring the style of `test/db/clinic-applications-schema.int-spec.ts`:

```ts
import { Pool } from 'pg';

describe('admin clinics/patients schema', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  });
  afterAll(async () => {
    await pool.end();
  });

  it('creates the admin_notes table', async () => {
    const { rows } = await pool.query(`SELECT to_regclass('public.admin_notes') AS t`);
    expect(rows[0].t).not.toBeNull();
  });

  it('gives admin_notes the expected columns', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'admin_notes' ORDER BY column_name`,
    );
    const cols = rows.map((r) => r.column_name);
    expect(cols).toEqual([
      'author_name',
      'author_user_id',
      'body',
      'clinic_id',
      'created_at',
      'id',
    ]);
  });

  it('cascades admin_notes on clinic delete and restricts on user delete', async () => {
    const { rows } = await pool.query(
      `SELECT rc.delete_rule, kcu.column_name
         FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = rc.constraint_name
        WHERE kcu.table_name = 'admin_notes'
        ORDER BY kcu.column_name`,
    );
    expect(rows).toEqual([
      { column_name: 'author_user_id', delete_rule: 'RESTRICT' },
      { column_name: 'clinic_id', delete_rule: 'CASCADE' },
    ]);
  });

  it('indexes admin_notes by clinic and created_at', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'admin_notes' AND indexname = 'admin_notes_clinic_created_idx'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('adds zip_code and is_listed_in_directory to clinics', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'clinics'
          AND column_name IN ('zip_code', 'is_listed_in_directory')
        ORDER BY column_name`,
    );
    expect(rows).toEqual([
      { column_name: 'is_listed_in_directory', is_nullable: 'NO', column_default: 'true' },
      { column_name: 'zip_code', is_nullable: 'YES', column_default: null },
    ]);
  });
});
```

- [ ] **Step 2:** Run `pnpm test:int -- admin-schema` — expect FAIL (`to_regclass` returns null).

- [ ] **Step 3:** Add to `prisma/schema.prisma` — inside `model Clinic`, after the `suspensionReason` line:

```prisma
  zipCode              String?            @map("zip_code")
  isListedInDirectory  Boolean            @default(true) @map("is_listed_in_directory")
```

and in `Clinic`'s relation block add `notes AdminNote[]`. Then append the new model:

```prisma
model AdminNote {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  clinicId     String   @map("clinic_id") @db.Uuid
  authorUserId String   @map("author_user_id") @db.Uuid
  authorName   String   @map("author_name")
  body         String
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz

  clinic Clinic @relation(fields: [clinicId], references: [id], onDelete: Cascade)
  author User   @relation(fields: [authorUserId], references: [id], onDelete: Restrict)

  @@index([clinicId, createdAt(sort: Desc)], map: "admin_notes_clinic_created_idx")
  @@map("admin_notes")
}
```

Add `adminNotes AdminNote[]` to `model User`'s relation block.

- [ ] **Step 4:** Hand-write `prisma/migrations/20260720100000_admin_clinics_patients/migration.sql` in the existing raw-SQL style:

```sql
-- Admin Clinics & Patients slice: admin_notes table and two clinic columns.

ALTER TABLE clinics ADD COLUMN "zip_code" TEXT;
ALTER TABLE clinics ADD COLUMN "is_listed_in_directory" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE admin_notes (
    "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id"      UUID        NOT NULL,
    "author_user_id" UUID        NOT NULL,
    "author_name"    TEXT        NOT NULL,
    "body"           TEXT        NOT NULL,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "admin_notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_notes_clinic_id_fkey"
        FOREIGN KEY ("clinic_id") REFERENCES clinics("id") ON DELETE CASCADE,
    CONSTRAINT "admin_notes_author_user_id_fkey"
        FOREIGN KEY ("author_user_id") REFERENCES users("id") ON DELETE RESTRICT
);

CREATE INDEX "admin_notes_clinic_created_idx"
    ON admin_notes ("clinic_id", "created_at" DESC);
```

- [ ] **Step 5:** Run `pnpm prisma generate`, then `pnpm prisma migrate deploy` against the local DB (`127.0.0.1:54322`).

- [ ] **Step 6:** Run `pnpm test:int -- admin-schema` — expect PASS (5 tests). Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit.

```bash
git add prisma/schema.prisma prisma/migrations/20260720100000_admin_clinics_patients test/db/admin-schema.int-spec.ts
git commit -m "feat(db): add admin_notes table and clinic directory columns"
```

---

### Task 2: RLS + admin policies

**Files:**

- Create: `prisma/migrations/20260720110000_admin_clinics_patients_rls/migration.sql`
- Test: `test/db/admin-rls.int-spec.ts`

**Interfaces produced:**

- `admin_notes`: `ENABLE` + `FORCE ROW LEVEL SECURITY`, `GRANT SELECT, INSERT, UPDATE, DELETE TO app_authenticated`, policy `admin_notes_admin_all`.
- New `_admin_all` policies on `patients`, `patient_assessments`, `leads` (existing patient-owner and clinic-scoped policies stay intact).
- Index `audit_log_action_created_idx` on `audit_log (action_type, created_at DESC)` to serve PHI access reports.

**Consumes:** the `has_role` idiom from Global Constraints; the `withUserContext` helper on `PrismaService`.

- [ ] **Step 1 (test):** create `test/db/admin-rls.int-spec.ts`. Model it on `test/db/clinic-applications-rls.int-spec.ts` (read that file first for the exact seeding and context-switching helpers it uses). It must cover:

```ts
// Under an admin context:
//   - SELECT on patients, patient_assessments, leads returns the seeded rows
//   - INSERT into admin_notes succeeds, and SELECT returns it
// Under a clinic context (clinicId set, role 'clinic'):
//   - SELECT on admin_notes returns 0 rows
//   - INSERT into admin_notes is rejected
// Under a patient context (role 'patient', userId = patient A's user):
//   - SELECT on admin_notes returns 0 rows
//   - SELECT on patients returns only patient A's row, not patient B's
// Under an anonymous context (no userId):
//   - SELECT on admin_notes returns 0 rows
```

Write each of those as its own `it(...)` so a failure names the exact policy at fault.

- [ ] **Step 2:** Run `pnpm test:int -- admin-rls` — expect FAIL (admin_notes has no policies, so admin SELECT/INSERT is denied).

- [ ] **Step 3:** Write `prisma/migrations/20260720110000_admin_clinics_patients_rls/migration.sql`. Use this exact shape for each of the four tables, substituting the table name:

```sql
-- Admin Clinics & Patients slice: admin RLS policies.
-- Adds admin-only access to admin_notes and admin read/write on the patient
-- and lead tables the admin endpoints read. Every existing policy
-- (public-select, clinic self-scoped, patient self-scoped) is left intact.

-- ---------------------------------------------------------------------------
-- 1. admin_notes — admin-only access
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON admin_notes TO app_authenticated;

ALTER TABLE admin_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notes FORCE ROW LEVEL SECURITY;

CREATE POLICY admin_notes_admin_all ON admin_notes
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

-- ---------------------------------------------------------------------------
-- 2. patients — add admin access alongside the existing patient-self policy
-- ---------------------------------------------------------------------------

CREATE POLICY patients_admin_all ON patients
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

-- ---------------------------------------------------------------------------
-- 3. patient_assessments — admin read/write
-- ---------------------------------------------------------------------------

CREATE POLICY patient_assessments_admin_all ON patient_assessments
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

-- ---------------------------------------------------------------------------
-- 4. leads — admin read/write
-- ---------------------------------------------------------------------------

CREATE POLICY leads_admin_all ON leads
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

-- ---------------------------------------------------------------------------
-- 5. audit_log — index for PHI access reporting
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS audit_log_action_created_idx
    ON audit_log ("action_type", "created_at" DESC);
```

Before writing, run `psql "$DATABASE_URL" -c "\d patients"` (and the same for `patient_assessments`, `leads`) to confirm the existing GRANTs already cover the DML the admin policies need. Add any missing `GRANT` in the same file; do not remove existing grants.

- [ ] **Step 4:** Apply with `pnpm prisma migrate deploy`. Run `pnpm test:int -- admin-rls` — expect PASS. Then re-run the full int suite (`pnpm test:int`) to confirm no existing RLS spec regressed, since this migration touches shared tables.

- [ ] **Step 5:** `pnpm typecheck && pnpm lint && pnpm format:check`, then commit.

```bash
git add prisma/migrations/20260720110000_admin_clinics_patients_rls test/db/admin-rls.int-spec.ts
git commit -m "feat(db): add admin RLS policies for clinics and patients management"
```

---

### Task 3: Clinic DTO mapper (pure derivation rules)

**Files:**

- Create: `src/infrastructure/security/admin-ctx.ts`
- Create: `src/infrastructure/format/date.ts`
- Create: `src/modules/admin-clinics/domain/clinic-dto.mapper.ts`
- Test: `src/infrastructure/format/__tests__/date.spec.ts`
- Test: `src/modules/admin-clinics/domain/__tests__/clinic-dto.mapper.spec.ts`

**Interfaces produced** (later tasks import these by exact name):

```ts
// src/infrastructure/security/admin-ctx.ts
// Shared by BOTH admin-clinics and admin-patients. Defined here, not inside a
// feature module, so neither module has to import from its sibling.
export interface AdminCtx {
  userId: string;
  role: string;
  ip: string | null;
}

// src/infrastructure/format/date.ts
export function formatDateOnly(d: Date | null): string | null; // UTC 'yyyy-MM-dd'

// src/modules/admin-clinics/domain/clinic-dto.mapper.ts
export const SPECIALTIES: Readonly<Record<string, string>>;
export const CLINIC_STATUSES: readonly ['active', 'paused', 'suspended', 'inactive'];
export type ClinicStatusValue = (typeof CLINIC_STATUSES)[number];
export function isClinicStatus(value: string): value is ClinicStatusValue;
export interface ClinicServiceRow {
  service_code: string;
  is_top_service: boolean;
  display_order: number;
}
export interface AdminClinicRow {
  /* snake_case columns, see Step 3 */
}
export interface AdminClinicDto {
  /* camelCase, spec §1.1 */
}
export function toAdminClinicDto(
  row: AdminClinicRow,
  categories: string[],
  services: ClinicServiceRow[],
  leadCount: number,
  lastLeadAt: Date | null,
): AdminClinicDto;
```

This module is pure: no NestJS decorators, no Prisma imports, no I/O.

**Read spec §1.1 before starting.** It is the authority on every field name and derivation rule.

- [ ] **Step 1 (test):** create `src/modules/admin-clinics/domain/__tests__/clinic-dto.mapper.spec.ts`:

```ts
import {
  isClinicStatus,
  toAdminClinicDto,
  type AdminClinicRow,
  type ClinicServiceRow,
} from '../clinic-dto.mapper';

const baseRow: AdminClinicRow = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'vitality-hormone-nyc',
  name: 'Vitality Hormone NYC',
  location: 'New York, NY',
  city: 'New York',
  state_code: 'NY',
  zip_code: '10001',
  rating: 4.5,
  review_count: 120,
  about: null,
  differentiators: null,
  new_patient_wait: '1-2 weeks',
  telehealth_available: true,
  offers_lab_work: false,
  website_url: null,
  consultation_fee_band: '$$',
  monthly_program_band: '$$$',
  financing_available: true,
  accepts_insurance: false,
  insurance_notes: null,
  provider_name: null,
  credentials: null,
  photo_count: 3,
  status: 'active',
  created_at: new Date('2026-03-05T18:30:00.000Z'),
  billing_status: 'current',
  webhook_health: 'unknown',
  suspension_reason: null,
};

describe('isClinicStatus', () => {
  it.each(['active', 'paused', 'suspended', 'inactive'])('accepts %s', (s) => {
    expect(isClinicStatus(s)).toBe(true);
  });

  it.each(['Active', 'deleted', '', 'ACTIVE'])('rejects %s', (s) => {
    expect(isClinicStatus(s)).toBe(false);
  });
});

describe('toAdminClinicDto', () => {
  it('falls back to the wellness category when the clinic has none', () => {
    const dto = toAdminClinicDto(baseRow, [], [], 0, null);
    expect(dto.category).toBe('wellness');
    expect(dto.specialty).toBe('Integrative Wellness');
  });

  it('maps a known category to its specialty label', () => {
    const dto = toAdminClinicDto(baseRow, ['med_spa'], [], 0, null);
    expect(dto.category).toBe('med_spa');
    expect(dto.specialty).toBe('Med Spa & Aesthetics');
  });

  it('falls back to the category code when it is not in the specialty map', () => {
    const dto = toAdminClinicDto(baseRow, ['cryotherapy'], [], 0, null);
    expect(dto.specialty).toBe('cryotherapy');
  });

  it('uses the first category when several exist', () => {
    const dto = toAdminClinicDto(baseRow, ['peptide', 'hormone'], [], 0, null);
    expect(dto.category).toBe('peptide');
  });

  it('splits top services from all services and orders each', () => {
    const services: ClinicServiceRow[] = [
      { service_code: 'z_top', is_top_service: true, display_order: 2 },
      { service_code: 'a_other', is_top_service: false, display_order: 1 },
      { service_code: 'b_top', is_top_service: true, display_order: 1 },
      { service_code: 'c_other', is_top_service: false, display_order: 2 },
    ];
    const dto = toAdminClinicDto(baseRow, [], services, 0, null);
    expect(dto.services).toEqual(['b_top', 'z_top']);
    expect(dto.allServices).toEqual(['b_top', 'z_top', 'a_other', 'c_other']);
  });

  it('converts null text fields to empty strings', () => {
    const dto = toAdminClinicDto(baseRow, [], [], 0, null);
    expect(dto.about).toBe('');
    expect(dto.differentiators).toBe('');
    expect(dto.insuranceNotes).toBe('');
    expect(dto.providerName).toBe('');
    expect(dto.credentials).toBe('');
  });

  it('emits rating as a number', () => {
    const dto = toAdminClinicDto(baseRow, [], [], 0, null);
    expect(typeof dto.rating).toBe('number');
    expect(dto.rating).toBe(4.5);
  });

  it('formats createdAt and lastLeadAt as yyyy-MM-dd', () => {
    const dto = toAdminClinicDto(baseRow, [], [], 7, new Date('2026-06-01T10:00:00.000Z'));
    expect(dto.createdAt).toBe('2026-03-05');
    expect(dto.lastLeadAt).toBe('2026-06-01');
    expect(dto.leadCount).toBe(7);
  });

  it('emits a null lastLeadAt when the clinic has no leads', () => {
    const dto = toAdminClinicDto(baseRow, [], [], 0, null);
    expect(dto.lastLeadAt).toBeNull();
    expect(dto.leadCount).toBe(0);
  });
});
```

Also create `src/infrastructure/format/__tests__/date.spec.ts`:

```ts
import { formatDateOnly } from '../date';

describe('formatDateOnly', () => {
  it('formats a date as UTC yyyy-MM-dd', () => {
    expect(formatDateOnly(new Date('2026-03-05T23:59:00.000Z'))).toBe('2026-03-05');
  });

  it('uses UTC, not local time, at a day boundary', () => {
    expect(formatDateOnly(new Date('2026-03-05T00:30:00.000Z'))).toBe('2026-03-05');
  });

  it('returns null for null', () => {
    expect(formatDateOnly(null)).toBeNull();
  });
});
```

- [ ] **Step 2:** Run `pnpm jest clinic-dto.mapper date.spec` — expect FAIL (modules not found).

- [ ] **Step 3:** Create the two shared modules first.

`src/infrastructure/security/admin-ctx.ts`:

```ts
/** The admin identity every admin repository call runs under. */
export interface AdminCtx {
  userId: string;
  role: string;
  ip: string | null;
}
```

`src/infrastructure/format/date.ts`:

```ts
/** Formats as UTC `yyyy-MM-dd`. UTC keeps the output deterministic regardless of server timezone. */
export function formatDateOnly(d: Date | null): string | null {
  return d === null ? null : d.toISOString().slice(0, 10);
}
```

Then create `src/modules/admin-clinics/domain/clinic-dto.mapper.ts`:

```ts
import { formatDateOnly } from '../../../infrastructure/format/date';

export const SPECIALTIES: Readonly<Record<string, string>> = Object.freeze({
  hormone: 'Hormone Therapy',
  peptide: 'Peptide Therapy',
  med_spa: 'Med Spa & Aesthetics',
  wellness: 'Integrative Wellness',
});

export const CLINIC_STATUSES = ['active', 'paused', 'suspended', 'inactive'] as const;
export type ClinicStatusValue = (typeof CLINIC_STATUSES)[number];

export function isClinicStatus(value: string): value is ClinicStatusValue {
  return (CLINIC_STATUSES as readonly string[]).includes(value);
}

export interface ClinicServiceRow {
  service_code: string;
  is_top_service: boolean;
  display_order: number;
}

export interface AdminClinicRow {
  id: string;
  slug: string;
  name: string;
  location: string | null;
  city: string | null;
  state_code: string | null;
  zip_code: string | null;
  rating: number;
  review_count: number;
  about: string | null;
  differentiators: string | null;
  new_patient_wait: string | null;
  telehealth_available: boolean;
  offers_lab_work: boolean;
  website_url: string | null;
  consultation_fee_band: string | null;
  monthly_program_band: string | null;
  financing_available: boolean;
  accepts_insurance: boolean;
  insurance_notes: string | null;
  provider_name: string | null;
  credentials: string | null;
  photo_count: number;
  status: string;
  created_at: Date;
  billing_status: string | null;
  webhook_health: string | null;
  suspension_reason: string | null;
}

export interface AdminClinicDto {
  id: string;
  slug: string;
  name: string;
  category: string;
  specialty: string;
  location: string;
  city: string;
  stateCode: string;
  zipCode: string;
  rating: number;
  reviewCount: number;
  about: string;
  differentiators: string;
  services: string[];
  allServices: string[];
  waitTime: string;
  telehealth: boolean;
  offersLabWork: boolean;
  websiteUrl: string | null;
  consultationFee: string;
  monthlyProgram: string;
  financing: boolean;
  insurance: boolean;
  insuranceNotes: string;
  providerName: string;
  credentials: string;
  photoCount: number;
  status: string;
  createdAt: string;
  leadCount: number;
  lastLeadAt: string | null;
  billingStatus: string | null;
  webhookHealth: string | null;
  suspensionReason: string | null;
}

const orEmpty = (v: string | null): string => v ?? '';

export function toAdminClinicDto(
  row: AdminClinicRow,
  categories: string[],
  services: ClinicServiceRow[],
  leadCount: number,
  lastLeadAt: Date | null,
): AdminClinicDto {
  const category = categories[0] ?? 'wellness';

  const topServices = services
    .filter((s) => s.is_top_service)
    .slice()
    .sort((a, b) => a.display_order - b.display_order)
    .map((s) => s.service_code);

  const allServices = services
    .slice()
    .sort(
      (a, b) =>
        (a.is_top_service ? 0 : 1) - (b.is_top_service ? 0 : 1) ||
        a.display_order - b.display_order,
    )
    .map((s) => s.service_code);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category,
    specialty: SPECIALTIES[category] ?? category,
    location: orEmpty(row.location),
    city: orEmpty(row.city),
    stateCode: orEmpty(row.state_code),
    zipCode: orEmpty(row.zip_code),
    rating: Number(row.rating),
    reviewCount: row.review_count,
    about: orEmpty(row.about),
    differentiators: orEmpty(row.differentiators),
    services: topServices,
    allServices,
    waitTime: orEmpty(row.new_patient_wait),
    telehealth: row.telehealth_available,
    offersLabWork: row.offers_lab_work,
    websiteUrl: row.website_url,
    consultationFee: orEmpty(row.consultation_fee_band),
    monthlyProgram: orEmpty(row.monthly_program_band),
    financing: row.financing_available,
    insurance: row.accepts_insurance,
    insuranceNotes: orEmpty(row.insurance_notes),
    providerName: orEmpty(row.provider_name),
    credentials: orEmpty(row.credentials),
    photoCount: row.photo_count,
    status: row.status,
    createdAt: formatDateOnly(row.created_at) as string,
    leadCount,
    lastLeadAt: formatDateOnly(lastLeadAt),
    billingStatus: row.billing_status,
    webhookHealth: row.webhook_health,
    suspensionReason: row.suspension_reason,
  };
}
```

- [ ] **Step 4:** Run `pnpm jest clinic-dto.mapper date.spec` — expect PASS (14 tests). Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 5:** Commit.

```bash
git add src/infrastructure/security/admin-ctx.ts src/infrastructure/format src/modules/admin-clinics/domain
git commit -m "feat(admin-clinics): add clinic DTO mapper and shared admin context type"
```

---

### Task 4: Admin clinic read paths (list + detail)

**Files:**

- Create: `src/modules/admin-clinics/domain/ports/admin-clinic-repository.port.ts`
- Create: `src/modules/admin-clinics/application/list-clinics.use-case.ts`, `get-clinic.use-case.ts`
- Create: `src/modules/admin-clinics/infrastructure/prisma-admin-clinic.repository.ts`
- Create: `src/modules/admin-clinics/infrastructure/http/admin-clinics.controller.ts`
- Create: `src/modules/admin-clinics/admin-clinics.module.ts`
- Modify: `src/app.module.ts` (register `AdminClinicsModule`)
- Test: `src/modules/admin-clinics/application/__tests__/list-clinics.use-case.spec.ts`, `get-clinic.use-case.spec.ts`; `test/admin/admin-clinics-read.e2e-spec.ts`

**Interfaces produced:**

```ts
import type { AdminCtx } from '../../../../infrastructure/security/admin-ctx';

export interface AdminClinicRepositoryPort {
  listClinics(ctx: AdminCtx): Promise<AdminClinicDto[]>;
  getClinic(ctx: AdminCtx, clinicId: string): Promise<AdminClinicDto | null>;
}

export const ADMIN_CLINIC_REPOSITORY: symbol;
```

**Consumes:** `AdminCtx` from `src/infrastructure/security/admin-ctx.ts` (Task 3) — do not redefine it; `toAdminClinicDto`, `AdminClinicRow`, `ClinicServiceRow`, `AdminClinicDto` from Task 3; `PrismaService.withUserContext`; `RolesGuard`, `@Roles`, `@CurrentUser` from `src/infrastructure/security/`.

- [ ] **Step 1 (test):** create `src/modules/admin-clinics/application/__tests__/list-clinics.use-case.spec.ts` and `get-clinic.use-case.spec.ts`. Each mocks the repository port and asserts the use case (a) forwards `{ userId, role, ip }` unchanged and (b) for `get-clinic`, throws `NotFoundException` with message `Clinic not found.` when the repo returns `null`:

```ts
import { NotFoundException } from '@nestjs/common';
import { GetClinicUseCase } from '../get-clinic.use-case';

describe('GetClinicUseCase', () => {
  const repo = { listClinics: jest.fn(), getClinic: jest.fn() };
  const useCase = new GetClinicUseCase(repo);
  const ctx = { userId: 'u1', role: 'admin', ip: '127.0.0.1' };

  beforeEach(() => jest.resetAllMocks());

  it('returns the clinic the repository resolves', async () => {
    const dto = { id: 'c1' };
    repo.getClinic.mockResolvedValue(dto);
    await expect(useCase.execute(ctx, 'c1')).resolves.toBe(dto);
    expect(repo.getClinic).toHaveBeenCalledWith(ctx, 'c1');
  });

  it('throws NotFoundException when the clinic does not exist', async () => {
    repo.getClinic.mockResolvedValue(null);
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow(NotFoundException);
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow('Clinic not found.');
  });
});
```

- [ ] **Step 2:** Run `pnpm jest list-clinics get-clinic` — expect FAIL.

- [ ] **Step 3:** Create the port, the two use cases, the repository, the controller, and the module.

The repository resolves lead stats in **one grouped query**, never per clinic. Inside a single `withUserContext` transaction:

```ts
async listClinics(ctx: AdminCtx): Promise<AdminClinicDto[]> {
  return this.prisma.withUserContext({ userId: ctx.userId, role: ctx.role, ip: ctx.ip }, async (tx) => {
    const clinics = await tx.$queryRaw<AdminClinicRow[]>`
      SELECT id, slug, name, location, city, state_code AS "state_code",
             zip_code AS "zip_code", rating, review_count AS "review_count",
             about, differentiators, new_patient_wait AS "new_patient_wait",
             telehealth_available AS "telehealth_available",
             offers_lab_work AS "offers_lab_work", website_url AS "website_url",
             consultation_fee_band AS "consultation_fee_band",
             monthly_program_band AS "monthly_program_band",
             financing_available AS "financing_available",
             accepts_insurance AS "accepts_insurance",
             insurance_notes AS "insurance_notes", provider_name AS "provider_name",
             credentials, photo_count AS "photo_count", status,
             created_at AS "created_at", billing_status AS "billing_status",
             webhook_health AS "webhook_health", suspension_reason AS "suspension_reason"
        FROM clinics
       ORDER BY name ASC`;

    const cats = await tx.$queryRaw<{ clinic_id: string; category: string }[]>`
      SELECT clinic_id AS "clinic_id", category FROM clinic_categories`;

    const svcs = await tx.$queryRaw<
      { clinic_id: string; service_code: string; is_top_service: boolean; display_order: number }[]
    >`SELECT clinic_id AS "clinic_id", service_code AS "service_code",
             is_top_service AS "is_top_service", display_order AS "display_order"
        FROM clinic_services`;

    const stats = await tx.$queryRaw<{ clinic_id: string; count: bigint; last_at: Date }[]>`
      SELECT clinic_id AS "clinic_id", COUNT(*) AS count, MAX(received_at) AS "last_at"
        FROM leads GROUP BY clinic_id`;

    // group cats/svcs/stats into Maps keyed by clinic_id, then map with toAdminClinicDto
  });
}
```

`COUNT(*)` returns `bigint`; convert with `Number(...)` before putting it in the DTO.

`getClinic` runs the same shape filtered by `id`, returning `null` when the clinic row is absent.

Controller:

```ts
@ApiTags('Admin — Clinics')
@ApiCookieAuth('access_token')
@Controller('admin/clinics')
@Roles('admin', 'superadmin')
@UseGuards(RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class AdminClinicsController {
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) { ... }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { ... }
}
```

Use `@Ip()` from `@nestjs/common` for the context IP. Use `ParseUUIDPipe` on every `:id` so a malformed id is a 400, not a database error.

Register `AdminClinicsModule` in `src/app.module.ts` alongside `ClinicApplicationsModule`.

- [ ] **Step 4:** Run `pnpm jest list-clinics get-clinic` — expect PASS.

- [ ] **Step 5 (e2e):** create `test/admin/admin-clinics-read.e2e-spec.ts`. Read `test/clinic-portal.e2e-spec.ts` first for the app-bootstrap and admin-sign-in helpers. Assert: an admin gets 200 and an array from `GET /admin/clinics`; the array is ordered by name; `GET /admin/clinics/:id` returns the matching `id`; an unknown but well-formed UUID returns 404 with `Clinic not found.`; a `patient`-role user gets 403 on both routes.

- [ ] **Step 6:** Run `pnpm test:e2e -- admin-clinics-read` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit.

```bash
git add src/modules/admin-clinics src/app.module.ts test/admin/admin-clinics-read.e2e-spec.ts
git commit -m "feat(admin-clinics): add clinic list and detail endpoints"
```

---

### Task 5: Update clinic + pause delivery

**Files:**

- Modify: `src/modules/admin-clinics/domain/ports/admin-clinic-repository.port.ts` (add two methods)
- Create: `src/modules/admin-clinics/application/update-clinic.use-case.ts`, `pause-delivery.use-case.ts`
- Create: `src/modules/admin-clinics/infrastructure/http/dto/update-clinic.dto.ts`, `pause-delivery.dto.ts`
- Modify: `src/modules/admin-clinics/infrastructure/prisma-admin-clinic.repository.ts`, `admin-clinics.controller.ts`, `admin-clinics.module.ts`
- Test: `application/__tests__/update-clinic.use-case.spec.ts`, `pause-delivery.use-case.spec.ts`; `test/admin/admin-clinics-write.e2e-spec.ts`

**Interfaces produced:**

```ts
export interface UpdateClinicInput {
  name?: string; status?: string; about?: string; differentiators?: string;
  providerName?: string; credentials?: string; websiteUrl?: string;
  city?: string; stateCode?: string; zipCode?: string;
  telehealth?: boolean; offersLabWork?: boolean; financing?: boolean; insurance?: boolean;
  insuranceNotes?: string; consultationFee?: string; monthlyProgram?: string; waitTime?: string;
  rating?: number; reviewCount?: number; isListedInDirectory?: boolean; logoUrl?: string;
}

// added to AdminClinicRepositoryPort:
updateClinic(ctx: AdminCtx, clinicId: string, input: UpdateClinicInput): Promise<boolean>; // false = not found
pauseDelivery(ctx: AdminCtx, clinicId: string, paused: boolean): Promise<boolean>;         // false = not found
```

**Read spec §1.2 and §1.3 before starting.** They are the authority on the field-to-column mapping, the ignore-unknown-status rule, and the pause semantics.

- [ ] **Step 1 (test):** create the two use-case specs. `update-clinic.use-case.spec.ts` must cover:

```ts
it('throws NotFoundException when the repository reports the clinic is missing', ...);
it('forwards only the fields present in the input', ...);
it('drops an unrecognized status instead of rejecting the request', async () => {
  repo.updateClinic.mockResolvedValue(true);
  await useCase.execute(ctx, 'c1', { name: 'X', status: 'bogus' });
  expect(repo.updateClinic).toHaveBeenCalledWith(ctx, 'c1', { name: 'X' });
});
it.each(['active', 'paused', 'suspended', 'inactive'])('keeps the valid status %s', ...);
```

`pause-delivery.use-case.spec.ts` must cover the 404 path and that `paused` is forwarded verbatim.

- [ ] **Step 2:** Run `pnpm jest update-clinic pause-delivery` — expect FAIL.

- [ ] **Step 3:** Implement.

`UpdateClinicDto` uses `class-validator` with every field `@IsOptional()`: `@IsString()` for the text fields, `@IsBoolean()` for the four booleans, `@IsNumber()` for `rating`, `@IsInt()` for `reviewCount`. Do **not** add `@IsIn(CLINIC_STATUSES)` to `status` — an unrecognized status must be silently ignored, not rejected with a 400 (spec §1.2). The use case strips it instead, using `isClinicStatus` from Task 3.

The repository builds a partial `UPDATE` from only the present fields. Column mapping (spec §1.2): `telehealth` → `telehealth_available`, `financing` → `financing_available`, `insurance` → `accepts_insurance`, `consultationFee` → `consultation_fee_band`, `monthlyProgram` → `monthly_program_band`, `waitTime` → `new_patient_wait`; the rest map by snake_case name.

Build the statement with `Prisma.sql` fragments joined by `Prisma.join`, never string concatenation, so values stay parameterized:

```ts
const sets: Prisma.Sql[] = [];
if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name}`);
// ... one line per field ...
if (sets.length === 0) return true; // nothing to change, but the clinic exists
const result = await tx.$executeRaw`
  UPDATE clinics SET ${Prisma.join(sets, ', ')} WHERE id = ${clinicId}::uuid`;
```

Derived `location`: when `city` or `stateCode` is present in the input, recompute from the **post-update** values. Do it as a second statement inside the same transaction so it reads the values just written:

```ts
if (input.city !== undefined || input.stateCode !== undefined) {
  await tx.$executeRaw`
    UPDATE clinics SET location = concat(city, ', ', state_code) WHERE id = ${clinicId}::uuid`;
}
```

Return `false` when the first `UPDATE` affected 0 rows, so the use case can raise 404. When `sets` is empty, check existence with a `SELECT 1` rather than assuming the clinic exists.

`pauseDelivery` is a single conditional statement matching spec §1.3 exactly — un-pausing must be a no-op unless the clinic is currently `paused`:

```ts
const affected = await tx.$executeRaw`
  UPDATE clinics
     SET status = CASE WHEN ${paused} THEN 'paused'
                       WHEN status = 'paused' THEN 'active'
                       ELSE status END,
         notify_on_lead = CASE WHEN ${paused} THEN false
                               WHEN status = 'paused' THEN true
                               ELSE notify_on_lead END
   WHERE id = ${clinicId}::uuid`;
```

Existence is checked separately with `SELECT 1`, because this statement affects 1 row even when it changes nothing.

Both controller routes return `{ success: true }`.

- [ ] **Step 4:** Run `pnpm jest update-clinic pause-delivery` — expect PASS.

- [ ] **Step 5 (e2e):** create `test/admin/admin-clinics-write.e2e-spec.ts`. Assert: a partial `PUT` changes only the named fields and leaves the others untouched (read the clinic back via `GET /admin/clinics/:id`); sending `city` and `stateCode` updates `location` to `"City, ST"`; an unknown `status` leaves `status` unchanged and still returns 200; `pause-delivery {paused:true}` sets status `paused` and `notifyOnLead` false; `{paused:false}` on an `active` clinic leaves it `active`; `{paused:false}` on a `paused` clinic returns it to `active` with `notifyOnLead` true; 404 on an unknown id for both routes; 403 for a non-admin.

- [ ] **Step 6:** Run `pnpm test:e2e -- admin-clinics-write` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit.

```bash
git add src/modules/admin-clinics test/admin/admin-clinics-write.e2e-spec.ts
git commit -m "feat(admin-clinics): add clinic update and pause-delivery endpoints"
```

---

### Task 6: Clinic leads + admin notes

**Files:**

- Create: `src/modules/admin-clinics/domain/ports/admin-note-repository.port.ts`
- Create: `src/modules/admin-clinics/application/list-clinic-leads.use-case.ts`, `list-notes.use-case.ts`, `add-note.use-case.ts`
- Create: `src/modules/admin-clinics/infrastructure/prisma-admin-note.repository.ts`
- Create: `src/modules/admin-clinics/infrastructure/http/dto/admin-lead-row.dto.ts`, `admin-note.dto.ts`, `add-note.dto.ts`
- Modify: `admin-clinics.controller.ts`, `admin-clinics.module.ts`, `prisma-admin-clinic.repository.ts` (add `clinicExists`)
- Test: three use-case specs; `test/admin/admin-clinic-notes.e2e-spec.ts`

**Interfaces produced:**

```ts
export interface AdminLeadRow {
  lead_id: string; received_at: string; patientFirstName: string; patientEmail: string;
  patientZip: string; treatmentCategory: string; delivery_status: string; clinic_status: string;
}

export interface AdminNote { id: string; createdAt: string; authorName: string; body: string }

export interface AdminNoteRepositoryPort {
  listNotes(ctx: AdminCtx, clinicId: string): Promise<AdminNote[]>;
  addNote(ctx: AdminCtx, clinicId: string, body: string): Promise<AdminNote>;
  getAuthorName(ctx: AdminCtx, userId: string): Promise<string | null>;
}
export const ADMIN_NOTE_REPOSITORY: symbol;

// added to AdminClinicRepositoryPort:
clinicExists(ctx: AdminCtx, clinicId: string): Promise<boolean>;
listClinicLeads(ctx: AdminCtx, clinicId: string): Promise<AdminLeadRow[]>;
```

**Read spec §1.4 and §1.5 before starting.**

> **The `AdminLeadRow` field names are deliberately mixed case.** `lead_id`, `received_at`, `delivery_status`, and `clinic_status` are snake_case; `patientFirstName`, `patientEmail`, `patientZip`, and `treatmentCategory` are camelCase. This matches the TypeScript interface the frontend already binds to. Reproduce it exactly; do not "fix" it to one convention.

- [ ] **Step 1 (test):** create the three use-case specs. All three must assert a `NotFoundException` with message `Clinic not found.` when `clinicExists` resolves `false`. `add-note.use-case.spec.ts` must additionally assert:

```ts
it('uses the admin display name as the author name', async () => {
  noteRepo.getAuthorName.mockResolvedValue('Dana Reed');
  await useCase.execute(ctx, 'c1', 'note body');
  expect(noteRepo.addNote).toHaveBeenCalledWith(ctx, 'c1', 'note body');
});

it('falls back to "Admin" when the user has no name', async () => {
  noteRepo.getAuthorName.mockResolvedValue(null);
  // assert the repository receives 'Admin' as the author name
});
```

Include a `list-clinic-leads.use-case.spec.ts` asserting the mixed-case keys survive the use case untouched.

- [ ] **Step 2:** Run `pnpm jest list-clinic-leads list-notes add-note` — expect FAIL.

- [ ] **Step 3:** Implement.

`listClinicLeads` (ordered by `received_at` descending), returning the mixed-case shape. Convert the timestamp to ISO 8601 with `.toISOString()` and `null` zip to `''`:

```sql
SELECT lead_id            AS "lead_id",
       received_at        AS "received_at",
       patient_first_name AS "patientFirstName",
       patient_email      AS "patientEmail",
       patient_zip        AS "patientZip",
       treatment_category AS "treatmentCategory",
       delivery_status    AS "delivery_status",
       clinic_status      AS "clinic_status"
  FROM leads
 WHERE clinic_id = ${clinicId}::uuid
 ORDER BY received_at DESC
```

`addNote` resolves the author name from `users.name` for `ctx.userId`, falling back to `'Admin'`, and stores it denormalized in `author_name` along with `author_user_id = ctx.userId`. The author id comes from the context, never the request body.

`listNotes` orders by `created_at` descending; `createdAt` serializes as ISO 8601 (`.toISOString()`).

`AddNoteDto`: `@IsString() @IsNotEmpty() @MaxLength(4000) body!: string;`

`POST /:id/notes` returns the created `AdminNote` (not `{success:true}`).

- [ ] **Step 4:** Run `pnpm jest list-clinic-leads list-notes add-note` — expect PASS.

- [ ] **Step 5 (e2e):** create `test/admin/admin-clinic-notes.e2e-spec.ts`. Assert: `GET /:id/leads` returns rows whose keys are **literally** `['lead_id','received_at','patientFirstName','patientEmail','patientZip','treatmentCategory','delivery_status','clinic_status']` (assert with `Object.keys(...).sort()` against the sorted expected list, so a renamed field fails loudly); leads are newest-first; posting a note returns it and a subsequent `GET /:id/notes` includes it newest-first; the stored `authorName` matches the signed-in admin; a 4001-character body returns 400; all three routes 404 on an unknown clinic and 403 for a non-admin.

- [ ] **Step 6:** Run `pnpm test:e2e -- admin-clinic-notes` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit.

```bash
git add src/modules/admin-clinics test/admin/admin-clinic-notes.e2e-spec.ts
git commit -m "feat(admin-clinics): add clinic leads and admin notes endpoints"
```

---

### Task 7: Clinic password routes

**Files:**

- Create: `src/modules/admin-clinics/application/send-clinic-password-reset.use-case.ts`, `set-clinic-password.use-case.ts`
- Create: `src/infrastructure/http/dto/set-password.dto.ts` (shared with Task 11, so neither admin module imports from its sibling)
- Modify: `prisma-admin-clinic.repository.ts` (add `findClinicUser`), `admin-clinics.controller.ts`, `admin-clinics.module.ts`
- Test: two use-case specs; `test/admin/admin-clinic-password.e2e-spec.ts`

**Interfaces produced:**

```ts
// added to AdminClinicRepositoryPort:
findClinicUser(ctx: AdminCtx, clinicId: string): Promise<{ userId: string; email: string } | null>;
```

**Consumes:** `PASSWORD_RESET_REPOSITORY` (`issue`, `updatePasswordHash`) and `generateResetToken`, `RESET_TOKEN_TTL_MINUTES` from `src/modules/auth/domain/reset-token.ts`; `PASSWORD_HASHER` (`hash`); `EMAIL_SENDER` (`send`); `ConfigService` for `APP_BASE_URL`; `AUDIT` from `src/modules/auth/domain/ports/audit.port.ts`.

**Do not reimplement token generation or password hashing.** Reuse the Slice 4 ports. Model the email link on `src/modules/auth/application/forgot-password.use-case.ts`.

- [ ] **Step 1 (test):** create the two use-case specs.

`send-clinic-password-reset.use-case.spec.ts`:

```ts
it('throws NotFoundException when the clinic has no linked user', async () => {
  repo.findClinicUser.mockResolvedValue(null);
  await expect(useCase.execute(ctx, 'c1')).rejects.toThrow(
    'No user account found for this clinic.',
  );
});

it('issues a token and emails the reset link', async () => {
  repo.findClinicUser.mockResolvedValue({ userId: 'u9', email: 'clinic@example.com' });
  await useCase.execute(ctx, 'c1');
  expect(resetRepo.issue).toHaveBeenCalledWith('u9', expect.any(String), expect.any(Date));
  const [, hash] = resetRepo.issue.mock.calls[0];
  expect(hash).toHaveLength(64); // sha256 hex, never the raw token
  const [to, , link] = emailSender.send.mock.calls[0];
  expect(to).toBe('clinic@example.com');
  expect(link).toContain('/reset-password?email=clinic%40example.com&token=');
});
```

Note the contrast with `/auth/forgot-password`: this route is **not** enumeration-safe. It must throw 404 when no account exists, because the caller is an authenticated admin who needs to know the operation failed (spec §2.1).

`set-clinic-password.use-case.spec.ts`:

```ts
it('hashes the new password and stores the hash', async () => {
  repo.findClinicUser.mockResolvedValue({ userId: 'u9', email: 'c@example.com' });
  hasher.hash.mockResolvedValue('argon2-hash');
  await useCase.execute(ctx, 'c1', 'NewPassw0rd!');
  expect(hasher.hash).toHaveBeenCalledWith('NewPassw0rd!');
  expect(resetRepo.updatePasswordHash).toHaveBeenCalledWith('u9', 'argon2-hash');
});

it('writes an audit entry naming the acting admin', async () => {
  repo.findClinicUser.mockResolvedValue({ userId: 'u9', email: 'c@example.com' });
  await useCase.execute(ctx, 'c1', 'NewPassw0rd!');
  expect(audit.record).toHaveBeenCalledWith(
    expect.objectContaining({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      actionType: 'admin_set_password',
      affectedRecord: 'u9',
    }),
  );
});

it('throws NotFoundException when the clinic has no linked user', ...);
```

The audit entry is a required mitigation for the accepted risk in spec §4.4. Do not omit it.

- [ ] **Step 2:** Run `pnpm jest send-clinic-password-reset set-clinic-password` — expect FAIL.

- [ ] **Step 3:** Implement. `SetPasswordDto`: `@IsString() @MinLength(8) newPassword!: string;`. Both routes return `{ success: true }`. `findClinicUser` selects `id, email FROM users WHERE clinic_id = $1 LIMIT 1`.

- [ ] **Step 4:** Run `pnpm jest send-clinic-password-reset set-clinic-password` — expect PASS.

- [ ] **Step 5 (e2e):** create `test/admin/admin-clinic-password.e2e-spec.ts`. Assert: `send-password-reset` returns `{success:true}` and inserts exactly one `password_reset_tokens` row for that user whose `token_hash` is not the raw token from the emailed link; `set-password` returns `{success:true}` and the clinic user can afterwards sign in with the new password through the real sign-in flow; a `set-password` body shorter than 8 characters returns 400; a clinic with no linked user returns 404 on both; a non-admin gets 403 on both.

- [ ] **Step 6:** Run `pnpm test:e2e -- admin-clinic-password` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit.

```bash
git add src/modules/admin-clinics test/admin/admin-clinic-password.e2e-spec.ts
git commit -m "feat(admin-clinics): add clinic password reset and set-password endpoints"
```

---

### Task 8: PHI access interceptor

**Files:**

- Create: `src/modules/admin-patients/infrastructure/http/phi-access.interceptor.ts`
- Test: `src/modules/admin-patients/infrastructure/http/__tests__/phi-access.interceptor.spec.ts`

**Interfaces produced:**

```ts
@Injectable()
export class PhiAccessInterceptor implements NestInterceptor {
  constructor(@Inject(AUDIT) private readonly audit: AuditPort) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown>;
}
```

**Consumes:** `AUDIT` / `AuditPort` (`record(e: AuditEvent)`) from `src/modules/auth/domain/ports/audit.port.ts`. `AuditEvent` fields are exactly: `actorUserId`, `actorRole`, `ip`, `actionType`, `affectedRecord`, `notes?`. `affectedRecord` is a required non-nullable `string`, matching the `NOT NULL` column `audit_log.affected_record`.

**Read spec §4.2 before starting.**

Mapping onto `AuditEvent` (it has no dedicated method/path field, so):

- `actionType` = `'phi_access'` (constant)
- `actorUserId` = `request.user.sub`, `actorRole` = `request.user.role`
- `ip` = `request.ip`
- `affectedRecord` = the `:id` route param, or the request path (`req.path`) on the list route, which has no `:id`. It must never be null or empty: `audit_log.affected_record` is `NOT NULL`, and a null would make the insert fail and be silently swallowed by the error handling below.
- `notes` = `` `${method} ${path}` ``

A failed audit write must be logged via the Nest `Logger` and **swallowed**, so the request still succeeds (spec §4.2).

- [ ] **Step 1 (test):** create `src/modules/admin-patients/infrastructure/http/__tests__/phi-access.interceptor.spec.ts`:

```ts
import { of, lastValueFrom } from 'rxjs';
import { PhiAccessInterceptor } from '../phi-access.interceptor';

function ctxFor(req: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

describe('PhiAccessInterceptor', () => {
  const audit = { record: jest.fn() };
  const interceptor = new PhiAccessInterceptor(audit);
  const next = { handle: () => of('payload') };

  beforeEach(() => jest.resetAllMocks());

  it('records a phi_access entry with the actor, ip, and resource id', async () => {
    const req = {
      user: { sub: 'admin-1', role: 'admin' },
      ip: '10.0.0.4',
      method: 'GET',
      path: '/admin/patients/p1',
      params: { id: 'p1' },
    };
    await lastValueFrom(interceptor.intercept(ctxFor(req), next));
    expect(audit.record).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      actorRole: 'admin',
      ip: '10.0.0.4',
      actionType: 'phi_access',
      affectedRecord: 'p1',
      notes: 'GET /admin/patients/p1',
    });
  });

  it('records the request path as affectedRecord on the list route', async () => {
    const req = {
      user: { sub: 'admin-1', role: 'admin' },
      ip: '10.0.0.4',
      method: 'GET',
      path: '/admin/patients',
      params: {},
    };
    await lastValueFrom(interceptor.intercept(ctxFor(req), next));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ affectedRecord: '/admin/patients' }),
    );
  });

  it('still returns the response when the audit write fails', async () => {
    audit.record.mockRejectedValue(new Error('audit down'));
    const req = {
      user: { sub: 'admin-1', role: 'admin' },
      ip: '10.0.0.4',
      method: 'GET',
      path: '/admin/patients',
      params: {},
    };
    await expect(lastValueFrom(interceptor.intercept(ctxFor(req), next))).resolves.toBe('payload');
  });
});
```

- [ ] **Step 2:** Run `pnpm jest phi-access.interceptor` — expect FAIL.

- [ ] **Step 3:** Implement. The audit write happens before delegating to `next.handle()`, so an access is recorded even if the handler later throws.

- [ ] **Step 4:** Run `pnpm jest phi-access.interceptor` — expect PASS (3 tests). Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 5:** Commit.

```bash
git add src/modules/admin-patients/infrastructure/http
git commit -m "feat(admin-patients): add PHI access audit interceptor"
```

---

### Task 9: Admin patient read paths (list + detail)

**Files:**

- Create: `src/modules/admin-patients/domain/patient-dto.mapper.ts`, `domain/ports/admin-patient-repository.port.ts`
- Create: `src/modules/admin-patients/application/list-patients.use-case.ts`, `get-patient.use-case.ts`
- Create: `src/modules/admin-patients/infrastructure/prisma-admin-patient.repository.ts`
- Create: `src/modules/admin-patients/infrastructure/http/admin-patients.controller.ts`
- Create: `src/modules/admin-patients/admin-patients.module.ts`
- Modify: `src/app.module.ts`
- Test: `domain/__tests__/patient-dto.mapper.spec.ts`; two use-case specs; `test/admin/admin-patients-read.e2e-spec.ts`

**Interfaces produced:**

```ts
export interface AdminPatientDto {
  id: string;
  name: string;
  email: string;
  dob: string | null;
  zipCode: string;
  createdAt: string;
  lastAssessmentAt: string | null;
  treatmentCategory: string | null;
  matchCount: number;
  isDeleted: boolean;
  deletedAt: string | null;
}

export interface AdminPatientRow {
  id: string;
  name: string | null;
  email: string;
  date_of_birth: Date | null;
  zip_code: string | null;
  created_at: Date;
  last_assessment_at: Date | null;
  treatment_category: string | null;
  match_count: number;
  is_deleted: boolean;
  deleted_at: Date | null;
}

export function toAdminPatientDto(row: AdminPatientRow): AdminPatientDto;

export interface AdminPatientRepositoryPort {
  listPatients(ctx: AdminCtx): Promise<AdminPatientDto[]>;
  getPatient(ctx: AdminCtx, patientId: string): Promise<AdminPatientDto | null>;
}
export const ADMIN_PATIENT_REPOSITORY: symbol;
```

**Read spec §1.7 before starting.**

> **Never decrypt assessment fields here.** `treatment_category` is a plain enum column and is the only assessment data this slice exposes. Do not inject `ENCRYPTION_PORT` into this module.

- [ ] **Step 1 (test):** create `domain/__tests__/patient-dto.mapper.spec.ts` covering the §1.7 derivation rules:

```ts
it('prefers the user name', () => expect(toAdminPatientDto({ ...row, name: 'Alex' }).name).toBe('Alex'));
it('falls back to the email when name is null',
  () => expect(toAdminPatientDto({ ...row, name: null }).name).toBe(row.email));
it('converts a null zip to an empty string',
  () => expect(toAdminPatientDto({ ...row, zip_code: null }).zipCode).toBe(''));
it('formats dob, createdAt, lastAssessmentAt and deletedAt as yyyy-MM-dd', ...);
it('emits null dates as null', ...);
it('passes through a null treatmentCategory for a patient with no assessments', ...);
```

Import `formatDateOnly` from `src/infrastructure/format/date.ts` (Task 3) rather than writing a second date formatter. Import `AdminCtx` from `src/infrastructure/security/admin-ctx.ts`; do not import anything from the `admin-clinics` module.

Then the two use-case specs, mirroring Task 4 (forwarding of `ctx`; `NotFoundException` with `Patient not found.` on `null`).

- [ ] **Step 2:** Run `pnpm jest patient-dto.mapper list-patients get-patient` — expect FAIL.

- [ ] **Step 3:** Implement. Resolve everything in one query per call rather than N+1; the latest assessment and the lead count come from correlated subqueries:

```sql
SELECT p.id,
       u.name,
       u.email,
       p.date_of_birth      AS "date_of_birth",
       p.zip_code           AS "zip_code",
       p.created_at         AS "created_at",
       p.last_assessment_at AS "last_assessment_at",
       p.is_deleted         AS "is_deleted",
       p.deleted_at         AS "deleted_at",
       (SELECT a.treatment_category
          FROM patient_assessments a
         WHERE a.patient_id = p.id
         ORDER BY a.consent_given_at DESC
         LIMIT 1)                       AS "treatment_category",
       (SELECT COUNT(*) FROM leads l WHERE l.patient_id = p.id) AS "match_count"
  FROM patients p
  JOIN users u ON u.id = p.user_id
 ORDER BY p.created_at DESC
```

`COUNT(*)` returns `bigint`; convert with `Number(...)`. The list includes soft-deleted patients, flagged by `isDeleted` (spec §1.7).

Controller: same guard stack as the clinics controller, plus `@UseInterceptors(PhiAccessInterceptor)` at the class level (Task 8), and a tighter throttle on the list route only:

```ts
const PHI_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

@Get()
@Throttle(PHI_THROTTLE)
list(...) { ... }
```

Register `AdminPatientsModule` in `src/app.module.ts`.

- [ ] **Step 4:** Run `pnpm jest patient-dto.mapper list-patients get-patient` — expect PASS.

- [ ] **Step 5 (e2e):** create `test/admin/admin-patients-read.e2e-spec.ts`. Assert: an admin gets 200 and an array; results are newest-first; a soft-deleted patient appears with `isDeleted: true`; `GET /:id` returns the matching patient; an unknown UUID returns 404 `Patient not found.`; a non-admin gets 403 on both. Additionally assert **a `phi_access` audit row is written for each call** by querying `audit_log` for `action_type = 'phi_access'` before and after. Assert the response body of `GET /:id` contains no ciphertext: its keys are exactly the eleven `AdminPatientDto` fields.

- [ ] **Step 6:** Run `pnpm test:e2e -- admin-patients-read` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit.

```bash
git add src/modules/admin-patients src/app.module.ts test/admin/admin-patients-read.e2e-spec.ts
git commit -m "feat(admin-patients): add patient list and detail endpoints"
```

---

### Task 10: Patient update + soft delete

**Files:**

- Modify: `src/modules/admin-patients/domain/ports/admin-patient-repository.port.ts`
- Create: `src/modules/admin-patients/application/update-patient.use-case.ts`, `soft-delete-patient.use-case.ts`
- Create: `src/modules/admin-patients/infrastructure/http/dto/update-patient.dto.ts`
- Modify: `prisma-admin-patient.repository.ts`, `admin-patients.controller.ts`, `admin-patients.module.ts`
- Test: two use-case specs; `test/admin/admin-patients-write.e2e-spec.ts`

**Interfaces produced:**

```ts
export const DELETED_LOCK_UNTIL = new Date('9999-12-31T23:59:59.000Z');

export interface UpdatePatientInput { name?: string; dob?: string; zipCode?: string }

export type PatientWriteResult = 'ok' | 'not_found' | 'already_deleted';

// added to AdminPatientRepositoryPort:
updatePatient(ctx: AdminCtx, patientId: string, input: UpdatePatientInput): Promise<PatientWriteResult>;
softDeletePatient(ctx: AdminCtx, patientId: string): Promise<PatientWriteResult>;
```

**Read spec §1.8 and §3.3 before starting.**

- [ ] **Step 1 (test):** create the two use-case specs.

`update-patient.use-case.spec.ts`:

```ts
it('throws NotFoundException when the repository reports not_found', ...);       // 'Patient not found.'
it('throws ConflictException when the repository reports already_deleted', ...);
it('drops an unparseable dob instead of rejecting the request', async () => {
  repo.updatePatient.mockResolvedValue('ok');
  await useCase.execute(ctx, 'p1', { name: 'Alex', dob: 'not-a-date' });
  expect(repo.updatePatient).toHaveBeenCalledWith(ctx, 'p1', { name: 'Alex' });
});
it('keeps a valid dob', async () => {
  repo.updatePatient.mockResolvedValue('ok');
  await useCase.execute(ctx, 'p1', { dob: '1985-04-12' });
  expect(repo.updatePatient).toHaveBeenCalledWith(ctx, 'p1', { dob: '1985-04-12' });
});
```

`soft-delete-patient.use-case.spec.ts`: the 404 and 409 paths, and that `'ok'` yields `{ success: true }`.

- [ ] **Step 2:** Run `pnpm jest update-patient soft-delete-patient` — expect FAIL.

- [ ] **Step 3:** Implement.

`UpdatePatientDto`: three `@IsOptional() @IsString()` fields. Do **not** add `@IsDateString()` to `dob` — an unparseable value must be silently ignored, not rejected with a 400 (spec §1.8). The use case validates it with `Number.isNaN(Date.parse(dob))` and drops it when invalid.

`updatePatient` runs inside one `withUserContext` transaction: `SELECT is_deleted FROM patients WHERE id = $1` first, returning `'not_found'` or `'already_deleted'` as appropriate; then `UPDATE users SET name = ...` for `name` (it lives on `users`, not `patients`) and `UPDATE patients SET ...` for `zipCode` / `dob`.

`softDeletePatient` performs both writes in **one transaction** (spec §3.3):

```ts
await tx.$executeRaw`
  UPDATE patients SET is_deleted = true, deleted_at = now() WHERE id = ${patientId}::uuid`;
await tx.$executeRaw`
  UPDATE users SET locked_until = ${DELETED_LOCK_UNTIL}
   WHERE id = (SELECT user_id FROM patients WHERE id = ${patientId}::uuid)`;
```

Use the exact sentinel `9999-12-31T23:59:59Z`, not Postgres `infinity`, which does not round-trip through Prisma's `DateTime` (spec §3.3).

`PUT` returns `{ success: true }`; `DELETE` returns `{ success: true }`.

- [ ] **Step 4:** Run `pnpm jest update-patient soft-delete-patient` — expect PASS.

- [ ] **Step 5 (e2e):** create `test/admin/admin-patients-write.e2e-spec.ts`. Assert: a partial `PUT` updating `name` changes `users.name` and leaves `zipCode` and `dob` untouched; an unparseable `dob` returns 200 and leaves `dob` unchanged; `PUT` on a soft-deleted patient returns 409; `DELETE` returns `{success:true}` and sets `isDeleted` true; a second `DELETE` returns 409; both routes 404 on an unknown id and 403 for a non-admin.

- [ ] **Step 6 (regression test, spec §3.3):** in the same e2e file, add the test that pins the deletion lock. This behavior holds today only as a consequence of how `reset-password.use-case.ts` is written, so it needs its own guard:

```ts
it('keeps a soft-deleted patient locked out even after a valid password reset', async () => {
  // 1. admin soft-deletes the patient
  await request(app.getHttpServer())
    .delete(`/admin/patients/${patientId}`)
    .set('Cookie', adminCookie)
    .expect(200);

  // 2. the patient completes a full, valid forgot-password + reset-password cycle
  //    (drive it through the real endpoints; read the raw token from the captured email)
  await request(app.getHttpServer())
    .post('/auth/reset-password')
    .send({ email: patientEmail, token: rawToken, newPassword: 'BrandNewPassw0rd!' })
    .expect(201);

  // 3. sign-in with the NEW password must still be refused: the deletion lock survives
  const res = await request(app.getHttpServer())
    .post('/auth/signin')
    .send({ email: patientEmail, password: 'BrandNewPassw0rd!' });
  expect(res.status).toBeGreaterThanOrEqual(400);
});
```

- [ ] **Step 7:** Run `pnpm test:e2e -- admin-patients-write` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 8:** Commit.

```bash
git add src/modules/admin-patients test/admin/admin-patients-write.e2e-spec.ts
git commit -m "feat(admin-patients): add patient update and soft-delete endpoints"
```

---

### Task 11: Patient password routes

**Files:**

- Create: `src/modules/admin-patients/application/send-patient-password-reset.use-case.ts`, `set-patient-password.use-case.ts`
- Modify: `prisma-admin-patient.repository.ts` (add `findPatientUser`), `admin-patients.controller.ts`, `admin-patients.module.ts`
- Test: two use-case specs; `test/admin/admin-patient-password.e2e-spec.ts`

**Interfaces produced:**

```ts
// added to AdminPatientRepositoryPort:
findPatientUser(ctx: AdminCtx, patientId: string): Promise<{ userId: string; email: string } | null>;
```

**Consumes:** the same Slice 4 ports as Task 7, plus `AUDIT`. Import `SetPasswordDto` from `src/infrastructure/http/dto/set-password.dto.ts` (created in Task 7) rather than defining a second identical DTO.

- [ ] **Step 1 (test):** create the two use-case specs, mirroring Task 7 but with `Patient not found.` as the 404 message. `set-patient-password.use-case.spec.ts` must additionally assert the audit entry:

```ts
expect(audit.record).toHaveBeenCalledWith(
  expect.objectContaining({
    actorUserId: ctx.userId,
    actionType: 'admin_set_password',
    affectedRecord: 'u9',
  }),
);
```

- [ ] **Step 2:** Run `pnpm jest send-patient-password-reset set-patient-password` — expect FAIL.

- [ ] **Step 3:** Implement. Both routes return `{ success: true }`. Both are covered by the class-level `PhiAccessInterceptor` from Task 8, which supplies the `phi_access` record required by spec §4.4; the `admin_set_password` audit entry is separate and additional.

- [ ] **Step 4:** Run `pnpm jest send-patient-password-reset set-patient-password` — expect PASS.

- [ ] **Step 5 (e2e):** create `test/admin/admin-patient-password.e2e-spec.ts`. Assert: `send-password-reset` inserts exactly one `password_reset_tokens` row whose `token_hash` is not the raw token; `set-password` lets the patient sign in with the new password; a body shorter than 8 characters returns 400; both 404 on an unknown patient and 403 for a non-admin; and both write a `phi_access` audit row plus, for `set-password`, an `admin_set_password` row.

- [ ] **Step 6:** Run `pnpm test:e2e -- admin-patient-password` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit.

```bash
git add src/modules/admin-patients test/admin/admin-patient-password.e2e-spec.ts
git commit -m "feat(admin-patients): add patient password reset and set-password endpoints"
```

---

### Task 12: Seeds, OpenAPI, README

**Files:**

- Modify: `prisma/seed/patient-journey.seed.ts`
- Modify: `prisma/seed/cleanup-demo.ts` (remove seeded admin notes)
- Modify: `openapi.json` (regenerated), `scripts/generate-openapi.ts`, `README.md`
- Test: `test/db/admin-seed.int-spec.ts`

**Interfaces produced:** two seeded `admin_notes` rows on the first demo clinic, authored by the seeded superadmin; one seeded patient in the soft-deleted state.

- [ ] **Step 1 (test):** create `test/db/admin-seed.int-spec.ts`:

```ts
it('seeds admin notes on a demo clinic', async () => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM admin_notes
      WHERE clinic_id = (SELECT id FROM clinics WHERE slug = 'vitality-hormone-nyc')`,
  );
  expect(rows[0].n).toBeGreaterThanOrEqual(2);
});

it('seeds one soft-deleted patient', async () => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM patients WHERE is_deleted = true`,
  );
  expect(rows[0].n).toBeGreaterThanOrEqual(1);
});

it('locks the soft-deleted patient out of sign-in', async () => {
  const { rows } = await pool.query(
    `SELECT u.locked_until FROM users u
       JOIN patients p ON p.user_id = u.id WHERE p.is_deleted = true LIMIT 1`,
  );
  expect(new Date(rows[0].locked_until).getUTCFullYear()).toBe(9999);
});
```

- [ ] **Step 2:** Run `pnpm test:int -- admin-seed` — expect FAIL.

- [ ] **Step 3:** Extend `prisma/seed/patient-journey.seed.ts`. Keep it **idempotent** (check-before-create), matching the existing seed style. Add:

- two `admin_notes` on the `vitality-hormone-nyc` clinic, `author_user_id` = the seeded superadmin, `author_name` = that user's name.
- a third patient user `patient-deleted@medalign-seed.example.com` (password `SeedPatient1!`) whose patient row has `is_deleted = true`, `deleted_at = now()`, and whose user has `locked_until = '9999-12-31T23:59:59Z'`.

Update the seed file's header comment block to list the new rows and the new credential, matching how the existing entries are documented.

- [ ] **Step 4:** Extend `prisma/seed/cleanup-demo.ts`. `admin_notes` cascade when their clinic is deleted, but under `KEEP_CLINICS = true` they would survive, so delete them explicitly **before** the clinics step, scoped to the demo clinic slugs:

```ts
await del(
  'admin_notes',
  `DELETE FROM admin_notes
    WHERE clinic_id IN (SELECT id FROM clinics WHERE slug = ANY($1::text[]))`,
  [DEMO_CLINIC_SLUGS],
);
```

The new deleted-patient user is already covered by the existing `%@medalign-seed.example.com` rule.

- [ ] **Step 5:** Run `pnpm seed:pj` twice — it must succeed both times (idempotent). Run `pnpm test:int -- admin-seed` — expect PASS. Run `pnpm cleanup:demo` then `pnpm seed:pj` to confirm the cleanup leaves no orphans.

- [ ] **Step 6:** Register the two new controllers in `scripts/generate-openapi.ts`: import `AdminClinicsController` and `AdminPatientsController`, add both to the `controllers` array, and add a `stubProvider(...)` line for every use case they inject (15 total across the two). Run `pnpm openapi` and confirm `openapi.json` gains all 15 paths.

- [ ] **Step 7:** Update `README.md` with the new endpoint group and the new seed credential, following the existing section format.

- [ ] **Step 8:** Run the full suite: `pnpm test && pnpm test:int && pnpm test:e2e`, then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 9:** Commit.

```bash
git add prisma/seed scripts/generate-openapi.ts openapi.json README.md test/db/admin-seed.int-spec.ts
git commit -m "feat(admin): seed admin notes and deleted patient, refresh openapi and docs"
```

---

## Deploy notes

- Two migrations to apply in production: `20260720100000_admin_clinics_patients` and `20260720110000_admin_clinics_patients_rls`, via `prisma migrate deploy` on the direct/session connection.
- No new environment variables.
- Frontend work this unblocks: admin clinic list/detail/edit screens, a notes panel, admin patient list/detail, and the password actions. The mixed-case `AdminLeadRow` contract matches the existing TypeScript interface, so that binding is unchanged.
