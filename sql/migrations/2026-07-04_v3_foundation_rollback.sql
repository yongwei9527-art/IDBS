-- IDBS 3.0 回滚脚本：撤销 2026-07-04_v3_foundation.sql 中的结构变更。
-- 注意：本脚本只回滚 DDL 与约束，不回滚已写入的业务数据。
-- 软删除字段、audit_logs、user_wechat_bindings 中的数据会随 DROP 而丢失。
-- 执行前先 pg_dump 备份；此脚本不幂等，不可反复执行，每条都用 IF EXISTS 兜底。

-- 12. 移除基线标记
DELETE FROM system_configs WHERE config_key = 'schema_v3_applied_at';

-- 11. 移除新增权限及其角色授权
DELETE FROM role_permissions
WHERE permission_key IN ('chat.use','audit.view');
DELETE FROM permissions
WHERE permission_key IN ('chat.use','audit.view');

-- 10. 移除 3.0 新增配置项
DELETE FROM system_configs
WHERE config_key IN (
  'jwt_access_ttl_minutes',
  'jwt_refresh_ttl_days',
  'v3_feature_chat_ws_enabled',
  'v3_feature_notifications_ws_enabled',
  'overdue_auto_mark_enabled',
  'overdue_check_cron'
);

-- 9. 视图回滚到 2.x 版本（不含 deleted_at 过滤）
DROP VIEW IF EXISTS calendar_events_view;
DROP VIEW IF EXISTS device_usage_summary_view;
CREATE OR REPLACE VIEW calendar_events_view AS
SELECT
  ri.id AS event_id, d.id AS device_id, d.device_code, d.name AS device_name,
  u.id AS user_id, u.name AS user_name, ri.start_time, ri.end_time, ri.status,
  'reservation_item'::text AS source_type, d.device_code AS color_key
FROM reservation_items ri
JOIN devices d ON d.id = ri.device_id
JOIN users u ON u.id = ri.user_id
UNION ALL
SELECT
  b.id AS event_id, d.id AS device_id, d.device_code, d.name AS device_name,
  u.id AS user_id, u.name AS user_name, b.borrow_time AS start_time,
  COALESCE(b.return_time, b.expected_return_time, now()) AS end_time, b.status,
  'borrow'::text AS source_type, d.device_code AS color_key
FROM borrow_records b
JOIN devices d ON d.id = b.device_id
JOIN users u ON u.id = b.user_id;

CREATE OR REPLACE VIEW device_usage_summary_view AS
SELECT
  d.id AS device_id, d.device_code, d.name AS device_name,
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

-- 8. 微信绑定表
DROP TABLE IF EXISTS user_wechat_bindings CASCADE;

-- 7. 审计日志表
DROP TABLE IF EXISTS audit_logs CASCADE;

-- 6. 聊天表新增列
ALTER TABLE chat_conversations DROP COLUMN IF EXISTS last_message_preview;
ALTER TABLE chat_conversations DROP COLUMN IF EXISTS last_message_type;
DROP INDEX IF EXISTS idx_chat_message_reads_user_conv;

-- 5. 通知表扩展
DROP INDEX IF EXISTS idx_user_notifications_level_user_time;
ALTER TABLE user_notifications DROP CONSTRAINT IF EXISTS user_notifications_level_check;
ALTER TABLE user_notifications DROP COLUMN IF EXISTS action_url;
ALTER TABLE user_notifications DROP COLUMN IF EXISTS level;

-- 4. 时间段容量
ALTER TABLE device_time_slots DROP CONSTRAINT IF EXISTS device_time_slots_capacity_check;
ALTER TABLE device_time_slots DROP COLUMN IF EXISTS capacity;

-- 3. 枚举约束
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_status_check;
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservation_items DROP CONSTRAINT IF EXISTS reservation_items_status_check;
ALTER TABLE borrow_records DROP CONSTRAINT IF EXISTS borrow_records_status_check;
ALTER TABLE device_fault_reports DROP CONSTRAINT IF EXISTS device_fault_reports_status_check;
ALTER TABLE user_requests DROP CONSTRAINT IF EXISTS user_requests_status_check;

-- 2. 审计字段（保留以避免数据丢失风险；如需彻底回滚可手动 DROP）
-- 本脚本不删除 created_by/updated_by，因为可能已写入引用；仅在彻底重装时由 schema.sql 重建。

-- 1. 软删除字段（同理保留，避免误删数据。彻底回滚需手动 DROP COLUMN deleted_at。)
-- 如确认要删除：
-- ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE devices DROP COLUMN IF EXISTS deleted_at;
-- ... 等等

-- 标记 v3 迁移为已回滚（从 schema_migrations 移除，便于重跑）
DELETE FROM schema_migrations WHERE version = '2026-07-04_v3_foundation';
