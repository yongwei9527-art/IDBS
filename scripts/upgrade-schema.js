const { Pool } = require('pg');
const { postgresSslOptions } = require('../src/lib/postgres-ssl');
require('dotenv').config({ quiet: true });

const connectionString = process.env.DATABASE_URL || '';

const REQUIRED_EXTENSIONS = [
  { label: 'extension pgcrypto', sql: 'create extension if not exists pgcrypto' },
  { label: 'extension btree_gist', sql: 'create extension if not exists btree_gist' }
];

const REQUIRED_TABLES = [
  {
    name: 'device_time_slots',
    sql: `create table if not exists device_time_slots (
      id uuid primary key default gen_random_uuid(),
      device_id uuid not null references devices(id) on delete cascade,
      slot_key text not null,
      label text not null,
      start_time time not null,
      end_time time not null,
      crosses_day boolean not null default false,
      sort_order integer not null default 0,
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(device_id, slot_key)
    )`
  },
  {
    name: 'reservation_items',
    sql: `create table if not exists reservation_items (
      id uuid primary key default gen_random_uuid(),
      batch_id uuid not null references reservation_batches(id) on delete cascade,
      device_id uuid not null references devices(id) on delete cascade,
      user_id uuid not null references users(id) on delete cascade,
      reservation_date date not null,
      slot_key text not null default 'custom',
      start_time timestamptz not null,
      end_time timestamptz not null,
      status text not null default 'pending',
      admin_note text,
      approved_by uuid references users(id) on delete set null,
      approved_at timestamptz,
      reservation_id uuid references reservations(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (end_time > start_time)
    )`
  },
  {
    name: 'user_requests',
    sql: `create table if not exists user_requests (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      device_id uuid references devices(id) on delete set null,
      category text not null default 'feature',
      title text not null,
      description text not null,
      priority text not null default 'normal',
      status text not null default 'pending',
      admin_note text,
      change_request_note text,
      confirmed_by uuid references users(id) on delete set null,
      confirmed_at timestamptz,
      locked_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`
  },
  {
    name: 'user_notifications',
    sql: `create table if not exists user_notifications (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      type text not null default 'system',
      title text not null,
      content text not null,
      related_type text,
      related_id uuid,
      device_id uuid references devices(id) on delete set null,
      reservation_id uuid references reservations(id) on delete set null,
      is_read boolean not null default false,
      created_at timestamptz not null default now(),
      read_at timestamptz
    )`
  },
  {
    name: 'permissions',
    sql: `create table if not exists permissions (
      permission_key text primary key,
      name text not null,
      description text,
      group_name text not null,
      sort_order integer not null default 0
    )`
  },
  {
    name: 'roles',
    sql: `create table if not exists roles (
      id uuid primary key default gen_random_uuid(),
      role_key text not null unique,
      role_name text not null,
      description text,
      is_system boolean not null default false,
      created_at timestamptz not null default now()
    )`
  },
  {
    name: 'role_permissions',
    sql: `create table if not exists role_permissions (
      role_id uuid not null references roles(id) on delete cascade,
      permission_key text not null references permissions(permission_key) on delete cascade,
      primary key(role_id, permission_key)
    )`
  },
  {
    name: 'user_roles',
    sql: `create table if not exists user_roles (
      user_id uuid not null references users(id) on delete cascade,
      role_id uuid not null references roles(id) on delete cascade,
      granted_by uuid references users(id) on delete set null,
      granted_at timestamptz not null default now(),
      primary key(user_id, role_id)
    )`
  },
  {
    name: 'chat_conversations',
    sql: `create table if not exists chat_conversations (
      id uuid primary key default gen_random_uuid(),
      type text not null default 'direct',
      title text,
      created_by uuid references users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_message_at timestamptz
    )`
  },
  {
    name: 'chat_participants',
    sql: `create table if not exists chat_participants (
      conversation_id uuid not null references chat_conversations(id) on delete cascade,
      user_id uuid not null references users(id) on delete cascade,
      role text not null default 'member',
      joined_at timestamptz not null default now(),
      last_read_at timestamptz,
      primary key (conversation_id, user_id)
    )`
  },
  {
    name: 'chat_messages',
    sql: `create table if not exists chat_messages (
      id uuid primary key default gen_random_uuid(),
      conversation_id uuid not null references chat_conversations(id) on delete cascade,
      sender_id uuid references users(id) on delete set null,
      message_type text not null default 'text',
      content text not null,
      attachments jsonb not null default '[]'::jsonb,
      metadata jsonb not null default '{}'::jsonb,
      related_type text,
      related_id text,
      reply_to_message_id uuid references chat_messages(id) on delete set null,
      client_message_id text,
      delivery_status text not null default 'sent',
      edited_at timestamptz,
      recalled_at timestamptz,
      created_at timestamptz not null default now()
    )`
  },
  {
    name: 'chat_message_reads',
    sql: `create table if not exists chat_message_reads (
      message_id uuid not null references chat_messages(id) on delete cascade,
      user_id uuid not null references users(id) on delete cascade,
      read_at timestamptz not null default now(),
      primary key (message_id, user_id)
    )`
  },
  {
    name: 'audit_logs',
    sql: `create table if not exists audit_logs (
      id uuid primary key default gen_random_uuid(),
      actor_id uuid references users(id) on delete set null,
      actor_name text,
      action text not null,
      target_type text,
      target_id uuid,
      detail jsonb not null default '{}'::jsonb,
      ip_address text,
      user_agent text,
      request_id text,
      created_at timestamptz not null default now()
    )`
  },
  {
    name: 'user_wechat_bindings',
    sql: `create table if not exists user_wechat_bindings (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      openid text not null,
      unionid text,
      app_id text,
      nickname text,
      bound_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(openid, app_id)
    )`
  },
  {
    name: 'export_jobs',
    sql: `create table if not exists export_jobs (
      id uuid primary key default gen_random_uuid(),
      type text not null,
      params jsonb not null default '{}'::jsonb,
      status text not null default 'pending',
      attempt_count integer not null default 0,
      max_attempts integer not null default 3,
      available_at timestamptz,
      worker_id text,
      lease_token uuid,
      lease_expires_at timestamptz,
      row_count integer not null default 0,
      file_path text,
      error_message text,
      created_by uuid references users(id) on delete set null,
      created_at timestamptz not null default now(),
      started_at timestamptz,
      finished_at timestamptz
    )`
  },
  {
    name: 'intelligence_action_logs',
    sql: `create table if not exists intelligence_action_logs (
      id uuid primary key default gen_random_uuid(),
      action_id text not null,
      action_type text,
      action_title text,
      status text not null default 'open',
      note text,
      assigned_to uuid references users(id) on delete set null,
      handled_by uuid references users(id) on delete set null,
      handled_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (status in ('open','done','ignored','delegated'))
    )`
  },
  {
    name: 'refresh_token_sessions',
    sql: `create table if not exists refresh_token_sessions (
      jti uuid primary key,
      subject text not null,
      token_hash text not null,
      expires_at timestamptz not null,
      user_agent text,
      ip_address text,
      revoked_at timestamptz,
      replaced_by uuid,
      created_at timestamptz not null default now()
    )`
  },
  {
    name: 'scheduled_job_runs',
    sql: `create table if not exists scheduled_job_runs (
      job_key text primary key,
      job_name text not null,
      scheduled_for timestamptz not null,
      status text not null default 'running',
      instance_id text,
      error_message text,
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      check (status in ('running','success','failed'))
    )`
  },
  {
    name: 'rate_limit_buckets',
    sql: `create table if not exists rate_limit_buckets (
      bucket_key text not null,
      window_start timestamptz not null,
      count integer not null default 1,
      expires_at timestamptz not null,
      primary key (bucket_key, window_start)
    )`
  },
  {
    name: 'device_maintenance_plans',
    sql: `create table if not exists device_maintenance_plans (id uuid primary key default gen_random_uuid(), device_id uuid not null references devices(id) on delete cascade, title text not null, maintenance_type text not null default 'inspection', interval_days integer not null default 0 check (interval_days >= 0), next_due_at timestamptz, last_completed_at timestamptz, status text not null default 'active' check (status in ('active','paused','archived')), notes text, created_by uuid references users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`
  },
  {
    name: 'device_maintenance_windows',
    sql: `create table if not exists device_maintenance_windows (id uuid primary key default gen_random_uuid(), device_id uuid not null references devices(id) on delete cascade, plan_id uuid references device_maintenance_plans(id) on delete set null, title text not null, start_time timestamptz not null, end_time timestamptz not null, status text not null default 'scheduled' check (status in ('scheduled','active','completed','cancelled')), created_by uuid references users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (end_time > start_time))`
  },
  {
    name: 'device_maintenance_work_orders',
    sql: `create table if not exists device_maintenance_work_orders (id uuid primary key default gen_random_uuid(), device_id uuid not null references devices(id) on delete cascade, plan_id uuid references device_maintenance_plans(id) on delete set null, maintenance_window_id uuid references device_maintenance_windows(id) on delete set null, fault_report_id uuid references device_fault_reports(id) on delete set null, title text not null, maintenance_type text not null default 'inspection', status text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled')), assigned_to uuid references users(id) on delete set null, description text, result_note text, window_start timestamptz, window_end timestamptz, started_at timestamptz, completed_at timestamptz, created_by uuid references users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (window_end is null or window_start is null or window_end > window_start))`
  },
];

