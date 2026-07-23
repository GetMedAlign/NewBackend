# Billing Revenue & Weekly Summary Design (Slice 8 / Billing Subsystem 3)

**Date:** 2026-07-22
**Status:** Approved

## Goal

Give admins a revenue view and let them run billing jobs from the dashboard, and
send opted-in clinics a weekly lead summary. This is the last billing subsystem.
Mirrors the .NET `AdminRevenueController` and `WeeklySummaryJob`.

## Scope

Subsystems 1 and 2 (merged) built the billing data, Stripe client, invoicing,
webhook, suspension, and the shared-secret cron job-trigger. This slice adds the
reporting layer plus the third job.

**In scope:**

- `GET /admin/revenue/stats` and `GET /admin/revenue/clinics` (admin).
- `WeeklySummaryJob` (a third job, triggerable via the existing cron endpoint).
- A shared job-runner extracted from the existing shared-secret trigger, plus a
  new admin-JWT trigger endpoint `POST /admin/revenue/jobs/run/:jobName`.
- No migrations (the `clinics.weekly_summary` column exists from the Clinic
  Portal slice; revenue is computed from existing `clinics`/`leads` data). No new
  env vars.

**Out of scope:** none remaining in billing after this slice.

## Global Constraints

- Contract mirrors the .NET `AdminRevenueController` + `WeeklySummaryJob`. Exact
  fields/amounts in §1–§5.
- Fee constants, verbatim: monthly fee `$49`, price per lead `$90`. These are the
  same `PLATFORM_FEE`/`PRICE_PER_LEAD` constants from `billing-fee.ts`.
- Ids are UUID strings. No `any`. `Symbol` DI tokens. Keep `openapi.json` current;
  update README. No `Co-Authored-By` / Anthropic / Claude commit trailers. Node
  24, pnpm.
- Admin read endpoints run under `withUserContext({ userId, role })` (admin RLS
  permits reading all clinics/leads); admin id/role from `@CurrentUser()`. The
  `WeeklySummaryJob` runs `asSystem` (system process, no user).

---

## 1. Contracts

Both DTOs camelCase.

### 1.1 `AdminRevenueStatsDto` — `GET /admin/revenue/stats`

`mrr` (number), `leadRevenueMtd` (number), `totalRevenueMtd` (number),
`activeClinicCount` (int), `overdueCount` (int), `leadsThisMonth` (int).

### 1.2 `AdminClinicRevenueRowDto` — `GET /admin/revenue/clinics`

An array, ordered by clinic `name` ascending. Each: `clinicId` (string),
`clinicName` (string), `leadsThisMonth` (int), `leadRevenue` (number),
`monthlyFee` (number), `total` (number), `billingStatus` (string).

---

## 2. Revenue math (verbatim from .NET `AdminRevenueController`)

All "this month" windows use the start of the current calendar month in UTC
(`monthStart`).

**Stats:**

- `activeClinicCount` = clinics with `status = 'active'`.
- `overdueCount` = clinics with `billing_status = 'overdue'`.
- `leadsThisMonth` = leads with `received_at >= monthStart`.
- `mrr` = `activeClinicCount * 49`. (A flat headline metric — it deliberately
  ignores proration and the 2026 promo, matching .NET; it is not the invoiced
  amount.)
- `leadRevenueMtd` = `leadsThisMonth * 90`.
- `totalRevenueMtd` = `mrr + leadRevenueMtd`.

**Per-clinic row:**

- `leadsThisMonth` = that clinic's leads with `received_at >= monthStart`.
- `leadRevenue` = `leadsThisMonth * 90`.
- `monthlyFee` = `0` when the clinic is `status = 'suspended'` OR
  `billing_status = 'paused'`, else `49`.
- `total` = `leadRevenue + monthlyFee`.
- `billingStatus` = the clinic's `billing_status`.

The pure computations live in a small `revenue-math.ts` (or reuse
`PLATFORM_FEE`/`PRICE_PER_LEAD`), unit-tested directly.

---

## 3. `GET /admin/revenue/stats`

`@Roles('admin','superadmin')`. One `withUserContext({ userId, role })` read that
returns the four raw counts (active clinics, overdue clinics, this-month leads)
in as few queries as practical (a single query with conditional `count`s is
fine), then the use case derives `mrr`/`leadRevenueMtd`/`totalRevenueMtd`.
`count(*)` bigint → `Number(...)`.

---

## 4. `GET /admin/revenue/clinics`

`@Roles('admin','superadmin')`. One `withUserContext` read: all clinics ordered by
name, each with its this-month lead count (a grouped/joined query, no N+1). The
use case maps each to `AdminClinicRevenueRowDto` applying the `monthlyFee`
suspended/paused rule (§2). `count(*)` bigint → `Number(...)`.

---

## 5. `WeeklySummaryJob`

A third job, `execute(now?: Date): Promise<JobResult>`, run `asSystem`. Mirrors
the two existing jobs' structure.

