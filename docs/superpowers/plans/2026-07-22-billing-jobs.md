# Billing Jobs & Webhook (Slice 7 / Subsystem 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate monthly invoices, react to Stripe payment events, suspend clinics that do not pay, and let a clinic cancel — the money-movement half of billing.

**Architecture:** Extends the existing `billing` NestJS module. Two jobs are invokable services triggered by an external cron via a shared-secret admin endpoint (no in-process scheduler). Jobs and the Stripe webhook run as system processes (`asSystem`, one transaction per unit); the cancel endpoint runs under the clinic RLS context. A `STRIPE_WEBHOOK_VERIFIER` port keeps real Stripe crypto out of the test suite.

**Tech Stack:** NestJS 10, Prisma 7 + `@prisma/adapter-pg`, Postgres RLS, the `stripe` Node SDK, Jest.

## Global Constraints

- Contract mirrors the .NET `InvoiceGenerationJob`, `StripeWebhookController`, `AccountSuspensionJob`, and clinic subscription-cancel. Exact amounts/rules live in the spec (`docs/superpowers/specs/2026-07-22-billing-jobs-design.md`). Read the spec section named in each task.
- Fee constants, exact: price per lead `90`, platform fee `49`, processing fee `0.5%` of subtotal. Proration uses **timestamp subtraction** (`activeDays = periodEnd - createdAt`), matching subsystem 1.
- Ids are UUID strings. Jobs/webhook use `asSystem`; the cancel endpoint uses `withUserContext({ clinicId, role: 'clinic', ip: null })` with the clinic id ONLY from `@CurrentClinic()`. `asSystem` is NOT itself a transaction — wrap multi-write units in `asSystem(client => client.$transaction(...))`.
- Two new env vars, added to `src/infrastructure/config/env.schema.ts`, `.env`, `.env.example`, `test/.env.test`, AND the `scripts/generate-openapi.ts` fallback block: `STRIPE_WEBHOOK_SECRET`, `JOB_TRIGGER_SECRET`. The `src/infrastructure/config/env.schema.spec.ts` guard test ("test/.env.test satisfies the env schema") must stay green — that means these vars MUST be in `test/.env.test`.
- No `any` in production code. `Symbol` DI tokens. Keep `openapi.json` current (`pnpm openapi`); update README. No `Co-Authored-By` / Anthropic / Claude commit trailers. Node 24, pnpm.
- **File layout convention** (matches `src/modules/billing/`): domain at `domain/`, ports at `domain/ports/*.port.ts`, use cases/jobs at `application/*.ts`, repository at `infrastructure/prisma-billing.repository.ts`, controllers/guards/dtos at `infrastructure/http/`. Prisma client import `../../../../generated/prisma/client`. `PrismaService` at `src/infrastructure/prisma/prisma.service.ts`.
- Local DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`; suites read `test/.env.test` (local). No migrations in this slice (subsystem 1 created `invoices` and the `clinics` subscription columns).
- Verification per task: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean before commit.

## File Structure

```
src/modules/billing/
  domain/billing-fee.ts                         Task 1 (add exported proration helper)
  domain/invoice-amounts.ts                     Task 1  computeInvoiceAmounts (pure)
  domain/ports/stripe.port.ts                   Task 2  + createAndFinalizeInvoice
  domain/ports/stripe-webhook-verifier.port.ts  Task 3
  infrastructure/adapters/stripe.adapter.ts     Task 2  + createAndFinalizeInvoice
  infrastructure/adapters/fake-stripe.adapter.ts Task 2 + createAndFinalizeInvoice
  infrastructure/adapters/stripe-webhook-verifier.adapter.ts  Task 3 real + fake
  application/cancel-subscription.use-case.ts   Task 4
  application/generate-invoices.job.ts          Task 5
  application/suspend-overdue-accounts.job.ts   Task 6
  application/handle-stripe-webhook.use-case.ts Task 7
  infrastructure/http/stripe-webhook.controller.ts   Task 7
  infrastructure/http/job-trigger.guard.ts      Task 8
  infrastructure/http/billing-jobs.controller.ts Task 8
  infrastructure/http/dto/*.dto.ts              Tasks 4,8
  infrastructure/http/clinic-billing.controller.ts  Task 4 (+ cancel route)
  infrastructure/prisma-billing.repository.ts   Tasks 4-7 (+ methods)
  billing.module.ts                             Tasks 5-8 (register providers/controllers)

src/infrastructure/config/env.schema.ts         Tasks 3,8 (+ 2 vars)
src/main.ts                                      Task 7 (rawBody: true)
src/app.module.ts                               Task 7 (CSRF exclude webhook + jobs)
```

---

### Task 1: Money math (`invoice-amounts.ts`) + shared proration helper

**Files:**

- Modify: `src/modules/billing/domain/billing-fee.ts` (export a proration helper, keep existing behavior)
- Create: `src/modules/billing/domain/invoice-amounts.ts`
- Test: `src/modules/billing/domain/__tests__/invoice-amounts.spec.ts`

**Read spec §1 before starting.**

**Interfaces produced:**

```ts
// billing-fee.ts adds:
export function proratedPlatformFee(
  createdAt: Date,
  periodStart: Date,
  periodEnd: Date,
): {
  fee: number;
  activeDays: number;
  totalDays: number;
  prorated: boolean;
};

// invoice-amounts.ts:
export interface InvoiceAmounts {
  leadCount: number;
  pricePerLead: number;
  platformFee: number;
  platformFeeLabel: string;
  processingFee: number;
  subtotal: number;
  totalAmount: number;
}
export function computeInvoiceAmounts(input: {
  leadCount: number;
  clinicCreatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  priorInvoiceCount: number;
}): InvoiceAmounts;
```

**Consumes:** `PLATFORM_FEE` (49), `PRICE_PER_LEAD` (90) from `billing-fee.ts`.

- [ ] **Step 1 (refactor prep):** In `billing-fee.ts`, extract the proration math (currently inside `estimatePlatformFee`) into an exported `proratedPlatformFee(createdAt, periodStart, periodEnd)` returning `{ fee, activeDays, totalDays, prorated }`:

```ts
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function proratedPlatformFee(
  createdAt: Date,
  periodStart: Date,
  periodEnd: Date,
): { fee: number; activeDays: number; totalDays: number; prorated: boolean } {
  const totalDays = (periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY;
  if (createdAt.getTime() <= periodStart.getTime()) {
    return { fee: PLATFORM_FEE, activeDays: totalDays, totalDays, prorated: false };
  }
  const activeDays = (periodEnd.getTime() - createdAt.getTime()) / MS_PER_DAY;
  const fee = Math.round(PLATFORM_FEE * (activeDays / totalDays) * 100) / 100;
  return { fee, activeDays, totalDays, prorated: true };
}
```

Then rewrite `estimatePlatformFee` to call `proratedPlatformFee(clinicCreatedAt, startOfMonthUtc(now), startOfNextMonthUtc(now))` for its `.fee`, keeping its 2026-promo logic and its existing return shape unchanged. Run `pnpm jest billing-fee` — the existing subsystem-1 tests MUST stay green (this is a pure refactor; if any fails, the extraction changed behavior — fix it).

- [ ] **Step 2 (test):** create `invoice-amounts.spec.ts`:

```ts
import { computeInvoiceAmounts } from '../invoice-amounts';

const APRIL_START = new Date('2025-04-01T00:00:00Z');
const MAY_START = new Date('2025-05-01T00:00:00Z'); // periodEnd for April

describe('computeInvoiceAmounts', () => {
  it('full month, no leads, non-2026: fee 49, processing 0.245->0.25, total 49.25', () => {
    const r = computeInvoiceAmounts({
      leadCount: 0,
      clinicCreatedAt: new Date('2024-01-01T00:00:00Z'),
      periodStart: APRIL_START,
      periodEnd: MAY_START,
      priorInvoiceCount: 5,
    });
    expect(r.platformFee).toBe(49);
    expect(r.platformFeeLabel).toBe('Monthly platform fee');
    expect(r.subtotal).toBe(49);
    expect(r.processingFee).toBeCloseTo(0.25, 2); // round(49*0.005)=round(0.245)=0.25
    expect(r.totalAmount).toBeCloseTo(49.25, 2);
  });

  it('leads add 90 each and feed the processing fee', () => {
    const r = computeInvoiceAmounts({
      leadCount: 3,
      clinicCreatedAt: new Date('2024-01-01T00:00:00Z'),
      periodStart: APRIL_START,
      periodEnd: MAY_START,
      priorInvoiceCount: 5,
    });
    // subtotal = 3*90 + 49 = 319; processing = round(319*0.005)=round(1.595)=1.60; total 320.60
    expect(r.subtotal).toBe(319);
    expect(r.processingFee).toBeCloseTo(1.6, 2);
    expect(r.totalAmount).toBeCloseTo(320.6, 2);
  });

  it('mid-month signup prorates the platform fee with a labeled reason', () => {
    // created Apr 16 00:00 => activeDays 15 of 30 => 24.50
    const r = computeInvoiceAmounts({
      leadCount: 0,
      clinicCreatedAt: new Date('2025-04-16T00:00:00Z'),
      periodStart: APRIL_START,
      periodEnd: MAY_START,
      priorInvoiceCount: 3,
    });
    expect(r.platformFee).toBeCloseTo(24.5, 2);
    expect(r.platformFeeLabel).toBe('Platform fee (prorated — 15 of 30 days)');
  });

  it('2026 clinic with <2 prior invoices waives the platform fee', () => {
    const r = computeInvoiceAmounts({
      leadCount: 2,
      clinicCreatedAt: new Date('2026-02-10T00:00:00Z'),
      periodStart: new Date('2026-03-01T00:00:00Z'),
      periodEnd: new Date('2026-04-01T00:00:00Z'),
      priorInvoiceCount: 1,
    });
    expect(r.platformFee).toBe(0);
    expect(r.platformFeeLabel).toBe('Monthly platform fee (2026 Welcome Promotion — waived)');
    // subtotal = 2*90 + 0 = 180; processing = round(0.9)=0.90; total 180.90
    expect(r.subtotal).toBe(180);
    expect(r.totalAmount).toBeCloseTo(180.9, 2);
  });

  it('2026 clinic with 2+ prior invoices is charged (promo exhausted)', () => {
    const r = computeInvoiceAmounts({
      leadCount: 0,
      clinicCreatedAt: new Date('2026-02-10T00:00:00Z'),
      periodStart: new Date('2026-06-01T00:00:00Z'),
      periodEnd: new Date('2026-07-01T00:00:00Z'),
      priorInvoiceCount: 2,
    });
    expect(r.platformFee).toBe(49);
    expect(r.platformFeeLabel).toBe('Monthly platform fee');
  });
});
```

- [ ] **Step 3:** Run `pnpm jest invoice-amounts` — expect FAIL.

- [ ] **Step 4:** Create `invoice-amounts.ts`:

```ts
import { PLATFORM_FEE, PRICE_PER_LEAD, proratedPlatformFee } from './billing-fee';

export interface InvoiceAmounts {
  leadCount: number;
  pricePerLead: number;
  platformFee: number;
  platformFeeLabel: string;
  processingFee: number;
  subtotal: number;
  totalAmount: number;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

export function computeInvoiceAmounts(input: {
  leadCount: number;
  clinicCreatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  priorInvoiceCount: number;
}): InvoiceAmounts {
  const { leadCount, clinicCreatedAt, periodStart, periodEnd, priorInvoiceCount } = input;

  const proration = proratedPlatformFee(clinicCreatedAt, periodStart, periodEnd);
  let platformFee = proration.fee;
  let platformFeeLabel = proration.prorated
    ? `Platform fee (prorated — ${Math.ceil(proration.activeDays)} of ${proration.totalDays} days)`
    : 'Monthly platform fee';

  // 2026 Welcome Promotion: first two invoices have the platform fee waived.
  if (clinicCreatedAt.getUTCFullYear() === 2026 && priorInvoiceCount < 2) {
    platformFee = 0;
    platformFeeLabel = 'Monthly platform fee (2026 Welcome Promotion — waived)';
  }

  const subtotal = round2(leadCount * PRICE_PER_LEAD + platformFee);
  const processingFee = round2(subtotal * 0.005);
  const totalAmount = round2(subtotal + processingFee);

  return {
    leadCount,
    pricePerLead: PRICE_PER_LEAD,
    platformFee,
    platformFeeLabel,
    processingFee,
    subtotal,
    totalAmount,
  };
}
```

- [ ] **Step 5:** Run `pnpm jest invoice-amounts billing-fee` — expect PASS (both suites). Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 6:** Commit `feat(billing): add invoice-amounts money math and shared proration helper`.

---

### Task 2: `STRIPE_PORT.createAndFinalizeInvoice`

**Files:**

- Modify: `src/modules/billing/domain/ports/stripe.port.ts`, `src/modules/billing/infrastructure/adapters/stripe.adapter.ts`, `src/modules/billing/infrastructure/adapters/fake-stripe.adapter.ts`
- Test: `src/modules/billing/infrastructure/adapters/__tests__/fake-stripe.adapter.spec.ts` (extend)

**Interfaces produced (added to `StripePort`):**

```ts
createAndFinalizeInvoice(input: {
  customerId: string; clinicName: string; leadCount: number; pricePerLead: number;
  platformFee: number; platformFeeLabel: string; processingFee: number;
  periodStart: string; periodEnd: string;
}): Promise<{ stripeInvoiceId: string; invoiceUrl: string | null; pdfUrl: string | null }>;
```

**Read spec §3 (the `createAndFinalizeInvoice` subsection).**

- [ ] **Step 1 (test):** extend the fake-adapter spec:

```ts
it('createAndFinalizeInvoice returns a deterministic invoice and records the call', async () => {
  const cus = await stripe.createCustomer('Vitality', 'a@b.test', 'clinic-1');
  const r = await stripe.createAndFinalizeInvoice({
    customerId: cus,
    clinicName: 'Vitality',
    leadCount: 3,
    pricePerLead: 90,
    platformFee: 49,
    platformFeeLabel: 'Monthly platform fee',
    processingFee: 1.6,
    periodStart: '2025-04-01',
    periodEnd: '2025-05-01',
  });
  expect(r.stripeInvoiceId).toMatch(/^in_fake_/);
  expect(r.invoiceUrl).toContain(r.stripeInvoiceId);
  expect(stripe.invoicesCreated).toHaveLength(1);
  expect(stripe.invoicesCreated[0]).toMatchObject({
    customerId: cus,
    leadCount: 3,
    totalCents: expect.any(Number),
  });
});

it('createAndFinalizeInvoice can be forced to fail', async () => {
  const cus = await stripe.createCustomer('V', 'a@b.test', 'c1');
  stripe.failNextInvoice('stripe invoice error');
  await expect(
    stripe.createAndFinalizeInvoice({
      customerId: cus,
      clinicName: 'V',
      leadCount: 0,
      pricePerLead: 90,
      platformFee: 49,
      platformFeeLabel: 'x',
      processingFee: 0.25,
      periodStart: '2025-04-01',
      periodEnd: '2025-05-01',
    }),
  ).rejects.toThrow('stripe invoice error');
});
```

- [ ] **Step 2:** Run `pnpm jest fake-stripe.adapter` — expect FAIL.

- [ ] **Step 3:** Add the method to `StripePort`. In `FakeStripeAdapter`, add a public `invoicesCreated: Array<{ customerId: string; leadCount: number; totalCents: number }> = []`, a `failNextInvoice(msg)` helper (mirroring `failNextCreateCustomer`), and:

```ts
async createAndFinalizeInvoice(input: {
  customerId: string; clinicName: string; leadCount: number; pricePerLead: number;
  platformFee: number; platformFeeLabel: string; processingFee: number;
  periodStart: string; periodEnd: string;
}): Promise<{ stripeInvoiceId: string; invoiceUrl: string | null; pdfUrl: string | null }> {
  if (this.invoiceError !== null) {
    const m = this.invoiceError; this.invoiceError = null; throw new Error(m);
  }
  const id = `in_fake_${++this.invoiceSeq}`;
  const totalCents = Math.round(
    (input.leadCount * input.pricePerLead + input.platformFee + input.processingFee) * 100,
  );
  this.invoicesCreated.push({ customerId: input.customerId, leadCount: input.leadCount, totalCents });
  return { stripeInvoiceId: id, invoiceUrl: `https://stripe.test/i/${id}`, pdfUrl: null };
}
```

In `StripeAdapter`, implement the real version per spec §3: create a draft invoice (`collectionMethod: 'send_invoice'`, `daysUntilDue: 30`, `autoAdvance: false`, `description` = `MedAlign — <clinicName> — <periodStart> to <periodEnd>`), add invoice items pinned to `invoice: invoice.id` (a lead line when `leadCount > 0` at `leadCount * pricePerLead * 100` cents, a platform-fee line at `platformFee * 100`, a processing-fee line at `processingFee * 100`, currency `usd`), finalize with `autoAdvance: false`, return `{ stripeInvoiceId: finalized.id, invoiceUrl: finalized.hosted_invoice_url ?? null, pdfUrl: finalized.invoice_pdf ?? null }`. No `any`; narrow the SDK types. This real path is not unit-tested (typecheck is the gate).

- [ ] **Step 4:** Run `pnpm jest fake-stripe.adapter` — expect PASS.

- [ ] **Step 5:** `pnpm typecheck && pnpm lint && pnpm format:check`, then commit `feat(billing): add createAndFinalizeInvoice to the Stripe port`.

---

### Task 3: Stripe webhook verifier port + adapters + env

**Files:**

- Create: `src/modules/billing/domain/ports/stripe-webhook-verifier.port.ts`, `src/modules/billing/infrastructure/adapters/stripe-webhook-verifier.adapter.ts`
- Modify: `src/infrastructure/config/env.schema.ts`, `.env`, `.env.example`, `test/.env.test`, `scripts/generate-openapi.ts`
- Test: `src/modules/billing/infrastructure/adapters/__tests__/stripe-webhook-verifier.spec.ts`

**Interfaces produced:**

```ts
export interface StripeWebhookEvent {
  type: string;
  data: { object: { id: string; [k: string]: unknown } };
}
export interface StripeWebhookVerifier {
  constructEvent(rawBody: Buffer | string, signature: string): StripeWebhookEvent;
}
export const STRIPE_WEBHOOK_VERIFIER: symbol;
```

**Read spec §5.**

- [ ] **Step 1 (env):** Add `STRIPE_WEBHOOK_SECRET: z.string().min(1)` to `env.schema.ts`. Add `STRIPE_WEBHOOK_SECRET=whsec_fake` to `test/.env.test` (REQUIRED — the env guard test enforces this) and to `.env`; add `STRIPE_WEBHOOK_SECRET=whsec_placeholder` to `.env.example` (comment: Stripe webhook signing secret). Add `process.env['STRIPE_WEBHOOK_SECRET'] ??= 'whsec_openapi';` to the fallback block in `scripts/generate-openapi.ts`. Also add it to the `validFixture` in `src/infrastructure/config/env.schema.spec.ts`. Run `pnpm jest env.schema` — the guard test must be green.

- [ ] **Step 2 (test):** create `stripe-webhook-verifier.spec.ts` for the FAKE verifier:

```ts
import { FakeStripeWebhookVerifier } from '../stripe-webhook-verifier.adapter';

describe('FakeStripeWebhookVerifier', () => {
  const verifier = new FakeStripeWebhookVerifier();

  it('parses the JSON body into an event, trusting it', () => {
    const body = JSON.stringify({ type: 'invoice.paid', data: { object: { id: 'in_1' } } });
    const ev = verifier.constructEvent(body, 'sig-ignored');
    expect(ev.type).toBe('invoice.paid');
    expect(ev.data.object.id).toBe('in_1');
  });

  it('throws on a body that is not valid JSON', () => {
    expect(() => verifier.constructEvent('not json', 'sig')).toThrow();
  });
});
```

- [ ] **Step 3:** Run `pnpm jest stripe-webhook-verifier` — expect FAIL.

- [ ] **Step 4:** Create the port file. Create `stripe-webhook-verifier.adapter.ts` with both:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Env } from '../../../../infrastructure/config/env.schema';
import type {
  StripeWebhookEvent,
  StripeWebhookVerifier,
} from '../../domain/ports/stripe-webhook-verifier.port';

@Injectable()
export class StripeWebhookVerifierAdapter implements StripeWebhookVerifier {
  private readonly stripe: Stripe;
  private readonly secret: string;
  constructor(config: ConfigService<Env, true>) {
    this.stripe = new Stripe(config.getOrThrow('STRIPE_SECRET_KEY', { infer: true }), {
      apiVersion: '2026-06-24.dahlia',
    });
    this.secret = config.getOrThrow('STRIPE_WEBHOOK_SECRET', { infer: true });
  }
  constructEvent(rawBody: Buffer | string, signature: string): StripeWebhookEvent {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.secret);
    return event as unknown as StripeWebhookEvent;
  }
}

/** Test verifier: trusts the JSON body, no signature check. */
@Injectable()
export class FakeStripeWebhookVerifier implements StripeWebhookVerifier {
  constructEvent(rawBody: Buffer | string, _signature: string): StripeWebhookEvent {
    const parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8'));
    return parsed as StripeWebhookEvent;
  }
}
```

- [ ] **Step 5:** Run `pnpm jest stripe-webhook-verifier env.schema` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 6:** Commit `feat(billing): add Stripe webhook verifier port and STRIPE_WEBHOOK_SECRET`.

---

### Task 4: `POST /clinic/portal/subscription/cancel`

**Files:**

- Create: `src/modules/billing/application/cancel-subscription.use-case.ts`, `src/modules/billing/infrastructure/http/dto/cancel-subscription-response.dto.ts`
- Modify: `src/modules/billing/domain/ports/billing-repository.port.ts` (add `cancelSubscription`), `prisma-billing.repository.ts`, `clinic-billing.controller.ts`, `billing.module.ts`, `scripts/generate-openapi.ts`
- Test: `application/__tests__/cancel-subscription.use-case.spec.ts`, `test/billing/clinic-billing.e2e-spec.ts` (extend)

**Read spec §6.**

**Interfaces produced:**

```ts
// added to BillingRepositoryPort:
cancelSubscription(ctx: ClinicCtx, cancelledAt: Date, activeThrough: Date):
  Promise<'ok' | 'already_cancelled'>;
