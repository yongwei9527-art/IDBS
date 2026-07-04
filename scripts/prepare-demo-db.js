 const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || '';

async function createDemoRelations(client) {
  await client.query(`
    create table if not exists device_time_slots (
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
    )
  `);

  await client.query(`
    insert into device_time_slots (device_id, slot_key, label, start_time, end_time, crosses_day, sort_order)
    select d.id, slot.slot_key, slot.label, slot.start_time::time, slot.end_time::time, slot.crosses_day, slot.sort_order
    from devices d
    cross join (values
      ('morning', '上午 8:00-12:00', '08:00', '12:00', false, 10),
      ('afternoon', '下午 12:00-17:00', '12:00', '17:00', false, 20),
      ('evening', '傍晚 17:00-22:00', '17:00', '22:00', false, 30),
      ('night', '夜间 22:00-次日 8:00', '22:00', '08:00', true, 40),
      ('daytime', '白天 8:00-22:00', '08:00', '22:00', false, 50)
    ) as slot(slot_key, label, start_time, end_time, crosses_day, sort_order)
    on conflict (device_id, slot_key) do nothing
  `);

  await client.query(`
    create table if not exists reservation_items (
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
    )
  `);

  await client.query(`
    do $$
    begin
      if not exists (select 1 from pg_constraint where conname = 'reservation_items_no_overlap_active') then
        begin
          alter table reservation_items
            add constraint reservation_items_no_overlap_active
            exclude using gist (
              device_id with =,
              tstzrange(start_time, end_time, '[)') with &&
            )
            where (status in ('pending','approved','in_use'));
        exception when insufficient_privilege then
          raise notice 'reservation_items overlap constraint skipped because current user is not owner';
        end;
      end if;
    end$$
  `);

  await client.query(`
    create table if not exists permissions (
      permission_key text primary key,
      name text not null,
      description text,
      group_name text not null,
      sort_order integer not null default 0
    )
  `);

  await client.query(`
    create table if not exists roles (
      id uuid primary key default gen_random_uuid(),
      role_key text not null unique,
      role_name text not null,
      description text,
      is_system boolean not null default false,
      created_at timestamptz not null default now()
    )
  `);

  await client.query(`
    create table if not exists role_permissions (
      role_id uuid not null references roles(id) on delete cascade,
      permission_key text not null references permissions(permission_key) on delete cascade,
      primary key(role_id, permission_key)
    )
  `);

  await client.query(`
    create table if not exists user_roles (
      user_id uuid not null references users(id) on delete cascade,
      role_id uuid not null references roles(id) on delete cascade,
      granted_by uuid references users(id) on delete set null,
      granted_at timestamptz not null default now(),
      primary key(user_id, role_id)
    )
  `);
}

async function seedPermissions(client) {
  await client.query(`
    insert into permissions (permission_key, name, description, group_name, sort_order)
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
      sort_order = excluded.sort_order
  `);

  await client.query(`
    insert into roles (role_key, role_name, description, is_system)
    values
      ('super_admin', '超级管理员', '全部权限', true),
      ('admin', '管理员', '设备、用户、预约、统计管理', true),
      ('ops', '运营', '设备、预约、故障处理', true),
      ('auditor', '审计', '查看与导出', true)
    on conflict (role_key) do update set role_name = excluded.role_name, description = excluded.description, is_system = excluded.is_system
  `);

  await client.query(`
    insert into role_permissions (role_id, permission_key)
    select r.id, p.permission_key
    from roles r
    join permissions p on (
      r.role_key = 'super_admin'
      or (r.role_key = 'admin' and p.permission_key in ('user.approve','user.manage','reservation.view','reservation.approve','device.view','device.manage','fault.manage','stats.view','stats.export'))
      or (r.role_key = 'ops' and p.permission_key in ('reservation.view','reservation.approve','device.view','device.manage','fault.manage'))
      or (r.role_key = 'auditor' and p.permission_key in ('reservation.view','device.view','stats.view','stats.export','operation.view'))
    )
    on conflict do nothing
  `);
}

async function createViewsAndIndexes(client) {
  await client.query(`
    create or replace view calendar_events_view as
    select ri.id as event_id, d.id as device_id, d.device_code, d.name as device_name, u.id as user_id, u.name as user_name,
      ri.start_time, ri.end_time, ri.status, 'reservation'::text as source_type, d.device_code as color_key
    from reservation_items ri
    join devices d on d.id = ri.device_id
    join users u on u.id = ri.user_id
    union all
    select b.id as event_id, d.id as device_id, d.device_code, d.name as device_name, u.id as user_id, u.name as user_name,
      b.borrow_time as start_time, coalesce(b.return_time, b.expected_return_time, now()) as end_time, b.status, 'borrow'::text as source_type, d.device_code as color_key
    from borrow_records b
    join devices d on d.id = b.device_id
    join users u on u.id = b.user_id
  `);

  await client.query(`
    create or replace view device_usage_summary_view as
    select d.id as device_id, d.device_code, d.name as device_name,
      count(distinct r.id)::int as reservation_count,
      count(distinct b.id)::int as borrow_count,
      coalesce(sum(b.duration_minutes), 0)::int as total_minutes,
      count(distinct f.id)::int as fault_count,
      max(b.borrow_time) as last_used_at
    from devices d
    left join reservation_items r on r.device_id = d.id
    left join borrow_records b on b.device_id = d.id
    left join device_fault_reports f on f.device_id = d.id
    group by d.id, d.device_code, d.name
  `);

  await client.query('create index if not exists idx_device_time_slots_device on device_time_slots(device_id, enabled, sort_order)');
  await client.query('create index if not exists idx_reservation_items_batch on reservation_items(batch_id, created_at desc)');
  await client.query('create index if not exists idx_reservation_items_user_time on reservation_items(user_id, start_time desc)');
  await client.query('create index if not exists idx_reservation_items_device_time on reservation_items(device_id, start_time, end_time)');
  await client.query('create index if not exists idx_fault_reports_device_time on device_fault_reports(device_id, created_at desc)');
  await client.query('create index if not exists idx_fault_reports_status_time on device_fault_reports(status, created_at desc)');
}

async function main() {
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  const pool = new Pool({
    connectionString,
    ssl: String(process.env.PGSSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined
  });
  const client = await pool.connect();
  try {
    await client.query('begin');
    await createDemoRelations(client);
    await seedPermissions(client);
    await createViewsAndIndexes(client);
    await client.query('commit');
    console.log('Demo database relations are ready.');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});