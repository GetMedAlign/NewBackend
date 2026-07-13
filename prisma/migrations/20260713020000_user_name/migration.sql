-- Add display name to users table. Nullable; updated via profile endpoints.
ALTER TABLE "users" ADD COLUMN "name" TEXT;
