-- Align production databases with the current backend/frontend contract.
-- This migration is additive/idempotent so it can be applied after earlier 2026-06-30/2026-07-01 migrations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE reservation_batches
  ADD COLUMN IF NOT EXISTS submit_note TEXT,
  ADD COLUMN IF NOT EXISTS admin_note TEXT;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES reservation_batches(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS device_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL,
  label TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  crosses_day BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(device_id, slot_key)
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
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

INSERT INTO reservation_items (id, batch_id, device_id, user_id, reservation_date, slot_key, start_time, end_time, status, admin_note, approved_at, reservation_id, created_at, updated_at)
SELECT gen_random_uuid(), r.batch_id, r.device_id, r.user_id, (r.start_time AT TIME ZONE 'Asia/Shanghai')::date, 'custom', r.start_time, r.end_time, r.status, r.admin_note, r.approved_at, r.id, r.created_at, r.updated_at
FROM reservations r
WHERE r.batch_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM reservation_items ri WHERE ri.reservation_id = r.id);

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
END$$;

ALTER TABLE borrow_records
  ADD COLUMN IF NOT EXISTS reservation_item_id UUID REFERENCES reservation_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actual_start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_end_time TIMESTAMPTZ;

ALTER TABLE device_fault_reports
  ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS handled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reservation_item_id UUID REFERENCES reservation_items(id) ON DELETE SET NULL;

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

ALTER TABLE operation_logs
  ADD COLUMN IF NOT EXISTS target_type TEXT,
  ADD COLUMN IF NOT EXISTS target_id UUID,
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'operation_logs'
      AND column_name = 'detail'
      AND data_type <> 'jsonb'
  ) THEN
    ALTER TABLE operation_logs
      ALTER COLUMN detail TYPE JSONB USING jsonb_build_object('message', detail::text);
  END IF;
END$$;

ALTER TABLE operation_logs
  ALTER COLUMN detail SET DEFAULT '{}'::jsonb;

CREATE OR REPLACE VIEW calendar_events_view AS
SELECT
  r.id AS event_id,
  d.id AS device_id,
  d.device_code,
  d.name AS device_name,
  u.id AS user_id,
  u.name AS user_name,
  r.start_time,
  r.end_time,
  r.status,
  'reservation'::text AS source_type,
  d.device_code AS color_key
FROM reservations r
JOIN devices d ON d.id = r.device_id
JOIN users u ON u.id = r.user_id
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

CREATE INDEX IF NOT EXISTS idx_device_time_slots_device ON device_time_slots(device_id, enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_reservation_items_batch ON reservation_items(batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reservation_items_user_time ON reservation_items(user_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_reservation_items_device_time ON reservation_items(device_id, start_time, end_time);

ALTER TABLE device_time_slots DISABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE permissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles DISABLE ROW LEVEL SECURITY;