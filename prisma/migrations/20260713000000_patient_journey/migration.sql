-- Patient Journey slice: schema migration
-- Adds assessment_category enum + 12 new tables.
-- RLS/policies/triggers are added in the next migration (Task 3).

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
CREATE TYPE "assessment_category" AS ENUM ('hormone', 'peptide', 'med_spa', 'wellness');

-- ---------------------------------------------------------------------------
-- patients (1:1 with users)
-- ---------------------------------------------------------------------------
CREATE TABLE "patients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "zip_code" TEXT,
    "date_of_birth" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_assessment_at" TIMESTAMPTZ,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "patients_user_id_key" ON "patients"("user_id");

ALTER TABLE "patients"
    ADD CONSTRAINT "patients_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- patient_assessments
-- ---------------------------------------------------------------------------
CREATE TABLE "patient_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" TEXT NOT NULL,
    "patient_id" UUID,
    "treatment_category" "assessment_category" NOT NULL,
    -- Encrypted PHI (stored as ciphertext text)
    "symptom_duration" TEXT,
    "exercise_frequency" TEXT,
    "diet" TEXT,
    "sleep_hours" TEXT,
    "stress_level" TEXT,
    "alcohol_use" TEXT,
    "appointment_preference" TEXT,
    "biological_sex" TEXT,
    "allergy_details" TEXT,
    "other_medications" TEXT,
    -- Plain fields
    "has_prior_treatment" BOOLEAN,
    "willing_lab_work" BOOLEAN,
    "willing_structured_program" BOOLEAN,
    "start_timeline" TEXT,
    "budget_band" TEXT NOT NULL,
    "telehealth_preference" TEXT NOT NULL,
    "pregnant_or_planning" BOOLEAN,
    "taking_prescriptions" BOOLEAN,
    "had_prior_therapy" BOOLEAN,
    "medication_allergies" BOOLEAN,
    "zip_code" TEXT NOT NULL,
    "consent_given" BOOLEAN NOT NULL,
    "consent_version" TEXT NOT NULL,
    "consent_given_at" TIMESTAMPTZ NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "patient_assessments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "patient_assessments_session_id_key" ON "patient_assessments"("session_id");

ALTER TABLE "patient_assessments"
    ADD CONSTRAINT "patient_assessments_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- assessment_goals
-- ---------------------------------------------------------------------------
CREATE TABLE "assessment_goals" (
    "assessment_id" UUID NOT NULL,
    "goal_code" TEXT NOT NULL,

    CONSTRAINT "assessment_goals_pkey" PRIMARY KEY ("assessment_id", "goal_code")
);

ALTER TABLE "assessment_goals"
    ADD CONSTRAINT "assessment_goals_assessment_id_fkey"
    FOREIGN KEY ("assessment_id") REFERENCES "patient_assessments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- assessment_symptoms
-- ---------------------------------------------------------------------------
CREATE TABLE "assessment_symptoms" (
    "assessment_id" UUID NOT NULL,
    "symptom_code" TEXT NOT NULL,
    "severity" INTEGER NOT NULL,

    CONSTRAINT "assessment_symptoms_pkey" PRIMARY KEY ("assessment_id", "symptom_code")
);

ALTER TABLE "assessment_symptoms"
    ADD CONSTRAINT "assessment_symptoms_assessment_id_fkey"
    FOREIGN KEY ("assessment_id") REFERENCES "patient_assessments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- assessment_chronic_conditions
-- ---------------------------------------------------------------------------
CREATE TABLE "assessment_chronic_conditions" (
    "assessment_id" UUID NOT NULL,
    "condition_code" TEXT NOT NULL,

    CONSTRAINT "assessment_chronic_conditions_pkey" PRIMARY KEY ("assessment_id", "condition_code")
);

ALTER TABLE "assessment_chronic_conditions"
    ADD CONSTRAINT "assessment_chronic_conditions_assessment_id_fkey"
    FOREIGN KEY ("assessment_id") REFERENCES "patient_assessments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- assessment_prescriptions
