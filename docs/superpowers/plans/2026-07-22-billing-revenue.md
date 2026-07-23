# Billing Revenue & Weekly Summary (Slice 8 / Subsystem 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a revenue dashboard (stats + per-clinic breakdown) and an admin-JWT way to run billing jobs, and add a weekly-summary job — the last billing subsystem.

**Architecture:** Extends the existing `billing` module. Two admin read endpoints compute revenue from `clinics`/`leads` (reusing the $49/$90 constants). A `WeeklySummaryJob` joins the two existing jobs. A shared `RunBillingJobService` (extracted from the current shared-secret trigger) backs both the cron endpoint and a new admin-JWT trigger endpoint.

**Tech Stack:** NestJS 10, Prisma 7 + `@prisma/adapter-pg`, Postgres RLS, Jest.

## Global Constraints

- Contract mirrors the .NET `AdminRevenueController` + `WeeklySummaryJob`. Exact fields/amounts live in the spec (`docs/superpowers/specs/2026-07-22-billing-revenue-design.md`). Read the spec section named in each task.
- Fee constants, exact: monthly fee `49`, price per lead `90` — the same `PLATFORM_FEE`/`PRICE_PER_LEAD` from `src/modules/billing/domain/billing-fee.ts`.
- Ids are UUID strings. Admin reads run under `withUserContext({ userId, role, ip: null })` with admin id/role ONLY from `@CurrentUser()`. The `WeeklySummaryJob` runs `asSystem` (system process). `asSystem` is NOT itself a transaction.
- `count(*)` from Postgres is `bigint` → convert with `Number(...)` before it reaches a DTO/JSON.
- No migrations, no new env vars.
- No `any` in production code. `Symbol` DI tokens. Keep `openapi.json` current (`pnpm openapi`); update README. No `Co-Authored-By` / Anthropic / Claude commit trailers. Node 24, pnpm.
- **File layout convention** (matches `src/modules/billing/`): domain at `domain/`, use cases/jobs/services at `application/*.ts`, repository at `infrastructure/prisma-billing.repository.ts`, controllers/dtos at `infrastructure/http/`. Prisma client import `../../../../generated/prisma/client`. `PrismaService` at `src/infrastructure/prisma/prisma.service.ts`.
- Local DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`; suites read `test/.env.test` (local). Integration/e2e specs that mutate the 6 seeded demo clinics MUST snapshot/restore them so the shared DB stays clean (mirror the prior job specs).
- Verification per task: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean before commit.

## File Structure

```
src/modules/billing/
  domain/revenue-math.ts                          Task 1  (pure)
  application/weekly-summary.job.ts               Task 2
  application/run-billing-job.service.ts          Task 3  (shared runner)
  application/get-revenue-stats.use-case.ts       Task 4
  application/get-revenue-clinics.use-case.ts     Task 5
  infrastructure/prisma-billing.repository.ts     Tasks 2,4,5 (+ read methods)
  infrastructure/http/admin-revenue.controller.ts Tasks 4,5,6
  infrastructure/http/billing-jobs.controller.ts  Task 3 (refactor to the runner)
  infrastructure/http/dto/revenue-stats.dto.ts    Task 4
  infrastructure/http/dto/clinic-revenue-row.dto.ts Task 5
  billing.module.ts                               Tasks 2,3,4 (register providers/controller)
scripts/generate-openapi.ts                        Tasks 4-6
README.md                                          Task 7
```

---

### Task 1: Revenue math (`revenue-math.ts`, pure)

**Files:**

- Create: `src/modules/billing/domain/revenue-math.ts`
- Test: `src/modules/billing/domain/__tests__/revenue-math.spec.ts`

**Read spec §2 before starting.**

**Interfaces produced:**

```ts
export interface RevenueStats {
  mrr: number;
  leadRevenueMtd: number;
  totalRevenueMtd: number;
  activeClinicCount: number;
  overdueCount: number;
  leadsThisMonth: number;
}
export function computeRevenueStats(input: {
  activeClinicCount: number;
  overdueCount: number;
  leadsThisMonth: number;
}): RevenueStats;
export function clinicMonthlyFee(status: string, billingStatus: string): number;
export function clinicLeadRevenue(leadsThisMonth: number): number;
```

**Consumes:** `PLATFORM_FEE` (49), `PRICE_PER_LEAD` (90) from `billing-fee.ts`.

- [ ] **Step 1 (test):** create `revenue-math.spec.ts`:

```ts
import { computeRevenueStats, clinicMonthlyFee, clinicLeadRevenue } from '../revenue-math';

