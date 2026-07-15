-- Clinic Applications slice: RLS policies and grants.
-- Enables Row-Level Security on the four new tables, grants DML to
-- app_authenticated on the application tables (admin-only access via policies),
-- adds admin-write policies on the clinic tables so approval provisioning can
-- INSERT/DELETE clinics + child rows under withUserContext, and keeps every
-- existing policy (public-select, clinic self/write, patient self) intact.

-- ---------------------------------------------------------------------------
-- 1. clinic_applications — admin-only access
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_applications TO app_authenticated;

ALTER TABLE clinic_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_applications FORCE ROW LEVEL SECURITY;

CREATE POLICY clinic_applications_admin_all ON clinic_applications
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
-- 2. application_categories — admin-only access
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON application_categories TO app_authenticated;

ALTER TABLE application_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_categories FORCE ROW LEVEL SECURITY;

CREATE POLICY application_categories_admin_all ON application_categories
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
-- 3. application_services — admin-only access
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON application_services TO app_authenticated;

ALTER TABLE application_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_services FORCE ROW LEVEL SECURITY;

CREATE POLICY application_services_admin_all ON application_services
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
-- 4. password_reset_tokens — system-only; ENABLE+FORCE RLS, no app grant
-- ---------------------------------------------------------------------------

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;

-- No GRANT and no policy for app_authenticated: access is exclusively via
-- asSystem (postgres superuser, which bypasses RLS). Adding RLS ensures that
-- if app_authenticated ever reaches this table (e.g., through a future
-- misconfiguration), it sees nothing.

-- ---------------------------------------------------------------------------
-- 5. clinics — add INSERT + DELETE grant and admin-all policy for provisioning
--
-- Context: app_authenticated already has SELECT (patient-journey-rls) and
-- UPDATE (clinic-portal-rls). We add INSERT and DELETE so an admin context
-- can provision (INSERT) a new clinic and optionally remove one.
-- The existing clinics_public_select, clinic_self_select, and
-- clinic_self_update policies are kept unchanged — this policy is ADDITIVE.
-- ---------------------------------------------------------------------------

GRANT INSERT, DELETE ON clinics TO app_authenticated;

CREATE POLICY clinics_admin_all ON clinics
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
-- 6. clinic_categories — admin-all policy for provisioning
--
-- app_authenticated already has INSERT, UPDATE, DELETE from
-- 20260714120000_clinic_portal_child_rls. The existing
-- clinic_categories_clinic_write policy (clinic-scoped) is kept; this is
-- ADDITIVE (permissive OR).
-- ---------------------------------------------------------------------------

CREATE POLICY clinic_categories_admin_all ON clinic_categories
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
-- 7. clinic_services — admin-all policy for provisioning
--
-- app_authenticated already has INSERT, UPDATE, DELETE from
-- 20260714120000_clinic_portal_child_rls. The existing
-- clinic_services_clinic_write policy is kept; this is ADDITIVE.
-- ---------------------------------------------------------------------------

CREATE POLICY clinic_services_admin_all ON clinic_services
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
-- 8. clinic_photos — admin-all policy for provisioning
--
-- app_authenticated already has SELECT, INSERT, UPDATE, DELETE from
-- 20260714110000_clinic_portal_rls. The existing clinic_photos_self_all
-- policy is kept; this is ADDITIVE.
-- ---------------------------------------------------------------------------

CREATE POLICY clinic_photos_admin_all ON clinic_photos
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );
