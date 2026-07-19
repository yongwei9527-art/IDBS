-- User supplement workflow for abnormal return handover records.
ALTER TABLE borrow_records
  ADD COLUMN IF NOT EXISTS return_material_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS return_material_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_supplement_note TEXT,
  ADD COLUMN IF NOT EXISTS return_supplement_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS return_supplemented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_material_late BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_borrow_records_material_deadline
  ON borrow_records(return_material_deadline)
  WHERE return_material_required = TRUE AND return_supplemented_at IS NULL;