describe('computeRevenueStats', () => {
  it('derives mrr, lead revenue, and total from the counts', () => {
    const r = computeRevenueStats({ activeClinicCount: 4, overdueCount: 1, leadsThisMonth: 7 });
    expect(r.mrr).toBe(196); // 4 * 49
    expect(r.leadRevenueMtd).toBe(630); // 7 * 90
    expect(r.totalRevenueMtd).toBe(826); // 196 + 630
    expect(r.activeClinicCount).toBe(4);
    expect(r.overdueCount).toBe(1);
    expect(r.leadsThisMonth).toBe(7);
  });

  it('is all zeros for an empty system', () => {
    expect(
      computeRevenueStats({ activeClinicCount: 0, overdueCount: 0, leadsThisMonth: 0 }),
    ).toEqual({
      mrr: 0,
      leadRevenueMtd: 0,
      totalRevenueMtd: 0,
      activeClinicCount: 0,
      overdueCount: 0,
      leadsThisMonth: 0,
    });
  });
});

describe('clinicMonthlyFee', () => {
  it('is 49 for an active, current clinic', () => {
    expect(clinicMonthlyFee('active', 'current')).toBe(49);
  });
  it('is 0 when the clinic status is suspended', () => {
    expect(clinicMonthlyFee('suspended', 'overdue')).toBe(0);
  });
  it('is 0 when the billing status is paused', () => {
    expect(clinicMonthlyFee('active', 'paused')).toBe(0);
  });
});

describe('clinicLeadRevenue', () => {
  it('is leads times 90', () => {
    expect(clinicLeadRevenue(3)).toBe(270);
    expect(clinicLeadRevenue(0)).toBe(0);
  });
});
```

- [ ] **Step 2:** Run `pnpm jest revenue-math` — expect FAIL.

- [ ] **Step 3:** Create `revenue-math.ts`:

```ts
import { PLATFORM_FEE, PRICE_PER_LEAD } from './billing-fee';

export interface RevenueStats {
  mrr: number;
  leadRevenueMtd: number;
  totalRevenueMtd: number;
  activeClinicCount: number;
  overdueCount: number;
  leadsThisMonth: number;
}

export function computeRevenueStats(input: {
  activeClinicCount: number;
  overdueCount: number;
  leadsThisMonth: number;
}): RevenueStats {
  const mrr = input.activeClinicCount * PLATFORM_FEE;
  const leadRevenueMtd = input.leadsThisMonth * PRICE_PER_LEAD;
  return {
    mrr,
    leadRevenueMtd,
    totalRevenueMtd: mrr + leadRevenueMtd,
    activeClinicCount: input.activeClinicCount,
    overdueCount: input.overdueCount,
    leadsThisMonth: input.leadsThisMonth,
  };
}

export function clinicMonthlyFee(status: string, billingStatus: string): number {
  return status === 'suspended' || billingStatus === 'paused' ? 0 : PLATFORM_FEE;
}

