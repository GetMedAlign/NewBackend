-- Clinic Portal slice: schema migration
-- Adds clinic_id to users, new columns to clinics, and clinic_photos table.
-- RLS/policies/grants are added in the next migration (Task 2).

-- ---------------------------------------------------------------------------
-- users: add clinic_id FK → clinics(id) ON DELETE SET NULL
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN "clinic_id" UUID;

ALTER TABLE "users"
    ADD CONSTRAINT "users_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- clinics: add new columns
-- ---------------------------------------------------------------------------
ALTER TABLE "clinics" ADD COLUMN "differentiators" TEXT;
ALTER TABLE "clinics" ADD COLUMN "offers_lab_work" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clinics" ADD COLUMN "insurance_notes" TEXT;
ALTER TABLE "clinics" ADD COLUMN "credentials" TEXT;
ALTER TABLE "clinics" ADD COLUMN "npi_number" TEXT;
ALTER TABLE "clinics" ADD COLUMN "state_license_number" TEXT;
ALTER TABLE "clinics" ADD COLUMN "logo_url" TEXT;
ALTER TABLE "clinics" ADD COLUMN "photo_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "clinics" ADD COLUMN "weekly_summary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clinics" ADD COLUMN "location" TEXT;
ALTER TABLE "clinics" ADD COLUMN "webhook_health" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "clinics" ADD COLUMN "suspension_reason" TEXT;
ALTER TABLE "clinics" ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------------
-- clinic_photos
-- ---------------------------------------------------------------------------
CREATE TABLE "clinic_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,

    CONSTRAINT "clinic_photos_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "clinic_photos"
    ADD CONSTRAINT "clinic_photos_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