```

- [ ] **Step 1 (test):** `cancel-subscription.use-case.spec.ts`:

```ts
it('throws 409 when already cancelled', async () => {
  repo.cancelSubscription.mockResolvedValue('already_cancelled');
  await expect(
    useCase.execute({ clinicId: 'c1' }, new Date('2026-07-22T12:00:00Z')),
  ).rejects.toThrow('Subscription is already cancelled.');
  // assert ConflictException
});
it('returns cancelledAt and activeThrough (end of month) on success', async () => {
  repo.cancelSubscription.mockResolvedValue('ok');
  const r = await useCase.execute({ clinicId: 'c1' }, new Date('2026-07-22T12:00:00Z'));
  expect(r.cancelledAt).toBe('2026-07-22T12:00:00.000Z');
  expect(r.activeThrough).toBe('2026-07-31T23:59:59.000Z');
  expect(repo.cancelSubscription).toHaveBeenCalledWith(
    { clinicId: 'c1' },
    new Date('2026-07-22T12:00:00Z'),
    new Date('2026-07-31T23:59:59.000Z'),
  );
});
```

- [ ] **Step 2:** Run `pnpm jest cancel-subscription` — expect FAIL.

- [ ] **Step 3:** Implement. The use case takes `now` (controller passes `new Date()`), computes `activeThrough = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59))` (day 0 of next month = last day of this month, 23:59:59 UTC), calls `cancelSubscription`; `'already_cancelled'` → `ConflictException('Subscription is already cancelled.')`; else returns `{ cancelledAt: now.toISOString(), activeThrough: activeThrough.toISOString() }`. `cancelSubscription` in the repo runs under `withUserContext({ clinicId, role: 'clinic', ip: null })`: a single `UPDATE clinics SET subscription_cancelled_at = ${cancelledAt}, subscription_active_through = ${activeThrough}, billing_status = 'cancelled', notify_on_lead = false WHERE id = current_clinic_id AND subscription_cancelled_at IS NULL` — return `'already_cancelled'` when it affects 0 rows AND a `SELECT 1 WHERE id = current_clinic_id` confirms the clinic exists (so a real already-cancelled clinic is distinguished; the guard ensures the clinic exists). Controller adds `@Post('subscription/cancel')` returning the response DTO.

- [ ] **Step 4:** Run `pnpm jest cancel-subscription` — expect PASS.

- [ ] **Step 5 (e2e):** extend `test/billing/clinic-billing.e2e-spec.ts`: a clinic cancels → 200 with `cancelledAt`/`activeThrough` and `billing_status = 'cancelled'`, `notify_on_lead = false`, and the two subscription columns set (read the row back); a second cancel → 409; a non-clinic → 403.

- [ ] **Step 6:** Run `pnpm test:e2e -- clinic-billing` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit `feat(billing): add clinic subscription cancel endpoint`.

---

### Task 5: Invoice generation job

**Files:**

- Create: `src/modules/billing/application/generate-invoices.job.ts`
- Modify: `src/modules/billing/domain/ports/billing-repository.port.ts` (add job methods), `prisma-billing.repository.ts`, `billing.module.ts`
- Test: `application/__tests__/generate-invoices.job.spec.ts` (unit, mocked repo+stripe), `test/billing/invoice-generation.int-spec.ts` (integration, real DB + fake stripe)

**Read spec §3.**

**Interfaces produced:**

```ts
export interface JobResult { job: string; processed: number; skipped: number; failed: number; details?: string[] }

