-- IDBS 5.0 preventive maintenance, maintenance windows and work orders


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
CREATE INDEX IF NOT EXISTS idx_maintenance_work_orders_status_time ON device_maintenance_work_orders(status, window_start DESC);