const REQUIRED_INDEXES = [
  { table: 'device_maintenance_plans', label: 'idx_maintenance_plans_due', sql: 'create index if not exists idx_maintenance_plans_due on device_maintenance_plans(status, next_due_at)' },
  { table: 'device_maintenance_windows', label: 'idx_maintenance_windows_device_time', sql: "create index if not exists idx_maintenance_windows_device_time on device_maintenance_windows(device_id, start_time, end_time) where status in ('scheduled','active')" },
  { table: 'device_maintenance_windows', label: 'idx_maintenance_windows_lifecycle', sql: "create index if not exists idx_maintenance_windows_lifecycle on device_maintenance_windows(status, start_time, end_time) where status in ('scheduled','active')" },
  { table: 'device_maintenance_work_orders', label: 'idx_maintenance_work_orders_status_time', sql: 'create index if not exists idx_maintenance_work_orders_status_time on device_maintenance_work_orders(status, window_start desc)' },
  {
    table: 'refresh_token_sessions',
    label: 'idx_refresh_token_sessions_subject',
    sql: 'create index if not exists idx_refresh_token_sessions_subject on refresh_token_sessions(subject, created_at desc)'
  },
  {
    table: 'refresh_token_sessions',
    label: 'idx_refresh_token_sessions_expiry',
    sql: 'create index if not exists idx_refresh_token_sessions_expiry on refresh_token_sessions(expires_at) where revoked_at is null'
  },
  {
    table: 'scheduled_job_runs',
    label: 'idx_scheduled_job_runs_name_time',
    sql: 'create index if not exists idx_scheduled_job_runs_name_time on scheduled_job_runs(job_name, scheduled_for desc)'
  },
  {
    table: 'rate_limit_buckets',
    label: 'idx_rate_limit_buckets_expiry',
    sql: 'create index if not exists idx_rate_limit_buckets_expiry on rate_limit_buckets(expires_at)'
  },
  {
    table: 'audit_logs',
    label: 'idx_audit_logs_actor_time',
    sql: 'create index if not exists idx_audit_logs_actor_time on audit_logs(actor_id, created_at desc)'
  },
  {
    table: 'audit_logs',
    label: 'idx_audit_logs_action_time',
    sql: 'create index if not exists idx_audit_logs_action_time on audit_logs(action, created_at desc)'
  },
  {
    table: 'audit_logs',
    label: 'idx_audit_logs_target',
    sql: 'create index if not exists idx_audit_logs_target on audit_logs(target_type, target_id)'
  },
  {
    table: 'user_wechat_bindings',
    label: 'idx_user_wechat_bindings_user',
    sql: 'create index if not exists idx_user_wechat_bindings_user on user_wechat_bindings(user_id)'
  },
  {
    table: 'user_wechat_bindings',
    label: 'idx_user_wechat_bindings_unionid',
    sql: 'create index if not exists idx_user_wechat_bindings_unionid on user_wechat_bindings(unionid) where unionid is not null'
  },
  {
    table: 'device_time_slots',
    label: 'idx_device_time_slots_device',
    sql: 'create index if not exists idx_device_time_slots_device on device_time_slots(device_id, enabled, sort_order)'
  },
  {
    table: 'reservation_items',
    label: 'idx_reservation_items_batch',
    sql: 'create index if not exists idx_reservation_items_batch on reservation_items(batch_id, created_at desc)'
  },
  {
    table: 'reservation_items',
    label: 'idx_reservation_items_user_time',
    sql: 'create index if not exists idx_reservation_items_user_time on reservation_items(user_id, start_time desc)'
  },
  {
    table: 'reservation_items',
    label: 'idx_reservation_items_device_time',
    sql: 'create index if not exists idx_reservation_items_device_time on reservation_items(device_id, start_time, end_time)'
  },
  {
    table: 'reservation_items',
    label: 'idx_reservation_items_pending_time',
    sql: "create index if not exists idx_reservation_items_pending_time on reservation_items(start_time, created_at desc) where status = 'pending'"
  },
  {
    table: 'borrow_records',
    label: 'idx_borrow_records_active_due',
    sql: "create index if not exists idx_borrow_records_active_due on borrow_records(expected_return_time) where status = 'in_use'"
  },
  {
    table: 'borrow_records',
    label: 'idx_borrow_records_material_deadline',
    sql: 'create index if not exists idx_borrow_records_material_deadline on borrow_records(return_material_deadline) where return_material_required = true and return_supplemented_at is null'
  },
  {
    table: 'users',
    label: 'idx_users_pending_active',
    sql: "create index if not exists idx_users_pending_active on users(created_at desc) where status = 'pending' and coalesce(is_banned, false) = false"
  },
  {
    table: 'user_requests',
    label: 'idx_user_requests_user_time',
    sql: 'create index if not exists idx_user_requests_user_time on user_requests(user_id, created_at desc)'
  },
  {
    table: 'user_requests',
    label: 'idx_user_requests_status_time',
    sql: 'create index if not exists idx_user_requests_status_time on user_requests(status, created_at desc)'
  },
  {
    table: 'user_notifications',
    label: 'idx_user_notifications_user_time',
    sql: 'create index if not exists idx_user_notifications_user_time on user_notifications(user_id, created_at desc)'
  },
  {
    table: 'user_notifications',
    label: 'idx_user_notifications_unread',
    sql: 'create index if not exists idx_user_notifications_unread on user_notifications(user_id, is_read, created_at desc)'
  },
  {
    table: 'chat_participants',
    label: 'idx_chat_participants_user_time',
    sql: 'create index if not exists idx_chat_participants_user_time on chat_participants(user_id, joined_at desc)'
  },
  {
    table: 'chat_messages',
    label: 'idx_chat_messages_conversation_time',
    sql: 'create index if not exists idx_chat_messages_conversation_time on chat_messages(conversation_id, created_at desc)'
  },
  {
    table: 'chat_conversations',
    label: 'idx_chat_conversations_last_message',
    sql: 'create index if not exists idx_chat_conversations_last_message on chat_conversations(last_message_at desc nulls last, updated_at desc)'
  },
  {
    table: 'intelligence_action_logs',
    label: 'idx_intelligence_action_logs_action_time',
    sql: 'create index if not exists idx_intelligence_action_logs_action_time on intelligence_action_logs(action_id, updated_at desc, created_at desc)'
  },
  {
    table: 'intelligence_action_logs',
    label: 'idx_intelligence_action_logs_status_time',
    sql: 'create index if not exists idx_intelligence_action_logs_status_time on intelligence_action_logs(status, updated_at desc)'
  },
  {
    table: 'export_jobs',
    label: 'idx_export_jobs_worker_queue',
    sql: 'create index if not exists idx_export_jobs_worker_queue on export_jobs(status, available_at, created_at)'
  },
  {
    table: 'export_jobs',
    label: 'idx_export_jobs_expired_files',
    sql: "create index if not exists idx_export_jobs_expired_files on export_jobs(finished_at) where status = 'finished' and file_path is not null"  }
];

