GRANT SELECT, INSERT, UPDATE, DELETE ON
  location, location_alias, location_near,
  marketing_service, marketing_service_code, marketing_service_related,
  localization_setting, location_notify
  TO app_authenticated;

-- Enable + force RLS on every new table.
ALTER TABLE location                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE location                  FORCE  ROW LEVEL SECURITY;
ALTER TABLE location_alias            ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_alias            FORCE  ROW LEVEL SECURITY;
ALTER TABLE location_near             ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_near             FORCE  ROW LEVEL SECURITY;
ALTER TABLE marketing_service         ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_service         FORCE  ROW LEVEL SECURITY;
ALTER TABLE marketing_service_code    ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_service_code    FORCE  ROW LEVEL SECURITY;
ALTER TABLE marketing_service_related ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_service_related FORCE  ROW LEVEL SECURITY;
ALTER TABLE localization_setting      ENABLE ROW LEVEL SECURITY;
ALTER TABLE localization_setting      FORCE  ROW LEVEL SECURITY;
ALTER TABLE location_notify           ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_notify           FORCE  ROW LEVEL SECURITY;

-- Admin / superadmin full access (sub-project 2 writes rely on this).
-- Repeat this block for each of the 8 tables, substituting the table name
-- and policy name <table>_admin_all.
CREATE POLICY location_admin_all ON location
  FOR ALL TO app_authenticated
  USING (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin')
    OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin')
  );

CREATE POLICY location_alias_admin_all ON location_alias
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));

CREATE POLICY location_near_admin_all ON location_near
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));

CREATE POLICY marketing_service_admin_all ON marketing_service
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));

CREATE POLICY marketing_service_code_admin_all ON marketing_service_code
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));

CREATE POLICY marketing_service_related_admin_all ON marketing_service_related
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));

CREATE POLICY localization_setting_admin_all ON localization_setting
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));

CREATE POLICY location_notify_admin_all ON location_notify
  FOR ALL TO app_authenticated
  USING (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'))
  WITH CHECK (has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'admin') OR has_role(nullif(current_setting('app.current_user_id', true), '')::uuid, 'superadmin'));