export interface EligibleClinic {
  clinicId: string; clinicName: string; createdAt: Date;
  stripeCustomerId: string; billingEmail: string | null;
}
// added to BillingRepositoryPort (all asSystem):
listInvoiceEligibleClinics(periodStart: Date, periodEnd: Date): Promise<EligibleClinic[]>;
countLeadsInPeriod(clinicId: string, periodStart: Date, periodEnd: Date): Promise<number>;
countInvoicesForClinic(clinicId: string): Promise<number>;
insertGeneratedInvoice(row: {
  clinicId: string; stripeInvoiceId: string; periodStart: Date; periodEnd: Date;
  leadCount: number; pricePerLead: number; platformFee: number; totalAmount: number;
  dueDate: Date; invoiceUrl: string | null; pdfUrl: string | null;
}): Promise<void>;

export class GenerateInvoicesJob { execute(now?: Date): Promise<JobResult>; }
```

**Consumes:** `computeInvoiceAmounts` (Task 1), `STRIPE_PORT.createAndFinalizeInvoice` (Task 2), `EMAIL_SENDER`.

- [ ] **Step 1 (unit test):** `generate-invoices.job.spec.ts` mocks the repo + stripe + email. Assert: for one eligible clinic with 2 leads, it calls `createAndFinalizeInvoice` with the computed amounts, `insertGeneratedInvoice` with `status`-less row (status set in SQL) and the right `dueDate` (periodEnd + 30d), and returns `{ processed: 1, skipped: 0, failed: 0 }`; a clinic whose Stripe call throws is counted `failed: 1` and does not stop the others; the email is best-effort (a throw does not fail the clinic).

```ts
it('generates an invoice for an eligible clinic and returns counts', async () => {
  repo.listInvoiceEligibleClinics.mockResolvedValue([
    {
      clinicId: 'c1',
      clinicName: 'Vitality',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      stripeCustomerId: 'cus_1',
      billingEmail: 'b@c.test',
    },
  ]);
  repo.countLeadsInPeriod.mockResolvedValue(2);
  repo.countInvoicesForClinic.mockResolvedValue(5);
  stripe.createAndFinalizeInvoice.mockResolvedValue({
    stripeInvoiceId: 'in_1',
    invoiceUrl: 'http://x',
    pdfUrl: null,
  });
  const r = await job.execute(new Date('2025-05-05T00:00:00Z')); // invoices April
  expect(stripe.createAndFinalizeInvoice).toHaveBeenCalled();
  expect(repo.insertGeneratedInvoice).toHaveBeenCalledWith(
    expect.objectContaining({
      clinicId: 'c1',
      stripeInvoiceId: 'in_1',
      leadCount: 2,
      pricePerLead: 90,
    }),
  );
  expect(r).toMatchObject({ job: 'invoice-generation', processed: 1, skipped: 0, failed: 0 });
});
```

- [ ] **Step 2:** Run `pnpm jest generate-invoices.job` — expect FAIL.

- [ ] **Step 3:** Implement. The job computes `periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))` and `periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))`. For each eligible clinic (from `listInvoiceEligibleClinics`, which encodes the full eligibility incl. the "no invoice for this period" clause per spec §3), inside a per-clinic `try/catch`: count leads, count prior invoices, `computeInvoiceAmounts`, `createAndFinalizeInvoice`, `insertGeneratedInvoice` (with `dueDate = periodEnd + 30d`), then best-effort email (inner try/catch). Tally processed/failed. `insertGeneratedInvoice` runs `asSystem(client => client.$transaction(...))` and sets `status = 'open'`.

`listInvoiceEligibleClinics` SQL (asSystem):

```sql
SELECT c.id AS "clinicId", c.name AS "clinicName", c.created_at AS "createdAt",
       c.stripe_customer_id AS "stripeCustomerId",
       COALESCE(bp.billing_email, c.business_email) AS "billingEmail"
  FROM clinics c
  LEFT JOIN billing_profiles bp ON bp.clinic_id = c.id
 WHERE c.status = 'active'
   AND c.stripe_customer_id IS NOT NULL
   AND c.created_at < ${periodEnd}
   AND (c.subscription_active_through IS NULL OR c.subscription_active_through > ${periodStart})
   AND NOT EXISTS (SELECT 1 FROM invoices i
                     WHERE i.clinic_id = c.id AND i.period_start = ${periodStart} AND i.period_end = ${periodEnd})
