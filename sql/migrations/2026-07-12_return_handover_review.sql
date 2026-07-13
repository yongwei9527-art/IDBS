-- IDBS 5.0: user return submission must be accepted by operations before a device returns to service.
ALTER TABLE borrow_records
  ADD COLUMN IF NOT EXISTS return_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_review_note TEXT;

CREATE INDEX IF NOT EXISTS idx_borrow_records_return_review
  ON borrow_records(status, return_time DESC)
  WHERE status IN ('return_pending', 'abnormal_pending');