const REQUIRED_COLUMNS = [
  { table: 'users', column: 'deleted_at', definition: "timestamptz" },
  { table: 'devices', column: 'deleted_at', definition: "timestamptz" },
  { table: 'devices', column: 'created_by', definition: "uuid references users(id) on delete set null" },
  { table: 'devices', column: 'updated_by', definition: "uuid references users(id) on delete set null" },
  { table: 'reservations', column: 'deleted_at', definition: "timestamptz" },
  { table: 'reservations', column: 'created_by', definition: "uuid references users(id) on delete set null" },
  { table: 'reservations', column: 'updated_by', definition: "uuid references users(id) on delete set null" },
  { table: 'reservation_items', column: 'deleted_at', definition: "timestamptz" },
  { table: 'reservation_items', column: 'created_by', definition: "uuid references users(id) on delete set null" },
  { table: 'reservation_items', column: 'updated_by', definition: "uuid references users(id) on delete set null" },
  { table: 'reservation_batches', column: 'deleted_at', definition: "timestamptz" },
  { table: 'reservation_batches', column: 'updated_by', definition: "uuid references users(id) on delete set null" },
  { table: 'borrow_records', column: 'deleted_at', definition: "timestamptz" },
  { table: 'borrow_records', column: 'updated_by', definition: "uuid references users(id) on delete set null" },
  { table: 'device_fault_reports', column: 'deleted_at', definition: "timestamptz" },
  { table: 'device_fault_reports', column: 'updated_by', definition: "uuid references users(id) on delete set null" },
  { table: 'user_requests', column: 'deleted_at', definition: "timestamptz" },
  { table: 'user_requests', column: 'updated_by', definition: "uuid references users(id) on delete set null" },
  { table: 'device_time_slots', column: 'capacity', definition: "integer not null default 1" },
  { table: 'user_notifications', column: 'action_url', definition: "text" },
  { table: 'user_notifications', column: 'level', definition: "text not null default 'info'" },
  { table: 'chat_conversations', column: 'last_message_preview', definition: "text" },
  { table: 'chat_conversations', column: 'last_message_type', definition: "text" },
  { table: 'users', column: 'avatar_url', definition: 'text' },
  { table: 'users', column: 'department', definition: 'text' },
  { table: 'users', column: 'last_active_at', definition: 'timestamptz' },
  { table: 'users', column: 'disabled_reason', definition: 'text' },
  { table: 'users', column: 'approved_by', definition: 'uuid references users(id) on delete set null' },
  { table: 'users', column: 'approved_at', definition: 'timestamptz' },
  { table: 'operation_logs', column: 'target_type', definition: 'text' },
  { table: 'operation_logs', column: 'target_id', definition: 'uuid' },
  { table: 'operation_logs', column: 'ip_address', definition: 'text' },
  { table: 'export_jobs', column: 'type', definition: 'text not null default \'usage\'' },
  { table: 'export_jobs', column: 'params', definition: "jsonb not null default '{}'::jsonb" },
  { table: 'export_jobs', column: 'status', definition: "text not null default 'pending'" },
  { table: 'export_jobs', column: 'attempt_count', definition: 'integer not null default 0' },
  { table: 'export_jobs', column: 'max_attempts', definition: 'integer not null default 3' },
  { table: 'export_jobs', column: 'available_at', definition: 'timestamptz' },
  { table: 'export_jobs', column: 'worker_id', definition: 'text' },
  { table: 'export_jobs', column: 'lease_token', definition: 'uuid' },
  { table: 'export_jobs', column: 'lease_expires_at', definition: 'timestamptz' },
  { table: 'export_jobs', column: 'row_count', definition: 'integer not null default 0' },
  { table: 'export_jobs', column: 'file_path', definition: 'text' },
  { table: 'export_jobs', column: 'error_message', definition: 'text' },
  { table: 'export_jobs', column: 'created_by', definition: 'uuid references users(id) on delete set null' },
  { table: 'export_jobs', column: 'started_at', definition: 'timestamptz' },
  { table: 'export_jobs', column: 'finished_at', definition: 'timestamptz' },
  { table: 'chat_conversations', column: 'system_key', definition: 'text' },
  { table: 'chat_conversations', column: 'is_system', definition: 'boolean not null default false' },
  { table: 'chat_conversations', column: 'retention_days', definition: 'integer' },
  { table: 'chat_messages', column: 'message_type', definition: "text not null default 'text'" },
  { table: 'chat_messages', column: 'attachments', definition: "jsonb not null default '[]'::jsonb" },
  { table: 'chat_messages', column: 'metadata', definition: "jsonb not null default '{}'::jsonb" },
  { table: 'chat_messages', column: 'related_type', definition: 'text' },
  { table: 'chat_messages', column: 'related_id', definition: 'text' },
  { table: 'chat_messages', column: 'reply_to_message_id', definition: 'uuid references chat_messages(id) on delete set null' },
  { table: 'chat_messages', column: 'client_message_id', definition: 'text' },
  { table: 'chat_messages', column: 'delivery_status', definition: "text not null default 'sent'" },
  { table: 'chat_messages', column: 'edited_at', definition: 'timestamptz' },
  { table: 'chat_messages', column: 'recalled_at', definition: 'timestamptz' },
  { table: 'borrow_records', column: 'reservation_item_id', definition: 'uuid references reservation_items(id) on delete set null' },
  { table: 'borrow_records', column: 'actual_start_time', definition: 'timestamptz' },
  { table: 'borrow_records', column: 'actual_end_time', definition: 'timestamptz' },
  { table: 'borrow_records', column: 'return_archive_folder', definition: 'text' },
  { table: 'borrow_records', column: 'return_archive_photos', definition: "jsonb not null default '[]'::jsonb" },
  { table: 'borrow_records', column: 'return_material_required', definition: 'boolean not null default false' },
  { table: 'borrow_records', column: 'return_material_deadline', definition: 'timestamptz' },
  { table: 'borrow_records', column: 'return_supplement_note', definition: 'text' },
  { table: 'borrow_records', column: 'return_supplement_photos', definition: "jsonb not null default '[]'::jsonb" },
  { table: 'borrow_records', column: 'return_supplemented_at', definition: 'timestamptz' },
  { table: 'borrow_records', column: 'return_material_late', definition: 'boolean not null default false' },
  { table: 'devices', column: 'return_mode', definition: "text not null default 'image_required'" },
  { table: 'devices', column: 'return_require_note', definition: 'boolean not null default false' },
  { table: 'reservation_batches', column: 'submit_note', definition: 'text' },
  { table: 'reservation_batches', column: 'admin_note', definition: 'text' },
  { table: 'device_fault_reports', column: 'severity', definition: "text default 'normal'" },
  { table: 'device_fault_reports', column: 'handled_by', definition: 'uuid references users(id) on delete set null' },
  { table: 'device_fault_reports', column: 'handled_at', definition: 'timestamptz' },
  { table: 'device_fault_reports', column: 'reservation_item_id', definition: 'uuid references reservation_items(id) on delete set null' },
  { table: 'usage_log', column: 'reservation_item_id', definition: 'uuid references reservation_items(id) on delete set null' }
];

