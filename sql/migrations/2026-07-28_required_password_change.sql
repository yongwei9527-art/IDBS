BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS temporary_password_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN users.password_reset_required IS
  'True after an administrator password reset; the account must set a new password before using protected business features.';
COMMENT ON COLUMN users.temporary_password_expires_at IS
  'Expiration time for the one-time temporary password issued by an administrator.';

COMMIT;
