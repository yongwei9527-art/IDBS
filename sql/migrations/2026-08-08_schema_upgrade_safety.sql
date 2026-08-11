-- Canonical schema repair for password recovery, legacy import, roles and soft-delete-safe views.
-- This migration intentionally uses ordinary transactional DDL; the Node migrator wraps it in one transaction.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_phone TEXT NOT NULL,
  submitted_name TEXT NOT NULL,
  submitted_student_no TEXT NOT NULL,
  submitted_major TEXT,
  submitted_mentor_name TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  request_count INTEGER NOT NULL DEFAULT 1,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS submitted_phone TEXT;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS submitted_name TEXT;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS submitted_student_no TEXT;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS submitted_major TEXT;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS submitted_mentor_name TEXT;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS request_count INTEGER;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS reviewed_by UUID;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE password_reset_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

DO $password_reset_column_types$
DECLARE
  expected RECORD;
  actual_type TEXT;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('id', 'uuid'),
      ('user_id', 'uuid'),
      ('submitted_phone', 'text'),
      ('submitted_name', 'text'),
      ('submitted_student_no', 'text'),
      ('submitted_major', 'text'),
      ('submitted_mentor_name', 'text'),
      ('reason', 'text'),
      ('status', 'text'),
      ('request_count', 'integer'),
      ('reviewed_by', 'uuid'),
      ('reviewed_at', 'timestamp with time zone'),
      ('review_note', 'text'),
      ('expires_at', 'timestamp with time zone'),
      ('created_at', 'timestamp with time zone'),
      ('updated_at', 'timestamp with time zone')
    ) AS required(column_name, data_type)
  LOOP
    SELECT format_type(a.atttypid, a.atttypmod)
      INTO actual_type
    FROM pg_attribute a
    WHERE a.attrelid = 'public.password_reset_requests'::regclass
      AND a.attname = expected.column_name
      AND a.attnum > 0
      AND NOT a.attisdropped;
    IF actual_type IS DISTINCT FROM expected.data_type THEN
      RAISE EXCEPTION 'password_reset_requests.% has type %, expected %',
        expected.column_name, COALESCE(actual_type, '<missing>'), expected.data_type;
    END IF;
  END LOOP;
END
$password_reset_column_types$;

DO $password_reset_drop_checks$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT DISTINCT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'public.password_reset_requests'::regclass
      AND c.contype = 'c'
      AND a.attname IN ('status', 'request_count')
  LOOP
    EXECUTE format('ALTER TABLE public.password_reset_requests DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END
$password_reset_drop_checks$;

UPDATE password_reset_requests
SET id = COALESCE(id, gen_random_uuid()),
    submitted_phone = COALESCE(submitted_phone, ''),
    submitted_name = COALESCE(submitted_name, ''),
    submitted_student_no = COALESCE(submitted_student_no, ''),
    submitted_mentor_name = COALESCE(submitted_mentor_name, ''),
    status = COALESCE(status, 'pending'),
    request_count = GREATEST(COALESCE(request_count, 1), 1),
    created_at = COALESCE(created_at, now()),
    updated_at = COALESCE(updated_at, created_at, now()),
    expires_at = COALESCE(expires_at, created_at + INTERVAL '7 days', now() + INTERVAL '7 days');

DO $password_reset_status_values$
BEGIN
  IF EXISTS (
    SELECT 1 FROM password_reset_requests
    WHERE status NOT IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')
  ) THEN
    RAISE EXCEPTION 'password_reset_requests contains an unsupported status value';
  END IF;
END
$password_reset_status_values$;

ALTER TABLE password_reset_requests ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE password_reset_requests ALTER COLUMN id SET NOT NULL;
ALTER TABLE password_reset_requests ALTER COLUMN submitted_phone SET NOT NULL;
ALTER TABLE password_reset_requests ALTER COLUMN submitted_name SET NOT NULL;
ALTER TABLE password_reset_requests ALTER COLUMN submitted_student_no SET NOT NULL;
ALTER TABLE password_reset_requests ALTER COLUMN submitted_mentor_name SET NOT NULL;
ALTER TABLE password_reset_requests ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE password_reset_requests ALTER COLUMN status SET NOT NULL;
ALTER TABLE password_reset_requests ALTER COLUMN request_count SET DEFAULT 1;
ALTER TABLE password_reset_requests ALTER COLUMN request_count SET NOT NULL;
ALTER TABLE password_reset_requests ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '7 days');
ALTER TABLE password_reset_requests ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE password_reset_requests ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE password_reset_requests ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE password_reset_requests ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE password_reset_requests ALTER COLUMN updated_at SET NOT NULL;

