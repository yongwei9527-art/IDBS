CREATE TABLE IF NOT EXISTS device_fault_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  borrow_record_id UUID REFERENCES borrow_records(id) ON DELETE SET NULL,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  issue_type TEXT NOT NULL DEFAULT 'fault',
  description TEXT,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fault_reports_device_time ON device_fault_reports(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fault_reports_status_time ON device_fault_reports(status, created_at DESC);
ALTER TABLE device_fault_reports DISABLE ROW LEVEL SECURITY;
