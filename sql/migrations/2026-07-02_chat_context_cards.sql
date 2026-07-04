-- Chat business-context cards.
-- Stores lightweight metadata so messages can carry device, reservation, fault, and user-request context.

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS related_type TEXT,
  ADD COLUMN IF NOT EXISTS related_id TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_messages_related
  ON chat_messages(related_type, related_id);