DO $password_reset_primary_key$
DECLARE
  primary_key_columns TEXT[];
BEGIN
  SELECT array_agg(a.attname ORDER BY key.ordinality)
    INTO primary_key_columns
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality)
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum
  WHERE c.conrelid = 'public.password_reset_requests'::regclass
    AND c.contype = 'p';
  IF primary_key_columns IS NULL THEN
    ALTER TABLE password_reset_requests ADD CONSTRAINT password_reset_requests_pkey PRIMARY KEY (id);
  ELSIF primary_key_columns IS DISTINCT FROM ARRAY['id']::TEXT[] THEN
    RAISE EXCEPTION 'password_reset_requests must use id as its primary key';
  END IF;
END
$password_reset_primary_key$;

ALTER TABLE password_reset_requests
  ADD CONSTRAINT password_reset_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired'));
ALTER TABLE password_reset_requests
  ADD CONSTRAINT password_reset_requests_request_count_check
  CHECK (request_count >= 1);

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS row_number
  FROM password_reset_requests
  WHERE status = 'pending' AND user_id IS NOT NULL
)
UPDATE password_reset_requests request
SET status = 'cancelled',
    reviewed_at = COALESCE(request.reviewed_at, now()),
    review_note = COALESCE(request.review_note, 'Cancelled during duplicate pending-request repair'),
    updated_at = now()
FROM ranked
WHERE request.id = ranked.id AND ranked.row_number > 1;

DROP INDEX IF EXISTS public.idx_password_reset_requests_pending_user;
CREATE UNIQUE INDEX idx_password_reset_requests_pending_user
  ON password_reset_requests(user_id)
  WHERE status = 'pending' AND user_id IS NOT NULL;
DROP INDEX IF EXISTS public.idx_password_reset_requests_status_time;
CREATE INDEX idx_password_reset_requests_status_time
  ON password_reset_requests(status, updated_at DESC);
DROP INDEX IF EXISTS public.idx_password_reset_requests_pending_expiry;
CREATE INDEX idx_password_reset_requests_pending_expiry
  ON password_reset_requests(expires_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS legacy_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE legacy_import_runs ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE legacy_import_runs ADD COLUMN IF NOT EXISTS source_name TEXT;
ALTER TABLE legacy_import_runs ADD COLUMN IF NOT EXISTS source_sha256 TEXT;
ALTER TABLE legacy_import_runs ADD COLUMN IF NOT EXISTS source_format TEXT;
ALTER TABLE legacy_import_runs ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE legacy_import_runs ADD COLUMN IF NOT EXISTS options JSONB;
ALTER TABLE legacy_import_runs ADD COLUMN IF NOT EXISTS summary JSONB;
ALTER TABLE legacy_import_runs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE legacy_import_runs ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE legacy_import_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE legacy_import_runs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

DO $legacy_import_column_types$
DECLARE
  expected RECORD;
  actual_type TEXT;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('id', 'uuid'),
      ('source_name', 'text'),
      ('source_sha256', 'text'),
      ('source_format', 'text'),
      ('status', 'text'),
      ('options', 'jsonb'),
      ('summary', 'jsonb'),
      ('error_message', 'text'),
      ('created_by', 'uuid'),
      ('created_at', 'timestamp with time zone'),
      ('finished_at', 'timestamp with time zone')
    ) AS required(column_name, data_type)
  LOOP
    SELECT format_type(a.atttypid, a.atttypmod)
      INTO actual_type
    FROM pg_attribute a
    WHERE a.attrelid = 'public.legacy_import_runs'::regclass
      AND a.attname = expected.column_name
      AND a.attnum > 0
      AND NOT a.attisdropped;
    IF actual_type IS DISTINCT FROM expected.data_type THEN
      RAISE EXCEPTION 'legacy_import_runs.% has type %, expected %',
        expected.column_name, COALESCE(actual_type, '<missing>'), expected.data_type;
    END IF;
  END LOOP;