-- ---------------------------------------------------------------------------
CREATE TABLE "assessment_prescriptions" (
    "assessment_id" UUID NOT NULL,
    "prescription_code" TEXT NOT NULL,

    CONSTRAINT "assessment_prescriptions_pkey" PRIMARY KEY ("assessment_id", "prescription_code")
);

ALTER TABLE "assessment_prescriptions"
    ADD CONSTRAINT "assessment_prescriptions_assessment_id_fkey"
    FOREIGN KEY ("assessment_id") REFERENCES "patient_assessments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- clinics (read-model)
-- ---------------------------------------------------------------------------
CREATE TABLE "clinics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "about" TEXT,
    "provider_name" TEXT,
    "website_url" TEXT,
    "rating" NUMERIC(2,1) NOT NULL,
    "review_count" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "city" TEXT,
    "state_code" TEXT,
    "telehealth_available" BOOLEAN NOT NULL,
    "new_patient_wait" TEXT,
    "consultation_fee_band" TEXT,
    "monthly_program_band" TEXT,
    "financing_available" BOOLEAN NOT NULL,
    "accepts_insurance" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "billing_status" TEXT NOT NULL,
    "business_email" TEXT,
    "webhook_url" TEXT,
    "webhook_secret" TEXT,
    "notify_on_lead" BOOLEAN NOT NULL,

    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinics_slug_key" ON "clinics"("slug");

-- ---------------------------------------------------------------------------
-- clinic_categories
-- ---------------------------------------------------------------------------
CREATE TABLE "clinic_categories" (
    "clinic_id" UUID NOT NULL,
    "category" "assessment_category" NOT NULL,

    CONSTRAINT "clinic_categories_pkey" PRIMARY KEY ("clinic_id", "category")
);

ALTER TABLE "clinic_categories"
    ADD CONSTRAINT "clinic_categories_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- clinic_services
-- ---------------------------------------------------------------------------
CREATE TABLE "clinic_services" (
    "clinic_id" UUID NOT NULL,
    "service_code" TEXT NOT NULL,

    CONSTRAINT "clinic_services_pkey" PRIMARY KEY ("clinic_id", "service_code")
);

ALTER TABLE "clinic_services"
    ADD CONSTRAINT "clinic_services_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
CREATE TABLE "leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lead_id" TEXT NOT NULL,
    "clinic_id" UUID NOT NULL,
    "assessment_id" UUID,
    "patient_id" UUID,
    "patient_first_name" TEXT NOT NULL,
    "patient_email" TEXT NOT NULL,
    "patient_zip" TEXT,
    "treatment_category" TEXT NOT NULL,
    "top_goals" TEXT,
    "top_symptoms" TEXT,
    "budget_band" TEXT,
    "telehealth_preference" TEXT,
    "appointment_preference" TEXT,
    "start_timeline" TEXT,
    "patient_phone" TEXT,
    "inquiry_message" TEXT,
    "lead_source" TEXT NOT NULL,
    "delivery_status" TEXT NOT NULL,
    "clinic_status" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL,
    "delivered_at" TIMESTAMPTZ,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leads_lead_id_key" ON "leads"("lead_id");

ALTER TABLE "leads"
    ADD CONSTRAINT "leads_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leads"
    ADD CONSTRAINT "leads_assessment_id_fkey"
    FOREIGN KEY ("assessment_id") REFERENCES "patient_assessments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leads"
    ADD CONSTRAINT "leads_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- webhook_deliveries
-- ---------------------------------------------------------------------------
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lead_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "response_code" INTEGER,
    "error" TEXT,
    "attempted_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "webhook_deliveries"
    ADD CONSTRAINT "webhook_deliveries_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- zip_codes (pk is the zip string)
-- ---------------------------------------------------------------------------
CREATE TABLE "zip_codes" (
    "zip" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "city" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,

    CONSTRAINT "zip_codes_pkey" PRIMARY KEY ("zip")
);
