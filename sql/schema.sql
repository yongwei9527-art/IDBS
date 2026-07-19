-- IDBS schema for PostgreSQL
-- Run this in schema public.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  student_no TEXT,
  group_name TEXT,
  avatar_url TEXT,
  department TEXT,
  email TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- user/admin/super_admin
  status TEXT NOT NULL DEFAULT 'pending', -- pending/active/disabled/rejected
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  disabled_reason TEXT,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  wechat_openid TEXT UNIQUE,
  wechat_nickname TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS users_single_super_admin_idx ON users ((role)) WHERE role = 'super_admin';

CREATE TABLE IF NOT EXISTS admin_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL DEFAULT 'admin', -- admin/super_admin/ops/auditor
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT NOT NULL UNIQUE,
  config_value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  user_name TEXT,
  phone TEXT,
  wechat_openid TEXT,
  device_type TEXT,
  client_key TEXT,
  ip_address TEXT,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wechat_push_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  push_date TEXT NOT NULL,
  recipient_openid TEXT,
  message_type TEXT NOT NULL DEFAULT 'daily_usage_report',
  message_preview TEXT,
  status TEXT,
  response_body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  location TEXT,
  manager TEXT,
  status TEXT NOT NULL DEFAULT 'available', -- available/reserved/in_use/abnormal_pending/maintenance/disabled
  allow_reservation BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  usage_notice TEXT,
  cover_photo TEXT,
  instruction_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  reservation_slot_keys JSONB NOT NULL DEFAULT '["morning","afternoon","evening","night","daytime"]'::jsonb,
  last_return_photo TEXT,
  last_return_user TEXT,
  last_return_time TIMESTAMPTZ,
  last_condition TEXT,
  return_mode TEXT NOT NULL DEFAULT 'image_required',
  return_require_note BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID,
  reservation_id UUID,
  reservation_item_id UUID,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  device_code TEXT,
  device_name TEXT,
  user_name TEXT,
  user_phone TEXT,
  user_student_no TEXT,
  borrow_time TIMESTAMPTZ,
  expected_return_time TIMESTAMPTZ,
  return_time TIMESTAMPTZ,
  duration_minutes INTEGER,
  record_status TEXT,
  return_condition TEXT,
  return_note TEXT,
  operator_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending/approved/rejected/cancelled/in_use/completed/no_show
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS reservation_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_codes TEXT NOT NULL,
  time_slots TEXT NOT NULL,
  purpose TEXT,
  submit_note TEXT,
  admin_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_batches_user_time ON reservation_batches(user_id, created_at DESC);

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES reservation_batches(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS borrow_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  reservation_item_id UUID,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  borrow_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_return_time TIMESTAMPTZ,
  return_time TIMESTAMPTZ,
  duration_minutes INTEGER,
  return_condition TEXT,
  return_note TEXT,
  overdue_reason_category TEXT,
  abnormal_reason_category TEXT,
  return_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'in_use', -- in_use/return_pending/returned/abnormal_pending/overdue
  is_overdue BOOLEAN NOT NULL DEFAULT FALSE,
  actual_start_time TIMESTAMPTZ,
  actual_end_time TIMESTAMPTZ,
  return_archive_folder TEXT,
  return_archive_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  return_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  return_reviewed_at TIMESTAMPTZ,
  return_review_note TEXT,
  return_material_required BOOLEAN NOT NULL DEFAULT FALSE,
  return_material_deadline TIMESTAMPTZ,
  return_supplement_note TEXT,
  return_supplement_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  return_supplemented_at TIMESTAMPTZ,
  return_material_late BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receive_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  previous_record_id UUID REFERENCES borrow_records(id) ON DELETE SET NULL,
  receiver_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  receive_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirm_status TEXT,
  receive_note TEXT,
  receive_photo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_fault_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  borrow_record_id UUID REFERENCES borrow_records(id) ON DELETE SET NULL,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  reservation_item_id UUID,
  issue_type TEXT NOT NULL DEFAULT 'fault',
  severity TEXT DEFAULT 'normal',
  reason_category TEXT,
  auto_action TEXT NOT NULL DEFAULT 'inspect',
  impact_current_borrow BOOLEAN NOT NULL DEFAULT FALSE,
  impact_future_reservations BOOLEAN NOT NULL DEFAULT FALSE,
  notify_affected_users BOOLEAN NOT NULL DEFAULT FALSE,
  transfer_to_backup BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending', -- pending/processing/resolved/closed
  admin_note TEXT,
  handled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);