export function clinicLeadRevenue(leadsThisMonth: number): number {
  return leadsThisMonth * PRICE_PER_LEAD;
}
```

- [ ] **Step 4:** Run `pnpm jest revenue-math` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 5:** Commit `feat(billing): add revenue math`.

---

### Task 2: Weekly summary job

**Files:**

- Create: `src/modules/billing/application/weekly-summary.job.ts`
- Modify: `src/modules/billing/domain/ports/billing-repository.port.ts` (add `listWeeklySummaryClinics`, `countLeadsSince`, `countAllLeads`), `prisma-billing.repository.ts`, `billing.module.ts`
- Test: `application/__tests__/weekly-summary.job.spec.ts` (unit), `test/billing/weekly-summary.int-spec.ts` (integration)

**Read spec §5 before starting.**

**Interfaces produced:**

```ts
export interface WeeklySummaryClinic { clinicId: string; clinicName: string; businessEmail: string | null }
// added to BillingRepositoryPort (asSystem):
listWeeklySummaryClinics(): Promise<WeeklySummaryClinic[]>;   // status='active' AND weekly_summary=true
countLeadsSince(clinicId: string, since: Date): Promise<number>;
countAllLeads(clinicId: string): Promise<number>;

export class WeeklySummaryJob { execute(now?: Date): Promise<JobResult>; }
```

**Consumes:** `JobResult` from `src/modules/billing/application/generate-invoices.job.ts` (re-export or import the existing type — it is exported there); `EMAIL_SENDER` (`src/modules/auth/infrastructure/adapters/email-sender.port.ts`, `send(to, subject, body)`).

**Read `src/modules/billing/application/suspend-overdue-accounts.job.ts` as your template** — same `JobResult` shape, same per-clinic try/catch, same best-effort email, same `asSystem` repo methods.

- [ ] **Step 1 (unit test):** `weekly-summary.job.spec.ts` mocks the repo + email:

```ts
it('emails each opted-in clinic its weekly and total lead counts', async () => {
  repo.listWeeklySummaryClinics.mockResolvedValue([
    { clinicId: 'c1', clinicName: 'Vitality', businessEmail: 'biz@c.test' },
  ]);
  repo.countLeadsSince.mockResolvedValue(3);
  repo.countAllLeads.mockResolvedValue(20);
  const r = await job.execute(new Date('2026-07-20T00:00:00Z'));
  expect(email.send).toHaveBeenCalledWith(
    'biz@c.test',
    expect.any(String),
    expect.stringContaining('3'),
  );
  expect(r).toMatchObject({ job: 'weekly-summary', processed: 1, skipped: 0, failed: 0 });
});

it('skips a clinic with no business email but still counts it processed=0/skipped or failed appropriately', async () => {
  repo.listWeeklySummaryClinics.mockResolvedValue([
    { clinicId: 'c1', clinicName: 'V', businessEmail: null },
  ]);
  repo.countLeadsSince.mockResolvedValue(0);
  repo.countAllLeads.mockResolvedValue(0);
  const r = await job.execute(new Date('2026-07-20T00:00:00Z'));
  expect(email.send).not.toHaveBeenCalled();
  // a clinic with no email is not a failure; count it as skipped
  expect(r.failed).toBe(0);
});

it('counts a clinic whose email throws as failed without stopping the batch', async () => {
  repo.listWeeklySummaryClinics.mockResolvedValue([
    { clinicId: 'c1', clinicName: 'A', businessEmail: 'a@c.test' },
    { clinicId: 'c2', clinicName: 'B', businessEmail: 'b@c.test' },
  ]);
  repo.countLeadsSince.mockResolvedValue(1);
  repo.countAllLeads.mockResolvedValue(1);
  email.send.mockRejectedValueOnce(new Error('smtp down')).mockResolvedValueOnce(undefined);
  const r = await job.execute(new Date('2026-07-20T00:00:00Z'));
  expect(r.failed).toBe(1);
  expect(r.processed).toBe(1);
});
```

- [ ] **Step 2:** Run `pnpm jest weekly-summary.job` — expect FAIL.

- [ ] **Step 3:** Implement. `weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)`. For each clinic from `listWeeklySummaryClinics`, in a per-clinic try/catch: `countLeadsSince(clinicId, weekAgo)` and `countAllLeads(clinicId)`; if `businessEmail` is non-null, `emailSender.send(businessEmail, 'Your MedAlign weekly summary', <body with leadsThisWeek and totalLeads>)` — the email body wording is your choice, but it MUST contain the weekly lead count. A clinic with no email is `skipped` (not `failed`); an email throw is `failed`; a success is `processed`. Returns `{ job: 'weekly-summary', processed, skipped, failed, details }` (include `details` only when non-empty, matching the existing jobs). The repo methods run `asSystem`; `count(*)` → `Number(...)`. `listWeeklySummaryClinics`:

```sql
SELECT id AS "clinicId", name AS "clinicName", business_email AS "businessEmail"
  FROM clinics WHERE status = 'active' AND weekly_summary = true
