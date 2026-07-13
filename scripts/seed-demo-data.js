const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { postgresSslOptions } = require('../src/lib/postgres-ssl');
const { loadConfig } = require('../src/config/env');
require('dotenv').config({ quiet: true });

const connectionString = process.env.DATABASE_URL || 'postgresql://idbs_user:generated-by-installer@127.0.0.1:5432/idbs';

function assertSeedTarget(urlText) {
  const url = new URL(urlText);
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!localHosts.has(url.hostname) && process.env.ALLOW_NON_LOCAL_SEED !== '1') {
    throw new Error('为避免误写入生产库，默认只允许向本机数据库写入演示数据；如确认需要，请设置 ALLOW_NON_LOCAL_SEED=1。');
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  }).toString('hex');
}

function uuid(seed) {
  return `d0000000-0000-4000-8000-${String(seed).padStart(12, '0')}`;
}

function atDay(daysFromNow, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function dateText(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

const columnCache = new Map();

async function getColumns(client, tableName) {
  if (columnCache.has(tableName)) return columnCache.get(tableName);
  const result = await client.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1",
    [tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  columnCache.set(tableName, columns);
  return columns;
}

async function ensureDemoSchema(_client) {
  // 兼容非 owner 的本地库：不强制 ALTER，写入时根据现有列动态降级。
}

async function upsertUser(client, user) {
  const salt = `demo-${user.phone}`;
  const result = await client.query(`
    insert into users (id, name, phone, student_no, group_name, email, password_hash, password_salt, role, status, is_banned, created_at, updated_at, last_login_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$13,$11,now(),$12)
    on conflict (phone) do update set
      name = excluded.name,
      student_no = excluded.student_no,
      group_name = excluded.group_name,
      email = excluded.email,
      password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      role = excluded.role,
      status = excluded.status,
      is_banned = excluded.is_banned,
      last_login_at = excluded.last_login_at,
      updated_at = now()
    returning id
  `, [
    user.id,
    user.name,
    user.phone,
    user.student_no,
    user.group_name,
    user.email,
    hashPassword(user.password, salt),
    salt,
    user.role,
    user.status,
    user.created_at || atDay(-10, 9).toISOString(),
    user.last_login_at || new Date().toISOString(),
    Boolean(user.is_banned)
  ]);
  return result.rows[0].id;
}

async function upsertAdminRole(client, role) {
  await client.query(`
    insert into admin_roles (id, user_id, role_key, permissions, note, created_at, updated_at)
    values ($1,$2,$3,$4::jsonb,$5,now(),now())
    on conflict (user_id) do update set
      role_key = excluded.role_key,
      permissions = excluded.permissions,
      note = excluded.note,
      updated_at = now()
  `, [role.id, role.user_id, role.role_key, JSON.stringify(role.permissions || []), role.note || '']);
}

async function upsertDevice(client, device) {
  const columns = await getColumns(client, 'devices');
  const fieldDefs = [
    ['id', device.id],
    ['device_code', device.device_code],
    ['name', device.name],
    ['category', device.category],
    ['location', device.location],
    ['manager', device.manager],
    ['status', device.status],
    ['allow_reservation', device.allow_reservation],
    ['description', device.description],
    ['usage_notice', device.usage_notice],
    ['cover_photo', device.cover_photo || ''],
    ['instruction_photos', JSON.stringify(device.instruction_photos || []), '::jsonb'],
    ['reservation_slot_keys', JSON.stringify(device.reservation_slot_keys || ['morning', 'afternoon', 'evening', 'night']), '::jsonb'],
    ['return_mode', device.return_mode || 'image_required'],
    ['return_require_note', Boolean(device.return_require_note)]
  ].filter(([name]) => columns.has(name));
  const names = fieldDefs.map(([name]) => name);
  const params = fieldDefs.map(([, value]) => value);
  const values = fieldDefs.map(([, , cast], index) => `$${index + 1}${cast || ''}`);
  const updates = names
    .filter((name) => name !== 'id' && name !== 'device_code')
    .map((name) => `${name} = excluded.${name}`);
  if (columns.has('updated_at')) updates.push('updated_at = now()');
  const createdAtSql = columns.has('created_at') ? ', created_at' : '';
  const updatedAtSql = columns.has('updated_at') ? ', updated_at' : '';
  const createdValueSql = columns.has('created_at') ? ', now()' : '';
  const updatedValueSql = columns.has('updated_at') ? ', now()' : '';
  const result = await client.query(`
    insert into devices (${names.join(', ')}${createdAtSql}${updatedAtSql})
    values (${values.join(', ')}${createdValueSql}${updatedValueSql})
    on conflict (device_code) do update set
      ${updates.join(',\n      ')}
    returning id
  `, params);
  return result.rows[0].id;
}

async function upsertDeviceSlots(client, deviceIds) {
  const slots = [
    ['morning', '上午 08:00-12:00', '08:00', '12:00', false, 10],
    ['afternoon', '下午 12:00-17:00', '12:00', '17:00', false, 20],
    ['evening', '晚上 17:00-22:00', '17:00', '22:00', false, 30],
    ['night', '夜间 22:00-次日08:00', '22:00', '08:00', true, 40],
    ['daytime', '白天 08:00-22:00', '08:00', '22:00', false, 50]
  ];
  for (const deviceId of Object.values(deviceIds)) {
    for (const slot of slots) {
      await client.query(`
        insert into device_time_slots (device_id, slot_key, label, start_time, end_time, crosses_day, sort_order, enabled)
        values ($1,$2,$3,$4::time,$5::time,$6,$7,true)
        on conflict (device_id, slot_key) do update set
          label = excluded.label,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          crosses_day = excluded.crosses_day,
          sort_order = excluded.sort_order,
          enabled = true,
          updated_at = now()
      `, [deviceId, ...slot]);
    }
  }
}

async function upsertBatch(client, batch) {
  await client.query(`
    insert into reservation_batches (id, user_id, device_codes, time_slots, purpose, status, created_at, updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,now())
    on conflict (id) do update set
      user_id = excluded.user_id,
      device_codes = excluded.device_codes,
      time_slots = excluded.time_slots,
      purpose = excluded.purpose,
      status = excluded.status,
      updated_at = now()
  `, [batch.id, batch.user_id, batch.device_codes, batch.time_slots, batch.purpose, batch.status, batch.created_at || new Date().toISOString()]);

  const columns = await getColumns(client, 'reservation_batches');
  const updates = [];
  const params = [];
  if (columns.has('submit_note')) {
    params.push(batch.submit_note || null);
    updates.push(`submit_note = $${params.length}`);
  }
  if (columns.has('admin_note')) {
    params.push(batch.admin_note || null);
    updates.push(`admin_note = $${params.length}`);
  }
  if (updates.length) {
    params.push(batch.id);
    await client.query(`update reservation_batches set ${updates.join(', ')} where id = $${params.length}`, params);
  }
}

async function upsertReservation(client, row) {
  const values = [row.id, row.batch_id, row.device_id, row.user_id, row.start_time, row.end_time, row.purpose, row.status, row.admin_note || null, row.created_at || new Date().toISOString(), row.approved_at || null];
  // 本脚本的时间基于“今天”动态生成。重复 seed 或跨日 seed 时，旧演示行可能与新演示行
  // 在同一设备时间段上重叠，触发 reservations_no_overlap_active 排他约束。
  // 只处理带“演示”口径的本地种子数据，避免误动真实业务记录。
  const conflicts = await client.query(`
    select id from reservations
    where id <> $1
      and device_id = $2
      and coalesce(purpose, '') like '%演示%'
      and tstzrange(start_time, end_time, '[)') && tstzrange($3::timestamptz, $4::timestamptz, '[)')
  `, [row.id, row.device_id, row.start_time, row.end_time]);
  if (conflicts.rowCount) {
    const conflictIds = conflicts.rows.map((item) => item.id);
    await client.query("update reservation_items set status = 'cancelled', updated_at = now() where reservation_id = any($1::uuid[])", [conflictIds]);
    await client.query("update reservations set status = 'cancelled', updated_at = now() where id = any($1::uuid[])", [conflictIds]);
  }

  const existing = await client.query('select 1 from reservations where id = $1 limit 1', [row.id]);
  if (existing.rowCount) {
    await client.query(`
      update reservations set
        batch_id = $2,
        device_id = $3,
        user_id = $4,
        start_time = $5,
        end_time = $6,
        purpose = $7,
        status = $8,
        admin_note = $9,
        created_at = $10,
        approved_at = $11,
        updated_at = now()
      where id = $1
    `, values);
    return;
  }

  await client.query(`
    insert into reservations (id, batch_id, device_id, user_id, start_time, end_time, purpose, status, admin_note, created_at, updated_at, approved_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11)
  `, values);
}

async function upsertReservationItem(client, row) {
  if (row.id) {
    await client.query('delete from reservation_items where reservation_id = $1 and id <> $2', [row.id, row.item_id]);
  }
  await client.query(`
    insert into reservation_items (id, batch_id, device_id, user_id, reservation_date, slot_key, start_time, end_time, status, admin_note, approved_at, reservation_id, created_at, updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
    on conflict (id) do update set
      batch_id = excluded.batch_id,
      device_id = excluded.device_id,
      user_id = excluded.user_id,
      reservation_date = excluded.reservation_date,
      slot_key = excluded.slot_key,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      status = excluded.status,
      admin_note = excluded.admin_note,
      approved_at = excluded.approved_at,
      reservation_id = excluded.reservation_id,
      updated_at = now()
  `, [
    row.item_id,
    row.batch_id,
    row.device_id,
    row.user_id,
    dateText(new Date(row.start_time)),
    row.slot_key || 'custom',
    row.start_time,
    row.end_time,
    row.status,
    row.admin_note || null,
    row.approved_at || null,
    row.id,
    row.created_at || new Date().toISOString()
  ]);
}

async function upsertBorrow(client, row) {
  await client.query(`
    insert into borrow_records (id, reservation_id, device_id, user_id, borrow_time, expected_return_time, return_time, duration_minutes, return_condition, return_note, return_photos, status, is_overdue, created_at, updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,now())
    on conflict (id) do update set
      reservation_id = excluded.reservation_id,
      device_id = excluded.device_id,
      user_id = excluded.user_id,
      borrow_time = excluded.borrow_time,
      expected_return_time = excluded.expected_return_time,
      return_time = excluded.return_time,
      duration_minutes = excluded.duration_minutes,
      return_condition = excluded.return_condition,
      return_note = excluded.return_note,
      return_photos = excluded.return_photos,
      status = excluded.status,
      is_overdue = excluded.is_overdue,
      updated_at = now()
  `, [row.id, row.reservation_id || null, row.device_id, row.user_id, row.borrow_time, row.expected_return_time, row.return_time || null, row.duration_minutes || null, row.return_condition || null, row.return_note || null, JSON.stringify(row.return_photos || []), row.status, Boolean(row.is_overdue), row.created_at || new Date().toISOString()]);

  const columns = await getColumns(client, 'borrow_records');
  const updates = [];
  const params = [];
  if (columns.has('reservation_item_id')) {
    params.push(row.reservation_item_id || null);
    updates.push(`reservation_item_id = $${params.length}`);
  }
  if (columns.has('actual_start_time')) {
    params.push(row.borrow_time);
    updates.push(`actual_start_time = $${params.length}`);
  }
  if (columns.has('actual_end_time')) {
    params.push(row.return_time || null);
    updates.push(`actual_end_time = $${params.length}`);
  }
  if (updates.length) {
    params.push(row.id);
    await client.query(`update borrow_records set ${updates.join(', ')} where id = $${params.length}`, params);
  }
}

async function upsertFault(client, row) {
  await client.query(`
    insert into device_fault_reports (id, device_id, user_id, borrow_record_id, reservation_id, issue_type, description, photos, status, admin_note, created_at, updated_at, resolved_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,now(),$12)
    on conflict (id) do update set
      device_id = excluded.device_id,
      user_id = excluded.user_id,
      borrow_record_id = excluded.borrow_record_id,
      reservation_id = excluded.reservation_id,
      issue_type = excluded.issue_type,
      description = excluded.description,
      photos = excluded.photos,
      status = excluded.status,
      admin_note = excluded.admin_note,
      resolved_at = excluded.resolved_at,
      updated_at = now()
  `, [row.id, row.device_id, row.user_id, row.borrow_record_id || null, row.reservation_id || null, row.issue_type, row.description, JSON.stringify(row.photos || []), row.status, row.admin_note || null, row.created_at || new Date().toISOString(), row.resolved_at || null]);
  const columns = await getColumns(client, 'device_fault_reports');
  const updates = [];
  const params = [];
  if (columns.has('severity')) {
    params.push(row.severity || 'normal');
    updates.push(`severity = $${params.length}`);
  }
  if (columns.has('reservation_item_id')) {
    params.push(row.reservation_item_id || null);
    updates.push(`reservation_item_id = $${params.length}`);
  }
  if (updates.length) {
    params.push(row.id);
    await client.query(`update device_fault_reports set ${updates.join(', ')} where id = $${params.length}`, params);
  }
}

async function insertUsageLog(client, row) {
  await client.query(`
    insert into usage_log (id, record_id, reservation_id, device_id, user_id, action, device_code, device_name, user_name, user_phone, user_student_no, borrow_time, expected_return_time, return_time, duration_minutes, return_condition, return_note, record_status, operator_name, created_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    on conflict (id) do update set
      record_id = excluded.record_id,
      reservation_id = excluded.reservation_id,
      device_id = excluded.device_id,
      user_id = excluded.user_id,
      action = excluded.action,
      device_code = excluded.device_code,
      device_name = excluded.device_name,
      user_name = excluded.user_name,
      user_phone = excluded.user_phone,
      user_student_no = excluded.user_student_no,
      borrow_time = excluded.borrow_time,
      expected_return_time = excluded.expected_return_time,
      return_time = excluded.return_time,
      duration_minutes = excluded.duration_minutes,
      return_condition = excluded.return_condition,
      return_note = excluded.return_note,
      record_status = excluded.record_status,
      operator_name = excluded.operator_name,
      created_at = excluded.created_at
  `, [row.id, row.record_id, row.reservation_id || null, row.device_id, row.user_id, row.action, row.device_code, row.device_name, row.user_name, row.user_phone, row.user_student_no, row.borrow_time || null, row.expected_return_time || null, row.return_time || null, row.duration_minutes || null, row.return_condition || null, row.return_note || null, row.record_status, row.operator_name, row.created_at || new Date().toISOString()]);
}

async function insertOperationLog(client, row) {
  const columns = await getColumns(client, 'operation_logs');
  const fieldDefs = [
    ['id', row.id],
    ['operator_id', row.operator_id],
    ['operator_name', row.operator_name],
    ['action', row.action],
    ['target_type', row.target_type],
    ['target_id', row.target_id],
    ['device_id', row.device_id || (row.target_type === 'device' ? row.target_id : null)],
    ['record_id', row.record_id || null],
    ['detail', JSON.stringify(row.detail || {}), '::jsonb'],
    ['ip_address', '127.0.0.1'],
    ['created_at', row.created_at || new Date().toISOString()]
  ].filter(([name]) => columns.has(name));
  const names = fieldDefs.map(([name]) => name);
  const params = fieldDefs.map(([, value]) => value);
  const values = fieldDefs.map(([, , cast], index) => `$${index + 1}${cast || ''}`);
  const updates = names
    .filter((name) => name !== 'id')
    .map((name) => `${name} = excluded.${name}`);
  await client.query(`
    insert into operation_logs (${names.join(', ')})
    values (${values.join(', ')})
    on conflict (id) do update set ${updates.join(', ')}
  `, params);
}

async function upsertUserRequestDemo(client, row) {
  const columns = await getColumns(client, 'user_requests');
  if (!columns.has('id') || !columns.has('user_id') || !columns.has('title')) return;
  const fieldDefs = [
    ['id', row.id],
    ['user_id', row.user_id],
    ['device_id', row.device_id || null],
    ['category', row.category || 'feature'],
    ['title', row.title],
    ['description', row.description || row.title],
    ['priority', row.priority || 'normal'],
    ['status', row.status || 'pending'],
    ['admin_note', row.admin_note || null],
    ['change_request_note', row.change_request_note || null],
    ['confirmed_by', row.confirmed_by || null],
    ['confirmed_at', row.confirmed_at || null],
    ['locked_at', row.locked_at || null],
    ['created_at', row.created_at || new Date().toISOString()],
    ['updated_at', row.updated_at || row.created_at || new Date().toISOString()]
  ].filter(([name]) => columns.has(name));
  const names = fieldDefs.map(([name]) => name);
  const params = fieldDefs.map(([, value]) => value);
  const values = fieldDefs.map(([, , cast], index) => `$${index + 1}${cast || ''}`);
  const updates = names
    .filter((name) => name !== 'id')
    .map((name) => `${name} = excluded.${name}`);
  await client.query(`
    insert into user_requests (${names.join(', ')})
    values (${values.join(', ')})
    on conflict (id) do update set ${updates.join(', ')}
  `, params);
}

async function upsertNotificationDemo(client, row) {
  const columns = await getColumns(client, 'user_notifications');
  if (!columns.has('id') || !columns.has('user_id') || !columns.has('title')) return;
  const fieldDefs = [
    ['id', row.id],
    ['user_id', row.user_id],
    ['type', row.type || 'system'],
    ['title', row.title],
    ['content', row.content || row.title],
    ['related_type', row.related_type || null],
    ['related_id', row.related_id || null],
    ['device_id', row.device_id || null],
    ['reservation_id', row.reservation_id || null],
    ['is_read', Boolean(row.is_read)],
    ['created_at', row.created_at || new Date().toISOString()],
    ['read_at', row.read_at || null]
  ].filter(([name]) => columns.has(name));
  const names = fieldDefs.map(([name]) => name);
  const params = fieldDefs.map(([, value]) => value);
  const values = fieldDefs.map(([, , cast], index) => `$${index + 1}${cast || ''}`);
  const updates = names
    .filter((name) => name !== 'id')
    .map((name) => `${name} = excluded.${name}`);
  await client.query(`
    insert into user_notifications (${names.join(', ')})
    values (${values.join(', ')})
    on conflict (id) do update set ${updates.join(', ')}
  `, params);
}

async function upsertIntelligenceActionLog(client, row) {
  const columns = await getColumns(client, 'intelligence_action_logs');
  if (!columns.has('id') || !columns.has('action_id') || !columns.has('status')) return;
  const fieldDefs = [
    ['id', row.id],
    ['action_id', row.action_id],
    ['action_type', row.action_type],
    ['action_title', row.action_title],
    ['status', row.status || 'open'],
    ['note', row.note || ''],
    ['assigned_to', row.assigned_to || null],
    ['handled_by', row.handled_by || null],
    ['handled_at', row.handled_at || new Date().toISOString()],
    ['created_at', row.created_at || new Date().toISOString()],
    ['updated_at', row.updated_at || row.handled_at || new Date().toISOString()]
  ].filter(([name]) => columns.has(name));
  const names = fieldDefs.map(([name]) => name);
  const params = fieldDefs.map(([, value]) => value);
  const values = fieldDefs.map(([, , cast], index) => `$${index + 1}${cast || ''}`);
  const updates = names
    .filter((name) => name !== 'id')
    .map((name) => `${name} = excluded.${name}`);
  await client.query(`
    insert into intelligence_action_logs (${names.join(', ')})
    values (${values.join(', ')})
    on conflict (id) do update set ${updates.join(', ')}
  `, params);
}

async function seedChatDemo(client, users) {
  let managementGroupId = uuid(1001);
  const demoGroupId = uuid(1002);
  const directId = uuid(1003);

  await client.query(`
    insert into chat_conversations (id, type, title, system_key, is_system, retention_days, created_by, created_at, updated_at, last_message_at)
    values ($1,'group','实验管理总群','lab_management',true,7,$2,$3,now(),$4)
    on conflict (system_key) where system_key is not null do update set
      title = excluded.title,
      is_system = excluded.is_system,
      retention_days = excluded.retention_days,
      updated_at = now(),
      last_message_at = excluded.last_message_at
  `, [managementGroupId, users.admin, atDay(-2, 9).toISOString(), addHours(new Date(), -1).toISOString()]);

  const managementRows = await client.query('select id from chat_conversations where system_key = $1 limit 1', ['lab_management']);
  managementGroupId = managementRows.rows[0]?.id || managementGroupId;

  await client.query(`
    delete from chat_conversations
    where id <> all($1::uuid[])
      and (
        title in ('实验管理总群','实验室总群','演示超级管理员 发起的群聊')
        or id in ($2,$3)
      )
  `, [[managementGroupId, demoGroupId, directId], demoGroupId, directId]);

  await client.query(`
    insert into chat_conversations (id, type, title, created_by, created_at, updated_at, last_message_at)
    values
      ($1,'group','演示超级管理员 发起的群聊',$3,$4,now(),$5),
      ($2,'direct',null,$3,$4,now(),$6)
    on conflict (id) do update set
      title = excluded.title,
      updated_at = now(),
      last_message_at = excluded.last_message_at
  `, [
    demoGroupId,
    directId,
    users.admin,
    atDay(-1, 10).toISOString(),
    addHours(new Date(), -4).toISOString(),
    addHours(new Date(), -3).toISOString()
  ]);

  const participants = [
    [managementGroupId, users.admin, 'admin'],
    [managementGroupId, users.zhang, 'member'],
    [managementGroupId, users.li, 'member'],
    [demoGroupId, users.admin, 'owner'],
    [demoGroupId, users.zhang, 'member'],
    [demoGroupId, users.li, 'member'],
    [directId, users.admin, 'member'],
    [directId, users.zhang, 'member']
  ];
  for (const [conversationId, userId, role] of participants) {
    await client.query(`
      insert into chat_participants (conversation_id, user_id, role, joined_at, last_read_at)
      values ($1,$2,$3,$4,$5)
      on conflict (conversation_id, user_id) do update set role = excluded.role
    `, [conversationId, userId, role, atDay(-1, 10).toISOString(), addHours(new Date(), -2).toISOString()]);
  }

  await client.query('delete from chat_messages where id = any($1)', [[uuid(1101), uuid(1102), uuid(1103), uuid(1104), uuid(1105)]]);
  const messages = [
    [uuid(1101), managementGroupId, users.admin, '欢迎加入实验管理总群。这里用于发布实验室管理通知，聊天记录仅保留 7 天。', atDay(-1, 9).toISOString()],
    [uuid(1102), managementGroupId, users.admin, '@全体成员 明天上午显微镜维护，请提前调整预约安排。', addHours(new Date(), -1).toISOString()],
    [uuid(1103), demoGroupId, users.admin, '你好，这个群用于演示成员添加、成员操作和群聊消息。', addHours(new Date(), -5).toISOString()],
    [uuid(1104), demoGroupId, users.zhang, '收到，我会按预约时间使用设备。', addHours(new Date(), -4).toISOString()],
    [uuid(1105), directId, users.admin, '张三，你的预约申请已经收到，稍后会统一审核。', addHours(new Date(), -3).toISOString()]
  ];
  for (const message of messages) {
    await client.query(`
      insert into chat_messages (id, conversation_id, sender_id, content, created_at)
      values ($1,$2,$3,$4,$5)
      on conflict (id) do update set
        conversation_id = excluded.conversation_id,
        sender_id = excluded.sender_id,
        content = excluded.content,
        created_at = excluded.created_at
    `, message);
  }
}

async function seedIntelligentOpsDemo(client, users, deviceIds) {
  const patterns = [
    ['DEMO-MIC-001', users.zhang, -28, 'morning', 8, 12, 'completed', 'normal'],
    ['DEMO-MIC-001', users.li, -25, 'afternoon', 12, 17, 'completed', 'normal'],
    ['DEMO-MIC-001', users.zhang, -21, 'afternoon', 12, 17, 'completed', 'normal'],
    ['DEMO-OSC-001', users.li, -19, 'afternoon', 12, 17, 'completed', 'normal'],
    ['DEMO-OSC-001', users.zhang, -16, 'evening', 17, 22, 'completed', 'normal'],
    ['DEMO-CAM-001', users.li, -14, 'afternoon', 12, 17, 'completed', 'normal'],
    ['DEMO-LAS-001', users.zhang, -12, 'evening', 17, 22, 'completed', 'minor_scratch'],
    ['DEMO-MIC-001', users.li, -10, 'afternoon', 12, 17, 'completed', 'normal'],
    ['DEMO-OSC-001', users.zhang, -8, 'afternoon', 12, 17, 'completed', 'normal'],
    ['DEMO-LAS-001', users.li, -6, 'evening', 17, 22, 'completed', 'normal'],
    ['DEMO-INC-001', users.zhang, -5, 'morning', 8, 12, 'completed', 'temperature_unstable'],
    ['DEMO-OSC-001', users.li, -4, 'afternoon', 12, 17, 'completed', 'normal']
  ];

  for (let index = 0; index < patterns.length; index += 1) {
    const [deviceCode, userId, days, slotKey, startHour, endHour, status, condition] = patterns[index];
    const batchId = uuid(1201 + index);
    const reservationId = uuid(1301 + index);
    const itemId = uuid(1401 + index);
    const borrowId = uuid(1501 + index);
    const start = atDay(days, startHour);
    const end = atDay(days, endHour);
    const returnTime = addHours(end, condition === 'normal' ? -0.2 : 0.4);
    const purpose = `智能运营演示：${slotKey} 时段使用 ${deviceCode}`;
    await upsertBatch(client, {
      id: batchId,
      user_id: userId,
      device_codes: deviceCode,
      time_slots: slotKey,
      purpose,
      status,
      created_at: addHours(start, -24).toISOString(),
      admin_note: '智能运营演示历史批次'
    });
    const reservation = {
      id: reservationId,
      item_id: itemId,
      batch_id: batchId,
      device_id: deviceIds[deviceCode],
      user_id: userId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      purpose,
      status,
      slot_key: slotKey,
      approved_at: addHours(start, -20).toISOString(),
      created_at: addHours(start, -24).toISOString()
    };
    await upsertReservation(client, reservation);
    await upsertReservationItem(client, reservation);
    await upsertBorrow(client, {
      id: borrowId,
      reservation_id: reservationId,
      reservation_item_id: itemId,
      device_id: deviceIds[deviceCode],
      user_id: userId,
      borrow_time: start.toISOString(),
      expected_return_time: end.toISOString(),
      return_time: returnTime.toISOString(),
      duration_minutes: Math.max(1, Math.round((returnTime.getTime() - start.getTime()) / 60_000)),
      return_condition: condition,
      return_note: condition === 'normal' ? '智能运营演示：正常归还。' : `智能运营演示：${condition}，已纳入风险判断。`,
      status: condition === 'normal' ? 'returned' : 'abnormal_pending',
      is_overdue: returnTime > end,
      return_photos: condition === 'normal' ? [] : ['/uploads/demo/return-abnormal.jpg'],
      created_at: start.toISOString()
    });
    await insertUsageLog(client, {
      id: uuid(1601 + index),
      record_id: borrowId,
      reservation_id: reservationId,
      device_id: deviceIds[deviceCode],
      user_id: userId,
      action: 'RETURN',
      device_code: deviceCode,
      device_name: deviceCode,
      user_name: userId === users.zhang ? '张三' : '李四',
      user_phone: userId === users.zhang ? '13800000001' : '13800000002',
      user_student_no: userId === users.zhang ? 'S2026001' : 'S2026002',
      borrow_time: start.toISOString(),
      expected_return_time: end.toISOString(),
      return_time: returnTime.toISOString(),
      duration_minutes: Math.max(1, Math.round((returnTime.getTime() - start.getTime()) / 60_000)),
      return_condition: condition,
      return_note: condition === 'normal' ? '正常归还' : '异常归还',
      record_status: condition === 'normal' ? 'returned' : 'abnormal_pending',
      operator_name: userId === users.zhang ? '张三' : '李四',
      created_at: returnTime.toISOString()
    });
  }

  const futureWork = [
    ['DEMO-MIC-001', users.zhang, 1, 'afternoon', 12, 17],
    ['DEMO-LAS-001', users.li, 2, 'evening', 17, 22],
    ['DEMO-CEN-001', users.zhang, 3, 'morning', 8, 12]
  ];
  for (let index = 0; index < futureWork.length; index += 1) {
    const [deviceCode, userId, days, slotKey, startHour, endHour] = futureWork[index];
    const batchId = uuid(1801 + index);
    const reservationId = uuid(1811 + index);
    const itemId = uuid(1821 + index);
    await upsertBatch(client, {
      id: batchId,
      user_id: userId,
      device_codes: deviceCode,
      time_slots: slotKey,
      purpose: `智能运营演示：未来待审批 ${deviceCode}`,
      status: 'pending',
      created_at: atDay(-1, 18 + index).toISOString(),
      submit_note: '用于展示智能运营待处理工作量。'
    });
    const reservation = {
      id: reservationId,
      item_id: itemId,
      batch_id: batchId,
      device_id: deviceIds[deviceCode],
      user_id: userId,
      start_time: atDay(days, startHour).toISOString(),
      end_time: atDay(days, endHour).toISOString(),
      purpose: `智能运营演示：未来待审批 ${deviceCode}`,
      status: 'pending',
      slot_key: slotKey,
      created_at: atDay(-1, 18 + index).toISOString()
    };
    await upsertReservation(client, reservation);
    await upsertReservationItem(client, reservation);
  }

  await upsertBorrow(client, {
    id: uuid(1901),
    device_id: deviceIds['DEMO-LAS-001'],
    user_id: users.li,
    borrow_time: atDay(-1, 9).toISOString(),
    expected_return_time: atDay(-1, 17).toISOString(),
    status: 'in_use',
    is_overdue: true,
    return_photos: [],
    created_at: atDay(-1, 9).toISOString()
  });

  const riskFaults = [
    { id: uuid(1701), device_id: deviceIds['DEMO-LAS-001'], user_id: users.li, issue_type: '切割精度偏移', severity: 'high', description: '连续两次任务出现偏移，建议校准光路。', status: 'pending', created_at: atDay(-6, 21).toISOString() },
    { id: uuid(1702), device_id: deviceIds['DEMO-LAS-001'], user_id: users.zhang, issue_type: '排烟异常', severity: 'normal', description: '排烟风量偏低，使用后有明显残留气味。', status: 'processing', admin_note: '已安排检查排风管路。', created_at: atDay(-3, 18).toISOString() },
    { id: uuid(1703), device_id: deviceIds['DEMO-OSC-001'], user_id: users.zhang, issue_type: '探头接触不良', severity: 'normal', description: '1 号通道探头偶发接触不良。', status: 'resolved', admin_note: '已更换探头。', created_at: atDay(-11, 14).toISOString(), resolved_at: atDay(-10, 10).toISOString() },
    { id: uuid(1704), device_id: deviceIds['DEMO-INC-001'], user_id: users.li, issue_type: '温控报警复现', severity: 'high', description: '智能运营演示：恒温培养箱温控报警复现。', status: 'pending', created_at: atDay(-1, 16).toISOString() }
  ];
  for (const fault of riskFaults) await upsertFault(client, fault);
}

async function seedDenseCalendarDemo(client, users, deviceIds) {
  const slotHours = {
    morning: [8, 12],
    afternoon: [12, 17],
    evening: [17, 22],
    night: [22, 32],
    daytime: [8, 22]
  };
  const entries = [
    ['DEMO-MIC-001', users.zhang, 5, 'morning', 'pending'],
    ['DEMO-OSC-001', users.li, 5, 'morning', 'approved'],
    ['DEMO-PCR-001', users.zhang, 5, 'morning', 'approved'],
    ['DEMO-SPC-001', users.li, 5, 'morning', 'pending'],
    ['DEMO-CEN-001', users.zhang, 5, 'morning', 'approved'],
    ['DEMO-LAS-001', users.li, 5, 'afternoon', 'pending'],
    ['DEMO-ROBOT-001', users.zhang, 5, 'afternoon', 'approved'],
    ['DEMO-CAM-001', users.li, 5, 'evening', 'approved'],
    ['DEMO-VAC-001', users.zhang, 5, 'night', 'approved'],

    ['DEMO-ROBOT-001', users.li, 6, 'morning', 'pending'],
    ['DEMO-MIC-001', users.li, 6, 'afternoon', 'approved'],
    ['DEMO-OSC-001', users.zhang, 6, 'afternoon', 'pending'],
    ['DEMO-PCR-001', users.li, 6, 'afternoon', 'approved'],
    ['DEMO-SPC-001', users.zhang, 6, 'daytime', 'pending'],
    ['DEMO-CEN-001', users.li, 6, 'daytime', 'approved'],
    ['DEMO-LAS-001', users.zhang, 6, 'evening', 'approved'],
    ['DEMO-CAM-001', users.zhang, 6, 'evening', 'pending'],
    ['DEMO-VAC-001', users.li, 6, 'night', 'approved'],

    ['DEMO-LAS-001', users.li, 7, 'morning', 'pending'],
    ['DEMO-CEN-001', users.zhang, 7, 'morning', 'approved'],
    ['DEMO-SPC-001', users.li, 7, 'afternoon', 'approved'],
    ['DEMO-ROBOT-001', users.zhang, 7, 'afternoon', 'pending'],
    ['DEMO-MIC-001', users.li, 7, 'evening', 'approved'],
    ['DEMO-OSC-001', users.zhang, 7, 'evening', 'pending'],
    ['DEMO-PCR-001', users.zhang, 7, 'evening', 'approved'],
    ['DEMO-VAC-001', users.li, 7, 'daytime', 'approved'],

    ['DEMO-MIC-001', users.zhang, 8, 'morning', 'approved'],
    ['DEMO-PCR-001', users.li, 8, 'afternoon', 'pending'],
    ['DEMO-ROBOT-001', users.zhang, 8, 'evening', 'approved'],
    ['DEMO-SPC-001', users.li, 9, 'morning', 'approved'],
    ['DEMO-CEN-001', users.zhang, 9, 'afternoon', 'pending'],
    ['DEMO-LAS-001', users.li, 10, 'evening', 'approved'],
    ['DEMO-VAC-001', users.zhang, 10, 'night', 'pending'],
    ['DEMO-OSC-001', users.li, 11, 'morning', 'approved'],
    ['DEMO-CAM-001', users.zhang, 12, 'afternoon', 'pending'],
    ['DEMO-PCR-001', users.zhang, 13, 'morning', 'approved'],
    ['DEMO-SPC-001', users.li, 13, 'afternoon', 'pending'],
    ['DEMO-ROBOT-001', users.li, 14, 'evening', 'approved']
  ];

  for (let index = 0; index < entries.length; index += 1) {
    const [deviceCode, userId, days, slotKey, status] = entries[index];
    const [startHour, rawEndHour] = slotHours[slotKey] || [8, 12];
    const endDayOffset = rawEndHour >= 24 ? days + 1 : days;
    const endHour = rawEndHour >= 24 ? rawEndHour - 24 : rawEndHour;
    const batchId = uuid(2100 + index);
    const reservationId = uuid(2200 + index);
    const itemId = uuid(2300 + index);
    const purpose = `演示：日历色块压力测试 ${deviceCode} ${slotKey}（第 ${index + 1} 条）`;
    const createdAt = atDay(-1, 8 + (index % 8), (index % 4) * 10).toISOString();
    await upsertBatch(client, {
      id: batchId,
      user_id: userId,
      device_codes: deviceCode,
      time_slots: slotKey,
      purpose,
      status,
      created_at: createdAt,
      submit_note: '演示数据：用于检查密集日历、设备色块、预约浮层和权限边界。',
      admin_note: status === 'pending' ? null : '演示数据：已通过，用于日历展示。'
    });
    const reservation = {
      id: reservationId,
      item_id: itemId,
      batch_id: batchId,
      device_id: deviceIds[deviceCode],
      user_id: userId,
      start_time: atDay(days, startHour).toISOString(),
      end_time: atDay(endDayOffset, endHour).toISOString(),
      purpose,
      status,
      slot_key: slotKey,
      admin_note: status === 'pending' ? null : '演示数据：已通过，用于日历展示。',
      approved_at: status === 'pending' ? null : atDay(-1, 17).toISOString(),
      created_at: createdAt
    };
    await upsertReservation(client, reservation);
    await upsertReservationItem(client, reservation);
  }
}

async function seedRequestsNotificationsDemo(client, users, deviceIds) {
  const requests = [
    { id: uuid(3001), user_id: users.zhang, device_id: deviceIds['DEMO-SEM-001'], category: 'feature', title: '希望开放扫描电镜预约培训', description: '课题组近期有微纳形貌观察需求，希望增加 SEM 培训说明和预约前置条件。', priority: 'high', status: 'pending', created_at: atDay(-2, 10).toISOString() },
    { id: uuid(3002), user_id: users.li, device_id: deviceIds['DEMO-VAC-001'], category: 'rule', title: '跨夜设备希望显示紧急联系人', description: '真空干燥箱跨夜使用时，日历浮层中如果能展示紧急联系人会更安全。', priority: 'normal', status: 'confirmed', admin_note: '已纳入智能管理 4.0 交互优化清单。', confirmed_by: users.admin, confirmed_at: atDay(-1, 9).toISOString(), locked_at: atDay(-1, 9).toISOString(), created_at: atDay(-4, 16).toISOString() },
    { id: uuid(3003), user_id: users.zhang, device_id: deviceIds['DEMO-HPLC-001'], category: 'maintenance', title: 'HPLC 泵压异常需要补充图片说明', description: '归还时拍摄的压力曲线和管路照片需要与设备记录关联，方便后续排查。', priority: 'urgent', status: 'change_requested', change_request_note: '补充异常发生的流动相、流速和柱温信息。', admin_note: '请补充使用条件后再确认处理方案。', created_at: atDay(-1, 18).toISOString() },
    { id: uuid(3004), user_id: users.li, device_id: deviceIds['DEMO-BAL-001'], category: 'ui', title: '天平高频预约希望减少页面占位', description: '一天内多次短时使用时，列表展示太长，希望以色块和浮层查看详情。', priority: 'normal', status: 'confirmed', admin_note: '已通过，将在日历交互中统一优化。', confirmed_by: users.admin, confirmed_at: atDay(-2, 13).toISOString(), locked_at: atDay(-2, 13).toISOString(), created_at: atDay(-6, 15).toISOString() },
    { id: uuid(3005), user_id: users.wang, device_id: deviceIds['DEMO-STER-001'], category: 'access', title: '申请查看停用设备说明', description: '希望停用设备仍展示原因和替代设备建议。', priority: 'low', status: 'rejected', admin_note: '账号仍待审核，暂不处理设备诉求。', confirmed_by: users.admin, confirmed_at: atDay(-1, 11).toISOString(), locked_at: atDay(-1, 11).toISOString(), created_at: atDay(-1, 8).toISOString() },
    { id: uuid(3006), user_id: users.zhang, device_id: deviceIds['DEMO-FURN-001'], category: 'safety', title: '马弗炉跨夜使用希望增加归还照片要求', description: '高温设备使用后建议必须上传炉膛、温控面板和样品位置照片。', priority: 'high', status: 'pending', created_at: atDay(-1, 20).toISOString() }
  ];
  for (const request of requests) await upsertUserRequestDemo(client, request);

  const notifications = [
    { id: uuid(3101), user_id: users.zhang, type: 'user_request', title: '诉求已收到：扫描电镜培训', content: '管理员将确认扫描电镜培训与预约前置条件。', related_type: 'user_request', related_id: uuid(3001), device_id: deviceIds['DEMO-SEM-001'], created_at: atDay(-2, 10, 5).toISOString() },
    { id: uuid(3102), user_id: users.li, type: 'user_request', title: '诉求已确认：跨夜设备联系人', content: '你的跨夜设备联系人展示诉求已确认，将进入版本优化。', related_type: 'user_request', related_id: uuid(3002), device_id: deviceIds['DEMO-VAC-001'], is_read: true, read_at: atDay(-1, 10).toISOString(), created_at: atDay(-1, 9, 5).toISOString() },
    { id: uuid(3103), user_id: users.zhang, type: 'fault', title: 'HPLC 异常需要补充信息', content: '请补充流动相、流速和柱温信息，便于管理员判断是否恢复开放。', related_type: 'user_request', related_id: uuid(3003), device_id: deviceIds['DEMO-HPLC-001'], created_at: atDay(-1, 18, 30).toISOString() },
    { id: uuid(3104), user_id: users.li, type: 'reservation', title: '马弗炉跨夜安全提醒', content: '跨夜使用高温设备请确认紧急联系人，并按要求完成归还确认。', device_id: deviceIds['DEMO-FURN-001'], created_at: atDay(0, 8).toISOString() },
    { id: uuid(3105), user_id: users.zhang, type: 'system', title: '智能管理 4.0 演示数据已更新', content: '已加入更多设备、权限边界、诉求、故障和通知样本，便于发现页面问题。', created_at: addHours(new Date(), -1).toISOString() }
  ];
  for (const notification of notifications) await upsertNotificationDemo(client, notification);

  const lifecycleFaults = [
    { id: uuid(3201), device_id: deviceIds['DEMO-HPLC-001'], user_id: users.zhang, issue_type: '泵压波动', severity: 'high', description: '压力曲线出现周期性波动，等待用户补充现场照片与方法参数。', status: 'pending', created_at: atDay(-1, 17).toISOString() },
    { id: uuid(3202), device_id: deviceIds['DEMO-XRD-001'], user_id: users.li, issue_type: '样品台校准', severity: 'normal', description: '样品台零点偏移，工程师已接单处理中。', status: 'processing', admin_note: '已暂停预约并安排校准。', created_at: atDay(-2, 14).toISOString() },
    { id: uuid(3203), device_id: deviceIds['DEMO-FTIR-001'], user_id: users.zhang, issue_type: '背景噪声偏高', severity: 'normal', description: '更换干燥剂后背景噪声恢复正常。', status: 'resolved', admin_note: '已处理并恢复开放。', created_at: atDay(-8, 13).toISOString(), resolved_at: atDay(-7, 10).toISOString() },
    { id: uuid(3204), device_id: deviceIds['DEMO-STER-001'], user_id: users.li, issue_type: '压力阀老化', severity: 'high', description: '设备停用归档，保留用于演示 closed 故障生命周期。', status: 'closed', admin_note: '设备停用，建议迁移至替代灭菌设备。', created_at: atDay(-12, 9).toISOString(), resolved_at: atDay(-10, 16).toISOString() }
  ];
  for (const fault of lifecycleFaults) await upsertFault(client, fault);

  const operationLogs = [
    { id: uuid(3301), operator_id: users.admin, operator_name: '演示超级管理员', action: 'review_user_request', target_type: 'user_request', target_id: uuid(3002), detail: { status: 'confirmed', module: 'requests', permission: 'user.manage' }, created_at: atDay(-1, 9).toISOString() },
    { id: uuid(3302), operator_id: users.adminFault, operator_name: '演示故障管理员', action: 'resolve_device_fault', target_type: 'fault_report', target_id: uuid(3202), detail: { status: 'processing', device_code: 'DEMO-XRD-001', permission: 'fault.manage' }, created_at: atDay(-2, 15).toISOString() },
    { id: uuid(3303), operator_id: users.adminAuditor, operator_name: '演示数据审计员', action: 'export_faults', target_type: 'export', target_id: uuid(3303), detail: { type: 'faults', permissions: ['stats.export', 'device.view'] }, created_at: atDay(-1, 12).toISOString() },
    { id: uuid(3304), operator_id: users.admin, operator_name: '演示超级管理员', action: 'update_security_config', target_type: 'system', target_id: users.admin, detail: { scope: 'super_admin_only', module: 'system' }, created_at: atDay(-3, 17).toISOString() }
  ];
  for (const item of operationLogs) await insertOperationLog(client, item);
}

async function ensureDemoUploadAssets() {
  const uploadDir = loadConfig().uploadDir;
  const demoDir = path.join(uploadDir, 'demo');
  // A tiny valid JPEG keeps seeded records usable without shipping photo data.
  const placeholder = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=', 'base64');
  await fs.promises.mkdir(demoDir, { recursive: true });
  await Promise.all(['return-abnormal.jpg', 'return-mic.jpg', 'fault-incubator.jpg'].map((name) =>
    fs.promises.writeFile(path.join(demoDir, name), placeholder)
  ));
}

async function main() {
  assertSeedTarget(connectionString);
  await ensureDemoUploadAssets();
  const pool = new Pool({ connectionString, ssl: postgresSslOptions() });
  const client = await pool.connect();

  try {
    await client.query('begin');
    await ensureDemoSchema(client);

    const users = {
      admin: await upsertUser(client, { id: uuid(1), name: '演示超级管理员', phone: '13900000000', student_no: 'ADMIN001', group_name: '设备中心', email: 'admin.demo@example.com', password: '123456', role: 'super_admin', status: 'active', created_at: atDay(-60, 9).toISOString() }),
      zhang: await upsertUser(client, { id: uuid(2), name: '张三', phone: '13800000001', student_no: 'S2026001', group_name: '材料学院', email: 'zhangsan.demo@example.com', password: '123456', role: 'user', status: 'active', created_at: atDay(-35, 10).toISOString() }),
      li: await upsertUser(client, { id: uuid(3), name: '李四', phone: '13800000002', student_no: 'S2026002', group_name: '电子学院', email: 'lisi.demo@example.com', password: '123456', role: 'user', status: 'active', created_at: atDay(-18, 11).toISOString() }),
      wang: await upsertUser(client, { id: uuid(4), name: '王五（待审核）', phone: '13800000003', student_no: 'S2026003', group_name: '生命学院', email: 'wangwu.demo@example.com', password: '123456', role: 'user', status: 'pending', created_at: atDay(-1, 15).toISOString(), last_login_at: null }),
      zhao: await upsertUser(client, { id: uuid(5), name: '赵六（账号封禁）', phone: '13800000004', student_no: 'S2026004', group_name: '化学学院', email: 'zhaoliu.demo@example.com', password: '123456', role: 'user', status: 'active', is_banned: true, created_at: atDay(-12, 9).toISOString() }),
      qian: await upsertUser(client, { id: uuid(6), name: '钱七（审核驳回）', phone: '13800000005', student_no: 'S2026005', group_name: '机械学院', email: 'qianqi.demo@example.com', password: '123456', role: 'user', status: 'rejected', created_at: atDay(-6, 12).toISOString() }),
      adminReadonly: await upsertUser(client, { id: uuid(10), name: '演示普通管理员（无预约审批）', phone: '13900000010', student_no: 'ADMIN010', group_name: '设备中心', email: 'admin.readonly.demo@example.com', password: '123456', role: 'admin', status: 'active', created_at: atDay(-50, 9).toISOString() }),
      adminReservation: await upsertUser(client, { id: uuid(11), name: '演示预约管理员', phone: '13900000011', student_no: 'ADMIN011', group_name: '设备中心', email: 'admin.reservation.demo@example.com', password: '123456', role: 'admin', status: 'active', created_at: atDay(-45, 9).toISOString() }),
      adminFault: await upsertUser(client, { id: uuid(12), name: '演示故障管理员', phone: '13900000012', student_no: 'ADMIN012', group_name: '设备中心', email: 'admin.fault.demo@example.com', password: '123456', role: 'admin', status: 'active', created_at: atDay(-40, 9).toISOString() }),
      adminAuditor: await upsertUser(client, { id: uuid(13), name: '演示数据审计员', phone: '13900000013', student_no: 'ADMIN013', group_name: '设备中心', email: 'admin.auditor.demo@example.com', password: '123456', role: 'admin', status: 'active', created_at: atDay(-38, 9).toISOString() })
    };

    await upsertAdminRole(client, { id: uuid(90), user_id: users.admin, role_key: 'super_admin', permissions: ['*'], note: '演示超级管理员，拥有全部权限' });
    await upsertAdminRole(client, {
      id: uuid(91),
      user_id: users.adminReadonly,
      role_key: 'admin',
      permissions: ['user.manage', 'user.approve', 'device.view', 'device.manage', 'reservation.view', 'fault.manage', 'stats.view'],
      note: '普通管理员：可查看预约，但默认不能改变用户预约计划'
    });
    await upsertAdminRole(client, {
      id: uuid(92),
      user_id: users.adminReservation,
      role_key: 'admin',
      permissions: ['user.manage', 'device.view', 'reservation.view', 'reservation.approve', 'stats.view'],
      note: '已授予 reservation.approve，可审批/驳回用户预约'
    });
    await upsertAdminRole(client, {
      id: uuid(93),
      user_id: users.adminFault,
      role_key: 'admin',
      permissions: ['device.view', 'fault.manage', 'reservation.view', 'stats.view'],
      note: '故障管理员：可查看设备/预约并处理故障，但不能审批预约或修改用户'
    });
    await upsertAdminRole(client, {
      id: uuid(94),
      user_id: users.adminAuditor,
      role_key: 'auditor',
      permissions: ['audit.view', 'reservation.view', 'return.view', 'device.view'],
      note: '数据审计员：可查看统计和导出授权范围内文档，不可修改业务数据'
    });

    const deviceIds = {};
    const devices = [
      { id: uuid(101), device_code: 'DEMO-MIC-001', name: '荧光显微镜', category: '成像分析', location: 'A 楼 301', manager: '赵老师', status: 'available', allow_reservation: true, description: '用于细胞样品荧光观察，支持多通道成像。', usage_notice: '使用前请检查镜头洁净度，结束后关闭光源。' },
      { id: uuid(102), device_code: 'DEMO-OSC-001', name: '数字示波器', category: '电子测量', location: 'B 楼 205', manager: '钱老师', status: 'reserved', allow_reservation: true, description: '4 通道数字示波器，适合电路调试与信号采集。', usage_notice: '探头倍率需和软件设置一致。' },
      { id: uuid(103), device_code: 'DEMO-CAM-001', name: '高速摄像机', category: '影像采集', location: 'C 楼 108', manager: '孙老师', status: 'in_use', allow_reservation: true, description: '用于高速运动拍摄和过程分析。', usage_notice: '请提前准备存储卡并确认补光。' },
      { id: uuid(104), device_code: 'DEMO-INC-001', name: '恒温培养箱', category: '生命科学', location: 'D 楼 412', manager: '周老师', status: 'abnormal_pending', allow_reservation: false, description: '用于样品恒温培养和稳定性观察。', usage_notice: '当前温度波动异常，待处理期间暂停预约。' },
      { id: uuid(105), device_code: 'DEMO-3DP-001', name: '3D 打印机', category: '加工制造', location: '创新工坊', manager: '吴老师', status: 'maintenance', allow_reservation: false, description: '用于 PLA/ABS 快速原型打印。', usage_notice: '喷头维护中，恢复后开放预约。' },
      { id: uuid(106), device_code: 'DEMO-OLD-001', name: '停用旧设备', category: '历史设备', location: '仓库', manager: '管理员', status: 'disabled', allow_reservation: false, description: '演示停用状态。', usage_notice: '该设备不再开放预约。' },
      { id: uuid(107), device_code: 'DEMO-LAS-001', name: '激光切割机', category: '加工制造', location: '创新工坊', manager: '郑老师', status: 'in_use', allow_reservation: true, description: '用于亚克力、木板与薄板材料切割，是智能运营风险预警演示设备。', usage_notice: '使用前确认排烟系统，严禁无人值守。' },
      { id: uuid(108), device_code: 'DEMO-CEN-001', name: '低温离心机', category: '生命科学', location: 'D 楼 208', manager: '陈老师', status: 'available', allow_reservation: true, description: '用于样品低温离心分离，是智能运营低利用率优化演示设备。', usage_notice: '请提前配平样品并确认转子型号。' },
      { id: uuid(109), device_code: 'DEMO-PCR-001', name: '实时荧光 PCR 仪', category: '生命科学', location: 'D 楼 216', manager: '林老师', status: 'available', allow_reservation: true, reservation_slot_keys: ['morning', 'afternoon', 'evening'], description: '用于核酸定量检测，演示多时段高频预约。', usage_notice: '请提前准备耗材并完成模板登记。' },
      { id: uuid(110), device_code: 'DEMO-SPC-001', name: '紫外可见分光光度计', category: '分析检测', location: 'A 楼 220', manager: '何老师', status: 'available', allow_reservation: true, reservation_slot_keys: ['morning', 'afternoon', 'daytime'], description: '用于样品吸收光谱测试，演示同日多设备排期。', usage_notice: '请使用洁净比色皿，结束后导出数据。' },
      { id: uuid(111), device_code: 'DEMO-VAC-001', name: '真空干燥箱', category: '材料制备', location: 'C 楼 307', manager: '高老师', status: 'available', allow_reservation: true, reservation_slot_keys: ['daytime', 'night'], description: '用于长时间干燥任务，演示跨夜预约色块。', usage_notice: '跨夜使用请确认样品标签与紧急联系人。' },
      { id: uuid(112), device_code: 'DEMO-ROBOT-001', name: '协作机械臂', category: '自动化', location: '创新工坊', manager: '邓老师', status: 'reserved', allow_reservation: true, reservation_slot_keys: ['morning', 'afternoon', 'evening'], description: '用于运动控制和自动化实验，演示未来密集预约。', usage_notice: '使用前必须完成安全围栏检查。' }
    ];
    devices.push(
      { id: uuid(113), device_code: 'DEMO-SEM-001', name: '扫描电镜', category: '表征分析', location: 'A 楼 505', manager: '郑老师', status: 'available', allow_reservation: true, reservation_slot_keys: ['morning', 'afternoon'], description: '用于微纳形貌观察，适合演示高价值设备预约审批与风险提示。', usage_notice: '预约前需完成样品导电处理，使用后确认样品仓清洁。' },
      { id: uuid(114), device_code: 'DEMO-XRD-001', name: 'X 射线衍射仪', category: '材料表征', location: 'A 楼 508', manager: '韩老师', status: 'maintenance', allow_reservation: false, reservation_slot_keys: ['morning', 'afternoon'], description: '用于晶体结构分析，当前演示维护中状态。', usage_notice: '维护期间暂停预约，恢复后需管理员开放。' },
      { id: uuid(115), device_code: 'DEMO-RHEO-001', name: '流变仪', category: '材料测试', location: 'B 楼 318', manager: '罗老师', status: 'available', allow_reservation: true, reservation_slot_keys: ['morning', 'afternoon', 'evening'], description: '用于浆料与高分子样品流变测试，演示连续时段预约。', usage_notice: '测试前确认转子型号，结束后清洁夹具。' },
      { id: uuid(116), device_code: 'DEMO-FTIR-001', name: '傅里叶红外光谱仪', category: '分析检测', location: 'B 楼 322', manager: '许老师', status: 'available', allow_reservation: true, reservation_slot_keys: ['morning', 'afternoon', 'daytime'], description: '用于官能团与材料成分分析，演示普通高频设备。', usage_notice: '请保持 ATR 晶体清洁，数据自行导出备份。' },
      { id: uuid(117), device_code: 'DEMO-HPLC-001', name: '高效液相色谱仪', category: '分析检测', location: 'C 楼 406', manager: '沈老师', status: 'abnormal_pending', allow_reservation: false, reservation_slot_keys: ['daytime'], description: '用于复杂样品分离检测，当前演示异常待确认。', usage_notice: '泵压异常排查中，暂不开放预约。' },
      { id: uuid(118), device_code: 'DEMO-BAL-001', name: '万分之一天平', category: '基础仪器', location: 'C 楼 201', manager: '刘老师', status: 'available', allow_reservation: true, reservation_slot_keys: ['morning', 'afternoon', 'evening'], description: '用于精密称量，演示低门槛高频设备。', usage_notice: '称量后清洁台面，关闭防风罩。' },
      { id: uuid(119), device_code: 'DEMO-FURN-001', name: '马弗炉', category: '材料制备', location: 'C 楼 510', manager: '郭老师', status: 'in_use', allow_reservation: true, reservation_slot_keys: ['daytime', 'night'], description: '用于高温烧结与灰化，演示长时间/跨夜使用。', usage_notice: '高温设备必须填写紧急联系人，禁止无人值守异常升温。' },
      { id: uuid(120), device_code: 'DEMO-STER-001', name: '高压灭菌锅', category: '生命科学', location: 'D 楼 105', manager: '曹老师', status: 'disabled', allow_reservation: false, reservation_slot_keys: ['morning', 'afternoon'], description: '用于灭菌处理，当前演示停用设备。', usage_notice: '停用设备不可预约，仅用于权限和状态展示。' }
    );
    const demoReturnRules = [
      ['DEMO-MIC-001', 'image_required', false],
      ['DEMO-OSC-001', 'confirm_only', false],
      ['DEMO-CAM-001', 'image_required', true],
      ['DEMO-INC-001', 'image_required', true],
      ['DEMO-3DP-001', 'image_optional', true],
      ['DEMO-LAS-001', 'image_required', true],
      ['DEMO-CEN-001', 'confirm_only', false],
      ['DEMO-PCR-001', 'image_optional', false],
      ['DEMO-SPC-001', 'image_optional', false],
      ['DEMO-VAC-001', 'image_required', true],
      ['DEMO-BAL-001', 'confirm_only', false],
      ['DEMO-FURN-001', 'image_required', true]
    ];
    const returnRuleMap = new Map(demoReturnRules.map(([code, mode, requireNote]) => [code, { mode, requireNote }]));
    for (const device of devices) {
      const rule = returnRuleMap.get(device.device_code) || { mode: 'image_optional', requireNote: false };
      device.return_mode = device.return_mode || rule.mode;
      device.return_require_note = device.return_require_note ?? rule.requireNote;
    }
    for (const device of devices) deviceIds[device.device_code] = await upsertDevice(client, device);
    await upsertDeviceSlots(client, deviceIds);

    const batches = [
      { id: uuid(201), user_id: users.zhang, device_codes: 'DEMO-MIC-001,DEMO-OSC-001', time_slots: '明天上午、后天下午', purpose: '演示：多设备多日期预约待审核', status: 'pending', created_at: atDay(-1, 16).toISOString(), submit_note: '希望连续两天完成观察和信号采集。' },
      { id: uuid(202), user_id: users.li, device_codes: 'DEMO-OSC-001', time_slots: '后天下午', purpose: '演示：已通过预约', status: 'approved', created_at: atDay(-2, 14).toISOString(), admin_note: '演示管理员已通过。' },
      { id: uuid(203), user_id: users.zhang, device_codes: 'DEMO-CAM-001', time_slots: '今天使用中', purpose: '演示：当前使用中', status: 'approved', created_at: atDay(-3, 9).toISOString(), admin_note: '已开始使用。' },
      { id: uuid(204), user_id: users.li, device_codes: 'DEMO-MIC-001', time_slots: '过去一周已完成', purpose: '演示：历史完成记录', status: 'completed', created_at: atDay(-8, 10).toISOString(), admin_note: '使用完成。' },
      { id: uuid(205), user_id: users.wang, device_codes: 'DEMO-INC-001', time_slots: '故障设备预约', purpose: '演示：故障设备被拒绝', status: 'rejected', created_at: atDay(-1, 11).toISOString(), admin_note: '设备异常待处理，暂不可预约。' },
      { id: uuid(206), user_id: users.zhang, device_codes: 'DEMO-PCR-001,DEMO-SPC-001,DEMO-ROBOT-001', time_slots: '明天上午/下午/晚上密集预约', purpose: '演示：同一天多设备密集排期，用于检查日历色块和浮层', status: 'pending', created_at: atDay(-1, 19).toISOString(), submit_note: '希望在同一天完成前处理、检测与机械臂演示。' },
      { id: uuid(207), user_id: users.li, device_codes: 'DEMO-VAC-001', time_slots: '后天夜间跨日预约', purpose: '演示：跨夜长时段预约', status: 'approved', created_at: atDay(-2, 18).toISOString(), admin_note: '跨夜任务已确认样品标签。' },
      { id: uuid(208), user_id: users.li, device_codes: 'DEMO-PCR-001', time_slots: '大后天上午/下午连续预约', purpose: '演示：同设备同日不同时间段连续预约', status: 'pending', created_at: atDay(-1, 20).toISOString(), submit_note: '连续检测两批样品，便于观察时间色块。' }
    ];
    for (const batch of batches) await upsertBatch(client, batch);

    const reservations = [
      { id: uuid(301), item_id: uuid(401), batch_id: uuid(201), device_id: deviceIds['DEMO-MIC-001'], user_id: users.zhang, start_time: atDay(1, 8).toISOString(), end_time: atDay(1, 12).toISOString(), purpose: batches[0].purpose, status: 'pending', slot_key: 'morning', created_at: batches[0].created_at },
      { id: uuid(302), item_id: uuid(402), batch_id: uuid(201), device_id: deviceIds['DEMO-OSC-001'], user_id: users.zhang, start_time: atDay(2, 12).toISOString(), end_time: atDay(2, 17).toISOString(), purpose: batches[0].purpose, status: 'pending', slot_key: 'afternoon', created_at: batches[0].created_at },
      { id: uuid(303), item_id: uuid(403), batch_id: uuid(202), device_id: deviceIds['DEMO-OSC-001'], user_id: users.li, start_time: atDay(3, 12).toISOString(), end_time: atDay(3, 17).toISOString(), purpose: batches[1].purpose, status: 'approved', slot_key: 'afternoon', admin_note: '演示管理员已通过', approved_at: atDay(-1, 9).toISOString(), created_at: batches[1].created_at },
      { id: uuid(304), item_id: uuid(404), batch_id: uuid(203), device_id: deviceIds['DEMO-CAM-001'], user_id: users.zhang, start_time: atDay(0, 8).toISOString(), end_time: atDay(0, 22).toISOString(), purpose: batches[2].purpose, status: 'in_use', slot_key: 'daytime', admin_note: '已开始使用', approved_at: atDay(-2, 10).toISOString(), created_at: batches[2].created_at },
      { id: uuid(305), item_id: uuid(405), batch_id: uuid(204), device_id: deviceIds['DEMO-MIC-001'], user_id: users.li, start_time: atDay(-7, 8).toISOString(), end_time: atDay(-7, 12).toISOString(), purpose: batches[3].purpose, status: 'completed', slot_key: 'morning', admin_note: '已完成归还', approved_at: atDay(-8, 13).toISOString(), created_at: batches[3].created_at },
      { id: uuid(306), item_id: uuid(406), batch_id: uuid(205), device_id: deviceIds['DEMO-INC-001'], user_id: users.wang, start_time: atDay(4, 8).toISOString(), end_time: atDay(4, 12).toISOString(), purpose: batches[4].purpose, status: 'rejected', slot_key: 'morning', admin_note: batches[4].admin_note, created_at: batches[4].created_at },
      { id: uuid(307), item_id: uuid(407), batch_id: uuid(206), device_id: deviceIds['DEMO-PCR-001'], user_id: users.zhang, start_time: atDay(1, 8).toISOString(), end_time: atDay(1, 12).toISOString(), purpose: batches[5].purpose, status: 'pending', slot_key: 'morning', created_at: batches[5].created_at },
      { id: uuid(308), item_id: uuid(408), batch_id: uuid(206), device_id: deviceIds['DEMO-SPC-001'], user_id: users.zhang, start_time: atDay(1, 12).toISOString(), end_time: atDay(1, 17).toISOString(), purpose: batches[5].purpose, status: 'pending', slot_key: 'afternoon', created_at: batches[5].created_at },
      { id: uuid(309), item_id: uuid(409), batch_id: uuid(206), device_id: deviceIds['DEMO-ROBOT-001'], user_id: users.zhang, start_time: atDay(1, 17).toISOString(), end_time: atDay(1, 22).toISOString(), purpose: batches[5].purpose, status: 'pending', slot_key: 'evening', created_at: batches[5].created_at },
      { id: uuid(310), item_id: uuid(410), batch_id: uuid(207), device_id: deviceIds['DEMO-VAC-001'], user_id: users.li, start_time: atDay(2, 22).toISOString(), end_time: atDay(3, 8).toISOString(), purpose: batches[6].purpose, status: 'approved', slot_key: 'night', admin_note: batches[6].admin_note, approved_at: atDay(-1, 10).toISOString(), created_at: batches[6].created_at },
      { id: uuid(311), item_id: uuid(411), batch_id: uuid(208), device_id: deviceIds['DEMO-PCR-001'], user_id: users.li, start_time: atDay(4, 8).toISOString(), end_time: atDay(4, 12).toISOString(), purpose: batches[7].purpose, status: 'pending', slot_key: 'morning', created_at: batches[7].created_at },
      { id: uuid(312), item_id: uuid(412), batch_id: uuid(208), device_id: deviceIds['DEMO-PCR-001'], user_id: users.li, start_time: atDay(4, 12).toISOString(), end_time: atDay(4, 17).toISOString(), purpose: batches[7].purpose, status: 'pending', slot_key: 'afternoon', created_at: batches[7].created_at }
    ];
    for (const reservation of reservations) {
      await upsertReservation(client, reservation);
      await upsertReservationItem(client, reservation);
    }

    const borrows = [
      { id: uuid(501), reservation_id: uuid(304), reservation_item_id: uuid(404), device_id: deviceIds['DEMO-CAM-001'], user_id: users.zhang, borrow_time: addHours(new Date(), -2).toISOString(), expected_return_time: addHours(new Date(), 3).toISOString(), status: 'in_use', return_photos: [], created_at: addHours(new Date(), -2).toISOString() },
      { id: uuid(502), reservation_id: uuid(305), reservation_item_id: uuid(405), device_id: deviceIds['DEMO-MIC-001'], user_id: users.li, borrow_time: atDay(-7, 8).toISOString(), expected_return_time: atDay(-7, 12).toISOString(), return_time: atDay(-7, 11, 45).toISOString(), duration_minutes: 225, return_condition: 'normal', return_note: '设备状态正常，镜头已清洁。', status: 'returned', return_photos: ['/uploads/demo/return-mic.jpg'], created_at: atDay(-7, 8).toISOString() },
      { id: uuid(503), reservation_id: null, device_id: deviceIds['DEMO-INC-001'], user_id: users.zhang, borrow_time: atDay(-2, 13).toISOString(), expected_return_time: atDay(-2, 17).toISOString(), return_time: atDay(-2, 16, 40).toISOString(), duration_minutes: 220, return_condition: 'temperature_unstable', return_note: '归还时发现温度波动偏大，已提交故障报备。', status: 'abnormal_pending', return_photos: ['/uploads/demo/fault-incubator.jpg'], created_at: atDay(-2, 13).toISOString() }
    ];
    for (const borrow of borrows) await upsertBorrow(client, borrow);

    await upsertFault(client, { id: uuid(601), device_id: deviceIds['DEMO-INC-001'], user_id: users.zhang, borrow_record_id: uuid(503), issue_type: '温度异常', severity: 'high', description: '设定 37℃，实际读数在 35.8℃-38.5℃之间波动，影响继续使用。', photos: ['/uploads/demo/fault-incubator.jpg'], status: 'pending', created_at: atDay(-2, 16, 50).toISOString() });
    await upsertFault(client, { id: uuid(602), device_id: deviceIds['DEMO-3DP-001'], user_id: users.li, issue_type: '喷头堵塞', severity: 'normal', description: '打印前测试发现喷头出料不连续，管理员已安排维护。', status: 'processing', admin_note: '已联系维护人员，预计明日恢复。', created_at: atDay(-1, 10).toISOString() });

    await insertUsageLog(client, { id: uuid(701), record_id: uuid(501), reservation_id: uuid(304), device_id: deviceIds['DEMO-CAM-001'], user_id: users.zhang, action: 'BORROW', device_code: 'DEMO-CAM-001', device_name: '高速摄像机', user_name: '张三', user_phone: '13800000001', user_student_no: 'S2026001', borrow_time: borrows[0].borrow_time, expected_return_time: borrows[0].expected_return_time, record_status: 'in_use', operator_name: '张三', created_at: borrows[0].borrow_time });
    await insertUsageLog(client, { id: uuid(702), record_id: uuid(502), reservation_id: uuid(305), device_id: deviceIds['DEMO-MIC-001'], user_id: users.li, action: 'RETURN', device_code: 'DEMO-MIC-001', device_name: '荧光显微镜', user_name: '李四', user_phone: '13800000002', user_student_no: 'S2026002', borrow_time: borrows[1].borrow_time, expected_return_time: borrows[1].expected_return_time, return_time: borrows[1].return_time, duration_minutes: 225, return_condition: 'normal', return_note: borrows[1].return_note, record_status: 'returned', operator_name: '李四', created_at: borrows[1].return_time });
    await insertUsageLog(client, { id: uuid(703), record_id: uuid(503), device_id: deviceIds['DEMO-INC-001'], user_id: users.zhang, action: 'RETURN', device_code: 'DEMO-INC-001', device_name: '恒温培养箱', user_name: '张三', user_phone: '13800000001', user_student_no: 'S2026001', borrow_time: borrows[2].borrow_time, expected_return_time: borrows[2].expected_return_time, return_time: borrows[2].return_time, duration_minutes: 220, return_condition: 'temperature_unstable', return_note: borrows[2].return_note, record_status: 'abnormal_pending', operator_name: '张三', created_at: borrows[2].return_time });

    const activities = [
      ['register', users.wang, '王五（待审核）', '13800000003', '演示：新用户提交注册，等待后台审核', atDay(-1, 15).toISOString()],
      ['login', users.zhang, '张三', '13800000001', '演示：用户登录并查看预约记录', addHours(new Date(), -1).toISOString()],
      ['wechat_bind', users.li, '李四', '13800000002', '演示：用户完成微信绑定', atDay(-3, 12).toISOString()],
      ['ban', users.zhao, '赵六（账号封禁）', '13800000004', '演示：违规使用后被封禁，用于测试禁用态', atDay(-2, 17).toISOString()],
      ['reject', users.qian, '钱七（审核驳回）', '13800000005', '演示：注册资料不完整被驳回', atDay(-5, 16).toISOString()]
    ];
    for (let index = 0; index < activities.length; index += 1) {
      const [eventType, userId, name, phone, remark, createdAt] = activities[index];
      await client.query(`
        insert into user_activity_logs (id, user_id, event_type, user_name, phone, wechat_openid, device_type, client_key, ip_address, remark, created_at)
        values ($1,$2,$3,$4,$5,$6,'browser','demo','127.0.0.1',$7,$8)
        on conflict (id) do update set user_id = excluded.user_id, event_type = excluded.event_type, user_name = excluded.user_name, phone = excluded.phone, remark = excluded.remark, created_at = excluded.created_at
      `, [uuid(801 + index), userId, eventType, name, phone, `demo-openid-${index + 1}`, remark, createdAt]);
    }

    await insertOperationLog(client, { id: uuid(901), operator_id: users.admin, operator_name: '演示超级管理员', action: 'approve_reservation_batch', target_type: 'reservation_batch', target_id: uuid(202), detail: { message: '演示：通过李四的示波器预约批次' }, created_at: atDay(-1, 9).toISOString() });
    await insertOperationLog(client, { id: uuid(902), operator_id: users.admin, operator_name: '演示超级管理员', action: 'resolve_fault_processing', target_type: 'fault_report', target_id: uuid(602), detail: { message: '演示：3D 打印机喷头堵塞转处理中' }, created_at: atDay(-1, 11).toISOString() });
    await insertOperationLog(client, { id: uuid(903), operator_id: users.admin, operator_name: '演示超级管理员', action: 'grant_admin_role', target_type: 'user', target_id: users.admin, detail: { permissions: ['*'], role_key: 'super_admin' }, created_at: atDay(-2, 10).toISOString() });
    await insertOperationLog(client, { id: uuid(904), operator_id: users.admin, operator_name: '演示超级管理员', action: 'grant_admin_role', target_type: 'user', target_id: users.adminReadonly, detail: { permissions: ['reservation.view'], role_key: 'admin', note: '无 reservation.approve，不能改用户预约计划' }, created_at: atDay(-2, 10, 10).toISOString() });
    await insertOperationLog(client, { id: uuid(905), operator_id: users.admin, operator_name: '演示超级管理员', action: 'grant_admin_role', target_type: 'user', target_id: users.adminReservation, detail: { permissions: ['reservation.view', 'reservation.approve'], role_key: 'admin', note: '已授权预约审批' }, created_at: atDay(-2, 10, 20).toISOString() });
    await insertOperationLog(client, { id: uuid(906), operator_id: users.admin, operator_name: '演示超级管理员', action: 'grant_admin_role', target_type: 'user', target_id: users.adminFault, detail: { permissions: ['device.view', 'fault.manage'], role_key: 'admin', note: '只开放故障处理，不开放预约审批' }, created_at: atDay(-2, 10, 30).toISOString() });
    await insertOperationLog(client, { id: uuid(907), operator_id: users.admin, operator_name: '演示超级管理员', action: 'grant_admin_role', target_type: 'user', target_id: users.adminAuditor, detail: { permissions: ['audit.view', 'reservation.view', 'return.view', 'device.view'], role_key: 'auditor', note: '数据导出按业务权限匹配' }, created_at: atDay(-2, 10, 40).toISOString() });

    await upsertIntelligenceActionLog(client, {
      id: uuid(1251),
      action_id: 'users-pending',
      action_type: 'user_review',
      action_title: '完成待审核用户处理',
      status: 'done',
      note: '演示闭环：已核验一批用户资料，保留 1 个待审核样本用于测试。',
      handled_by: users.admin,
      handled_at: addHours(new Date(), -6).toISOString(),
      created_at: atDay(-1, 9).toISOString(),
      updated_at: addHours(new Date(), -6).toISOString()
    });
    await upsertIntelligenceActionLog(client, {
      id: uuid(1252),
      action_id: 'faults-open',
      action_type: 'fault_backlog',
      action_title: '优先收敛未处理故障',
      status: 'delegated',
      note: '演示闭环：已转交设备管理员现场复检，保留待办用于观察高压状态。',
      assigned_to: users.adminReservation,
      handled_by: users.admin,
      handled_at: addHours(new Date(), -2).toISOString(),
      created_at: atDay(-1, 14).toISOString(),
      updated_at: addHours(new Date(), -2).toISOString()
    });

    await seedIntelligentOpsDemo(client, users, deviceIds);
    await seedDenseCalendarDemo(client, users, deviceIds);
    await seedRequestsNotificationsDemo(client, users, deviceIds);
    await seedChatDemo(client, users);

    await client.query('commit');
    console.log('演示数据已准备完成。');
    console.log('普通用户：13800000001 / 123456');
    console.log('普通用户：13800000002 / 123456');
    console.log('待审核用户：13800000003 / 123456');
    console.log('已禁用用户：13800000004 / 123456');
    console.log('已拒绝用户：13800000005 / 123456');
    console.log('最高权限管理员：13900000000 / 123456');
    console.log('无预约审批权限管理员：13900000010 / 123456');
    console.log('预约管理员：13900000011 / 123456');
    console.log('故障管理员：13900000012 / 123456');
    console.log('数据审计员：13900000013 / 123456');
    console.log('可打开 /v5/login 登录对应账号，查看总览、智能运营、预约、设备、故障、导出与审计等演示场景。');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

