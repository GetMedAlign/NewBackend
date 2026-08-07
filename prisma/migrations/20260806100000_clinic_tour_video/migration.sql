-- Clinic tour video: nullable URL column for the one-video-per-clinic tour
-- upload flow (separate `clinic-videos` bucket). No backfill; existing
-- clinics simply have no tour video until they upload one.

ALTER TABLE clinics ADD COLUMN tour_video_url text;