```

Register `WeeklySummaryJob` in `billing.module.ts` providers (and exports if the pattern exports the other jobs).

- [ ] **Step 4:** Run `pnpm jest weekly-summary.job` — expect PASS.

- [ ] **Step 5 (integration):** create `test/billing/weekly-summary.int-spec.ts`. Seed (via `asSystem`/pg, snapshot/restore demo-clinic state) an active clinic with `weekly_summary=true` + a `business_email` + a few recent leads, an active clinic with `weekly_summary=false`, and a suspended clinic with `weekly_summary=true`. Construct the job with the real `PrismaBillingRepository` and a stub email sender that records calls. Run `execute(fixedNow)`; assert ONLY the active+opted-in+has-email clinic was emailed, with a body containing its weekly lead count; the others were not. Leave the DB clean.

- [ ] **Step 6:** Run `pnpm test:int -- weekly-summary` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit `feat(billing): add weekly summary job`.

---

### Task 3: Shared job runner (refactor)

**Files:**

- Create: `src/modules/billing/application/run-billing-job.service.ts`
- Modify: `src/modules/billing/infrastructure/http/billing-jobs.controller.ts` (use the runner), `billing.module.ts` (provide the runner)
- Test: `application/__tests__/run-billing-job.service.spec.ts`; the existing `test/billing/job-trigger.e2e-spec.ts` must still pass (regression) and gains a `weekly-summary` trigger assertion.

**Read spec §6.1 before starting.**

**Interfaces produced:**

```ts
export interface JobAuditActor {
  userId: string | null;
  role: string;
  ip: string | null;
}
@Injectable()
export class RunBillingJobService {
  // resolves jobName -> job (400 BadRequestException on unknown); writes an
  // audit_log 'job_triggered' row with the given actor + affectedRecord=jobName;
  // awaits the job; returns its JobResult.
  run(jobName: string, actor: JobAuditActor): Promise<JobResult>;
}
```

**Consumes:** `GenerateInvoicesJob`, `SuspendOverdueAccountsJob`, `WeeklySummaryJob` (Task 2), `AUDIT`/`AuditPort` (`src/modules/auth/domain/ports/audit.port.ts`), `JobResult`.

- [ ] **Step 1 (test):** `run-billing-job.service.spec.ts` mocks the three jobs + `AUDIT`:

```ts
it('resolves and runs invoice-generation with an audit row', async () => {
  invoiceJob.execute.mockResolvedValue({
    job: 'invoice-generation',
    processed: 1,
    skipped: 0,
    failed: 0,
  });
  const r = await service.run('invoice-generation', {
    userId: null,
    role: 'system',
    ip: '1.2.3.4',
  });
  expect(audit.record).toHaveBeenCalledWith(
    expect.objectContaining({
      actorUserId: null,
      actorRole: 'system',
      ip: '1.2.3.4',
      actionType: 'job_triggered',
      affectedRecord: 'invoice-generation',
    }),
  );
  expect(r.job).toBe('invoice-generation');
});
it('runs account-suspension and weekly-summary', async () => {
  suspendJob.execute.mockResolvedValue({
    job: 'account-suspension',
    processed: 0,
    skipped: 0,
    failed: 0,
  });
  weeklyJob.execute.mockResolvedValue({
    job: 'weekly-summary',
    processed: 0,
    skipped: 0,
    failed: 0,
  });
  expect((await service.run('account-suspension', actor)).job).toBe('account-suspension');
  expect((await service.run('weekly-summary', actor)).job).toBe('weekly-summary');
});
it('records the audit with the given actor (admin case)', async () => {
  weeklyJob.execute.mockResolvedValue({
    job: 'weekly-summary',
    processed: 0,
    skipped: 0,
    failed: 0,
  });
  await service.run('weekly-summary', { userId: 'admin-1', role: 'admin', ip: '9.9.9.9' });
  expect(audit.record).toHaveBeenCalledWith(
    expect.objectContaining({ actorUserId: 'admin-1', actorRole: 'admin' }),
  );
});
it('throws 400 for an unknown job name', async () => {
  await expect(service.run('nope', actor)).rejects.toThrow(BadRequestException);
});
```

- [ ] **Step 2:** Run `pnpm jest run-billing-job.service` — expect FAIL.

- [ ] **Step 3:** Implement `RunBillingJobService`. It holds a `resolveJob(jobName)` mapping `'invoice-generation'`→`GenerateInvoicesJob`, `'account-suspension'`→`SuspendOverdueAccountsJob`, `'weekly-summary'`→`WeeklySummaryJob` (throw `BadRequestException(\`Unknown job: ${jobName}\`)`otherwise);`run(jobName, actor)`resolves, then`await this.audit.record({ actorUserId: actor.userId, actorRole: actor.role, ip: actor.ip, actionType: 'job_triggered', affectedRecord: jobName, notes: 'POST job ' + jobName })`, then `return job.execute()`.

