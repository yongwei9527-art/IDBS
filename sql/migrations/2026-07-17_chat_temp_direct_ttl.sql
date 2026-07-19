-- Temporary direct chats also auto-end after 2 days (except 实验管理总群).
UPDATE chat_conversations
SET expires_at = created_at + interval '2 days',
    retention_days = COALESCE(retention_days, 2)
WHERE type = 'direct'
  AND COALESCE(is_system, false) = false
  AND expires_at IS NULL;

UPDATE chat_conversations
SET expires_at = NULL,
    dissolve_notified_at = NULL
WHERE system_key = 'lab_management'
   OR (is_system = true AND title = '实验管理总群');
