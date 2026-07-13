-- IDBS 5.0 communication and authority policy.
-- Keep exactly one root administrator, and make it impossible to retain legacy peer-to-peer chats.
BEGIN;

WITH ranked_roots AS (
  SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS position
  FROM users
  WHERE role = 'super_admin'
)
UPDATE users u
SET role = 'admin', updated_at = now()
FROM ranked_roots r
WHERE u.id = r.id AND r.position > 1;

UPDATE admin_roles ar
SET role_key = 'admin', permissions = '[]'::jsonb, updated_at = now()
FROM users u
WHERE ar.user_id = u.id
  AND ar.role_key = 'super_admin'
  AND u.role <> 'super_admin';

CREATE UNIQUE INDEX IF NOT EXISTS users_single_super_admin_idx
  ON users ((role))
  WHERE role = 'super_admin';

COMMIT;