Refactor `billing-jobs.controller.ts`: drop its own `resolveJob` + inline audit; inject `RunBillingJobService` and call `this.runner.run(jobName, { userId: null, role: 'system', ip })`. Keep `@Public()` + `@UseGuards(JobTriggerGuard)` + `@HttpCode(200)` and the `@Param('jobName')` + `@Ip()`. Register `RunBillingJobService` in `billing.module.ts` providers.

- [ ] **Step 4:** Run `pnpm jest run-billing-job.service` — expect PASS.

- [ ] **Step 5 (regression + new):** run `pnpm test:e2e -- job-trigger` — the existing shared-secret trigger tests must still pass (the refactor is behavior-preserving for the two jobs). Then extend that e2e with one case: `POST /admin/jobs/run/weekly-summary` with the correct `X-Job-Secret` → 200 with `job: 'weekly-summary'` (proving the cron can now trigger the third job). Run it — expect PASS.

- [ ] **Step 6:** `pnpm typecheck && pnpm lint && pnpm format:check`, then commit `refactor(billing): extract shared job runner and add weekly-summary to the job map`.

---

### Task 4: `GET /admin/revenue/stats`

**Files:**

- Create: `src/modules/billing/application/get-revenue-stats.use-case.ts`, `src/modules/billing/infrastructure/http/admin-revenue.controller.ts`, `src/modules/billing/infrastructure/http/dto/revenue-stats.dto.ts`
- Modify: `src/modules/billing/domain/ports/billing-repository.port.ts` (add `getRevenueCounts`), `prisma-billing.repository.ts`, `billing.module.ts` (register the controller + use case), `scripts/generate-openapi.ts`
- Test: `application/__tests__/get-revenue-stats.use-case.spec.ts`, `test/admin/admin-revenue.e2e-spec.ts`

**Read spec §3 before starting.**

**Interfaces produced:**

```ts
export interface AdminRevenueCtx { userId: string; role: string }
export interface RevenueCounts { activeClinicCount: number; overdueCount: number; leadsThisMonth: number }
// added to BillingRepositoryPort:
getRevenueCounts(ctx: AdminRevenueCtx, now: Date): Promise<RevenueCounts>;   // withUserContext admin
```

**Consumes:** `computeRevenueStats` (Task 1); `RolesGuard` + `@Roles` + `@CurrentUser`/`AuthenticatedUser` (`src/infrastructure/security/`).

- [ ] **Step 1 (unit test):** `get-revenue-stats.use-case.spec.ts` mocks the repo:

