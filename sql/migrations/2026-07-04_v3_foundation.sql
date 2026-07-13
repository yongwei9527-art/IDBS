-- IDBS 3.0 基线迁移：枚举约束化、软删除、审计字段、时间段容量、通知扩展、
-- 聊天增强、统一审计日志、视图更新、微信绑定独立表。
-- 设计原则：全部 additive + 幂等，兼容 2.x schema；
-- 不删除已有数据；旧字段保留，新增字段 nullable 或带默认值。
-- 执行前请先 pg_dump 全量备份；回滚见 scripts/rollback-3-to-2.sql。

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. 业务表软删除
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE reservation_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE reservation_batches ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE borrow_records ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE device_fault_reports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE user_requests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2. 审计字段 created_by / updated_by
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='devices' AND column_name='created_by') THEN
    ALTER TABLE devices ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='devices' AND column_name='updated_by') THEN
    ALTER TABLE devices ADD COLUMN updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='reservations' AND column_name='created_by') THEN
    ALTER TABLE reservations ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='reservations' AND column_name='updated_by') THEN
    ALTER TABLE reservations ADD COLUMN updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='reservation_items' AND column_name='created_by') THEN
    ALTER TABLE reservation_items ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='reservation_items' AND column_name='updated_by') THEN
    ALTER TABLE reservation_items ADD COLUMN updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='reservation_batches' AND column_name='updated_by') THEN
    ALTER TABLE reservation_batches ADD COLUMN updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='borrow_records' AND column_name='updated_by') THEN
    ALTER TABLE borrow_records ADD COLUMN updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='device_fault_reports' AND column_name='updated_by') THEN
    ALTER TABLE device_fault_reports ADD COLUMN updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='user_requests' AND column_name='updated_by') THEN
    ALTER TABLE user_requests ADD COLUMN updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. 枚举 CHECK 约束（使用 IF NOT EXISTS 等价的 DO 块，PG < 12 无 ALTER TABLE ADD CONSTRAINT IF NOT EXISTS）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_status_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_status_check
      CHECK (status IN ('pending','active','disabled','rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('user','admin','super_admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='devices_status_check') THEN
    ALTER TABLE devices ADD CONSTRAINT devices_status_check
      CHECK (status IN ('available','reserved','in_use','abnormal_pending','maintenance','disabled'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reservations_status_check') THEN
    ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
      CHECK (status IN ('pending','approved','rejected','cancelled','in_use','completed','no_show'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reservation_items_status_check') THEN
    ALTER TABLE reservation_items ADD CONSTRAINT reservation_items_status_check
      CHECK (status IN ('pending','approved','rejected','cancelled','in_use','completed','no_show'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='borrow_records_status_check') THEN
    ALTER TABLE borrow_records ADD CONSTRAINT borrow_records_status_check
      CHECK (status IN ('in_use','returned','abnormal_pending','overdue'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='device_fault_reports_status_check') THEN
    ALTER TABLE device_fault_reports ADD CONSTRAINT device_fault_reports_status_check
      CHECK (status IN ('pending','processing','resolved','closed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_requests_status_check') THEN
    ALTER TABLE user_requests ADD CONSTRAINT user_requests_status_check
      CHECK (status IN ('pending','processing','resolved','closed'));
  END IF;
END $$;

-- 4. 时间段容量
ALTER TABLE device_time_slots ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 1;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='device_time_slots_capacity_check') THEN
    ALTER TABLE device_time_slots ADD CONSTRAINT device_time_slots_capacity_check
      CHECK (capacity >= 1);
  END IF;
END $$;

-- 5. 通知表扩展
ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'info';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_notifications_level_check') THEN
    ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_level_check
      CHECK (level IN ('info','warning','success'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_user_notifications_level_user_time
  ON user_notifications(level, user_id, created_at DESC);

-- 6. 聊天表增强（保留全部 chat_* 表）
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS last_message_preview TEXT;
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS last_message_type TEXT NOT NULL DEFAULT 'text';
CREATE INDEX IF NOT EXISTS idx_chat_message_reads_user_conv
  ON chat_message_reads(user_id, read_at DESC);

-- 7. 统一审计日志表（旧 operation_logs / user_activity_logs 保留只读归档）
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

-- 8. 微信绑定独立表（支持 unionid + 多公众号）
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

-- 9. 视图更新（加 deleted_at 过滤，覆盖 3.0 视图）
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

-- 10. 配置：3.0 新增默认项
INSERT INTO system_configs (config_key, config_value, description)
VALUES
  ('jwt_access_ttl_minutes', '15', 'Access token validity in minutes'),
  ('jwt_refresh_ttl_days', '7', 'Refresh token validity in days'),
  ('v3_feature_chat_ws_enabled', '1', 'Whether chat over WebSocket is enabled in v3'),
  ('v3_feature_notifications_ws_enabled', '1', 'Whether realtime notifications over WebSocket is enabled in v3'),
  ('overdue_auto_mark_enabled', '1', 'Whether to auto-mark overdue borrow records'),
  ('overdue_check_cron', '*/15 * * * *', 'Cron for overdue scan (server-local)')
ON CONFLICT (config_key) DO NOTHING;

-- 11. 新增权限项
INSERT INTO permissions (permission_key, name, description, group_name, sort_order)
VALUES
  ('chat.use', '使用聊天', '发起会话与发送消息', '沟通', 25),
  ('audit.view', '查看审计日志', '查看统一审计日志', '系统', 125)
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  group_name = EXCLUDED.group_name,
  sort_order = EXCLUDED.sort_order;

-- 为现有系统角色补新权限
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
JOIN permissions p ON (
  (r.role_key = 'super_admin')
  OR (r.role_key = 'admin' AND p.permission_key IN ('chat.use'))
  OR (r.role_key = 'ops' AND p.permission_key IN ('chat.use'))
  OR (r.role_key = 'auditor' AND p.permission_key IN ('audit.view'))
)
ON CONFLICT DO NOTHING;

-- 12. 基线标记（可选，便于排查）
INSERT INTO system_configs (config_key, config_value, description)
VALUES ('schema_v3_applied_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'IDBS 3.0 schema baseline applied timestamp')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;
