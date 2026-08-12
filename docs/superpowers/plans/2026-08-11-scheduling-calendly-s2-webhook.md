# Scheduling Slice 2: Webhook capture + Appointment model (backend) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Receive Calendly `invitee.created` / `invitee.canceled` webhooks, verify them, and record bookings: create/cancel an `appointment` and mark the linked lead `booked` + `scheduled_at`. Expose read endpoints for the clinic portal and the patient. No frontend (slices 3-4).

**Architecture:** A per-clinic webhook URL (`/webhooks/calendly/:clinicId`) identifies the tenant so we can select its signing key. A `CalendlyWebhookVerifierPort` (mirrors the existing Stripe verifier) checks the HMAC signature over the raw body. A receiver use-case parses the event and updates the appointment + lead through repositories, running as system with an explicit clinic scope. Reuses the raw-body support already enabled in `main.ts` (`rawBody: true`).

**Tech Stack:** NestJS 10, Prisma 7 + adapter-pg, Postgres RLS, Node 24 crypto. Verify: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run openapi`, `npx jest <touched>`.

## Global Constraints
- Spec: `docs/superpowers/specs/2026-08-11-scheduling-calendly-design.md`. Read before Task 1.
- Signing key + tokens are stored **encrypted**; decrypt via `EncryptionPort` only inside the verifier/use-case, never expose. No em dashes in code/comments. Keep OpenAPI updated. Reuse the Stripe webhook pattern in `src/modules/billing/**` (`stripe-webhook.controller.ts`, `stripe-webhook-verifier.adapter.ts`, `handle-stripe-webhook.use-case.ts`) for raw-body + verify-first structure.
- New tables under RLS (mirror an existing `*_rls` migration, e.g. `20260714110000_clinic_portal_rls`). The webhook path is public (no session); it inserts as system with an explicit `clinicId` resolved from the URL, after signature verification.
- Idempotent on the Calendly invitee URI (redelivery must not double-create).

## Task 1: Appointment model + lead extension + RLS

**Files:** `prisma/schema.prisma`, a migration under `prisma/migrations/` (schema change) and RLS statements (can be in the same migration), read the `Lead` model first.

- [ ] **Step 1:** Add `enum AppointmentStatus { booked canceled @@map("appointment_status") }` and `model Appointment`: `id` (uuid default), `clinicId @db.Uuid @map("clinic_id")`, `leadId String? @db.Uuid @map("lead_id")`, `patientId String? @db.Uuid @map("patient_id")`, `sessionId String? @map("session_id")`, `inviteeEmail String @map("invitee_email")`, `inviteeName String? @map("invitee_name")`, `calendlyEventUri String @map("calendly_event_uri")`, `calendlyInviteeUri String @unique @map("calendly_invitee_uri")`, `startTime DateTime @map("start_time") @db.Timestamptz`, `endTime DateTime? @map("end_time") @db.Timestamptz`, `status AppointmentStatus @default(booked) @map("status")`, `provider String @default("calendly")`, `createdAt`/`updatedAt`. Relations to Clinic and Lead (optional). `@@map("appointments")`, index on `clinicId`.
- [ ] **Step 2:** Extend `Lead`: add `scheduledAt DateTime? @map("scheduled_at") @db.Timestamptz` (the lead's booked status uses the existing `clinicStatus`/status field set to the booked value; read the Lead model to use the exact existing status column/enum, do not invent a new status field).
- [ ] **Step 3:** Migration: create the enum + `appointments` table + the `leads.scheduled_at` column. Then RLS: `ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;` with policies mirroring the clinic-portal pattern: clinic can select its own (`clinic_id = current_setting('app.current_clinic_id')::uuid`), patient can select its own (`patient_id = current_setting('app.current_patient_id')::uuid` if that setting exists; read an existing patient RLS migration for the exact setting name), admin per the existing admin pattern, and grants so the system role can insert/update. Follow an existing `*_rls` migration verbatim for the GRANT + policy style. Timestamp after the latest migration. `npx prisma generate`. Do NOT run migrate against a DB.
- [ ] **Step 4:** Verify `npm run typecheck`, `npm run build`. Commit `feat(scheduling): appointment model, lead scheduled_at, and RLS`.

## Task 2: Per-clinic webhook URL + Calendly signature verifier

**Files:** `src/modules/scheduling/infrastructure/calendly.adapter.ts` (+ its port + callback use-case for the URL change), `src/modules/scheduling/domain/ports/calendly-webhook-verifier.port.ts` (new), `src/modules/scheduling/infrastructure/calendly-webhook-verifier.adapter.ts` (new), specs, `scheduling.module.ts`.

- [ ] **Step 1:** Change webhook registration to per-clinic URL. Update `CalendlyPort.createWebhookSubscription` to take the clinic id (or a fully-built callback URL) and register `url = ${CALENDLY_WEBHOOK_URL}/${clinicId}`. Update `CalendlyCallbackUseCase` to pass the clinic id. Update the adapter + its tests. (This refines slice 1 on the same branch.)
- [ ] **Step 2:** `CalendlyWebhookVerifierPort`: `verify(rawBody: Buffer, signatureHeader: string, signingKey: string): void` (throws on bad/missing/stale signature). Mirror `stripe-webhook-verifier.port.ts`.
- [ ] **Step 3:** `CalendlyWebhookVerifierAdapter`: parse the `Calendly-Webhook-Signature` header (`t=<ts>,v1=<hex>`), compute `HMAC-SHA256(signingKey, ` + "`${t}.${rawBody}`" + `)`, `crypto.timingSafeEqual` compare, and reject when the timestamp is older than a tolerance (e.g. 5 minutes). Use Node `crypto`.
- [ ] **Step 4:** Unit-test the verifier: valid signature passes; tampered body fails; wrong key fails; missing/malformed header fails; stale timestamp fails. Provide the signingKey + body + a correctly-computed signature in the test (compute it with crypto in the test). `npx jest src/modules/scheduling`.
- [ ] **Step 5:** Wire the verifier into `scheduling.module.ts`. Verify `npm run typecheck`, `npm run lint`, `npm run build`, jest. Commit `feat(scheduling): per-clinic Calendly webhook URL and signature verifier`.

## Task 3: Webhook receiver (controller + use-case)

**Files:** `src/modules/scheduling/infrastructure/http/calendly-webhook.controller.ts`, `src/modules/scheduling/application/handle-calendly-webhook.use-case.ts` (+ spec), an appointment repository port + prisma impl, a lead-update method (extend the leads repo or add a small scheduling-side method), `scheduling.module.ts`, tracking-token decode helper.

- [ ] **Step 1:** Appointment repo port + prisma impl (system-scoped): `createIfAbsent(appointment)` (idempotent on `calendlyInviteeUri`), `cancelByInviteeUri(uri)`, `listForClinic(clinicId)`, `listForPatient({patientId, sessionId})`. Use `asSystem`.
- [ ] **Step 2:** Lead linkage: a method to mark a lead booked (`setBookedScheduled(leadId, scheduledAt)`, sets the existing booked status + `scheduled_at`) and to revert on cancel. Decode the tracking token from `payload.tracking.utm_content` (it is the value slice 4 will set; for now support the token = `EncryptionPort`-encrypted `leadId` OR a plain leadId, decide one and document; recommend an encrypted `leadId:clinicId` so it is unforgeable). If absent, fall back to matching an existing lead by clinic + invitee email.
- [ ] **Step 2b:** `HandleCalendlyWebhookUseCase.handle(clinicId, rawBody, signatureHeader)`: load the clinic scheduling state; if not `calendly`-connected -> 404/ignore. Decrypt the signing key; `verifier.verify(...)` (bad signature -> BadRequest). Parse the event JSON. On `invitee.created`: build the appointment (clinic, lead via token/email, invitee email/name, event + invitee URIs, start/end from `payload.scheduled_event.start_time`/`end_time`, status booked) and `createIfAbsent`; if a lead resolved, `setBookedScheduled`. On `invitee.canceled`: `cancelByInviteeUri` and revert the lead. Other events: ignore. Return void.
- [ ] **Step 3:** Controller `@Post('webhooks/calendly/:clinicId')` (NO ClinicGuard; public), `@Req() req: RawBodyRequest<Request>`, read the `calendly-webhook-signature` header, call the use-case with `req.rawBody as Buffer`. Return `{ received: true }`. Mirror `stripe-webhook.controller.ts`.
- [ ] **Step 4:** Tests (mock verifier + repos): created -> creates appointment + marks lead booked; redelivery -> idempotent (createIfAbsent no-ops); canceled -> cancels + reverts lead; bad signature -> BadRequest and no writes; unconnected clinic -> ignored. `npx jest src/modules/scheduling`.
- [ ] **Step 5:** Wire into `scheduling.module.ts`. Verify typecheck/lint/build/jest. Commit `feat(scheduling): Calendly webhook receiver creates appointments and books leads`.

## Task 4: Read endpoints (clinic + patient) + OpenAPI

**Files:** clinic portal appointments endpoint (extend the scheduling controller or clinic-portal), patient appointments endpoint (read the existing patients controller for the patient-auth guard/role pattern), DTOs, OpenAPI.

- [ ] **Step 1:** `GET /clinic/portal/appointments` (ClinicGuard + @CurrentClinic) -> `AppointmentDto[]` from `listForClinic`.
- [ ] **Step 2:** `GET /patients/me/appointments` using the SAME patient auth/guard the existing `/patients/me` endpoints use (read `patients.controller.ts`) -> the patient's appointments from `listForPatient`.
- [ ] **Step 3:** `AppointmentDto` (no internal ciphertext; expose clinic name/appointment time/status/invitee where appropriate), `@ApiOkResponse` on both. `npm run openapi`.
- [ ] **Step 4:** Tests for both list use-cases. Verify typecheck/lint/build/jest. Commit `feat(scheduling): clinic and patient appointment read endpoints`.

## Self-Review Notes
- Signature verified before any write; unconnected/unknown clinic ignored; idempotent on invitee URI.
- Appointments under RLS; the public webhook inserts as system with the URL-derived clinicId only after verification.
- Lead linkage prefers the unforgeable tracking token, falls back to clinic + invitee email.
- Tracking-token format is fixed here so slice 4's embed sets the matching value.
