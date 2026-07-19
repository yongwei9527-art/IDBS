-- Temporary group chats (except 实验管理总群) auto-dissolve after 2 days.
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dissolve_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_expires_at
  ON chat_conversations (expires_at)
  WHERE expires_at IS NOT NULL;

-- Existing non-system groups: start 2-day countdown from creation time.
UPDATE chat_conversations
SET expires_at = created_at + interval '2 days',
    retention_days = COALESCE(retention_days, 2)
WHERE type = 'group'
  AND COALESCE(is_system, false) = false
  AND (system_key IS NULL OR system_key <> 'lab_management')
  AND expires_at IS NULL;

-- Management group never expires.
UPDATE chat_conversations
SET expires_at = NULL,
    dissolve_notified_at = NULL
WHERE system_key = 'lab_management' OR (is_system = true AND title = '实验管理总群');