```ts
it('returns the computed revenue stats', async () => {
  repo.getRevenueCounts.mockResolvedValue({
    activeClinicCount: 4,
    overdueCount: 1,
    leadsThisMonth: 7,
  });
  const dto = await useCase.execute(
    { userId: 'a1', role: 'admin' },
    new Date('2026-07-15T00:00:00Z'),
  );
  expect(dto).toEqual({
    mrr: 196,
    leadRevenueMtd: 630,
    totalRevenueMtd: 826,
    activeClinicCount: 4,
    overdueCount: 1,
    leadsThisMonth: 7,
  });
  expect(repo.getRevenueCounts).toHaveBeenCalledWith(
    { userId: 'a1', role: 'admin' },
    new Date('2026-07-15T00:00:00Z'),
  );
});
```

- [ ] **Step 2:** Run `pnpm jest get-revenue-stats` — expect FAIL.

- [ ] **Step 3:** Implement. The use case takes `now` (controller passes `new Date()`), calls `getRevenueCounts`, returns `computeRevenueStats(counts)`. `getRevenueCounts` runs `withUserContext({ userId: ctx.userId, role: ctx.role, ip: null })` with `monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))`, in one query:

```sql
SELECT
  (SELECT count(*) FROM clinics WHERE status = 'active') AS "activeClinicCount",
  (SELECT count(*) FROM clinics WHERE billing_status = 'overdue') AS "overdueCount",
  (SELECT count(*) FROM leads WHERE received_at >= ${monthStart}) AS "leadsThisMonth"
```

Convert each `count(*)` with `Number(...)`. Create `AdminRevenueController`:

```ts
@ApiTags('Admin — Revenue')
@ApiCookieAuth('access_token')
@Controller('admin/revenue')
@Roles('admin', 'superadmin')
@UseGuards(RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class AdminRevenueController {
  @Get('stats')
  getStats(@CurrentUser() user: AuthenticatedUser): Promise<RevenueStatsDto> {
    return this.getRevenueStats.execute({ userId: user.sub, role: user.role }, new Date());
  }
}
```

`RevenueStatsDto` is a class with the six fields (spec §1.1) for OpenAPI. Register `AdminRevenueController` + `GetRevenueStatsUseCase` in `billing.module.ts` and `scripts/generate-openapi.ts`, then `pnpm openapi`.

- [ ] **Step 4:** Run `pnpm jest get-revenue-stats` — expect PASS.

- [ ] **Step 5 (e2e):** create `test/admin/admin-revenue.e2e-spec.ts`. Sign in as the seeded superadmin (see `test/admin/admin-clinics-read.e2e-spec.ts` for the helper) and override `STRIPE_PORT` with the fake (the billing module provides it). Assert: an admin gets 200 from `GET /admin/revenue/stats` with the six numeric fields present and `totalRevenueMtd === mrr + leadRevenueMtd`; a non-admin (patient) → 403. (Seed a known active clinic + a lead this month if you want to assert exact numbers, snapshot/restore demo state; otherwise assert the shape + the arithmetic invariant.)

- [ ] **Step 6:** Run `pnpm test:e2e -- admin-revenue` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit `feat(billing): add GET /admin/revenue/stats`.

---

### Task 5: `GET /admin/revenue/clinics`

**Files:**

- Create: `src/modules/billing/application/get-revenue-clinics.use-case.ts`, `src/modules/billing/infrastructure/http/dto/clinic-revenue-row.dto.ts`
- Modify: `src/modules/billing/domain/ports/billing-repository.port.ts` (add `getClinicRevenueRows`), `prisma-billing.repository.ts`, `admin-revenue.controller.ts` (add the route), `billing.module.ts`, `scripts/generate-openapi.ts`
- Test: `application/__tests__/get-revenue-clinics.use-case.spec.ts`, extend `test/admin/admin-revenue.e2e-spec.ts`

**Read spec §4 before starting.**

**Interfaces produced:**

