-- Invalidate access and refresh credentials whenever account authority changes.
-- The Node migrator executes this file in a transaction.
SET search_path = public, pg_temp;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS authz_version BIGINT;

UPDATE users
SET authz_version = 1
WHERE authz_version IS NULL OR authz_version < 1;

ALTER TABLE users
  ALTER COLUMN authz_version SET DEFAULT 1,
  ALTER COLUMN authz_version SET NOT NULL;

DO $authz_version_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_authz_version_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_authz_version_check CHECK (authz_version >= 1);
  END IF;
END
$authz_version_check$;

CREATE OR REPLACE FUNCTION bump_user_authz_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.password_hash IS DISTINCT FROM NEW.password_hash
     OR OLD.password_salt IS DISTINCT FROM NEW.password_salt
     OR OLD.password_reset_required IS DISTINCT FROM NEW.password_reset_required
     OR OLD.temporary_password_expires_at IS DISTINCT FROM NEW.temporary_password_expires_at
     OR OLD.role IS DISTINCT FROM NEW.role
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.is_banned IS DISTINCT FROM NEW.is_banned
     OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
    NEW.authz_version := GREATEST(COALESCE(NEW.authz_version, 1), OLD.authz_version + 1);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION revoke_user_refresh_sessions_after_authz_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.authz_version IS DISTINCT FROM NEW.authz_version THEN
    UPDATE refresh_token_sessions
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE subject = NEW.id::text AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION bump_user_authz_for_admin_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_user_id UUID;
BEGIN
  affected_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  IF TG_OP = 'UPDATE'
     AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id
     AND OLD.role_key IS NOT DISTINCT FROM NEW.role_key
     AND OLD.permissions IS NOT DISTINCT FROM NEW.permissions THEN
    RETURN NULL;
  END IF;

  UPDATE users
  SET authz_version = authz_version + 1,
      updated_at = now()
  WHERE id = affected_user_id;

  UPDATE refresh_token_sessions
  SET revoked_at = COALESCE(revoked_at, now())
  WHERE subject = affected_user_id::text AND revoked_at IS NULL;

  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    UPDATE users
    SET authz_version = authz_version + 1,
        updated_at = now()
    WHERE id = OLD.user_id;

    UPDATE refresh_token_sessions
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE subject = OLD.user_id::text AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS users_authz_version_bump_trigger ON users;
CREATE TRIGGER users_authz_version_bump_trigger
BEFORE UPDATE OF password_hash, password_salt, password_reset_required,
  temporary_password_expires_at, role, status, is_banned, deleted_at
ON users
FOR EACH ROW EXECUTE FUNCTION bump_user_authz_version();

DROP TRIGGER IF EXISTS users_authz_refresh_revoke_trigger ON users;
CREATE TRIGGER users_authz_refresh_revoke_trigger
AFTER UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION revoke_user_refresh_sessions_after_authz_change();

DROP TRIGGER IF EXISTS admin_roles_authz_version_trigger ON admin_roles;
CREATE TRIGGER admin_roles_authz_version_trigger
AFTER INSERT OR UPDATE OR DELETE ON admin_roles
FOR EACH ROW EXECUTE FUNCTION bump_user_authz_for_admin_role_change();
