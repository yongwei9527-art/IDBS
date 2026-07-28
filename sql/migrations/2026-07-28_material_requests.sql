-- Structured user-submitted material checklist requests.
CREATE TABLE IF NOT EXISTS material_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  unit TEXT NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','fulfilled','cancelled')),
  admin_note TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  fulfilled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fulfilled_at IS NULL OR status = 'fulfilled')
);

CREATE INDEX IF NOT EXISTS idx_material_requests_user_time ON material_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_requests_status_time ON material_requests(status, created_at DESC);
ALTER TABLE material_requests DISABLE ROW LEVEL SECURITY;