END
$legacy_import_column_types$;

DO $legacy_import_drop_checks$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT DISTINCT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'public.legacy_import_runs'::regclass
      AND c.contype = 'c'
      AND a.attname = 'status'
  LOOP
    EXECUTE format('ALTER TABLE public.legacy_import_runs DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END
$legacy_import_drop_checks$;

UPDATE legacy_import_runs
SET id = COALESCE(id, gen_random_uuid());

UPDATE legacy_import_runs
SET source_name = COALESCE(source_name, 'recovered-' || id::text),
    source_sha256 = COALESCE(source_sha256, encode(digest(id::text, 'sha256'), 'hex')),
    source_format = COALESCE(source_format, 'unknown'),
    status = COALESCE(status, 'running'),
    options = COALESCE(options, '{}'::jsonb),
    summary = COALESCE(summary, '{}'::jsonb),
    created_at = COALESCE(created_at, now());

DO $legacy_import_status_values$
BEGIN
  IF EXISTS (
    SELECT 1 FROM legacy_import_runs
    WHERE status NOT IN ('running', 'completed', 'failed')
  ) THEN
    RAISE EXCEPTION 'legacy_import_runs contains an unsupported status value';
  END IF;
END
$legacy_import_status_values$;

ALTER TABLE legacy_import_runs ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE legacy_import_runs ALTER COLUMN id SET NOT NULL;
ALTER TABLE legacy_import_runs ALTER COLUMN source_name SET NOT NULL;
ALTER TABLE legacy_import_runs ALTER COLUMN source_sha256 SET NOT NULL;
ALTER TABLE legacy_import_runs ALTER COLUMN source_format SET NOT NULL;
ALTER TABLE legacy_import_runs ALTER COLUMN status SET DEFAULT 'running';
ALTER TABLE legacy_import_runs ALTER COLUMN status SET NOT NULL;
ALTER TABLE legacy_import_runs ALTER COLUMN options SET DEFAULT '{}'::jsonb;
ALTER TABLE legacy_import_runs ALTER COLUMN options SET NOT NULL;
ALTER TABLE legacy_import_runs ALTER COLUMN summary SET DEFAULT '{}'::jsonb;
ALTER TABLE legacy_import_runs ALTER COLUMN summary SET NOT NULL;
ALTER TABLE legacy_import_runs ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE legacy_import_runs ALTER COLUMN created_at SET NOT NULL;

DO $legacy_import_primary_key$
DECLARE
  primary_key_columns TEXT[];
BEGIN
  SELECT array_agg(a.attname ORDER BY key.ordinality)
    INTO primary_key_columns
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality)
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum
  WHERE c.conrelid = 'public.legacy_import_runs'::regclass
    AND c.contype = 'p';
  IF primary_key_columns IS NULL THEN
    ALTER TABLE legacy_import_runs ADD CONSTRAINT legacy_import_runs_pkey PRIMARY KEY (id);
  ELSIF primary_key_columns IS DISTINCT FROM ARRAY['id']::TEXT[] THEN
    RAISE EXCEPTION 'legacy_import_runs must use id as its primary key';
  END IF;
