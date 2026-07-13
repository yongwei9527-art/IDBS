-- IDBS 5.0 export-job reliability and secure-download upgrade
ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS lease_token UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
UPDATE export_jobs SET available_at = COALESCE(available_at, created_at)
WHERE status = 'pending' AND available_at IS NULL;
ALTER TABLE export_jobs DROP CONSTRAINT IF EXISTS export_jobs_status_check;
ALTER TABLE export_jobs ADD CONSTRAINT export_jobs_status_check CHECK (status IN ('pending', 'running', 'finished', 'failed')) NOT VALID;
ALTER TABLE export_jobs DROP CONSTRAINT IF EXISTS export_jobs_max_attempts_check;
ALTER TABLE export_jobs ADD CONSTRAINT export_jobs_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 10) NOT VALID;
CREATE INDEX IF NOT EXISTS idx_export_jobs_worker_queue ON export_jobs(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_export_jobs_expired_files ON export_jobs(finished_at) WHERE status = 'finished' AND file_path IS NOT NULL;