```

- [ ] **Step 4:** Run `pnpm jest generate-invoices.job` — expect PASS.

- [ ] **Step 5 (integration):** create `test/billing/invoice-generation.int-spec.ts`. Seed (via `asSystem`/pg, in `beforeAll`, snapshot/restore any demo-clinic mutations like the Task 9 backfill spec did) two active clinics with `stripe_customer_id` set and a few leads dated in the prior month, plus one ineligible clinic (no customer). Construct the job with the real `PrismaBillingRepository`, a `FakeStripeAdapter`, and a stub email sender. Run `execute(fixedNow)`; assert one `invoices` row per eligible clinic with `status='open'`, the right `total_amount`, and `due_date`; run AGAIN and assert **no new rows** (idempotency); assert the ineligible clinic has none.

- [ ] **Step 6:** Run `pnpm test:int -- invoice-generation` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit `feat(billing): add invoice generation job`.

---

### Task 6: Account suspension job

**Files:**

- Create: `src/modules/billing/application/suspend-overdue-accounts.job.ts`
- Modify: `billing-repository.port.ts` (add suspension methods), `prisma-billing.repository.ts`, `billing.module.ts`
- Test: `application/__tests__/suspend-overdue-accounts.job.spec.ts` (unit), `test/billing/account-suspension.int-spec.ts` (integration)

**Read spec §4.**

**Interfaces produced:**

```ts
export interface OverdueClinic {
  clinicId: string; clinicName: string; billingEmail: string | null;
  overdueTotal: number; overdueDueDate: Date | null;
}
// added to BillingRepositoryPort (asSystem):
listSuspendableClinics(now: Date): Promise<OverdueClinic[]>;   // active clinics with an invoice >30d past due
suspendClinicForNonPayment(clinicId: string): Promise<void>;   // one tx: status/reason/notify + mark open invoices overdue

