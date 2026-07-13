-- Align user request lifecycle statuses with the service contract.
ALTER TABLE user_requests DROP CONSTRAINT IF EXISTS user_requests_status_check;
ALTER TABLE user_requests ADD CONSTRAINT user_requests_status_check
  CHECK (status IN ('pending','confirmed','rejected','closed','cancelled','change_requested'));
