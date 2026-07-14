-- Clinic Portal slice: clinic-scoped RLS policies.
-- Adds policies keyed on app.current_clinic_id so a clinic-context caller
-- (role app_authenticated, app.current_clinic_id set) sees only its own rows.
-- Uses nullif(current_setting('app.current_clinic_id', true), '')::uuid so
-- that when the var is unset or empty (e.g. a patient request) the cast yields
-- NULL and the policy simply matches no rows instead of throwing a cast error.
--
-- This migration also hardens the existing patient-journey policies to use the
-- same nullif idiom for app.current_user_id: previously those policies would
-- throw "invalid input syntax for type uuid: """ whenever a clinic-context
-- caller (userId = '') evaluated them. The semantics are identical — nullif
-- yields NULL, which makes the USING clause false and matches no rows. No
-- previously-granted access is widened.

-- ---------------------------------------------------------------------------
-- Grants to app_authenticated
-- ---------------------------------------------------------------------------

-- clinics: add UPDATE so clinic users can edit their own profile.
-- (SELECT was already granted in the patient-journey-rls migration.)
GRANT UPDATE ON clinics TO app_authenticated;

-- leads: revoke broad UPDATE and replace with a column-level grant for
-- clinic_status only. This enforces that the clinic role (app_authenticated
-- with app.current_clinic_id set) may only change clinic_status — any attempt
-- to UPDATE another column is rejected at the privilege level. Admin paths that
-- need full UPDATE on leads must go through asSystem (postgres, bypasses RLS).
-- SELECT, INSERT, DELETE remain as granted in the patient-journey-rls migration.
REVOKE UPDATE ON leads FROM app_authenticated;
GRANT UPDATE (clinic_status) ON leads TO app_authenticated;

-- webhook_deliveries: grant SELECT (previously no grant; postgres-only).
GRANT SELECT ON webhook_deliveries TO app_authenticated;

-- clinic_photos: full DML (table is new to this slice).
GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_photos TO app_authenticated;

-- ---------------------------------------------------------------------------
-- Enable + FORCE Row-Level Security
-- (clinics, leads, webhook_deliveries already enabled in patient-journey-rls;
--  clinic_photos is new — enable it here.)
-- ---------------------------------------------------------------------------
ALTER TABLE clinic_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_photos FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Harden existing patient-journey policies with nullif for app.current_user_id.
-- This prevents "invalid input syntax for type uuid" when a clinic-context
-- request (current_user_id = '') evaluates these policies. Semantics unchanged.
-- ---------------------------------------------------------------------------

-- patients
DROP POLICY patients_self_select ON patients;
CREATE POLICY patients_self_select ON patients
  FOR SELECT TO app_authenticated
  USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY patients_self_insert ON patients;
