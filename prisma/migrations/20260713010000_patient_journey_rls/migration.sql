-- Patient Journey slice: RLS policies + audit triggers for the new tables.
-- Mirrors the Foundation RLS migration (20260710010000_rls_audit). The app
-- connects as the `postgres` superuser (bypasses RLS for asSystem paths). User
-- work runs inside a transaction that does `SET LOCAL ROLE app_authenticated`,
-- an RLS-subject role that RLS enforces. `has_role`, `append_audit_log`, and
-- the `app_authenticated` role are provided by the Foundation migration.

-- ---------------------------------------------------------------------------
-- Grants to app_authenticated
-- ---------------------------------------------------------------------------
-- Patient-owned PHI tables: full DML (RLS scopes the rows).
GRANT SELECT, INSERT, UPDATE, DELETE ON patients                      TO app_authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON patient_assessments           TO app_authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_goals              TO app_authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_symptoms           TO app_authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_chronic_conditions TO app_authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_prescriptions      TO app_authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON leads                         TO app_authenticated;

-- Public reference data: read-only.
GRANT SELECT ON clinics           TO app_authenticated;
GRANT SELECT ON clinic_categories TO app_authenticated;
GRANT SELECT ON clinic_services   TO app_authenticated;
GRANT SELECT ON zip_codes         TO app_authenticated;

-- webhook_deliveries: NO grant. Reached only via asSystem (postgres).

-- ---------------------------------------------------------------------------
-- Enable + FORCE Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE patients                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_assessments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_goals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_symptoms           ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_chronic_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_prescriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_categories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_services               ENABLE ROW LEVEL SECURITY;
ALTER TABLE zip_codes                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries            ENABLE ROW LEVEL SECURITY;

ALTER TABLE patients                      FORCE ROW LEVEL SECURITY;
ALTER TABLE patient_assessments           FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment_goals              FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment_symptoms           FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment_chronic_conditions FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment_prescriptions      FORCE ROW LEVEL SECURITY;
ALTER TABLE leads                         FORCE ROW LEVEL SECURITY;
ALTER TABLE clinics                       FORCE ROW LEVEL SECURITY;
ALTER TABLE clinic_categories             FORCE ROW LEVEL SECURITY;
ALTER TABLE clinic_services               FORCE ROW LEVEL SECURITY;
ALTER TABLE zip_codes                     FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries            FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- patients — a patient may see/manage only their own row; admins all.
-- ---------------------------------------------------------------------------
CREATE POLICY patients_self_select ON patients
  FOR SELECT TO app_authenticated
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY patients_self_insert ON patients
  FOR INSERT TO app_authenticated
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY patients_self_update ON patients
  FOR UPDATE TO app_authenticated
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY patients_self_delete ON patients
  FOR DELETE TO app_authenticated
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY patients_admin_all ON patients
  FOR ALL TO app_authenticated
  USING (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  );