const OPTIONAL_DETAIL_UPGRADES = [
  {
    label: 'operation_logs.detail jsonb conversion',
    sql: "alter table operation_logs alter column detail type jsonb using case when detail is null then '{}'::jsonb else jsonb_build_object('message', detail::text) end"
  },
  {
    label: 'operation_logs.detail default',
    sql: "alter table operation_logs alter column detail set default '{}'::jsonb"
  }
];

const REQUIRED_STATEMENTS = [
  {
    label: 'remove deprecated admin password seed',
    sql: "delete from system_configs where config_key = 'admin_default_password_seed'"
  },
  {
    label: 'seed v3 runtime configs',
    sql: "insert into system_configs (config_key, config_value, description)\n      values\n        ('jwt_access_ttl_minutes', '15', 'Access token validity in minutes'),\n        ('jwt_refresh_ttl_days', '7', 'Refresh token validity in days'),\n        ('v3_feature_chat_ws_enabled', '1', 'Whether chat over WebSocket is enabled in v3'),\n        ('v3_feature_notifications_ws_enabled', '1', 'Whether realtime notifications over WebSocket is enabled in v3'),\n        ('overdue_auto_mark_enabled', '1', 'Whether to auto-mark overdue borrow records'),\n        ('overdue_check_cron', '*/15 * * * *', 'Cron for overdue scan'),\n        ('schema_v3_applied_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), 'IDBS schema baseline applied timestamp'),\n        ('schema_v5_applied_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), 'IDBS 5.0 release baseline applied timestamp')\n      on conflict (config_key) do update set\n        config_value = case when system_configs.config_key in ('schema_v3_applied_at', 'schema_v5_applied_at') then excluded.config_value else system_configs.config_value end,\n        updated_at = now()"
  },
  {
    label: 'seed device time slots',
    sql: `insert into device_time_slots (device_id, slot_key, label, start_time, end_time, crosses_day, sort_order)
      select d.id, slot.slot_key, slot.label, slot.start_time::time, slot.end_time::time, slot.crosses_day, slot.sort_order
      from devices d
      cross join (values
        ('morning', '上午 8:00-12:00', '08:00', '12:00', false, 10),
        ('afternoon', '下午 12:00-17:00', '12:00', '17:00', false, 20),
        ('evening', '傍晚 17:00-22:00', '17:00', '22:00', false, 30),
        ('night', '夜间 22:00-次日 8:00', '22:00', '08:00', true, 40),
        ('daytime', '白天 8:00-22:00', '08:00', '22:00', false, 50)
      ) as slot(slot_key, label, start_time, end_time, crosses_day, sort_order)
      on conflict (device_id, slot_key) do nothing`
  },
  {
    label: 'chat conversations system key index',
    sql: 'create unique index if not exists idx_chat_conversations_system_key on chat_conversations(system_key) where system_key is not null'
  },
  {
    label: 'seed management chat group',
    sql: `insert into chat_conversations (type, title, system_key, is_system, retention_days, created_at, updated_at)
      values ('group', '实验室管理群', 'lab_management', true, 90, now(), now())
      on conflict (system_key) where system_key is not null do update set
        title = excluded.title,
        is_system = true,
        retention_days = excluded.retention_days,
        updated_at = excluded.updated_at`
  },
  {
    label: 'backfill reservation items',
    sql: `insert into reservation_items (id, batch_id, device_id, user_id, reservation_date, slot_key, start_time, end_time, status, admin_note, approved_at, reservation_id, created_at, updated_at)
      select gen_random_uuid(), r.batch_id, r.device_id, r.user_id, (r.start_time at time zone 'Asia/Shanghai')::date, 'custom', r.start_time, r.end_time, r.status, r.admin_note, r.approved_at, r.id, r.created_at, r.updated_at
      from reservations r
      where r.batch_id is not null
        and not exists (select 1 from reservation_items ri where ri.reservation_id = r.id)`
  },
  {
    label: 'reservation_items no overlap constraint',
    sql: `do $$
      begin
        if not exists (select 1 from pg_constraint where conname = 'reservation_items_no_overlap_active') then
          alter table reservation_items
            add constraint reservation_items_no_overlap_active
            exclude using gist (
              device_id with =,
              tstzrange(start_time, end_time, '[)') with &&
            )
            where (status in ('pending','approved','in_use'));
        end if;
      end$$`
  },
  {
    label: 'migrate legacy ops administrators to duty_admin',
    sql: `do $
      begin
        if to_regclass('public.admin_roles') is not null then
          update admin_roles
          set role_key = 'duty_admin', updated_at = now()
          where role_key = 'ops';
        end if;
        if to_regclass('public.roles') is not null and to_regclass('public.user_roles') is not null then
          insert into roles (role_key, role_name, description, is_system)
          values ('duty_admin', 'Duty administrator', 'Reservation, return and fault handling', true)
          on conflict (role_key) do update set role_name = excluded.role_name, description = excluded.description, is_system = excluded.is_system;
          insert into user_roles (user_id, role_id, granted_by, granted_at)
          select ur.user_id, duty.id, ur.granted_by, ur.granted_at
          from user_roles ur
          join roles legacy on legacy.id = ur.role_id and legacy.role_key = 'ops'
          join roles duty on duty.role_key = 'duty_admin'
          on conflict do nothing;
          delete from user_roles using roles legacy where user_roles.role_id = legacy.id and legacy.role_key = 'ops';
          delete from roles where role_key = 'ops';
        end if;
      end$`
  },
  {
    label: 'seed permissions',
    sql: `insert into permissions (permission_key, name, description, group_name, sort_order)
      values
        ('user.approve', 'Approve user registration', 'Review new user registration requests', 'Users', 10),
        ('user.manage', 'Manage users', 'Search, disable, restore and unbind users', 'Users', 20),
        ('reservation.view', 'View reservations', 'View reservation and calendar data', 'Reservations', 30),
        ('reservation.approve', 'Approve reservations', 'Approve reservation batches and items', 'Reservations', 40),
        ('reservation.change_plan', 'Change reservation plan', 'Modify reservation time and slot', 'Reservations', 45),
        ('return.view', 'View return records', 'View return status and archive data', 'Returns', 46),
        ('return.confirm', 'Confirm returns', 'Confirm or record device returns', 'Returns', 47),
        ('return.image_review', 'Review return images', 'Review return image evidence', 'Returns', 48),
        ('return.export', 'Export return archives', 'Export return records and archives', 'Returns', 49),
        ('device.view', 'View devices', 'View device inventory and status', 'Devices', 50),
        ('device.manage', 'Manage devices', 'Create, edit and maintain devices', 'Devices', 60),
        ('fault.manage', 'Manage fault reports', 'Process device fault reports', 'Faults', 70),
        ('stats.view', 'View analytics', 'View analytics and reports', 'Analytics', 80),
        ('stats.export', 'Export analytics', 'Export analytics data', 'Analytics', 90),
        ('system.config', 'System configuration', 'Manage system configuration', 'System', 100),
        ('admin.manage', 'Manage administrators', 'Grant or revoke administrator permissions', 'System', 110),
        ('audit.view', 'View operation logs', 'View administrator operation logs', 'System', 120)
      on conflict (permission_key) do update set
        name = excluded.name,
        description = excluded.description,
        group_name = excluded.group_name,
        sort_order = excluded.sort_order`
  },
  {
    label: 'seed roles',
    sql: `insert into roles (role_key, role_name, description, is_system)
      values
        ('super_admin', 'Super administrator', 'All permissions', true),
        ('admin', 'Administrator', 'Device, user, reservation and analytics management', true),
        ('duty_admin', 'Duty administrator', 'Reservation, return and fault handling', true),
        ('auditor', 'Auditor', 'Read and export access', true)
      on conflict (role_key) do update set role_name = excluded.role_name, description = excluded.description, is_system = excluded.is_system`
  },  {
    label: 'seed role permissions',
    sql: `insert into role_permissions (role_id, permission_key)
      select r.id, p.permission_key
      from roles r
      join permissions p on (
        r.role_key = 'super_admin'
        or (r.role_key = 'admin' and p.permission_key in ('user.approve','user.manage','reservation.view','device.view','device.manage','fault.manage','stats.view','stats.export'))
        or (r.role_key = 'duty_admin' and p.permission_key in ('reservation.view','reservation.approve','return.view','return.confirm','return.image_review','device.view','fault.manage'))
        or (r.role_key = 'auditor' and p.permission_key in ('reservation.view','device.view','stats.view','stats.export','audit.view'))
      )
      on conflict do nothing`
  },
  {
    label: 'calendar_events_view',
    sql: `create or replace view calendar_events_view as
      select
        ri.id as event_id,
        d.id as device_id,
        d.device_code,
        d.name as device_name,
        u.id as user_id,
        u.name as user_name,
        ri.start_time,
        ri.end_time,
        ri.status,
        'reservation'::text as source_type,
        d.device_code as color_key
      from reservation_items ri
      join devices d on d.id = ri.device_id
      join users u on u.id = ri.user_id
      union all
      select
        b.id as event_id,
        d.id as device_id,
        d.device_code,
        d.name as device_name,
        u.id as user_id,
        u.name as user_name,
        b.borrow_time as start_time,
        coalesce(b.return_time, b.expected_return_time, now()) as end_time,
        b.status,
        'borrow'::text as source_type,
        d.device_code as color_key
      from borrow_records b
      join devices d on d.id = b.device_id
      join users u on u.id = b.user_id`
  },
  {
    label: 'device_usage_summary_view',
    sql: `create or replace view device_usage_summary_view as
      select
        d.id as device_id,
        d.device_code,
        d.name as device_name,
        count(distinct r.id)::int as reservation_count,
        count(distinct b.id)::int as borrow_count,
        coalesce(sum(b.duration_minutes), 0)::int as total_minutes,
        count(distinct f.id)::int as fault_count,
        max(b.borrow_time) as last_used_at
      from devices d
      left join reservation_items r on r.device_id = d.id
      left join borrow_records b on b.device_id = d.id
      left join device_fault_reports f on f.device_id = d.id
      group by d.id, d.device_code, d.name`
  }
];

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function queryOne(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] || null;
}

