-- RLS policies, role helper, signup function, and DB-side audit triggers.
-- The app connects as the `postgres` superuser (which bypasses RLS for the
-- asSystem/signup paths). User-scoped work runs inside a transaction that does
-- `SET LOCAL ROLE app_authenticated`, an RLS-subject role that RLS enforces.

-- ---------------------------------------------------------------------------
-- RLS-subject role
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticated') THEN
    CREATE ROLE app_authenticated NOLOGIN;
  END IF;
END
$$;

-- The connection role (postgres, NOSUPERUSER + BYPASSRLS on Supabase) must be
-- a member of app_authenticated in order to `SET LOCAL ROLE app_authenticated`.
-- After the switch the active role has no BYPASSRLS, so RLS is enforced.
GRANT app_authenticated TO postgres;

GRANT USAGE ON SCHEMA public TO app_authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON users            TO app_authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles       TO app_authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON two_factor_codes TO app_authenticated;
GRANT SELECT                         ON audit_log        TO app_authenticated;

-- ---------------------------------------------------------------------------
-- Role helper — used inside RLS policies (SECURITY DEFINER to read user_roles
-- regardless of the caller's own row-level visibility)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

GRANT EXECUTE ON FUNCTION has_role(uuid, app_role) TO app_authenticated;

-- ---------------------------------------------------------------------------
-- Enable Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE two_factor_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log        ENABLE ROW LEVEL SECURITY;

-- users: a user may read/update their own row -------------------------------
CREATE POLICY users_self_select ON users
  FOR SELECT TO app_authenticated
  USING (id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY users_self_update ON users
  FOR UPDATE TO app_authenticated
  USING (id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (id = current_setting('app.current_user_id', true)::uuid);

-- users: admins / superadmins may read and manage every row -----------------
CREATE POLICY users_admin_select ON users
  FOR SELECT TO app_authenticated
  USING (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  );

CREATE POLICY users_admin_all ON users
  FOR ALL TO app_authenticated
  USING (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  );

-- user_roles: a user may read their own role rows ---------------------------
CREATE POLICY user_roles_self_select ON user_roles
  FOR SELECT TO app_authenticated
  USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- user_roles: admins / superadmins may manage every role row ----------------
CREATE POLICY user_roles_admin_all ON user_roles
  FOR ALL TO app_authenticated
  USING (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  )
  WITH CHECK (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  );

-- two_factor_codes: no policy for app_authenticated. RLS is enabled with no
-- permissive policy, so app_authenticated can touch no rows. The 2FA flow runs
-- via asSystem (postgres superuser, bypasses RLS).

-- audit_log: admins / superadmins may read; nobody writes via a policy.
-- Writes happen only through the append_audit_log SECURITY DEFINER function.
CREATE POLICY audit_log_admin_select ON audit_log
  FOR SELECT TO app_authenticated
  USING (
    has_role(current_setting('app.current_user_id', true)::uuid, 'admin')
    OR has_role(current_setting('app.current_user_id', true)::uuid, 'superadmin')
  );

-- ---------------------------------------------------------------------------
-- Signup function — inserts the user and its default patient role.
-- Runs as the function owner (postgres) so it is not gated by RLS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_user(_email citext, _password_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO users (email, password_hash, updated_at)
  VALUES (_email, _password_hash, CURRENT_TIMESTAMP)
  RETURNING id INTO new_id;

  INSERT INTO user_roles (user_id, role)
  VALUES (new_id, 'patient');

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_user(citext, text) TO app_authenticated;

-- ---------------------------------------------------------------------------
-- Audit-append function — the single writer to audit_log. Only trigger
-- functions call it; PUBLIC and app_authenticated are explicitly denied.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION append_audit_log(
  _actor_user_id  uuid,
  _actor_role     text,
  _ip             text,
  _action_type    text,
  _affected_record text,
  _previous       jsonb,
  _new            jsonb,
  _notes          text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO audit_log (
    actor_user_id, actor_role, ip_address, action_type,
    affected_record, previous_value, new_value, notes
  )
  VALUES (
    _actor_user_id, _actor_role, _ip, _action_type,
    _affected_record, _previous, _new, _notes
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION append_audit_log(uuid, text, text, text, text, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION append_audit_log(uuid, text, text, text, text, jsonb, jsonb, text) FROM app_authenticated;

-- ---------------------------------------------------------------------------
-- Audit triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_users()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id   uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
  actor_role text := coalesce(nullif(current_setting('app.current_user_role', true), ''), 'system');
  ip         text := nullif(current_setting('app.current_ip_address', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'user_created',
      'users:' || NEW.id,
      NULL, to_jsonb(NEW) - 'password_hash', NULL
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'user_updated',
      'users:' || NEW.id,
      to_jsonb(OLD) - 'password_hash', to_jsonb(NEW) - 'password_hash', NULL
    );
    RETURN NEW;
  ELSE
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'user_deleted',
      'users:' || OLD.id,
      to_jsonb(OLD) - 'password_hash', NULL, NULL
    );
    RETURN OLD;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION audit_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id   uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
  actor_role text := coalesce(nullif(current_setting('app.current_user_role', true), ''), 'system');
  ip         text := nullif(current_setting('app.current_ip_address', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'user_role_created',
      'user_roles:' || NEW.id,
      NULL, to_jsonb(NEW), NULL
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'user_role_updated',
      'user_roles:' || NEW.id,
      to_jsonb(OLD), to_jsonb(NEW), NULL
    );
    RETURN NEW;
  ELSE
    PERFORM append_audit_log(
      actor_id, actor_role, ip, 'user_role_deleted',
      'user_roles:' || OLD.id,
      to_jsonb(OLD), NULL, NULL
    );
    RETURN OLD;
  END IF;
END;
$$;

CREATE TRIGGER users_audit
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_users();

CREATE TRIGGER user_roles_audit
  AFTER INSERT OR UPDATE OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION audit_user_roles();