-- ---------------------------------------------------------------------------
-- patient_assessments — scoped through the owning patient; admins all.
-- Anonymous rows (patient_id IS NULL) match no app_authenticated policy and are
-- therefore reachable only via asSystem (postgres).
-- ---------------------------------------------------------------------------
CREATE POLICY patient_assessments_self_all ON patient_assessments
  FOR ALL TO app_authenticated
  USING (
    patient_id IN (
      SELECT id FROM patients
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  )
  WITH CHECK (
    patient_id IN (
      SELECT id FROM patients
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY patient_assessments_admin_all ON patient_assessments
  FOR ALL TO app_authenticated
  USING (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  );

-- ---------------------------------------------------------------------------
-- Assessment child tables — scoped through the assessment's owning patient.
-- ---------------------------------------------------------------------------
CREATE POLICY assessment_goals_self_all ON assessment_goals
  FOR ALL TO app_authenticated
  USING (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = current_setting('app.current_user_id', true)::uuid
    )
  )
  WITH CHECK (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY assessment_goals_admin_all ON assessment_goals
  FOR ALL TO app_authenticated
  USING (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  );

CREATE POLICY assessment_symptoms_self_all ON assessment_symptoms
  FOR ALL TO app_authenticated
  USING (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = current_setting('app.current_user_id', true)::uuid
    )
  )
  WITH CHECK (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY assessment_symptoms_admin_all ON assessment_symptoms
  FOR ALL TO app_authenticated
  USING (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  );

CREATE POLICY assessment_chronic_conditions_self_all ON assessment_chronic_conditions
  FOR ALL TO app_authenticated
  USING (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = current_setting('app.current_user_id', true)::uuid
    )
  )
  WITH CHECK (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY assessment_chronic_conditions_admin_all ON assessment_chronic_conditions
  FOR ALL TO app_authenticated
  USING (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  );

CREATE POLICY assessment_prescriptions_self_all ON assessment_prescriptions
  FOR ALL TO app_authenticated
  USING (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = current_setting('app.current_user_id', true)::uuid
    )
  )
  WITH CHECK (
    assessment_id IN (
      SELECT pa.id FROM patient_assessments pa
      JOIN patients p ON p.id = pa.patient_id
      WHERE p.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY assessment_prescriptions_admin_all ON assessment_prescriptions
  FOR ALL TO app_authenticated
  USING (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  );

-- ---------------------------------------------------------------------------
-- leads — a patient may read leads tied to their own patient row; admins all.
-- (Clinic-side access is a later slice.)
-- ---------------------------------------------------------------------------
CREATE POLICY leads_self_select ON leads
  FOR SELECT TO app_authenticated
  USING (
    patient_id IN (
      SELECT id FROM patients
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY leads_admin_all ON leads
  FOR ALL TO app_authenticated
  USING (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  );

-- ---------------------------------------------------------------------------
-- Public reference data — readable by any authenticated caller (no PHI).
-- ---------------------------------------------------------------------------
CREATE POLICY clinics_public_select ON clinics
  FOR SELECT TO app_authenticated
  USING (true);

CREATE POLICY clinic_categories_public_select ON clinic_categories
  FOR SELECT TO app_authenticated
  USING (true);

CREATE POLICY clinic_services_public_select ON clinic_services
  FOR SELECT TO app_authenticated
  USING (true);

CREATE POLICY zip_codes_public_select ON zip_codes
  FOR SELECT TO app_authenticated
  USING (true);

-- webhook_deliveries: RLS enabled with no policy for app_authenticated, so the
-- role can touch no rows. All access is via asSystem (postgres, bypasses RLS).

-- ---------------------------------------------------------------------------
-- Audit triggers — mirror audit_users: read the session vars, coalesce an
-- empty actor_role to 'system', strip encrypted/PHI free-text from the jsonb.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_patients()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id   uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
  actor_role text := coalesce(nullif(current_setting('app.current_user_role', true), ''), 'system');
  ip         text := nullif(current_setting('app.current_ip_address', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'patient_created',
      'patients:' || NEW.id,
      NULL, to_jsonb(NEW), NULL
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'patient_updated',
      'patients:' || NEW.id,
      to_jsonb(OLD), to_jsonb(NEW), NULL
    );
    RETURN NEW;
  ELSE
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'patient_deleted',
      'patients:' || OLD.id,
      to_jsonb(OLD), NULL, NULL
    );
    RETURN OLD;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION audit_patient_assessments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id   uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
  actor_role text := coalesce(nullif(current_setting('app.current_user_role', true), ''), 'system');
  ip         text := nullif(current_setting('app.current_ip_address', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'assessment_created',
      'patient_assessments:' || NEW.id,
      NULL,
      to_jsonb(NEW)
        - 'symptom_duration' - 'exercise_frequency' - 'diet' - 'sleep_hours'
        - 'stress_level' - 'alcohol_use' - 'appointment_preference'
        - 'biological_sex' - 'allergy_details' - 'other_medications',
      NULL
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'assessment_updated',
      'patient_assessments:' || NEW.id,
      to_jsonb(OLD)
        - 'symptom_duration' - 'exercise_frequency' - 'diet' - 'sleep_hours'
        - 'stress_level' - 'alcohol_use' - 'appointment_preference'
        - 'biological_sex' - 'allergy_details' - 'other_medications',
      to_jsonb(NEW)
        - 'symptom_duration' - 'exercise_frequency' - 'diet' - 'sleep_hours'
        - 'stress_level' - 'alcohol_use' - 'appointment_preference'
        - 'biological_sex' - 'allergy_details' - 'other_medications',
      NULL
    );
    RETURN NEW;
  ELSE
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'assessment_deleted',
      'patient_assessments:' || OLD.id,
      to_jsonb(OLD)
        - 'symptom_duration' - 'exercise_frequency' - 'diet' - 'sleep_hours'
        - 'stress_level' - 'alcohol_use' - 'appointment_preference'
        - 'biological_sex' - 'allergy_details' - 'other_medications',
      NULL, NULL
    );
    RETURN OLD;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION audit_leads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id   uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
  actor_role text := coalesce(nullif(current_setting('app.current_user_role', true), ''), 'system');
  ip         text := nullif(current_setting('app.current_ip_address', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'lead_created',
      'leads:' || NEW.id,
      NULL, to_jsonb(NEW) - 'patient_phone', NULL
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'lead_updated',
      'leads:' || NEW.id,
      to_jsonb(OLD) - 'patient_phone', to_jsonb(NEW) - 'patient_phone', NULL
    );
    RETURN NEW;
  ELSE
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'lead_deleted',
      'leads:' || OLD.id,
      to_jsonb(OLD) - 'patient_phone', NULL, NULL
    );
    RETURN OLD;
  END IF;
END;
$$;

CREATE TRIGGER patients_audit
  AFTER INSERT OR UPDATE OR DELETE ON patients
  FOR EACH ROW EXECUTE FUNCTION audit_patients();

CREATE TRIGGER patient_assessments_audit
  AFTER INSERT OR UPDATE OR DELETE ON patient_assessments
  FOR EACH ROW EXECUTE FUNCTION audit_patient_assessments();

CREATE TRIGGER leads_audit
  AFTER INSERT OR UPDATE OR DELETE ON leads
  FOR EACH ROW EXECUTE FUNCTION audit_leads();
