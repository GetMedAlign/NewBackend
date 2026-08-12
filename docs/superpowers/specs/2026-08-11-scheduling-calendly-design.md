# Scheduling (Calendly integration) Design Spec

**Date:** 2026-08-11
**Status:** Approved (design confirmed by Brian). Phase 1 = Calendly. Google Calendar and other providers are a later spec.

## Goal

Give clinics real, calendar-connected scheduling. A clinic connects its Calendly account; patients book a real slot in an embedded Calendly widget on the MedAlign booking page; MedAlign captures the booking through Calendly's server webhooks and records it as an appointment (also reflected on the lead). Clinics that connect nothing keep today's request-to-book flow.

## Confirmed decisions

1. **External calendar integration** (client wants Calendly, Google Calendar, etc.). Phase 1 is **Calendly**, built behind a per-clinic **provider abstraction** so Google and others slot in later.
2. **Embed the clinic's Calendly inside MedAlign** (inline widget on `/clinic/:slug/book`); the patient books in-brand, not redirected.
3. **Full Calendly OAuth connect per clinic in phase 1**, with **server-side webhooks** for `invitee.created` and `invitee.canceled` (robust cancellation/reschedule handling from day one).
4. **Record the booking as a dedicated Appointment AND extend the existing lead** (mark it `booked` with the scheduled time, linked to the appointment).
5. **Request-to-book stays as the fallback** for clinics with no provider connected (the current lead pipeline, unchanged).

## Architecture

### Provider abstraction
`clinic.scheduling_provider`: `none` | `calendly` (extensible to `google`, etc.). The booking page and the capture pipeline branch on this. Only `calendly` is implemented in phase 1.

### 1. Clinic connects Calendly (portal, OAuth)
- A "Scheduling" section in the clinic portal with a "Connect Calendly" action starting Calendly OAuth 2.0 (MedAlign developer app: `CALENDLY_CLIENT_ID`/`CALENDLY_CLIENT_SECRET`/redirect).
- On callback: exchange the code for access + refresh tokens; call Calendly `GET /users/me` to get the user URI, current organization URI, and scheduling URL.
- Store on the clinic: `scheduling_provider = 'calendly'`, the Calendly user/org URI, scheduling URL, and the **access + refresh tokens encrypted at rest** (reuse the existing AES-256-GCM field-encryption used for webhook secrets). Store token expiry; refresh transparently when expired.
- On connect, **register a Calendly webhook subscription** (`POST /webhook_subscriptions`) for events `invitee.created`, `invitee.canceled`, scope `organization` (or `user`), pointing at MedAlign's webhook URL, with a generated `signing_key`. Store the subscription URI + signing key (encrypted). Provide a "Disconnect" that deletes the subscription and clears the tokens.

### 2. Patient booking (embedded)
- On `/clinic/:slug/book`, if the clinic's provider is `calendly`, render the Calendly **inline embed** of their scheduling URL, prefilled with the patient's `name` + `email` and a MedAlign **tracking token** passed as `utm_content`.
- The tracking token is an opaque/signed value encoding the `leadId` (and clinic + patient). Before rendering the embed, **ensure a lead exists** for this patient + clinic (create one via the existing lead pipeline if the patient has not already inquired) so every booking links to a lead; use that `leadId` in the token.
- If the provider is `none`, render the existing request-to-book UI unchanged.

### 3. Capture (server webhook)
- `POST /webhooks/calendly` (public, no auth) receives Calendly events. **Verify the `Calendly-Webhook-Signature`** (HMAC-SHA256 over timestamp + raw body with the stored signing key); reject on mismatch or stale timestamp.
- Resolve the target clinic from the webhook subscription/organization; link the patient/lead via `payload.tracking.utm_content` (the tracking token), falling back to invitee email + clinic.
- **`invitee.created`:** create an `appointment` (clinic, lead, patient/session, invitee email/name, Calendly event + invitee URIs, start/end time, status `booked`, provider `calendly`); mark the linked lead `booked` and stamp `scheduled_at`; keep the clinic's existing lead notification.
- **`invitee.canceled`:** set the appointment status `canceled`; revert the lead status/`scheduled_at` as appropriate.
- Idempotent on the Calendly invitee URI (a redelivered webhook must not double-create).

### 4. Surfaces
- **Clinic portal:** a new **Appointments** view (`GET /clinic/portal/appointments`), and the existing lead pipeline reflects `booked` + the scheduled time.
- **Patient:** **My Consultations** shows the scheduled appointment (extend `GET /patients/me/leads` or a new `GET /patients/me/appointments`).
- Calendly sends its own confirmation/reminder emails to the patient; MedAlign does not duplicate them.

## Data model
- `clinic`: `scheduling_provider` (enum, default `none`), `calendly_user_uri`, `calendly_org_uri`, `calendly_scheduling_url`, `calendly_access_token_encrypted`, `calendly_refresh_token_encrypted`, `calendly_token_expires_at`, `calendly_webhook_uri`, `calendly_webhook_signing_key_encrypted`.
- New `appointment` table: `id`, `clinic_id`, `lead_id` (nullable), `patient_id`/`session_id`, `invitee_email`, `invitee_name`, `calendly_event_uri`, `calendly_invitee_uri` (unique, for idempotency), `start_time`, `end_time`, `status` (`booked` | `canceled`), `provider`, `created_at`, `updated_at`. RLS: clinic sees its own; patient sees its own; admin scoped.
- `lead`: add `scheduled_at` and `appointment_id` (or reuse `clinic_status = booked` + `scheduled_at`).

## Security & constraints
- Calendly tokens + webhook signing key **encrypted at rest** (AES-256-GCM, existing util).
- Webhook signature verified; endpoint idempotent; timestamp freshness checked.
- All new tables under the existing **RLS** model; the webhook path runs as system with an explicit clinic scope resolved from the subscription.
- **Calendly plan requirement:** Calendly's webhook + OAuth API needs a **paid Calendly plan** (Standard or higher) on the clinic side. Flag to the client. Free-tier clinics fall back to request-to-book.
- Keep the committed **OpenAPI** spec updated on every endpoint change (project convention).
- No em dashes in code/copy.
- Booking remains **auth-gated** for the patient (consistent with today's `/clinic/:slug/book`).

## Out of scope (later specs)
- Google Calendar and other providers (the abstraction is built; only Calendly is implemented).
- MedAlign-native slot rendering (we embed Calendly, not re-render its availability).
- Deep reschedule-in-place UX beyond canceled/created handling.

## Implementation slices (each its own plan)
1. **Backend: Calendly connect (OAuth) + token storage + webhook subscription** (portal connect/disconnect endpoints, encrypted tokens, provider field).
2. **Backend: webhook capture + Appointment model + lead extension** (signature verify, idempotency, appointment table, lead `booked`/`scheduled_at`, portal + patient read endpoints). OpenAPI + tests.
3. **Frontend: clinic portal Scheduling connect UI + Appointments view.**
4. **Frontend: embedded Calendly booking on `/clinic/:slug/book` (prefill + tracking token + ensure-lead) with request-to-book fallback; patient My Consultations shows the appointment.**
