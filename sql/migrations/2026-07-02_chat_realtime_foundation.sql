-- Chat realtime and rich-message foundation.
-- Additive and idempotent so upgraded databases can safely receive the first realtime release.

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_message_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS chat_message_reads (
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_client_message
  ON chat_messages(sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id_time
  ON chat_messages(conversation_id, id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_message_reads_user_time
  ON chat_message_reads(user_id, read_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_notifications_related
  ON user_notifications(related_type, related_id);

ALTER TABLE chat_conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_reads DISABLE ROW LEVEL SECURITY;