```ts
export interface ClinicRevenueRaw { clinicId: string; clinicName: string; status: string; billingStatus: string; leadsThisMonth: number }
export interface AdminClinicRevenueRow {
  clinicId: string; clinicName: string; leadsThisMonth: number;
  leadRevenue: number; monthlyFee: number; total: number; billingStatus: string;
}
// added to BillingRepositoryPort:
getClinicRevenueRows(ctx: AdminRevenueCtx, now: Date): Promise<ClinicRevenueRaw[]>;  // withUserContext admin, ordered by name
```

**Consumes:** `clinicMonthlyFee`, `clinicLeadRevenue` (Task 1); `AdminRevenueCtx` (Task 4).

- [ ] **Step 1 (unit test):** `get-revenue-clinics.use-case.spec.ts`:

```ts
it('maps each clinic, zeroing the fee for suspended/paused', async () => {
  repo.getClinicRevenueRows.mockResolvedValue([
    {
      clinicId: 'c1',
      clinicName: 'Apex',
      status: 'active',
      billingStatus: 'current',
      leadsThisMonth: 2,
    },
    {
      clinicId: 'c2',
      clinicName: 'Vitality',
      status: 'suspended',
      billingStatus: 'overdue',
      leadsThisMonth: 1,
    },
  ]);
  const rows = await useCase.execute(
    { userId: 'a1', role: 'admin' },
    new Date('2026-07-15T00:00:00Z'),
  );
  expect(rows[0]).toEqual({
    clinicId: 'c1',
    clinicName: 'Apex',
    leadsThisMonth: 2,
    leadRevenue: 180,
    monthlyFee: 49,
    total: 229,
    billingStatus: 'current',
  });
  expect(rows[1]).toEqual({
    clinicId: 'c2',
    clinicName: 'Vitality',
    leadsThisMonth: 1,
    leadRevenue: 90,
    monthlyFee: 0,
    total: 90,
    billingStatus: 'overdue',
  });
});
```

- [ ] **Step 2:** Run `pnpm jest get-revenue-clinics` — expect FAIL.

- [ ] **Step 3:** Implement. The use case maps each raw row via `clinicLeadRevenue`/`clinicMonthlyFee` and `total = leadRevenue + monthlyFee`. `getClinicRevenueRows` runs `withUserContext` admin, one query joining clinics to their this-month lead counts (no N+1), ordered by `name`:

```sql
SELECT c.id AS "clinicId", c.name AS "clinicName", c.status, c.billing_status AS "billingStatus",
       COALESCE(l.cnt, 0) AS "leadsThisMonth"
  FROM clinics c
  LEFT JOIN (
    SELECT clinic_id, count(*) AS cnt FROM leads WHERE received_at >= ${monthStart} GROUP BY clinic_id
  ) l ON l.clinic_id = c.id
 ORDER BY c.name ASC
```

`leadsThisMonth` comes back as `bigint`/string → `Number(...)`. Add `@Get('clinics')` to `AdminRevenueController` returning `ClinicRevenueRowDto[]`. `ClinicRevenueRowDto` is a class with the seven fields (spec §1.2). Register the use case in `billing.module.ts` + `scripts/generate-openapi.ts`; `pnpm openapi`.

- [ ] **Step 4:** Run `pnpm jest get-revenue-clinics` — expect PASS.

- [ ] **Step 5 (e2e):** extend `test/admin/admin-revenue.e2e-spec.ts`: an admin gets 200 from `GET /admin/revenue/clinics` with an array ordered by clinic name, each row having the seven fields and `total === leadRevenue + monthlyFee`; assert a suspended-or-paused seeded clinic reports `monthlyFee: 0` (seed one, snapshot/restore); a non-admin → 403.

- [ ] **Step 6:** Run `pnpm test:e2e -- admin-revenue` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit `feat(billing): add GET /admin/revenue/clinics`.

---

### Task 6: Admin-JWT job trigger `POST /admin/revenue/jobs/run/:jobName`

**Files:**

