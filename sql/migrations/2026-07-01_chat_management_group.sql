ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS system_key TEXT,
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS retention_days INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_system_key
  ON chat_conversations(system_key)
  WHERE system_key IS NOT NULL;

INSERT INTO chat_conversations (type, title, system_key, is_system, retention_days, created_at, updated_at)
VALUES ('group', '实验管理总群', 'lab_management', TRUE, 7, now(), now())
ON CONFLICT (system_key) WHERE system_key IS NOT NULL DO UPDATE SET
  title = EXCLUDED.title,
  is_system = TRUE,
  retention_days = EXCLUDED.retention_days,
  updated_at = now();

INSERT INTO chat_participants (conversation_id, user_id, role, joined_at)
SELECT c.id,
       u.id,
       CASE WHEN u.role IN ('super_admin','admin') THEN 'admin' ELSE 'member' END,
       now()
FROM chat_conversations c
JOIN users u ON u.status = 'active' AND coalesce(u.is_banned, false) = false
WHERE c.system_key = 'lab_management'
ON CONFLICT (conversation_id, user_id) DO UPDATE SET
  role = CASE WHEN EXCLUDED.role = 'admin' THEN 'admin' ELSE chat_participants.role END;

DELETE FROM chat_messages
WHERE conversation_id IN (
  SELECT id FROM chat_conversations WHERE system_key = 'lab_management'
)
AND created_at < now() - interval '7 days';
