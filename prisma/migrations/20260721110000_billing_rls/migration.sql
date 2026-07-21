-- Billing subsystem 1: RLS policies for billing_profiles and invoices.

GRANT SELECT, INSERT, UPDATE ON billing_profiles TO app_authenticated;
ALTER TABLE billing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY billing_profiles_clinic_all ON billing_profiles
  FOR ALL TO app_authenticated
  USING (clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid);

CREATE POLICY billing_profiles_admin_all ON billing_profiles
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

GRANT SELECT, INSERT, UPDATE ON invoices TO app_authenticated;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY invoices_clinic_select ON invoices
  FOR SELECT TO app_authenticated
  USING (clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid);

CREATE POLICY invoices_admin_all ON invoices
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );
