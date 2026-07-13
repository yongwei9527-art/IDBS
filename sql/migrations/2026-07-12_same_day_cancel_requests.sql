-- Same-day cancellation stays occupied until a reservation approver explicitly reviews it.
ALTER TABLE reservation_items ADD COLUMN IF NOT EXISTS cancel_previous_status TEXT;
ALTER TABLE reservation_items ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;
ALTER TABLE reservation_items ADD COLUMN IF NOT EXISTS cancel_request_note TEXT;
ALTER TABLE reservation_items ADD COLUMN IF NOT EXISTS cancel_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reservation_items ADD COLUMN IF NOT EXISTS cancel_reviewed_at TIMESTAMPTZ;
ALTER TABLE reservation_items ADD COLUMN IF NOT EXISTS cancel_review_note TEXT;
CREATE INDEX IF NOT EXISTS idx_reservation_items_cancel_requested ON reservation_items(status, cancel_requested_at DESC) WHERE status = 'cancel_requested';