- Modify: `src/modules/billing/infrastructure/http/admin-revenue.controller.ts` (add the route), `billing.module.ts` (inject the runner if not already), `scripts/generate-openapi.ts`
- Test: extend `test/admin/admin-revenue.e2e-spec.ts`

**Read spec §6.2 before starting.**

**Consumes:** `RunBillingJobService` (Task 3), `JobResult`.

- [ ] **Step 1 (e2e-first, since this is thin glue over the tested runner):** extend `test/admin/admin-revenue.e2e-spec.ts`. Assert: an admin `POST /admin/revenue/jobs/run/account-suspension` → 200 with a `JobResult` (`job: 'account-suspension'`); a non-admin → 403; an unknown job name (`POST /admin/revenue/jobs/run/nope`) → 400; and an `audit_log` row with `action_type='job_triggered'`, `affected_record='account-suspension'`, and `actor_user_id` = the admin's id (query it back). Use `account-suspension` (idempotent, writes nothing on a clean DB) to avoid mutating state; if you trigger `invoice-generation`, snapshot/restore.

- [ ] **Step 2:** Run `pnpm test:e2e -- admin-revenue` — expect FAIL (route missing).

- [ ] **Step 3:** Add to `AdminRevenueController`:

```ts
@Post('jobs/run/:jobName')
@HttpCode(200)
runJob(
  @CurrentUser() user: AuthenticatedUser,
  @Param('jobName') jobName: string,
  @Ip() ip: string,
): Promise<JobResult> {
  return this.runner.run(jobName, { userId: user.sub, role: user.role, ip });
}
```

Inject `RunBillingJobService` into the controller. It inherits the class-level `@Roles('admin','superadmin')` + `RolesGuard`, so a non-admin gets 403 and an unknown job name 400 (from the runner). Register the (already-provided) runner is enough; ensure `scripts/generate-openapi.ts` stubs `RunBillingJobService` for the controller and regenerate `pnpm openapi`.

- [ ] **Step 4:** Run `pnpm test:e2e -- admin-revenue` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 5:** Commit `feat(billing): add admin-JWT job trigger endpoint`.

---

### Task 7: OpenAPI, README, full gate

**Files:**

- Modify: `scripts/generate-openapi.ts` (confirm registration), `openapi.json` (regenerated), `README.md`

- [ ] **Step 1:** Run `pnpm openapi` and confirm `openapi.json` contains `/admin/revenue/stats`, `/admin/revenue/clinics`, and `/admin/revenue/jobs/run/{jobName}`. If any controller/use case is missing a registration in `scripts/generate-openapi.ts`, add it and regenerate.

- [ ] **Step 2:** Update `README.md`: add the three admin-revenue endpoints and the `weekly-summary` job. Extend the "Scheduled jobs" section with the weekly cron: `POST /admin/jobs/run/weekly-summary` on `0 8 * * 1` (Mondays 08:00 UTC) with the `X-Job-Secret` header. Note that admins can also trigger any job from the dashboard via `POST /admin/revenue/jobs/run/:jobName` (admin session).

- [ ] **Step 3:** Full gate: `pnpm test && pnpm test:int && pnpm test:e2e`, then `pnpm typecheck && pnpm lint && pnpm format:check && pnpm build`. All green. If the full `pnpm test:e2e` shows the known concurrent-worker seed-race flake, confirm the affected suite passes in isolation and note it — it is not a regression. Confirm the local DB is clean afterward (6 clinics, 0 invoices, 0 suspended).

- [ ] **Step 4:** Commit `feat(billing): register revenue endpoints in openapi and document the weekly job`.

---

## Deploy notes

- No migrations, no new env vars.
- Add the weekly cron to the external scheduler: `POST /admin/jobs/run/weekly-summary` on `0 8 * * 1` (Mondays 08:00 UTC), sending `X-Job-Secret: <JOB_TRIGGER_SECRET>`.
- Frontend: an admin revenue dashboard (the two read endpoints) and optional in-dashboard job-run buttons (`POST /admin/revenue/jobs/run/:jobName`, admin session).
