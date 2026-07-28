-- Shorten temporary direct and group conversation retention from two days to one day.
-- The laboratory management system conversation remains exempt.
UPDATE chat_conversations
SET retention_days = 1,
    expires_at = LEAST(
      COALESCE(expires_at, created_at + interval '1 day'),
      created_at + interval '1 day'
    ),
    dissolve_notified_at = CASE
      WHEN COALESCE(expires_at, created_at + interval '1 day') > created_at + interval '1 day' THEN NULL
      ELSE dissolve_notified_at
    END
WHERE COALESCE(is_system, false) = false
  AND type IN ('direct', 'group')
  AND (system_key IS NULL OR system_key <> 'lab_management');

-- Management group is a durable system channel and must never be shortened.
UPDATE chat_conversations
SET expires_at = NULL,
    dissolve_notified_at = NULL
WHERE system_key = 'lab_management'
   OR (COALESCE(is_system, false) = true AND title = '??????');
