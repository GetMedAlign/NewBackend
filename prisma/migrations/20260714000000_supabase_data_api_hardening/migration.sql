-- Supabase Data API hardening: lock the anon and authenticated roles out of
-- the public schema so PostgREST cannot expose any table, function, or
-- sequence. This app connects directly as the postgres role and never uses
-- the Supabase Data API, so these roles need no access to anything in public.
--
-- Both blocks are guarded so this migration is a no-op on plain Postgres
-- instances (e.g. local test DBs without Supabase roles).

-- Enable RLS on Prisma's migration bookkeeping table so it is not readable or
-- writable through Supabase's Data API. The postgres role owns the table and
-- bypasses RLS, so `prisma migrate` is unaffected. Guarded: the table only
-- exists once migrations have been recorded.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY';
  END IF;
END
$$;

-- Lock the Supabase REST roles out of the public schema entirely. This app
-- connects directly as the postgres role and never uses the Data API, so the
-- anon/authenticated roles need no access to anything in public. Guarded so the
-- migration is a no-op on Postgres instances without these Supabase roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE USAGE   ON SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES  FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  END IF;
END
$$;

-- Revoke EXECUTE on SECURITY DEFINER functions from the PUBLIC pseudo-role.
-- Supabase grants PUBLIC EXECUTE on functions by default; without this, any
-- role (including anon/authenticated) can call them via the PUBLIC grant even
-- after the role-specific revokes above. We target only SECURITY DEFINER
-- functions in public to avoid disturbing any non-sensitive helpers.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.fn);
  END LOOP;
END
$$;