export class SuspendOverdueAccountsJob { execute(now?: Date): Promise<JobResult>; }
```

- [ ] **Step 1 (unit test):** mock the repo + email. Assert: each returned clinic gets `suspendClinicForNonPayment` called, a best-effort overdue-warning email, and the result counts; an email failure does not fail the clinic; an empty list returns `{ processed: 0 }`.

- [ ] **Step 2:** Run `pnpm jest suspend-overdue-accounts.job` — expect FAIL.

- [ ] **Step 3:** Implement. `listSuspendableClinics` (asSystem):

```sql
SELECT c.id AS "clinicId", c.name AS "clinicName",
       COALESCE(bp.billing_email, c.business_email) AS "billingEmail",
       i.total_amount AS "overdueTotal", i.due_date AS "overdueDueDate"
  FROM clinics c
  JOIN LATERAL (
    SELECT total_amount, due_date FROM invoices
     WHERE clinic_id = c.id AND status IN ('open','overdue')
       AND due_date + interval '30 days' < ${now}
     ORDER BY due_date DESC NULLS LAST LIMIT 1
  ) i ON true
  LEFT JOIN billing_profiles bp ON bp.clinic_id = c.id
 WHERE c.status = 'active'
```

`suspendClinicForNonPayment(clinicId)` runs one `asSystem` transaction: `UPDATE clinics SET status='suspended', suspension_reason='overdue_payment', notify_on_lead=false WHERE id=${clinicId}::uuid`; `UPDATE invoices SET status='overdue' WHERE clinic_id=${clinicId}::uuid AND status='open'`. The job convert `overdueTotal` via `Number(...)`.

- [ ] **Step 4:** Run `pnpm jest suspend-overdue-accounts.job` — expect PASS.

- [ ] **Step 5 (integration):** `test/billing/account-suspension.int-spec.ts`. Seed an active clinic with an invoice whose `due_date` is 31 days before a fixed `now`; run; assert `status='suspended'`, `suspension_reason='overdue_payment'`, `notify_on_lead=false`, invoice `overdue`. Seed a current clinic (invoice not past due) and assert it is untouched. Run again → no-op (already suspended). Snapshot/restore demo-clinic state.

- [ ] **Step 6:** Run `pnpm test:int -- account-suspension` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit `feat(billing): add account suspension job`.

---

### Task 7: Stripe webhook endpoint

**Files:**

- Create: `src/modules/billing/application/handle-stripe-webhook.use-case.ts`, `src/modules/billing/infrastructure/http/stripe-webhook.controller.ts`
- Modify: `billing-repository.port.ts` (webhook methods), `prisma-billing.repository.ts`, `billing.module.ts`, `src/main.ts` (rawBody), `src/app.module.ts` (CSRF exclude), `scripts/generate-openapi.ts`
- Test: `application/__tests__/handle-stripe-webhook.use-case.spec.ts` (unit), `test/billing/stripe-webhook.e2e-spec.ts`

**Read spec §5.**

**Interfaces produced:**

```ts
// added to BillingRepositoryPort (asSystem):
markInvoicePaid(stripeInvoiceId: string): Promise<void>;        // one tx: invoice paid + clinic current + conditional reinstate
markInvoicePaymentFailed(stripeInvoiceId: string): Promise<void>; // one tx: invoice overdue + clinic billing_status overdue
invoiceExistsByStripeId(stripeInvoiceId: string): Promise<boolean>;

