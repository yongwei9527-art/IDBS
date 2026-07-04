CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'direct',
  title TEXT,
  system_key TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  retention_days INTEGER,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ
);

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS system_key TEXT,
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS retention_days INTEGER;

CREATE TABLE IF NOT EXISTS chat_participants (
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_participants_user_time ON chat_participants(user_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_time ON chat_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_last_message ON chat_conversations(last_message_at DESC NULLS LAST, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_system_key ON chat_conversations(system_key) WHERE system_key IS NOT NULL;

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

ALTER TABLE chat_conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;
