-- 实验室履约提醒、故障处置策略与异常原因分类
ALTER TABLE device_fault_reports
  ADD COLUMN IF NOT EXISTS reason_category TEXT,
  ADD COLUMN IF NOT EXISTS auto_action TEXT NOT NULL DEFAULT 'inspect',
  ADD COLUMN IF NOT EXISTS impact_current_borrow BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS impact_future_reservations BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notify_affected_users BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS transfer_to_backup BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE borrow_records
  ADD COLUMN IF NOT EXISTS overdue_reason_category TEXT,
  ADD COLUMN IF NOT EXISTS abnormal_reason_category TEXT;

ALTER TABLE reservation_items
  ADD COLUMN IF NOT EXISTS no_show_reason_category TEXT;

CREATE INDEX IF NOT EXISTS idx_reservation_reminder_window
  ON reservation_items(status, start_time)
  WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_borrow_reminder_window
  ON borrow_records(status, expected_return_time)
  WHERE status = 'in_use';