async function tableExists(client, name) {
  const row = await queryOne(client, 'select to_regclass($1) as name', [`public.${name}`]);
  return Boolean(row?.name);
}

async function columnInfo(client, table, column) {
  return queryOne(client, `
    select column_name, data_type, udt_name
    from information_schema.columns
    where table_schema = 'public' and table_name = $1 and column_name = $2
    limit 1
  `, [table, column]);
}

async function tryStatement(client, label, sql) {
  try {
    await client.query(sql);
    console.log(`完成 ${label}`);
    return { ok: true };
  } catch (error) {
    if (error.code === '42701') {
      console.log(`Skipped ${label}: already exists`);
      return { ok: true, skipped: true };
    }
    if (error.code === '42501' || /must be owner|permission denied/i.test(error.message || '')) {
      console.warn(`鎻愮ず ${label} -> ${error.message}`);
      return { ok: false, permission: true, error };
    }
    console.error(`失败 ${label} -> ${error.message}`);
    return { ok: false, error };
  }
}

function getConnectionUser() {
  try {
    return new URL(connectionString).username || 'idbs_user';
  } catch (_) {
    return 'idbs_user';
  }
}

function printOwnerTransferSql(appUser) {
  if (!appUser || appUser === 'postgres') return;
  const owner = quoteIdent(appUser);
    console.log('Run the generated manual SQL with the database owner if required.');
  console.log(`alter schema public owner to ${owner};`);
  console.log(`do $idbs_owner$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO ${owner}', r.schemaname, r.tablename);
  END LOOP;
  FOR r IN SELECT schemaname, viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER VIEW %I.%I OWNER TO ${owner}', r.schemaname, r.viewname);
  END LOOP;
  FOR r IN SELECT sequence_schema, sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO ${owner}', r.sequence_schema, r.sequence_name);
  END LOOP;
END $idbs_owner$;`);
}

