CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_phone TEXT NOT NULL,
  submitted_name TEXT NOT NULL,
  submitted_student_no TEXT NOT NULL,
  submitted_major TEXT,
  submitted_mentor_name TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count >= 1),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_requests_pending_user ON password_reset_requests(user_id) WHERE status = 'pending' AND user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status_time ON password_reset_requests(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_pending_expiry ON password_reset_requests(expires_at) WHERE status = 'pending';
