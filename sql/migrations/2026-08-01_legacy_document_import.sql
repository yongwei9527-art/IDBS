CREATE TABLE IF NOT EXISTS legacy_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_import_runs_active_hash ON legacy_import_runs(source_sha256) WHERE status IN ('running', 'completed');
CREATE INDEX IF NOT EXISTS idx_legacy_import_runs_created ON legacy_import_runs(created_at DESC);