- `weekAgo = now - 7 days`.
- Select clinics with `status = 'active'` AND `weekly_summary = true`.
- For each, in a per-clinic try/catch (a failure counts `failed`, does not stop
  the batch): count `leadsThisWeek` (`received_at >= weekAgo`) and `totalLeads`
  (all-time); if `business_email` is present, best-effort send the weekly-summary
  email (`business_email`, matching .NET — this job uses the business email, not
  the billing profile).
- Returns a `JobResult` (`{ job: 'weekly-summary', processed, skipped, failed, details? }`).

Idempotent enough for the intended weekly cron: it sends one email per opted-in
clinic per run; re-running the same day would re-send, but the cron runs it once
weekly (there is no state to double-write, unlike invoicing). No dedupe store,
matching .NET.

---

## 6. Job runner + admin-JWT trigger endpoint

### 6.1 Shared runner

Extract the existing `BillingJobsController`'s "resolve job name → write audit →
run → return `JobResult`" logic into a `RunBillingJobService`:

```ts
export interface JobAuditActor {
  userId: string | null;
  role: string;
  ip: string | null;
}
@Injectable()
export class RunBillingJobService {
  run(jobName: string, actor: JobAuditActor): Promise<JobResult>;
  // resolves jobName -> job service (400 on unknown); writes an audit_log
  // 'job_triggered' row with the given actor + affectedRecord=jobName; awaits
  // the job; returns its JobResult.
}
```

Job-name map gains `weekly-summary` → `WeeklySummaryJob`, alongside
`invoice-generation` and `account-suspension`.

The existing `BillingJobsController` (`POST /admin/jobs/run/:jobName`,
shared-secret guard) is refactored to call `RunBillingJobService.run(jobName, {
userId: null, role: 'system', ip })`, unchanged in behavior. So the cron can now
also trigger `weekly-summary`.

### 6.2 Admin-JWT trigger endpoint

`POST /admin/revenue/jobs/run/:jobName`, `@Roles('admin','superadmin')` +
`RolesGuard`, on the new `AdminRevenueController`. It calls
`RunBillingJobService.run(jobName, { userId: user.sub, role: user.role, ip })` and
returns the `JobResult` synchronously (the admin sees the processed/failed
counts). An unknown job name → 400.

So there are two trigger paths sharing one runner: machines via the shared secret
(`/admin/jobs/run/...`), humans via their admin session
(`/admin/revenue/jobs/run/...`). The audit row records which actor triggered it
(`actorUserId` null for the cron, the admin's id for the dashboard).

---

## 7. Security

- The two revenue reads and the admin trigger require `@Roles('admin','superadmin')`
  - `RolesGuard`; admin id/role come only from `@CurrentUser()`. The reads run
    under `withUserContext({ userId, role })` so the admin RLS policies apply.
- The `WeeklySummaryJob` runs `asSystem` (system process). It only reads leads
  and sends email; it writes nothing to clinic/lead rows.
- The admin trigger endpoint runs jobs synchronously under the admin's request;
  the jobs themselves still run `asSystem` internally (they act system-wide), but
  the trigger is gated by the admin session and audited to that admin.
- No new secrets. The shared-secret cron path is unchanged.

---

## 8. Module structure

```
src/modules/billing/
  domain/revenue-math.ts                         §2 (pure)
  application/get-revenue-stats.use-case.ts      §3
  application/get-revenue-clinics.use-case.ts    §4
  application/weekly-summary.job.ts              §5
  application/run-billing-job.service.ts         §6.1 (shared runner)
  infrastructure/prisma-billing.repository.ts    + revenue read queries, weekly-summary read
  infrastructure/http/admin-revenue.controller.ts §3/§4/§6.2
  infrastructure/http/billing-jobs.controller.ts  refactor to use the runner
  infrastructure/http/dto/*.dto.ts
  billing.module.ts                              register the runner, the job, the controller
```

---

## 9. Testing

- **Unit (pure):** `revenue-math.ts` — the stats derivations and the per-clinic
  `monthlyFee` suspended/paused rule.
- **Integration/e2e:**
  - `GET /admin/revenue/stats`: seed active/overdue clinics and this-month leads;
    assert the six numbers; a non-admin → 403.
  - `GET /admin/revenue/clinics`: assert per-clinic rows ordered by name, the
    lead revenue and the fee-zeroed suspended/paused case; non-admin → 403.
  - `WeeklySummaryJob` (integration, fake email sender): only `active` +
    `weekly_summary = true` clinics with a business email are emailed; a clinic
    whose email send throws is counted `failed` without stopping the batch;
    snapshot/restore demo-clinic state so the shared DB stays clean.
  - Admin trigger: an admin JWT runs a job and gets a `JobResult`; a non-admin →
    403; an unknown job name → 400; an `audit_log` `job_triggered` row is written
    with the admin's id. The refactored shared-secret endpoint still works
    (regression) and can now trigger `weekly-summary`.

---

## 10. Deploy notes

- No migrations, no new env vars.
- Add a weekly cron to the external scheduler: `POST /admin/jobs/run/weekly-summary`
  on `0 8 * * 1` (Mondays 08:00 UTC), sending the `X-Job-Secret` header — same
  mechanism as the other two jobs.
- Frontend: an admin revenue dashboard (the two read endpoints) and, optionally,
  in-dashboard job-run buttons (the admin trigger endpoint).