-- Preventive maintenance, work orders and reservation-blocking windows (IDBS 5.0)
CREATE TABLE IF NOT EXISTS device_maintenance_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  maintenance_type TEXT NOT NULL DEFAULT 'inspection',
  interval_days INTEGER NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
  next_due_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS device_maintenance_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES device_maintenance_plans(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','completed','cancelled')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE TABLE IF NOT EXISTS device_maintenance_work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES device_maintenance_plans(id) ON DELETE SET NULL,
  maintenance_window_id UUID REFERENCES device_maintenance_windows(id) ON DELETE SET NULL,
  fault_report_id UUID REFERENCES device_fault_reports(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  maintenance_type TEXT NOT NULL DEFAULT 'inspection',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled')),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  description TEXT,
  result_note TEXT,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (window_end IS NULL OR window_start IS NULL OR window_end > window_start)
);
CREATE INDEX IF NOT EXISTS idx_maintenance_plans_due ON device_maintenance_plans(status, next_due_at);
CREATE INDEX IF NOT EXISTS idx_maintenance_windows_device_time ON device_maintenance_windows(device_id, start_time, end_time) WHERE status IN ('scheduled','active');
CREATE INDEX IF NOT EXISTS idx_maintenance_windows_lifecycle ON device_maintenance_windows(status, start_time, end_time) WHERE status IN ('scheduled','active');
CREATE INDEX IF NOT EXISTS idx_maintenance_work_orders_status_time ON device_maintenance_work_orders(status, window_start DESC);

CREATE TABLE IF NOT EXISTS user_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'feature',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pending',
  no_show_reason_category TEXT,
  admin_note TEXT,
  change_request_note TEXT,
  confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('pending','confirmed','rejected','closed','cancelled','change_requested'))
);

CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  related_type TEXT,
  related_id UUID,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  action_url TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'direct',
  title TEXT,
  system_key TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  retention_days INTEGER,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  last_message_type TEXT,
  expires_at TIMESTAMPTZ,
  dissolve_notified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chat_participants (
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  related_type TEXT,
  related_id TEXT,
  reply_to_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  client_message_id TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'sent',
  edited_at TIMESTAMPTZ,
  recalled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_message_reads (
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_time ON audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_time ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);

CREATE TABLE IF NOT EXISTS user_wechat_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  openid TEXT NOT NULL,
  unionid TEXT,
  app_id TEXT,
  nickname TEXT,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(openid, app_id)
);

CREATE INDEX IF NOT EXISTS idx_user_wechat_bindings_user ON user_wechat_bindings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wechat_bindings_unionid ON user_wechat_bindings(unionid) WHERE unionid IS NOT NULL;


CREATE TABLE IF NOT EXISTS intelligence_action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id TEXT NOT NULL,
  action_type TEXT,
  action_title TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  handled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('open','done','ignored','delegated'))
);

