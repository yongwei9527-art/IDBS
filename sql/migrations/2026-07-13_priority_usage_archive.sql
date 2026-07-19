-- Persist daily summaries of successfully completed device use and returns.
CREATE TABLE IF NOT EXISTS priority_usage_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_date DATE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  successful_return_count INTEGER NOT NULL DEFAULT 0,
  successful_user_count INTEGER NOT NULL DEFAULT 0,
  successful_device_count INTEGER NOT NULL DEFAULT 0,
  total_usage_minutes INTEGER NOT NULL DEFAULT 0,
  overdue_return_count INTEGER NOT NULL DEFAULT 0,
  records JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_date, timezone)
);

CREATE INDEX IF NOT EXISTS idx_priority_usage_archives_period
  ON priority_usage_archives(period_date DESC, timezone);