END
$legacy_import_primary_key$;

ALTER TABLE legacy_import_runs
  ADD CONSTRAINT legacy_import_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed'));

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY source_sha256
           ORDER BY CASE status WHEN 'completed' THEN 0 ELSE 1 END,
                    created_at DESC,
                    id DESC
         ) AS row_number
  FROM legacy_import_runs
  WHERE status IN ('running', 'completed')
)
UPDATE legacy_import_runs run
SET status = 'failed',
    error_message = COALESCE(run.error_message, 'Duplicate active import repaired during schema upgrade'),
    finished_at = COALESCE(run.finished_at, now())
FROM ranked
WHERE run.id = ranked.id AND ranked.row_number > 1;

DROP INDEX IF EXISTS public.idx_legacy_import_runs_active_hash;
CREATE UNIQUE INDEX idx_legacy_import_runs_active_hash
  ON legacy_import_runs(source_sha256)
  WHERE status IN ('running', 'completed');
DROP INDEX IF EXISTS public.idx_legacy_import_runs_created;
CREATE INDEX idx_legacy_import_runs_created
  ON legacy_import_runs(created_at DESC);

-- Replace every status CHECK that references the password-reset status column, including non-standard names.
-- The canonical constraints above are the only status checks left on these two tables.

UPDATE admin_roles
SET role_key = 'duty_admin', updated_at = now()
WHERE role_key = 'ops';

INSERT INTO permissions (permission_key, name, description, group_name, sort_order)
VALUES
  ('user.approve', 'Approve user registration', 'Review new user registration requests', 'Users', 10),
  ('user.manage', 'Manage users', 'Search, disable, restore and unbind users', 'Users', 20),
  ('reservation.view', 'View reservations', 'View reservation and calendar data', 'Reservations', 30),
  ('reservation.approve', 'Approve reservations', 'Approve reservation batches and items', 'Reservations', 40),
  ('reservation.change_plan', 'Change reservation plan', 'Modify reservation time and slot', 'Reservations', 45),
  ('return.view', 'View return records', 'View return status and archive data', 'Returns', 46),
  ('return.confirm', 'Confirm returns', 'Confirm or record device returns', 'Returns', 47),
  ('return.image_review', 'Review return images', 'Review return image evidence', 'Returns', 48),
  ('return.export', 'Export return archives', 'Export return records and archives', 'Returns', 49),
  ('device.view', 'View devices', 'View device inventory and status', 'Devices', 50),
  ('device.manage', 'Manage devices', 'Create, edit and maintain devices', 'Devices', 60),
  ('fault.manage', 'Manage fault reports', 'Process device fault reports', 'Faults', 70),
  ('stats.view', 'View analytics', 'View analytics and reports', 'Analytics', 80),
  ('stats.export', 'Export analytics', 'Export analytics data', 'Analytics', 90),
  ('system.config', 'System configuration', 'Manage system configuration', 'System', 100),
  ('admin.manage', 'Manage administrators', 'Grant or revoke administrator permissions', 'System', 110),
  ('audit.view', 'View operation logs', 'View administrator operation logs', 'System', 120),
  ('chat.announce', 'Publish group announcements', 'Publish announcements and mention all members', 'Communication', 130),
  ('chat.kick', 'Remove group members', 'Remove members and suspend reservation access', 'Communication', 140)
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name,
  sort_order = EXCLUDED.sort_order;

INSERT INTO roles (role_key, role_name, description, is_system)
VALUES
  ('super_admin', 'Super administrator', 'All permissions', TRUE),
  ('admin', 'Administrator', 'All assignable administrator permissions', TRUE),
  ('duty_admin', 'Duty administrator', 'Reservation, return and fault handling', TRUE),
  ('auditor', 'Auditor', 'Read and audit access', TRUE)
ON CONFLICT (role_key) DO UPDATE SET
  role_name = EXCLUDED.role_name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system;

INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
SELECT user_roles.user_id, duty_role.id, user_roles.granted_by, user_roles.granted_at
FROM user_roles
JOIN roles old_role ON old_role.id = user_roles.role_id AND old_role.role_key = 'ops'
JOIN roles duty_role ON duty_role.role_key = 'duty_admin'
ON CONFLICT DO NOTHING;
DELETE FROM user_roles
USING roles old_role
WHERE user_roles.role_id = old_role.id AND old_role.role_key = 'ops';
DELETE FROM roles WHERE role_key = 'ops';

DELETE FROM role_permissions
USING roles
WHERE role_permissions.role_id = roles.id
  AND roles.role_key IN ('super_admin', 'admin', 'duty_admin', 'auditor');

INSERT INTO role_permissions (role_id, permission_key)
SELECT role.id, permission.permission_key
FROM roles role
JOIN permissions permission ON (
  role.role_key = 'super_admin'
  OR (role.role_key = 'admin' AND permission.permission_key IN (
    'user.approve', 'user.manage',
    'reservation.view', 'reservation.approve', 'reservation.change_plan',
    'return.view', 'return.confirm', 'return.image_review', 'return.export',
    'device.view', 'device.manage', 'fault.manage',
    'stats.view', 'stats.export', 'audit.view',
    'chat.announce', 'chat.kick'
  ))
  OR (role.role_key = 'duty_admin' AND permission.permission_key IN (
    'reservation.view', 'reservation.approve',
    'return.view', 'return.confirm', 'return.image_review',
    'device.view', 'fault.manage'
  ))
  OR (role.role_key = 'auditor' AND permission.permission_key IN (
    'audit.view', 'reservation.view', 'return.view', 'device.view'
  ))
)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW calendar_events_view AS
SELECT
  ri.id AS event_id,
  d.id AS device_id,
  d.device_code,
  d.name AS device_name,
  u.id AS user_id,
  u.name AS user_name,
  ri.start_time,
  ri.end_time,
  ri.status,
  'reservation_item'::text AS source_type,
  d.device_code AS color_key
FROM reservation_items ri
JOIN devices d ON d.id = ri.device_id AND d.deleted_at IS NULL
JOIN users u ON u.id = ri.user_id AND u.deleted_at IS NULL
WHERE ri.deleted_at IS NULL
UNION ALL
SELECT
  b.id AS event_id,
  d.id AS device_id,
  d.device_code,
  d.name AS device_name,
  u.id AS user_id,
  u.name AS user_name,
  b.borrow_time AS start_time,
  COALESCE(b.return_time, b.expected_return_time, now()) AS end_time,
  b.status,
  'borrow'::text AS source_type,
  d.device_code AS color_key
FROM borrow_records b
JOIN devices d ON d.id = b.device_id AND d.deleted_at IS NULL
JOIN users u ON u.id = b.user_id AND u.deleted_at IS NULL
WHERE b.deleted_at IS NULL;

CREATE OR REPLACE VIEW device_usage_summary_view AS
SELECT
  d.id AS device_id,
  d.device_code,
  d.name AS device_name,
  COUNT(DISTINCT r.id)::int AS reservation_count,
  COUNT(DISTINCT b.id)::int AS borrow_count,
  COALESCE(SUM(b.duration_minutes), 0)::int AS total_minutes,
  COUNT(DISTINCT f.id)::int AS fault_count,
  MAX(b.borrow_time) AS last_used_at
FROM devices d
LEFT JOIN reservations r ON r.device_id = d.id AND r.deleted_at IS NULL
LEFT JOIN borrow_records b ON b.device_id = d.id AND b.deleted_at IS NULL
LEFT JOIN device_fault_reports f ON f.device_id = d.id AND f.deleted_at IS NULL
WHERE d.deleted_at IS NULL
GROUP BY d.id, d.device_code, d.name;
