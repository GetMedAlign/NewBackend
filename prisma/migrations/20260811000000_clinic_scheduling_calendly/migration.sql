-- Scheduling Slice 1 (Calendly connect), Task 1: clinic scheduling provider
-- + Calendly connection fields. All Calendly columns are nullable and
-- populated by later tasks' OAuth connect flow; the token/signing-key
-- columns hold AES-GCM ciphertext, never plaintext.

CREATE TYPE scheduling_provider AS ENUM ('none', 'calendly');

ALTER TABLE clinics
  ADD COLUMN scheduling_provider scheduling_provider NOT NULL DEFAULT 'none',
  ADD COLUMN calendly_user_uri text,
  ADD COLUMN calendly_org_uri text,
  ADD COLUMN calendly_scheduling_url text,
  ADD COLUMN calendly_access_token_encrypted text,
  ADD COLUMN calendly_refresh_token_encrypted text,
  ADD COLUMN calendly_token_expires_at timestamptz,
  ADD COLUMN calendly_webhook_uri text,
  ADD COLUMN calendly_webhook_signing_key_encrypted text;
