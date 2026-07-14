-- Clinic Portal slice: schema extension + RLS for clinic_services and clinic_categories.
--
-- 1. Adds is_top_service and display_order to clinic_services (needed for the
--    top/all services split exposed by the portal profile endpoints).
-- 2. Enables RLS on clinic_categories and clinic_services, mirroring the
--    clinic-scoped policy pattern from 20260714110000_clinic_portal_rls.

-- ---------------------------------------------------------------------------
-- 1. Schema extension for clinic_services
-- ---------------------------------------------------------------------------

ALTER TABLE clinic_services ADD COLUMN IF NOT EXISTS is_top_service BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE clinic_services ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. RLS for clinic_categories
-- ---------------------------------------------------------------------------

GRANT INSERT, UPDATE, DELETE ON clinic_categories TO app_authenticated;

ALTER TABLE clinic_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_categories FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinic_categories_clinic_write ON clinic_categories;
CREATE POLICY clinic_categories_clinic_write ON clinic_categories
  FOR ALL TO app_authenticated
  USING (clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- 3. RLS for clinic_services
-- ---------------------------------------------------------------------------

GRANT INSERT, UPDATE, DELETE ON clinic_services TO app_authenticated;

ALTER TABLE clinic_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_services FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinic_services_clinic_write ON clinic_services;
CREATE POLICY clinic_services_clinic_write ON clinic_services
  FOR ALL TO app_authenticated
  USING (clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.current_clinic_id', true), '')::uuid);