CREATE POLICY patients_self_insert ON patients
  FOR INSERT TO app_authenticated
  WITH CHECK (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY patients_self_update ON patients;
CREATE POLICY patients_self_update ON patients
  FOR UPDATE TO app_authenticated
  USING     (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY patients_self_delete ON patients;
CREATE POLICY patients_self_delete ON patients
  FOR DELETE TO app_authenticated
  USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);

DROP POLICY patients_admin_all ON patients;
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

-- patient_assessments
DROP POLICY patient_assessments_self_all ON patient_assessments;
CREATE POLICY patient_assessments_self_all ON patient_assessments
  FOR ALL TO app_authenticated
  USING (
    patient_id IN (
      SELECT id FROM patients
      WHERE user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    patient_id IN (
      SELECT id FROM patients
      WHERE user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  );

DROP POLICY patient_assessments_admin_all ON patient_assessments;
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

-- assessment_goals
DROP POLICY assessment_goals_self_all ON assessment_goals;
CREATE POLICY assessment_goals_self_all ON assessment_goals
  FOR ALL TO app_authenticated
  USING (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  );

DROP POLICY assessment_goals_admin_all ON assessment_goals;
CREATE POLICY assessment_goals_admin_all ON assessment_goals
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

-- assessment_symptoms
DROP POLICY assessment_symptoms_self_all ON assessment_symptoms;
CREATE POLICY assessment_symptoms_self_all ON assessment_symptoms
  FOR ALL TO app_authenticated
  USING (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  );

DROP POLICY assessment_symptoms_admin_all ON assessment_symptoms;
CREATE POLICY assessment_symptoms_admin_all ON assessment_symptoms
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

-- assessment_chronic_conditions
DROP POLICY assessment_chronic_conditions_self_all ON assessment_chronic_conditions;
CREATE POLICY assessment_chronic_conditions_self_all ON assessment_chronic_conditions
  FOR ALL TO app_authenticated
  USING (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  );

DROP POLICY assessment_chronic_conditions_admin_all ON assessment_chronic_conditions;
CREATE POLICY assessment_chronic_conditions_admin_all ON assessment_chronic_conditions
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

-- assessment_prescriptions
DROP POLICY assessment_prescriptions_self_all ON assessment_prescriptions;
CREATE POLICY assessment_prescriptions_self_all ON assessment_prescriptions
  FOR ALL TO app_authenticated
  USING (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  );

DROP POLICY assessment_prescriptions_admin_all ON assessment_prescriptions;
CREATE POLICY assessment_prescriptions_admin_all ON assessment_prescriptions
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

-- leads (patient-side policies)
DROP POLICY leads_self_select ON leads;
CREATE POLICY leads_self_select ON leads
  FOR SELECT TO app_authenticated
  USING (
    patient_id IN (
      SELECT id FROM patients
      WHERE user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
    )
  );

DROP POLICY leads_admin_all ON leads;
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
-- clinics — clinic may read and update only its own row.
-- The existing clinics_public_select policy remains; these are additive.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS clinic_self_select ON clinics;
CREATE POLICY clinic_self_select ON clinics
  FOR SELECT TO app_authenticated
  USING (id = nullif(current_setting('app.current_clinic_id', true), '')::uuid);

DROP POLICY IF EXISTS clinic_self_update ON clinics;
CREATE POLICY clinic_self_update ON clinics
  FOR UPDATE TO app_authenticated
  USING     (id = nullif(current_setting('app.current_clinic_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.current_clinic_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- leads — a clinic may select and update (clinic_status only) its own leads.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS leads_clinic_select ON leads;
CREATE POLICY leads_clinic_select ON leads
  FOR SELECT TO app_authenticated
  USING (clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid);

DROP POLICY IF EXISTS leads_clinic_update ON leads;
CREATE POLICY leads_clinic_update ON leads
  FOR UPDATE TO app_authenticated
  USING     (clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- webhook_deliveries — a clinic may select deliveries for its own leads.
-- No insert/update/delete policy; writes remain asSystem-only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS webhook_deliveries_clinic_select ON webhook_deliveries;
CREATE POLICY webhook_deliveries_clinic_select ON webhook_deliveries
  FOR SELECT TO app_authenticated
  USING (
    lead_id IN (
      SELECT id FROM leads
      WHERE clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- clinic_photos — a clinic may manage only its own photos.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS clinic_photos_self_all ON clinic_photos;
CREATE POLICY clinic_photos_self_all ON clinic_photos
  FOR ALL TO app_authenticated
  USING     (clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Harden Foundation policies on users, user_roles, audit_log with nullif.
-- The original policies (from 20260710010000_rls_audit) cast
-- current_setting('app.current_user_id', true)::uuid directly. When a
-- clinic-context caller runs (app.current_user_id = ''), Postgres evaluates
-- ALL permissive policies on the table, hitting this cast and throwing
-- "invalid input syntax for type uuid: """. The fix is identical to the
-- patient-journey hardening above: wrap with nullif(..., '') so that an empty
-- string yields NULL instead of a cast error. Semantically identical for real
-- (non-empty) user IDs — nullif is a no-op on non-empty input.
-- two_factor_codes has no app_authenticated policy, so it is not touched.
-- ---------------------------------------------------------------------------

-- users: self-select
DROP POLICY IF EXISTS users_self_select ON users;
CREATE POLICY users_self_select ON users
  FOR SELECT TO app_authenticated
  USING (id = nullif(current_setting('app.current_user_id', true), '')::uuid);

-- users: self-update
DROP POLICY IF EXISTS users_self_update ON users;
CREATE POLICY users_self_update ON users
  FOR UPDATE TO app_authenticated
  USING     (id = nullif(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.current_user_id', true), '')::uuid);

-- users: admin-select
DROP POLICY IF EXISTS users_admin_select ON users;
CREATE POLICY users_admin_select ON users
  FOR SELECT TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

-- users: admin-all
DROP POLICY IF EXISTS users_admin_all ON users;
CREATE POLICY users_admin_all ON users
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

-- user_roles: self-select
DROP POLICY IF EXISTS user_roles_self_select ON user_roles;
CREATE POLICY user_roles_self_select ON user_roles
  FOR SELECT TO app_authenticated
  USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);

-- user_roles: admin-all
DROP POLICY IF EXISTS user_roles_admin_all ON user_roles;
CREATE POLICY user_roles_admin_all ON user_roles
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

-- audit_log: admin-select
DROP POLICY IF EXISTS audit_log_admin_select ON audit_log;
CREATE POLICY audit_log_admin_select ON audit_log
  FOR SELECT TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );
