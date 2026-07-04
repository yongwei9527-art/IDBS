const { Pool } = require('pg');
require('dotenv').config();

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
    name: 'export_jobs',
    sql: `create table if not exists export_jobs (
      id uuid primary key default gen_random_uuid(),
      type text not null,
      params jsonb not null default '{}'::jsonb,
      status text not null default 'pending',
      row_count integer not null default 0,
      file_path text,
      error_message text,
      created_by uuid references users(id) on delete set null,
      created_at timestamptz not null default now(),
      started_at timestamptz,
      finished_at timestamptz
    )`
  }
];

const REQUIRED_INDEXES = [
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
  }
];

const REQUIRED_COLUMNS = [
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
    label: 'seed permissions',
    sql: `insert into permissions (permission_key, name, description, group_name, sort_order)
      values
        ('user.approve', '同意用户注册', '审核新用户注册申请', '用户', 10),
        ('user.manage', '管理用户', '搜索、禁用、恢复、解绑用户', '用户', 20),
        ('reservation.view', '查看预约', '查看预约与日历数据', '预约', 30),
        ('reservation.approve', '同意用户预约', '审批预约批次和明细', '预约', 40),
        ('device.view', '查看设备', '查看设备和设备状态', '设备', 50),
        ('device.manage', '管理设备', '新增、编辑、停用设备和时间段', '设备', 60),
        ('fault.manage', '处理故障报备', '处理故障并联动设备状态', '故障', 70),
        ('stats.view', '查看统计', '查看统计与分析图', '统计', 80),
        ('stats.export', '导出统计', '导出统计数据', '统计', 90),
        ('system.config', '系统配置', '修改系统配置', '系统', 100),
        ('admin.manage', '管理管理员权限', '授权或撤销管理员权限', '系统', 110),
        ('operation.view', '查看操作日志', '查看后台操作日志', '系统', 120)
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
        ('super_admin', '超级管理员', '全部权限', true),
        ('admin', '管理员', '设备、用户、预约、统计管理', true),
        ('ops', '运营', '设备、预约、故障处理', true),
        ('auditor', '审计', '查看与导出', true)
      on conflict (role_key) do update set role_name = excluded.role_name, description = excluded.description, is_system = excluded.is_system`
  },
  {
    label: 'seed role permissions',
    sql: `insert into role_permissions (role_id, permission_key)
      select r.id, p.permission_key
      from roles r
      join permissions p on (
        r.role_key = 'super_admin'
        or (r.role_key = 'admin' and p.permission_key in ('user.approve','user.manage','reservation.view','reservation.approve','device.view','device.manage','fault.manage','stats.view','stats.export'))
        or (r.role_key = 'ops' and p.permission_key in ('reservation.view','reservation.approve','device.view','device.manage','fault.manage'))
        or (r.role_key = 'auditor' and p.permission_key in ('reservation.view','device.view','stats.view','stats.export','operation.view'))
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
    console.log(`DONE ${label}`);
    return { ok: true };
  } catch (error) {
    if (error.code === '42701') {
      console.log(`SKIP ${label} -> already exists`);
      return { ok: true, skipped: true };
    }
    if (error.code === '42501' || /must be owner|permission denied/i.test(error.message || '')) {
      console.warn(`WARN ${label} -> ${error.message}`);
      return { ok: false, permission: true, error };
    }
    console.error(`FAIL ${label} -> ${error.message}`);
    return { ok: false, error };
  }
}

function printManualSql(failedColumns = [], failedStatements = []) {
  if (!failedColumns.length && !failedStatements.length) return;
  console.log('\nManual SQL for a PostgreSQL table owner/admin account:');
  console.log('--------------------------------------------------');
  for (const item of failedColumns) {
    console.log(`alter table ${quoteIdent(item.table)} add column if not exists ${quoteIdent(item.column)} ${item.definition};`);
  }
  for (const item of failedStatements) {
    console.log(`${item.sql};`);
  }
  console.log('--------------------------------------------------');
  console.log('After applying the SQL above, run: npm run doctor');
}

async function main() {
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  const pool = new Pool({
    connectionString,
    ssl: String(process.env.PGSSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5000
  });

  const failedColumns = [];
  const failedStatements = [];
  const hardFailures = [];

  try {
    const client = await pool.connect();
    try {
      console.log('Checking schema upgrade extensions...');
      for (const item of REQUIRED_EXTENSIONS) {
        const result = await tryStatement(client, item.label, item.sql);
        if (!result.ok && result.permission) failedStatements.push(item);
        else if (!result.ok) hardFailures.push(`${item.label}: ${result.error.message}`);
      }

      console.log('Checking schema upgrade tables...');
      for (const item of REQUIRED_TABLES) {
        if (await tableExists(client, item.name)) {
          console.log(`SKIP table ${item.name} -> exists`);
          continue;
        }
        const result = await tryStatement(client, `table ${item.name}`, item.sql);
        if (!result.ok && result.permission) failedStatements.push(item);
        else if (!result.ok) hardFailures.push(`table ${item.name}: ${result.error.message}`);
      }

      console.log('Checking schema upgrade columns...');
      for (const item of REQUIRED_COLUMNS) {
        if (!(await tableExists(client, item.table))) {
          console.warn(`WARN ${item.table}.${item.column} -> table missing, skipped`);
          continue;
        }
        if (await columnInfo(client, item.table, item.column)) {
          console.log(`SKIP ${item.table}.${item.column} -> exists`);
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
          console.log('SKIP operation_logs.detail jsonb conversion -> already jsonb');
        }
        if (detail) {
          const result = await tryStatement(client, OPTIONAL_DETAIL_UPGRADES[1].label, OPTIONAL_DETAIL_UPGRADES[1].sql);
          if (!result.ok && result.permission) failedStatements.push(OPTIONAL_DETAIL_UPGRADES[1]);
          else if (!result.ok) hardFailures.push(`${OPTIONAL_DETAIL_UPGRADES[1].label}: ${result.error.message}`);
        }
      }

      console.log('Checking schema upgrade indexes...');
      for (const item of REQUIRED_INDEXES) {
        if (!(await tableExists(client, item.table))) {
          console.warn(`WARN ${item.label} -> table ${item.table} missing, skipped`);
          continue;
        }
        const result = await tryStatement(client, item.label, item.sql);
        if (!result.ok && result.permission) failedStatements.push(item);
        else if (!result.ok) hardFailures.push(`${item.label}: ${result.error.message}`);
      }

      console.log('Checking schema seed data and views...');
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
    console.error('\nSchema upgrade failed:');
    for (const failure of hardFailures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else if (failedColumns.length || failedStatements.length) {
    console.warn('\nSchema upgrade partially applied. Some changes require a PostgreSQL table owner/admin account.');
    process.exitCode = 2;
  } else {
    console.log('\nSchema upgrade finished successfully.');
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