function printManualSql(failedColumns = [], failedStatements = []) {
  if (!failedColumns.length && !failedStatements.length) return;
    console.log('Run the generated manual SQL with the database owner if required.');
    console.log('Run the generated manual SQL with the database owner if required.');
  printOwnerTransferSql(getConnectionUser());
  for (const item of failedColumns) {
    console.log(`alter table ${quoteIdent(item.table)} add column if not exists ${quoteIdent(item.column)} ${item.definition};`);
  }
  for (const item of failedStatements) {
    console.log(`${item.sql};`);
  }
    console.log('Run the generated manual SQL with the database owner if required.');
    console.log('Run the generated manual SQL with the database owner if required.');
}
async function main() {
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const pool = new Pool({
    connectionString,
    ssl: postgresSslOptions(),
    connectionTimeoutMillis: 5000
  });

  const failedColumns = [];
  const failedStatements = [];
  const hardFailures = [];

  try {
    const client = await pool.connect();
    try {
    console.log('Run the generated manual SQL with the database owner if required.');
      for (const item of REQUIRED_EXTENSIONS) {
        const result = await tryStatement(client, item.label, item.sql);
        if (!result.ok && result.permission) failedStatements.push(item);
        else if (!result.ok) hardFailures.push(`${item.label}: ${result.error.message}`);
      }
    console.log('Run the generated manual SQL with the database owner if required.');
      for (const item of REQUIRED_TABLES) {
        if (await tableExists(client, item.name)) {
          console.log(`Skipped table ${item.name}: already exists`);
          continue;
        }
        const result = await tryStatement(client, `table ${item.name}`, item.sql);
        if (!result.ok && result.permission) failedStatements.push(item);
        else if (!result.ok) hardFailures.push(`table ${item.name}: ${result.error.message}`);
      }
    console.log('Run the generated manual SQL with the database owner if required.');
      for (const item of REQUIRED_COLUMNS) {
        if (!(await tableExists(client, item.table))) {
          console.warn(`鎻愮ず ${item.table}.${item.column} -> 琛ㄤ笉瀛樺湪锛屽凡璺宠繃`);
          continue;
        }
        if (await columnInfo(client, item.table, item.column)) {
          console.log(`Skipped column ${item.table}.${item.column}: already exists`);
          continue;
        }
        const sql = `alter table ${quoteIdent(item.table)} add column ${quoteIdent(item.column)} ${item.definition}`;
        const result = await tryStatement(client, `${item.table}.${item.column}`, sql);
        if (!result.ok && result.permission) failedColumns.push(item);
        else if (!result.ok) hardFailures.push(`${item.table}.${item.column}: ${result.error.message}`);
      }

      if (await tableExists(client, 'operation_logs')) {
        const detail = await columnInfo(client, 'operation_logs', 'detail');
        if (detail && detail.data_type !== 'jsonb') {
          const result = await tryStatement(client, OPTIONAL_DETAIL_UPGRADES[0].label, OPTIONAL_DETAIL_UPGRADES[0].sql);
          if (!result.ok && result.permission) failedStatements.push(OPTIONAL_DETAIL_UPGRADES[0]);
          else if (!result.ok) hardFailures.push(`${OPTIONAL_DETAIL_UPGRADES[0].label}: ${result.error.message}`);
        } else if (detail) {
    console.log('Run the generated manual SQL with the database owner if required.');
        }
        if (detail) {
          const result = await tryStatement(client, OPTIONAL_DETAIL_UPGRADES[1].label, OPTIONAL_DETAIL_UPGRADES[1].sql);
          if (!result.ok && result.permission) failedStatements.push(OPTIONAL_DETAIL_UPGRADES[1]);
          else if (!result.ok) hardFailures.push(`${OPTIONAL_DETAIL_UPGRADES[1].label}: ${result.error.message}`);
        }
      }
    console.log('Run the generated manual SQL with the database owner if required.');
      for (const item of REQUIRED_INDEXES) {
        if (!(await tableExists(client, item.table))) {
          console.warn('Skipped index because its table is absent.');
          continue;
        }
        const result = await tryStatement(client, item.label, item.sql);
        if (!result.ok && result.permission) failedStatements.push(item);
        else if (!result.ok) hardFailures.push(`${item.label}: ${result.error.message}`);
      }
    console.log('Run the generated manual SQL with the database owner if required.');
      for (const item of REQUIRED_STATEMENTS) {
        const result = await tryStatement(client, item.label, item.sql);
        if (!result.ok && result.permission) failedStatements.push(item);
        else if (!result.ok) hardFailures.push(`${item.label}: ${result.error.message}`);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => {});
  }

  printManualSql(failedColumns, failedStatements);
  if (hardFailures.length) {
    console.error('Schema upgrade failed:');
    for (const failure of hardFailures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else if (failedColumns.length || failedStatements.length) {
    console.warn('Schema upgrade completed with warnings.');
    process.exitCode = 2;
  } else {
    console.log('Run the generated manual SQL with the database owner if required.');
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});













