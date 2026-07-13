-- IDBS 5.0 root-authority reconciliation.
-- Existing deployments may have used an administrator with a legacy wildcard permission
-- before the dedicated super_admin role existed. Promote one deterministic root and
-- remove wildcard authority from every ordinary administrator.
BEGIN;

WITH root_candidate AS (
  SELECT u.id
  FROM users u
  LEFT JOIN admin_roles ar ON ar.user_id = u.id
  WHERE u.role IN ('super_admin', 'admin')
    AND u.status = 'active'
    AND coalesce(u.is_banned, false) = false
  ORDER BY
    CASE
      WHEN u.role = 'super_admin' THEN 0
      WHEN coalesce(ar.permissions, '[]'::jsonb) ? '*' THEN 1
      ELSE 2
    END,
    u.created_at ASC,
    u.id ASC
  LIMIT 1
)
UPDATE users u
SET role = CASE WHEN u.id = (SELECT id FROM root_candidate) THEN 'super_admin' ELSE 'admin' END,
    updated_at = now()
WHERE u.role = 'super_admin'
   OR u.id = (SELECT id FROM root_candidate);

UPDATE admin_roles ar
SET role_key = CASE WHEN u.role = 'super_admin' THEN 'super_admin' ELSE 'admin' END,
    permissions = CASE
      WHEN u.role = 'super_admin' THEN '["*"]'::jsonb
      WHEN coalesce(ar.permissions, '[]'::jsonb) ? '*' THEN '[]'::jsonb
      ELSE ar.permissions
    END,
    updated_at = now()
FROM users u
WHERE ar.user_id = u.id
  AND u.role IN ('super_admin', 'admin')
  AND (
    ar.role_key = 'super_admin'
    OR u.role = 'super_admin'
    OR coalesce(ar.permissions, '[]'::jsonb) ? '*'
  );

COMMIT;