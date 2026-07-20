-- Admin Clinics & Patients slice: admin RLS policies.
-- Adds admin-only access to admin_notes and confirms admin read/write on the
-- patient and lead tables the admin endpoints read. Every existing policy
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
-- 2. patients — admin access already in place, verified only
--
-- `psql "$DATABASE_URL" -c "\d patients"` shows policy patients_admin_all
-- already exists (created by 20260713010000_patient_journey_rls, hardened
-- with the nullif(...) idiom by 20260714110000_clinic_portal_rls) using
-- exactly the admin idiom from Global Constraints. app_authenticated already
-- holds SELECT, INSERT, UPDATE, DELETE on patients. No new policy or grant
-- is added here — creating a second policy of the same name would error
-- ("policy already exists"), and the existing one already covers what this
-- task needs.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. patient_assessments — admin access already in place, verified only
--
-- Same situation as patients: policy patient_assessments_admin_all already
-- exists with the required idiom, and app_authenticated already holds
-- SELECT, INSERT, UPDATE, DELETE. Nothing to add.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. leads — admin policy already in place; no grant gap
--
-- Policy leads_admin_all already exists with the required idiom (from
-- 20260713010000_patient_journey_rls / 20260714110000_clinic_portal_rls), so
-- no new policy is added. `psql "$DATABASE_URL" -c "\d leads"` shows
-- app_authenticated holds table-level SELECT, INSERT, DELETE plus a
-- column-level UPDATE (clinic_status only) — not a gap: 20260714110000
-- deliberately narrowed UPDATE to that one column so a clinic-context caller
-- can update lead status but nothing else, and documents that admin paths
-- needing full UPDATE on leads must use asSystem instead of
-- withUserContext/app_authenticated. This task only needs admin SELECT on
-- leads (per the required test coverage), which the existing SELECT grant
-- already provides, so nothing is added here — widening UPDATE back to the
-- whole row would regress that clinic-role restriction.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. audit_log — index for PHI access reporting
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS audit_log_action_created_idx
    ON audit_log ("action_type", "created_at" DESC);
