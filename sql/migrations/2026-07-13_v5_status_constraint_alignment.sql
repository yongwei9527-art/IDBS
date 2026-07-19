-- Align persisted status constraints with the V5 cancellation and return workflows.
ALTER TABLE reservation_items
  DROP CONSTRAINT IF EXISTS reservation_items_status_check;

ALTER TABLE reservation_items
  ADD CONSTRAINT reservation_items_status_check
  CHECK (status IN (
    'pending',
    'approved',
    'rejected',
    'cancel_requested',
    'cancelled',
    'in_use',
    'completed',
    'no_show',
    'faulted'
  ));

ALTER TABLE borrow_records
  DROP CONSTRAINT IF EXISTS borrow_records_status_check;

ALTER TABLE borrow_records
  ADD CONSTRAINT borrow_records_status_check
  CHECK (status IN (
    'in_use',
    'return_pending',
    'returned',
    'abnormal_pending',
    'overdue'
  ));