CREATE INDEX IF NOT EXISTS idx_intelligence_action_logs_action_time ON intelligence_action_logs(action_id, updated_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_action_logs_status_time ON intelligence_action_logs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS refresh_token_sessions (
  jti UUID PRIMARY KEY,
  subject TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_token_sessions_subject ON refresh_token_sessions(subject, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_token_sessions_expiry ON refresh_token_sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  job_key TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  instance_id TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CHECK (status IN ('running','success','failed'))
);
CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_name_time ON scheduled_job_runs(job_name, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_expiry ON rate_limit_buckets(expires_at);

CREATE TABLE IF NOT EXISTS operation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID,
  operator_name TEXT,
  action TEXT NOT NULL,
  device_id UUID,
  record_id UUID,
  target_type TEXT,
  target_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS priority_usage_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_date DATE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  successful_return_count INTEGER NOT NULL DEFAULT 0,
  successful_user_count INTEGER NOT NULL DEFAULT 0,
  successful_device_count INTEGER NOT NULL DEFAULT 0,
  total_usage_minutes INTEGER NOT NULL DEFAULT 0,
  overdue_return_count INTEGER NOT NULL DEFAULT 0,
  records JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_date, timezone)
);

CREATE INDEX IF NOT EXISTS idx_priority_usage_archives_period
  ON priority_usage_archives(period_date DESC, timezone);

CREATE TABLE IF NOT EXISTS export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'finished', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at TIMESTAMPTZ,
  worker_id TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  row_count INTEGER NOT NULL DEFAULT 0,
  file_path TEXT,
  error_message TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_worker_queue
  ON export_jobs(status, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_export_jobs_expired_files
  ON export_jobs(finished_at)
  WHERE status = 'finished' AND file_path IS NOT NULL;

CREATE TABLE IF NOT EXISTS device_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL,
  label TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  crosses_day BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER NOT NULL DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(device_id, slot_key)
);

CREATE TABLE IF NOT EXISTS reservation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES reservation_batches(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reservation_date DATE NOT NULL,
  slot_key TEXT NOT NULL DEFAULT 'custom',
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  cancel_previous_status TEXT,
  cancel_requested_at TIMESTAMPTZ,
  cancel_request_note TEXT,
  cancel_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  cancel_reviewed_at TIMESTAMPTZ,
  cancel_review_note TEXT,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'borrow_records_reservation_item_fk') THEN
    ALTER TABLE borrow_records
      ADD CONSTRAINT borrow_records_reservation_item_fk
      FOREIGN KEY (reservation_item_id) REFERENCES reservation_items(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_fault_reports_reservation_item_fk') THEN
    ALTER TABLE device_fault_reports
      ADD CONSTRAINT device_fault_reports_reservation_item_fk
      FOREIGN KEY (reservation_item_id) REFERENCES reservation_items(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS permissions (
  permission_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  group_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(permission_key) ON DELETE CASCADE,
  PRIMARY KEY(role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, role_id)
);

INSERT INTO device_time_slots (device_id, slot_key, label, start_time, end_time, crosses_day, sort_order)
SELECT d.id, slot.slot_key, slot.label, slot.start_time::time, slot.end_time::time, slot.crosses_day, slot.sort_order
FROM devices d
CROSS JOIN (VALUES
  ('morning', '上午 8:00-12:00', '08:00', '12:00', FALSE, 10),
  ('afternoon', '下午 12:00-17:00', '12:00', '17:00', FALSE, 20),
  ('evening', '傍晚 17:00-22:00', '17:00', '22:00', FALSE, 30),
  ('night', '夜间 22:00-次日 8:00', '22:00', '08:00', TRUE, 40),
  ('daytime', '白天 8:00-22:00', '08:00', '22:00', FALSE, 50)
) AS slot(slot_key, label, start_time, end_time, crosses_day, sort_order)
ON CONFLICT (device_id, slot_key) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_items_no_overlap_active') THEN
    ALTER TABLE reservation_items
      ADD CONSTRAINT reservation_items_no_overlap_active
      EXCLUDE USING gist (
        device_id WITH =,
        tstzrange(start_time, end_time, '[)') WITH &&
      )
      WHERE (status IN ('pending','approved','in_use'));
  END IF;
END $$;

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
JOIN devices d ON d.id = ri.device_id
JOIN users u ON u.id = ri.user_id
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
JOIN devices d ON d.id = b.device_id
JOIN users u ON u.id = b.user_id;

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
LEFT JOIN reservations r ON r.device_id = d.id
LEFT JOIN borrow_records b ON b.device_id = d.id
LEFT JOIN device_fault_reports f ON f.device_id = d.id
GROUP BY d.id, d.device_code, d.name;

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_wechat_openid ON users(wechat_openid);
CREATE INDEX IF NOT EXISTS idx_devices_code ON devices(device_code);
CREATE INDEX IF NOT EXISTS idx_reservations_device_time ON reservations(device_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_reservations_user_time ON reservations(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_borrow_records_device_time ON borrow_records(device_id, borrow_time, return_time);
CREATE INDEX IF NOT EXISTS idx_borrow_records_user_time ON borrow_records(user_id, borrow_time, return_time);
CREATE INDEX IF NOT EXISTS idx_borrow_records_active_due ON borrow_records(expected_return_time) WHERE status = 'in_use';
CREATE INDEX IF NOT EXISTS idx_borrow_records_return_review ON borrow_records(status, return_time DESC) WHERE status IN ('return_pending', 'abnormal_pending');
CREATE INDEX IF NOT EXISTS idx_borrow_records_material_deadline ON borrow_records(return_material_deadline) WHERE return_material_required = TRUE AND return_supplemented_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_pending_active ON users(created_at DESC) WHERE status = 'pending' AND coalesce(is_banned, FALSE) = FALSE;
CREATE INDEX IF NOT EXISTS idx_user_activity_event_time ON user_activity_logs(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_user_activity_openid_time ON user_activity_logs(wechat_openid, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_log_created_at ON usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_log_record_action ON usage_log(record_id, action);
CREATE INDEX IF NOT EXISTS idx_wechat_push_logs_date ON wechat_push_logs(push_date, created_at);
CREATE INDEX IF NOT EXISTS idx_fault_reports_device_time ON device_fault_reports(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fault_reports_status_time ON device_fault_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reservation_items_cancel_requested ON reservation_items(status, cancel_requested_at DESC) WHERE status = 'cancel_requested';
CREATE INDEX IF NOT EXISTS idx_user_requests_user_time ON user_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_requests_status_time ON user_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_time ON user_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread ON user_notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_participants_user_time ON chat_participants(user_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_time ON chat_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id_time ON chat_messages(conversation_id, id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_last_message ON chat_conversations(last_message_at DESC NULLS LAST, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_system_key ON chat_conversations(system_key) WHERE system_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_client_message ON chat_messages(sender_id, client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_related ON chat_messages(related_type, related_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_reads_user_time ON chat_message_reads(user_id, read_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_related ON user_notifications(related_type, related_id);
CREATE INDEX IF NOT EXISTS idx_export_jobs_created_by_time ON export_jobs(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status_time ON export_jobs(status, created_at DESC);

INSERT INTO chat_conversations (type, title, system_key, is_system, retention_days, created_at, updated_at)
VALUES ('group', '实验室管理总群', 'lab_management', TRUE, 90, now(), now())
ON CONFLICT (system_key) WHERE system_key IS NOT NULL DO UPDATE SET
  title = EXCLUDED.title,
  is_system = TRUE,
  retention_days = EXCLUDED.retention_days,
  updated_at = now();

INSERT INTO chat_participants (conversation_id, user_id, role, joined_at)
SELECT c.id,
       u.id,
       CASE WHEN u.role IN ('super_admin','admin') THEN 'admin' ELSE 'member' END,
       now()
FROM chat_conversations c
JOIN users u ON u.status = 'active' AND coalesce(u.is_banned, false) = false
WHERE c.system_key = 'lab_management'
ON CONFLICT (conversation_id, user_id) DO UPDATE SET
  role = CASE WHEN EXCLUDED.role = 'admin' THEN 'admin' ELSE chat_participants.role END;
CREATE INDEX IF NOT EXISTS idx_device_time_slots_device ON device_time_slots(device_id, enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_reservation_items_batch ON reservation_items(batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reservation_items_user_time ON reservation_items(user_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_reservation_items_device_time ON reservation_items(device_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_reservation_items_pending_time ON reservation_items(start_time, created_at DESC) WHERE status = 'pending';

INSERT INTO system_configs (config_key, config_value, description)
VALUES
  ('captcha_expire_minutes', '3', 'Challenge code validity in minutes'),
  ('captcha_hourly_limit', '3', 'Maximum challenge requests per hour'),
  ('openid_daily_register_limit', '1', 'Daily bind limit for the same OpenID'),
  ('enable_image_captcha', '0', 'Whether image captcha is enabled before challenge issuance'),
  ('admin_report_enabled', '0', 'Whether daily usage report push is enabled'),
  ('admin_report_hour', '9', 'Daily report push hour'),
  ('admin_report_minute', '0', 'Daily report push minute'),
  ('admin_report_timezone', 'Asia/Shanghai', 'Daily report push timezone'),
  ('wechat_token', '', 'WeChat official account callback token'),
  ('wechat_app_id', '', 'WeChat official account AppID'),
  ('wechat_app_secret', '', 'WeChat official account AppSecret'),
  ('wechat_admin_openids', '', 'Comma-separated admin OpenIDs'),
  ('require_return_photo', '1', 'Whether return photos are required before ending usage'),
  ('jwt_access_ttl_minutes', '15', 'Access token validity in minutes'),
  ('jwt_refresh_ttl_days', '7', 'Refresh token validity in days'),
  ('v3_feature_chat_ws_enabled', '1', 'Whether chat over WebSocket is enabled in v3'),
  ('v3_feature_notifications_ws_enabled', '1', 'Whether realtime notifications over WebSocket is enabled in v3'),
  ('overdue_auto_mark_enabled', '1', 'Whether to auto-mark overdue borrow records'),
  ('overdue_check_cron', '*/15 * * * *', 'Cron for overdue scan'),
  ('schema_v3_applied_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'IDBS 3.0/4.0 schema baseline applied timestamp'),
  ('schema_v5_applied_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'IDBS 5.0 release baseline applied timestamp'),
  ('block_ip_access_enabled', '0', 'Whether public pages and login challenge are blocked when accessed by IP host'),
  ('public_show_reserver_name', '1', 'Whether public users can see reserver name'),
  ('public_show_reserver_phone', '1', 'Whether public users can see reserver phone'),
  ('public_show_reserver_student_no', '0', 'Whether public users can see reserver student number'),
  ('system_notice_enabled', '1', 'Whether login notice popup is enabled'),
  ('system_notice_title', '使用注意事项', 'Login notice popup title'),
  ('system_notice_content', '请按预约时间使用设备，归还前确认设备状态并按要求提交归还信息。', 'Login notice popup content'),
  ('system_notice_version', '1', 'Login notice popup version')
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO permissions (permission_key, name, description, group_name, sort_order)
VALUES
  ('user.approve', '同意用户注册', '审核新用户注册申请', '用户', 10),
  ('user.manage', '管理用户', '搜索、禁用、恢复、解绑用户', '用户', 20),
  ('reservation.view', '查看预约', '查看预约与日历数据', '预约', 30),
  ('reservation.approve', '同意用户预约', '审批预约批次和明细', '预约', 40),
  ('device.view', '查看设备', '查看设备和设备状态', '设备', 50),
  ('device.manage', '管理设备', '新增、编辑、停用设备和时间段', '设备', 60),
  ('fault.manage', '处理故障报备', '处理故障并联动设备状态', '故障', 70),
  ('stats.view', '查看统计', '查看统计与分析图', '统计', 80),
  ('stats.export', '导出统计', '导出统计数据', '统计', 90),
  ('system.config', '系统配置', '修改系统配置', '系统', 100),
  ('admin.manage', '管理管理员权限', '授权或撤销管理员权限', '系统', 110),
  ('operation.view', '查看操作日志', '查看后台操作日志', '系统', 120)
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name,
  sort_order = EXCLUDED.sort_order;

INSERT INTO roles (role_key, role_name, description, is_system)
VALUES
  ('super_admin', '超级管理员', '全部权限', TRUE),
  ('admin', '管理员', '设备、用户、预约、统计管理', TRUE),
  ('ops', '运营', '设备、预约、故障处理', TRUE),
  ('auditor', '审计', '查看与导出', TRUE)
ON CONFLICT (role_key) DO UPDATE SET role_name = EXCLUDED.role_name, description = EXCLUDED.description, is_system = EXCLUDED.is_system;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
JOIN permissions p ON (
  r.role_key = 'super_admin'
  OR (r.role_key = 'admin' AND p.permission_key IN ('user.approve','user.manage','reservation.view','reservation.approve','device.view','device.manage','fault.manage','stats.view','stats.export'))
  OR (r.role_key = 'ops' AND p.permission_key IN ('reservation.view','reservation.approve','device.view','device.manage','fault.manage'))
  OR (r.role_key = 'auditor' AND p.permission_key IN ('reservation.view','device.view','stats.view','stats.export','operation.view'))
)
ON CONFLICT DO NOTHING;

-- This project writes through the VPS Node service. Keep RLS off for the first runnable version.
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE devices DISABLE ROW LEVEL SECURITY;
ALTER TABLE reservations DISABLE ROW LEVEL SECURITY;
ALTER TABLE borrow_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE receive_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE operation_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_wechat_bindings DISABLE ROW LEVEL SECURITY;
ALTER TABLE intelligence_action_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_token_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_job_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_buckets DISABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE device_time_slots DISABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE permissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE system_configs DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE usage_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE wechat_push_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE device_fault_reports DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_reads DISABLE ROW LEVEL SECURITY;




