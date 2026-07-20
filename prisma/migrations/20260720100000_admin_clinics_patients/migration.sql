-- Admin Clinics & Patients slice: admin_notes table and two clinic columns.

ALTER TABLE clinics ADD COLUMN "zip_code" TEXT;
ALTER TABLE clinics ADD COLUMN "is_listed_in_directory" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE admin_notes (
    "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id"      UUID        NOT NULL,
    "author_user_id" UUID        NOT NULL,
    "author_name"    TEXT        NOT NULL,
    "body"           TEXT        NOT NULL,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "admin_notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_notes_clinic_id_fkey"
        FOREIGN KEY ("clinic_id") REFERENCES clinics("id") ON DELETE CASCADE,
    CONSTRAINT "admin_notes_author_user_id_fkey"
        FOREIGN KEY ("author_user_id") REFERENCES users("id") ON DELETE RESTRICT
);

CREATE INDEX "admin_notes_clinic_created_idx"
    ON admin_notes ("clinic_id", "created_at" DESC);
