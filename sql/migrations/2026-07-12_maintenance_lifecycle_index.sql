-- IDBS 5.0 maintenance lifecycle scheduler lookup index
CREATE INDEX IF NOT EXISTS idx_maintenance_windows_lifecycle
  ON device_maintenance_windows(status, start_time, end_time)
  WHERE status IN ('scheduled', 'active');