export class HandleStripeWebhookUseCase {
  handle(rawBody: Buffer, signature: string): Promise<void>;  // throws on bad signature
}
```

- [ ] **Step 1 (unit test):** mock the repo + a fake verifier. Assert: `invoice.paid` for a known id calls `markInvoicePaid`; `invoice.payment_failed` calls `markInvoicePaymentFailed`; an unknown-id `invoice.paid` (repo says not exists) calls nothing and does not throw; an unknown event type does nothing; a verifier that throws propagates (controller maps to 400).

- [ ] **Step 2:** Run `pnpm jest handle-stripe-webhook` — expect FAIL.

- [ ] **Step 3:** Implement the use case: `constructEvent` via `STRIPE_WEBHOOK_VERIFIER` (throws → propagate); switch on `event.type`; for `invoice.paid`/`invoice.payment_failed` read `event.data.object.id` (the Stripe invoice id) and, if `invoiceExistsByStripeId`, call the matching repo method (each is one `asSystem` transaction). `markInvoicePaid` SQL: `UPDATE invoices SET status='paid', paid_at=now() WHERE stripe_invoice_id=$1`; `UPDATE clinics SET billing_status='current' WHERE id=(SELECT clinic_id FROM invoices WHERE stripe_invoice_id=$1)`; then the conditional reinstate `UPDATE clinics SET status='active', suspension_reason=NULL, notify_on_lead=true WHERE id=(...) AND suspension_reason='overdue_payment' AND subscription_cancelled_at IS NULL`. `markInvoicePaymentFailed`: `UPDATE invoices SET status='overdue' WHERE stripe_invoice_id=$1`; `UPDATE clinics SET billing_status='overdue' WHERE id=(SELECT clinic_id FROM invoices WHERE stripe_invoice_id=$1)`.

Controller `stripe-webhook.controller.ts`: `@Controller('stripe')`, `@Post('webhook')`, `@Public()` (no auth guard), `@HttpCode(200)`. Read the raw body and signature:

```ts
@Post('webhook')
@HttpCode(200)
async handle(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
  const sig = req.headers['stripe-signature'];
  const signature = Array.isArray(sig) ? sig[0] : (sig ?? '');
  try {
    await this.useCase.handle(req.rawBody as Buffer, signature);
  } catch (err) {
    // signature failure or unexpected error
    throw new BadRequestException('Webhook error');
  }
  return { received: true };
}
```

Note: a bad signature → 400; a handler DB error also currently maps to 400 here — acceptable for this slice (Stripe retries on non-2xx). If the reviewer prefers 500 for handler errors vs 400 for signature errors, split the try/catch: verify first (400 on throw), then handle (let a handler error 500). Prefer the split.

In `src/main.ts`, change bootstrap to `NestFactory.create(AppModule, { rawBody: true })`. In `src/app.module.ts`, change the CSRF wiring to exclude the webhook and (for Task 8) the job routes:

```ts
consumer.apply(CsrfMiddleware).exclude('stripe/webhook', 'admin/jobs/run/:jobName').forRoutes('*');
```

- [ ] **Step 4:** Run `pnpm jest handle-stripe-webhook` — expect PASS.

- [ ] **Step 5 (e2e):** create `test/billing/stripe-webhook.e2e-spec.ts`. Bootstrap the test app with `rawBody: true` (`moduleRef.createNestApplication({ rawBody: true })`) and override `STRIPE_WEBHOOK_VERIFIER` with `FakeStripeWebhookVerifier` (so a JSON body is trusted) and `STRIPE_PORT` with the fake. Seed a clinic with an `open` invoice (via asSystem/pg). POST a JSON `invoice.paid` event referencing that invoice's `stripe_invoice_id`; assert 200, the invoice is `paid`, clinic `billing_status='current'`; when the clinic was suspended for `overdue_payment`, assert it is reinstated (`active`, `notify_on_lead=true`); when the clinic was `cancelled`, assert it is NOT reinstated. POST `invoice.payment_failed` → invoice `overdue`, clinic `overdue`. POST for an unknown `stripe_invoice_id` → 200 no-op. To exercise the bad-signature path, temporarily override with the REAL verifier or a fake that throws and assert 400.

- [ ] **Step 6:** Run `pnpm test:e2e -- stripe-webhook` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 7:** Commit `feat(billing): add Stripe webhook endpoint for invoice paid and failed`.

---

### Task 8: Job trigger endpoint + shared-secret guard

**Files:**

- Create: `src/modules/billing/infrastructure/http/job-trigger.guard.ts`, `src/modules/billing/infrastructure/http/billing-jobs.controller.ts`
- Modify: `src/infrastructure/config/env.schema.ts`, `.env`, `.env.example`, `test/.env.test`, `src/infrastructure/config/env.schema.spec.ts`, `scripts/generate-openapi.ts`, `billing.module.ts`
- Test: `infrastructure/http/__tests__/job-trigger.guard.spec.ts` (unit), `test/billing/job-trigger.e2e-spec.ts`

**Read spec §2.**

**Interfaces produced:** `POST /admin/jobs/run/:jobName` → `JobResult` (Task 5's type). Guard requires `X-Job-Secret` == `JOB_TRIGGER_SECRET` (constant-time).

- [ ] **Step 1 (env):** Add `JOB_TRIGGER_SECRET: z.string().min(1)` to `env.schema.ts`. Add `JOB_TRIGGER_SECRET=job_secret_fake` to `test/.env.test` and `.env`; `JOB_TRIGGER_SECRET=change-me` to `.env.example`; add it to the openapi fallback block and the `env.schema.spec.ts` `validFixture`. Run `pnpm jest env.schema` — guard green.

- [ ] **Step 2 (guard test):** `job-trigger.guard.spec.ts`:

```ts
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JobTriggerGuard } from '../job-trigger.guard';

