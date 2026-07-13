DELETE FROM system_configs WHERE config_key = 'admin_default_password_seed';

CREATE TABLE IF NOT EXISTS refresh_token_sessions (
  jti UUID PRIMARY KEY,
  subject TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_sessions_subject
  ON refresh_token_sessions(subject, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_refresh_token_sessions_expiry
  ON refresh_token_sessions(expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  job_key TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  instance_id TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CHECK (status IN ('running','success','failed'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_name_time
  ON scheduled_job_runs(job_name, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_expiry
  ON rate_limit_buckets(expires_at);

CREATE INDEX IF NOT EXISTS idx_reservation_items_pending_time
  ON reservation_items(start_time, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_borrow_records_active_due
  ON borrow_records(expected_return_time)
  WHERE status = 'in_use';

CREATE INDEX IF NOT EXISTS idx_users_pending_active
  ON users(created_at DESC)
  WHERE status = 'pending' AND coalesce(is_banned, FALSE) = FALSE;

INSERT INTO system_configs (config_key, config_value, description, updated_at)
VALUES ('schema_v5_applied_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'IDBS 5.0 release baseline timestamp', now())
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = now();
