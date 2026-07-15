-- Clinic Applications slice: schema migration
-- Adds clinic_applications, application_categories, application_services,
-- and password_reset_tokens tables.
-- RLS/policies/grants are added in the next migration (Task 2).

-- ---------------------------------------------------------------------------
-- clinic_applications
-- ---------------------------------------------------------------------------
CREATE TABLE "clinic_applications" (
    "id"                    UUID      NOT NULL DEFAULT gen_random_uuid(),
    "clinic_name"           TEXT      NOT NULL,
    "contact_email"         TEXT      NOT NULL,
    "business_email"        TEXT,
    "city"                  TEXT,
    "state_code"            TEXT,
    "zip_code"              TEXT,
    "website_url"           TEXT,
    "telehealth_available"  BOOLEAN   NOT NULL DEFAULT false,
    "offers_lab_work"       BOOLEAN   NOT NULL DEFAULT false,
    "new_patient_wait"      TEXT,
    "npi_number"            TEXT,
    "state_license_number"  TEXT,
    "consultation_fee_band" TEXT,
    "monthly_program_band"  TEXT,
    "financing_available"   BOOLEAN   NOT NULL DEFAULT false,
    "insurance_accepted"    BOOLEAN   NOT NULL DEFAULT false,
    "insurance_notes"       TEXT,
    "about"                 TEXT,
    "differentiators"       TEXT,
    "provider_name"         TEXT,
    "credentials"           TEXT,
    "logo_url"              TEXT,
    "photo_urls"            JSONB,
    "status"                TEXT      NOT NULL DEFAULT 'pending',
    "deny_reason"           TEXT,
    "reviewed_at"           TIMESTAMPTZ,
    "reviewed_by_user_id"   UUID,
    "created_clinic_id"     UUID,
    "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "clinic_applications_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "clinic_applications"
    ADD CONSTRAINT "clinic_applications_created_clinic_id_fkey"
    FOREIGN KEY ("created_clinic_id") REFERENCES "clinics"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- application_categories
-- ---------------------------------------------------------------------------
CREATE TABLE "application_categories" (
    "application_id" UUID                NOT NULL,
    "category"       assessment_category NOT NULL,

    CONSTRAINT "application_categories_pkey" PRIMARY KEY ("application_id", "category")
);

ALTER TABLE "application_categories"
    ADD CONSTRAINT "application_categories_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "clinic_applications"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- application_services
-- ---------------------------------------------------------------------------
CREATE TABLE "application_services" (
    "id"             UUID    NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID    NOT NULL,
    "service_code"   TEXT    NOT NULL,
    "is_top_service" BOOLEAN NOT NULL DEFAULT false,
    "display_order"  INTEGER NOT NULL,

    CONSTRAINT "application_services_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "application_services"
    ADD CONSTRAINT "application_services_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "clinic_applications"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- password_reset_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE "password_reset_tokens" (
    "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"     UUID        NOT NULL,
    "token_hash"  TEXT        NOT NULL,
    "expires_at"  TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
