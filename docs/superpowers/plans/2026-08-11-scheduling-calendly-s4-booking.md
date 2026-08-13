# Scheduling Slice 4: Patient booking + consultations (cross-repo) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a patient book a real time in the clinic's Calendly, embedded on `/clinic/:slug/book`, prefilled and tracked so the webhook (slice 2) links the booking to the patient/lead; keep request-to-book as the fallback; and show the patient their appointments in My Consultations.

**Repos:** Task 1 = `NewBackend` on `feat/scheduling-calendly`. Tasks 2-4 = `Medalign-frontend` on `feat/scheduling-calendly`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-11-scheduling-calendly-design.md`.
- The tracking token is minted by the BACKEND (encrypted with the server key): `EncryptionPort.encrypt(` + "`${leadId}:${clinicId}`" + `)`; the webhook (slice 2) decrypts it and validates the clinicId. The frontend never mints it.
- No em dashes in code/copy. Keep OpenAPI updated. Reuse existing patterns. No new runtime dependencies (embed Calendly via a plain iframe with prefill query params, not a third-party script).

---

## Task 1 (BACKEND): Booking-context endpoint

**Repo:** `NewBackend` (`feat/scheduling-calendly`).
**Files:** a `PrepareBookingUseCase` in `src/modules/scheduling/application/`, a DTO, add a route to a patient-facing controller (a new `PatientBookingController` in the scheduling module using the same patient auth as `PatientsController` / `patient-appointments.controller.ts`), scheduling.module wiring, OpenAPI. Reuse: `ClinicRepositoryPort` (find by slug + scheduling fields), `LeadRepositoryPort.findLatestByClinicAndEmail` + `SubmitLeadUseCase` (create), `GetLatestAssessmentUseCase` (patient's latest assessment), the patient profile repo (name/email), `EncryptionPort`.

- [ ] **Step 1:** `GET /patients/me/booking-context/:slug` (patient auth via the global JwtCookie+Roles guards + `@CurrentUser()`, mirror `patient-appointments.controller.ts`).
- [ ] **Step 2:** `PrepareBookingUseCase.execute({ userId, slug })`:
  - Resolve the clinic by slug. If not found -> 404.
  - If `clinic.schedulingProvider !== 'calendly'` or no `calendlySchedulingUrl` -> return `{ provider: 'request', schedulingUrl: null, trackingToken: null, inviteeName: null, inviteeEmail: null }` (frontend uses request-to-book fallback).
  - Else: get the patient's profile (name, email) from the patient repo (resolve patientId from userId). Ensure a lead: `findLatestByClinicAndEmail(clinic.id, patientEmail)`; if none, load the patient's latest assessment (`GetLatestAssessmentUseCase`) and create a lead via `SubmitLeadUseCase.execute(...)` mapping the assessment fields (treatmentCategory, topGoals, topSymptoms, budgetBand, telehealthPreference, appointmentPreference, startTimeline, patientEmail, patientZip). Get the resulting `leadId`. If the patient has no assessment at all, still return `provider: 'calendly'` with a null leadId + null token (booking still works; it just will not link to a lead, and the webhook falls back to email match).
  - `trackingToken = leadId ? encryption.encrypt(` + "`${leadId}:${clinic.id}`" + `) : null`.
  - Return `{ provider: 'calendly', schedulingUrl: clinic.calendlySchedulingUrl, trackingToken, inviteeName: patientName, inviteeEmail: patientEmail }`.
- [ ] **Step 3:** DTO with `@ApiProperty`; `@ApiOkResponse`. Wire into scheduling.module (import LeadsModule/AssessmentsModule/PatientsModule as needed; watch for cycles - prefer importing the modules that export the ports). `npm run openapi`.
- [ ] **Step 4:** Unit tests: not-connected clinic -> provider 'request'; connected + existing lead -> token minted from that lead; connected + no lead + has assessment -> creates lead + token; token decrypts to `${leadId}:${clinicId}`. Verify `npm run typecheck`, `npm run lint`, `npm run build`, `npx jest src/modules/scheduling`. Commit `feat(scheduling): patient booking-context endpoint (ensure lead, mint tracking token)`.

---

## Task 2 (FRONTEND): booking-context API method

**Repo:** `Medalign-frontend` (`feat/scheduling-calendly`).
**Files:** `app/api/client.ts` (patient-side API), `app/types/index.ts`.

- [ ] **Step 1:** Type `BookingContext = { provider: "request" | "calendly"; schedulingUrl: string | null; trackingToken: string | null; inviteeName: string | null; inviteeEmail: string | null }`.
- [ ] **Step 2:** `getBookingContext(slug: string): Promise<BookingContext>` -> `http.get('/patients/me/booking-context/' + slug)`. Mirror the existing `app/api/client.ts` style.
- [ ] **Step 3:** Verify `npm run typecheck` + `npm run build`. Commit `feat(booking): booking-context API method`.

## Task 3 (FRONTEND): embedded Calendly on the booking page

**Repo:** `Medalign-frontend`.
**Files:** `app/routes/clinic-booking.tsx`.

- [ ] **Step 1:** On mount (the page is already auth-gated + fetches the clinic), also `useQuery(["bookingContext", slug], () => getBookingContext(slug))`.
- [ ] **Step 2:** If `bookingContext.provider === "calendly"` and `schedulingUrl`: render the Calendly widget as an IFRAME (no external script) whose src is the scheduling URL with prefill + tracking query params: `${schedulingUrl}?embed_domain=${location.host}&embed_type=Inline&hide_gdpr_banner=1&name=${encodeURIComponent(inviteeName ?? "")}&email=${encodeURIComponent(inviteeEmail ?? "")}${trackingToken ? "&utm_content=" + encodeURIComponent(trackingToken) : ""}`. Give the iframe a sensible min-height (e.g. 700px), title, and `loading="lazy"`. Add a short heading + note that Calendly will email the confirmation. Build the query string inside an effect/handler or a `useMemo` guarded for SSR (the page is SPA `ssr:false`, but keep `location` usage inside the component body safe).
- [ ] **Step 3:** If `provider === "request"` (or the context query is loading/errored), render the EXISTING request-to-book flow unchanged. Do not remove or regress it.
- [ ] **Step 4:** Verify `npm run typecheck` + `npm run build`. Commit `feat(booking): embed clinic Calendly with prefill and tracking`.

## Task 4 (FRONTEND): appointments in My Consultations

**Repo:** `Medalign-frontend`.
**Files:** `app/routes/my-consultations.tsx`, `app/api/client.ts`, `app/types/index.ts`.

- [ ] **Step 1:** Type `PatientAppointment = { id: string; status: "booked" | "canceled"; startTime: string; endTime: string | null; clinicName: string | null; clinicId: string }` and `getMyAppointments(): Promise<PatientAppointment[]>` -> `http.get('/patients/me/appointments')`.
- [ ] **Step 2:** In `my-consultations.tsx`, add a `useQuery(["myAppointments"], getMyAppointments)` and render a "Scheduled appointments" section: clinic name, formatted start time (`Intl.DateTimeFormat`), status badge. Keep the existing consultations/leads content; add appointments as an additional section (booked ones first). Empty state when none.
- [ ] **Step 3:** Verify `npm run typecheck` + `npm run build`. Commit `feat(patient): show scheduled appointments in My Consultations`.

## Self-Review Notes

- The frontend never mints the token; it only passes through what the backend returned.
- Request-to-book stays fully intact as the fallback.
- The embed uses an iframe (no new dependency); the server webhook (slice 2) captures the booking via `utm_content`.
- Patient appointments come from the slice-2 `GET /patients/me/appointments` endpoint (now populated with patientId).
