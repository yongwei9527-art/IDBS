ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_openid TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_nickname TEXT;

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

CREATE INDEX IF NOT EXISTS idx_users_wechat_openid ON users(wechat_openid);
CREATE INDEX IF NOT EXISTS idx_user_activity_event_time ON user_activity_logs(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_user_activity_openid_time ON user_activity_logs(wechat_openid, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_log_created_at ON usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_log_record_action ON usage_log(record_id, action);
CREATE INDEX IF NOT EXISTS idx_wechat_push_logs_date ON wechat_push_logs(push_date, created_at);

INSERT INTO system_configs (config_key, config_value, description)
VALUES
  ('captcha_expire_minutes', '3', 'Challenge code validity in minutes'),
  ('captcha_hourly_limit', '3', 'Maximum challenge requests per hour'),
  ('openid_daily_register_limit', '1', 'Daily bind limit for the same OpenID'),
  ('enable_image_captcha', '0', 'Whether image captcha is enabled before challenge issuance'),
  ('admin_report_enabled', '0', 'Whether daily usage report push is enabled'),
  ('admin_report_hour', '9', 'Daily report push hour'),
  ('admin_report_minute', '0', 'Daily report push minute'),
  ('admin_report_timezone', 'Asia/Shanghai', 'Daily report push timezone')
ON CONFLICT (config_key) DO NOTHING;

ALTER TABLE system_configs DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE usage_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE wechat_push_logs DISABLE ROW LEVEL SECURITY;