function ctx(headerValue: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-job-secret': headerValue } }) }),
  } as unknown as ExecutionContext;
}
const config = { getOrThrow: () => 'the-secret' } as never;

describe('JobTriggerGuard', () => {
  const guard = new JobTriggerGuard(config);
  it('allows a matching secret', () => {
    expect(guard.canActivate(ctx('the-secret'))).toBe(true);
  });
  it('rejects a wrong secret', () => {
    expect(() => guard.canActivate(ctx('nope'))).toThrow(UnauthorizedException);
  });
  it('rejects a missing header', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 3:** Run `pnpm jest job-trigger.guard` — expect FAIL.

- [ ] **Step 4:** Create the guard (constant-time compare; unequal lengths reject early):

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import type { Env } from '../../../../infrastructure/config/env.schema';

@Injectable()
export class JobTriggerGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['x-job-secret'];
    const provided = Array.isArray(header) ? header[0] : header;
    const expected = this.config.getOrThrow('JOB_TRIGGER_SECRET', { infer: true });
    if (typeof provided !== 'string') throw new UnauthorizedException('Invalid job secret');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid job secret');
    }
    return true;
  }
}
```

Create `billing-jobs.controller.ts`: `@Controller('admin/jobs')`, `@UseGuards(JobTriggerGuard)`, `@Post('run/:jobName')`. It maps `jobName` to the job service (`invoice-generation` → `GenerateInvoicesJob`, `account-suspension` → `SuspendOverdueAccountsJob`), throws `BadRequestException` for an unknown name, writes an `audit_log` `job_triggered` entry via the `AUDIT` port (`actorUserId: null, actorRole: 'system', ip, actionType: 'job_triggered', affectedRecord: jobName, notes: 'POST /admin/jobs/run/' + jobName`), runs the job, returns its `JobResult`. The `AUDIT` token / `AuditPort` is provided and exported by `AuthModule` (`src/modules/auth/…`); `billing.module.ts` already imports what it needs from auth for the approval integration in the prior slice — confirm `AUDIT` is available to inject and, if not, add `AuthModule` to `billing.module.ts`'s `imports` (no circular dependency: auth does not import billing). Register both job services + the controller + guard in `billing.module.ts`.

Note: `AuditEvent.affectedRecord` is a required non-nullable `string` (tightened in Slice 5), and `actorUserId` is nullable — so pass `affectedRecord: jobName` (a real string) and `actorUserId: null`. A null `affectedRecord` would be a compile error.

- [ ] **Step 5:** Run `pnpm jest job-trigger.guard` — expect PASS.

- [ ] **Step 6 (e2e):** `test/billing/job-trigger.e2e-spec.ts`. Override `STRIPE_PORT` with the fake. Assert: `POST /admin/jobs/run/invoice-generation` with the correct `X-Job-Secret` (from `test/.env.test` = `job_secret_fake`) → 200 with a `JobResult` (`job: 'invoice-generation'`); no header → 401; wrong secret → 401; `POST /admin/jobs/run/nope` with the correct secret → 400; and an `audit_log` row with `action_type='job_triggered'` and `affected_record='invoice-generation'` is written.

- [ ] **Step 7:** Run `pnpm test:e2e -- job-trigger` — expect PASS. Then `pnpm typecheck && pnpm lint && pnpm format:check`.

- [ ] **Step 8:** Commit `feat(billing): add shared-secret job trigger endpoint`.

---

### Task 9: OpenAPI, README, deploy docs, full gate

**Files:**

- Modify: `scripts/generate-openapi.ts` (register new controllers/use cases), `openapi.json` (regenerated), `README.md`

- [ ] **Step 1:** Register in `scripts/generate-openapi.ts`: import and add `StripeWebhookController` and `BillingJobsController` to the `controllers` array; add `stubProvider(...)` for `HandleStripeWebhookUseCase`, `GenerateInvoicesJob`, `SuspendOverdueAccountsJob`, `CancelSubscriptionUseCase`, and the `AUDIT` token if not already stubbed; stub the `JobTriggerGuard`/`STRIPE_WEBHOOK_VERIFIER` providers as needed so the graph builds. Run `pnpm openapi` and confirm `openapi.json` gains `/stripe/webhook`, `/admin/jobs/run/{jobName}`, and `/clinic/portal/subscription/cancel`.

- [ ] **Step 2:** Update `README.md`: add the new endpoints, the two new env vars (`STRIPE_WEBHOOK_SECRET`, `JOB_TRIGGER_SECRET`), and a short "Scheduled jobs" section describing the external-cron setup (monthly `invoice-generation` at `0 0 1 * *` UTC, daily `account-suspension` at `0 6 * * *` UTC, each POSTing with the `X-Job-Secret` header) plus the Stripe-dashboard webhook registration for `invoice.paid` / `invoice.payment_failed`.

- [ ] **Step 3:** Full gate: `pnpm test && pnpm test:int && pnpm test:e2e`, then `pnpm typecheck && pnpm lint && pnpm format:check && pnpm build`. All green. (If the full `pnpm test:e2e` shows the known concurrent-worker seed-race flake, confirm the affected suite passes in isolation and note it — it is not a regression.)

- [ ] **Step 4:** Commit `feat(billing): register jobs/webhook in openapi and document scheduled jobs`.

---

## Deploy notes

- No migrations.
- Two new env vars on Railway: `STRIPE_WEBHOOK_SECRET` (Stripe dashboard webhook signing secret) and `JOB_TRIGGER_SECRET` (generated random string).
- Register the webhook URL in the Stripe dashboard for `invoice.paid` and `invoice.payment_failed`.
- Configure the external scheduler (Railway cron or a scheduled GitHub Actions workflow): monthly `POST /admin/jobs/run/invoice-generation` (`0 0 1 * *` UTC) and daily `POST /admin/jobs/run/account-suspension` (`0 6 * * *` UTC), each sending `X-Job-Secret: <JOB_TRIGGER_SECRET>`.
- Frontend: a subscription-cancel action on the clinic billing screen.
