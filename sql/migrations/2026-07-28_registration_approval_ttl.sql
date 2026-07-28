INSERT INTO system_configs (config_key, config_value, description)
VALUES ('registration_approval_code_ttl_minutes', '5', 'Registration approval code validity in minutes')
ON CONFLICT (config_key) DO NOTHING;
