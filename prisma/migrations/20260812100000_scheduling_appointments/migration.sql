-- Scheduling Slice 2 (Calendly webhook), Task 1: appointments table + lead
-- scheduled_at + RLS. Later tasks (webhook processing) write appointments and
-- lead.scheduled_at via asSystem (postgres, bypasses RLS); this migration only
-- adds the schema and the read-side RLS policies.

-- ---------------------------------------------------------------------------
-- appointment_status enum
-- ---------------------------------------------------------------------------
CREATE TYPE "appointment_status" AS ENUM ('booked', 'canceled');

-- ---------------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------------
CREATE TABLE "appointments" (
    "id"                    UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id"             UUID NOT NULL,
    "lead_id"               UUID,
    "patient_id"            UUID,
    "session_id"            TEXT,
    "invitee_email"         TEXT NOT NULL,
    "invitee_name"          TEXT,
    "calendly_event_uri"    TEXT NOT NULL,
    "calendly_invitee_uri"  TEXT NOT NULL,
    "start_time"            TIMESTAMPTZ NOT NULL,
    "end_time"              TIMESTAMPTZ,
    "status"                "appointment_status" NOT NULL DEFAULT 'booked',
    "provider"              TEXT NOT NULL DEFAULT 'calendly',
    "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"            TIMESTAMPTZ NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "appointments_calendly_invitee_uri_key" ON "appointments"("calendly_invitee_uri");

CREATE INDEX "appointments_clinic_id_idx" ON "appointments"("clinic_id");

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- leads: add scheduled_at (set alongside clinic_status = 'booked' by a later
-- task's webhook handler; no new status column, reuses clinic_status).
-- ---------------------------------------------------------------------------
ALTER TABLE "leads" ADD COLUMN "scheduled_at" TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- RLS: appointments
-- Mirrors the clinic-portal / patient-journey pattern:
--   - clinic (app_authenticated, app.current_clinic_id set) selects its own
--     appointments.
--   - patient (app_authenticated, app.current_user_id set) selects
--     appointments tied to their own patient row (there is no
--     app.current_patient_id session setting in this codebase; patient scoping
--     goes through app.current_user_id -> patients.user_id -> patients.id,
--     the same indirection leads_self_select uses).
--   - admin/superadmin: full access.
--   - system (postgres, BYPASSRLS) inserts/updates appointments via asSystem
--     for the webhook handler; no additional grant is required for that path,
--     mirroring webhook_deliveries in the patient-journey-rls migration.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON appointments TO app_authenticated;

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;

CREATE POLICY appointments_clinic_select ON appointments
  FOR SELECT TO app_authenticated
  USING (clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid);

CREATE POLICY appointments_patient_select ON appointments
  FOR SELECT TO app_authenticated
  USING (
    patient_id IN (
      SELECT id FROM patients
      WHERE user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY appointments_admin_all ON appointments
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );
