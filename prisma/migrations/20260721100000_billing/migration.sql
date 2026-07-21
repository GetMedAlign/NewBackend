-- Billing subsystem 1: billing_profiles, invoices, and three clinics columns.

ALTER TABLE clinics ADD COLUMN "stripe_customer_id" TEXT;
ALTER TABLE clinics ADD COLUMN "subscription_active_through" TIMESTAMPTZ;
ALTER TABLE clinics ADD COLUMN "subscription_cancelled_at" TIMESTAMPTZ;

CREATE TABLE billing_profiles (
    "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id"            UUID        NOT NULL,
    "billing_email"        TEXT,
    "billing_contact_name" TEXT,
    "address_line1"        TEXT,
    "address_line2"        TEXT,
    "city"                 TEXT,
    "state_code"           TEXT,
    "zip_code"             TEXT,
    "tax_id"               TEXT,
    "stripe_customer_id"   TEXT,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "billing_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "billing_profiles_clinic_id_key" UNIQUE ("clinic_id"),
    CONSTRAINT "billing_profiles_clinic_id_fkey"
        FOREIGN KEY ("clinic_id") REFERENCES clinics("id") ON DELETE CASCADE
);

CREATE TABLE invoices (
    "id"                UUID          NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id"         UUID          NOT NULL,
    "stripe_invoice_id" TEXT,
    "period_start"      TIMESTAMPTZ   NOT NULL,
    "period_end"        TIMESTAMPTZ   NOT NULL,
    "lead_count"        INTEGER       NOT NULL,
    "price_per_lead"    NUMERIC(10,2) NOT NULL,
    "platform_fee"      NUMERIC(10,2) NOT NULL,
    "total_amount"      NUMERIC(10,2) NOT NULL,
    "status"            TEXT          NOT NULL DEFAULT 'draft',
    "due_date"          TIMESTAMPTZ,
    "paid_at"           TIMESTAMPTZ,
    "invoice_url"       TEXT,
    "pdf_url"           TEXT,
    "created_at"        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoices_clinic_id_fkey"
        FOREIGN KEY ("clinic_id") REFERENCES clinics("id") ON DELETE CASCADE
);

CREATE INDEX "invoices_clinic_period_idx" ON invoices ("clinic_id", "period_start" DESC);
