BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS major TEXT,
  ADD COLUMN IF NOT EXISTS mentor_name TEXT;

COMMENT ON COLUMN users.major IS 'Major supplied during account registration.';
COMMENT ON COLUMN users.mentor_name IS 'Mentor name supplied during account registration.';

COMMIT;
