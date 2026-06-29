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
  email TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- user/admin/super_admin
  status TEXT NOT NULL DEFAULT 'pending', -- pending/active/disabled/rejected
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  wechat_openid TEXT UNIQUE,
  wechat_nickname TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS reservation_slot_keys JSONB NOT NULL DEFAULT '["morning","afternoon","evening","night","daytime"]'::jsonb;

CREATE TABLE IF NOT EXISTS usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID,
  reservation_id UUID,
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
  CHECK (end_time > start_time)
);

-- Hard rule: same device cannot have overlapping active reservation periods.
-- Status pending also occupies the time slot to prevent duplicate waiting requests.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_no_overlap_active'
  ) THEN
    ALTER TABLE reservations
      ADD CONSTRAINT reservations_no_overlap_active
      EXCLUDE USING gist (
        device_id WITH =,
        tstzrange(start_time, end_time, '[)') WITH &&
      )
      WHERE (status IN ('pending','approved','in_use'));
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS reservation_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_codes TEXT NOT NULL,
  time_slots TEXT NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES reservation_batches(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_reservation_batches_user_time ON reservation_batches(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS borrow_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  borrow_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_return_time TIMESTAMPTZ,
  return_time TIMESTAMPTZ,
  duration_minutes INTEGER,
  return_condition TEXT,
  return_note TEXT,
  return_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'in_use', -- in_use/returned/abnormal_pending/overdue
  is_overdue BOOLEAN NOT NULL DEFAULT FALSE,
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
  issue_type TEXT NOT NULL DEFAULT 'fault',
  description TEXT,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending', -- pending/processing/resolved
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID,
  operator_name TEXT,
  action TEXT NOT NULL,
  device_id UUID,
  record_id UUID,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_wechat_openid ON users(wechat_openid);
CREATE INDEX IF NOT EXISTS idx_devices_code ON devices(device_code);
CREATE INDEX IF NOT EXISTS idx_reservations_device_time ON reservations(device_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_reservations_user_time ON reservations(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_borrow_records_device_time ON borrow_records(device_id, borrow_time, return_time);
CREATE INDEX IF NOT EXISTS idx_borrow_records_user_time ON borrow_records(user_id, borrow_time, return_time);
CREATE INDEX IF NOT EXISTS idx_user_activity_event_time ON user_activity_logs(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_user_activity_openid_time ON user_activity_logs(wechat_openid, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_log_created_at ON usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_log_record_action ON usage_log(record_id, action);
CREATE INDEX IF NOT EXISTS idx_wechat_push_logs_date ON wechat_push_logs(push_date, created_at);
CREATE INDEX IF NOT EXISTS idx_fault_reports_device_time ON device_fault_reports(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fault_reports_status_time ON device_fault_reports(status, created_at DESC);

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
  ('public_show_reserver_name', '1', 'Whether public users can see reserver name'),
  ('public_show_reserver_phone', '1', 'Whether public users can see reserver phone'),
  ('public_show_reserver_student_no', '0', 'Whether public users can see reserver student number'),
  ('system_notice_enabled', '1', 'Whether login notice popup is enabled'),
  ('system_notice_title', '使用注意事项', 'Login notice popup title'),
  ('system_notice_content', '请按预约时间使用设备，归还前确认设备状态并按要求提交归还信息。', 'Login notice popup content'),
  ('system_notice_version', '1', 'Login notice popup version'),
  ('admin_default_password_seed', 'IDBS123456', 'Default initial admin password seed')
ON CONFLICT (config_key) DO NOTHING;

-- This project writes through the VPS Node service. Keep RLS off for the first runnable version.
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE admin_roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE devices DISABLE ROW LEVEL SECURITY;
ALTER TABLE reservations DISABLE ROW LEVEL SECURITY;
ALTER TABLE borrow_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE receive_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE operation_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE system_configs DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE usage_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE wechat_push_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE device_fault_reports DISABLE ROW LEVEL SECURITY;
