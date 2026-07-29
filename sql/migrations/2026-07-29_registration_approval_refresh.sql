INSERT INTO system_configs (config_key, config_value, description)
VALUES
  ('registration_approval_code_ttl_minutes', '1', 'Registration approval code validity in minutes'),
  ('registration_approval_code_generation', '0', 'Registration approval code manual rotation generation')
ON CONFLICT (config_key) DO NOTHING;

-- The previous release hard-coded five minutes. Move untouched/default installations
-- to the new one-minute default; administrators can change it later in User Management.
UPDATE system_configs
SET config_value = '1', updated_at = now()
WHERE config_key = 'registration_approval_code_ttl_minutes' AND config_value = '5';