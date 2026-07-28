BEGIN;

ALTER TABLE borrow_records
  ADD COLUMN IF NOT EXISTS return_photo_metadata JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS return_supplement_photo_metadata JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN borrow_records.return_photo_metadata IS
  'Return photo metadata: server id, URL, original filename, abnormal flag, submission time and retention deadline.';
COMMENT ON COLUMN borrow_records.return_supplement_photo_metadata IS
  'Supplemental return photo metadata with the same retention contract.';

COMMIT;