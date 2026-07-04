const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || 'postgresql://idbs_user:generated-by-installer@127.0.0.1:5432/idbs';

function assertSeedTarget(urlText) {
  const url = new URL(urlText);
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!localHosts.has(url.hostname) && process.env.ALLOW_NON_LOCAL_SEED !== '1') {
    throw new Error('Refusing to seed a non-local database. Set ALLOW_NON_LOCAL_SEED=1 if this is intentional.');
  }
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
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

async function upsertUser(client, user) {
  const salt = `demo-${user.phone}`;
  const result = await client.query(`
    insert into users (id, name, phone, student_no, group_name, email, password_hash, password_salt, role, status, is_banned, created_at, updated_at, last_login_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,now(),$12)
    on conflict (phone) do update set
      name = excluded.name,
      student_no = excluded.student_no,
      group_name = excluded.group_name,
      email = excluded.email,
      password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      role = excluded.role,
      status = excluded.status,
      is_banned = false,
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
    user.last_login_at || new Date().toISOString()
  ]);
  return result.rows[0].id;
}

async function upsertDevice(client, device) {
  const result = await client.query(`
    insert into devices (id, device_code, name, category, location, manager, status, allow_reservation, description, usage_notice, cover_photo, instruction_photos, reservation_slot_keys, created_at, updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,now(),now())
    on conflict (device_code) do update set
      name = excluded.name,
      category = excluded.category,
      location = excluded.location,
      manager = excluded.manager,
      status = excluded.status,
      allow_reservation = excluded.allow_reservation,
      description = excluded.description,
      usage_notice = excluded.usage_notice,
      cover_photo = excluded.cover_photo,
      instruction_photos = excluded.instruction_photos,
      reservation_slot_keys = excluded.reservation_slot_keys,
      updated_at = now()
    returning id
  `, [
    device.id,
    device.device_code,
    device.name,
    device.category,
    device.location,
    device.manager,
    device.status,
    device.allow_reservation,
    device.description,
    device.usage_notice,
    device.cover_photo || '',
    JSON.stringify(device.instruction_photos || []),
    JSON.stringify(device.reservation_slot_keys || ['morning', 'afternoon', 'evening', 'night'])
  ]);
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

  await client.query('update reservation_batches set submit_note = $1, admin_note = $2 where id = $3', [batch.submit_note || null, batch.admin_note || null, batch.id]);
}

async function upsertReservation(client, row) {
  const existing = await client.query('select 1 from reservations where id = $1 limit 1', [row.id]);
  if (existing.rowCount) {
    return;
  }
  await client.query(`
    insert into reservations (id, batch_id, device_id, user_id, start_time, end_time, purpose, status, admin_note, created_at, updated_at, approved_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11)
  `, [row.id, row.batch_id, row.device_id, row.user_id, row.start_time, row.end_time, row.purpose, row.status, row.admin_note || null, row.created_at || new Date().toISOString(), row.approved_at || null]);
}

async function upsertReservationItem(client, row) {
  const existing = await client.query('select 1 from reservation_items where id = $1 limit 1', [row.item_id]);
  if (existing.rowCount) return;
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

  await client.query('update borrow_records set reservation_item_id = $1, actual_start_time = $2, actual_end_time = $3 where id = $4', [row.reservation_item_id || null, row.borrow_time, row.return_time || null, row.id]);
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
  await client.query('update device_fault_reports set severity = $1, reservation_item_id = $2 where id = $3', [row.severity || 'normal', row.reservation_item_id || null, row.id]);
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
  await client.query(`
    insert into operation_logs (id, operator_id, operator_name, action, target_type, target_id, detail, ip_address, created_at)
    values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
    on conflict (id) do update set operator_id = excluded.operator_id, operator_name = excluded.operator_name, action = excluded.action, target_type = excluded.target_type, target_id = excluded.target_id, detail = excluded.detail, ip_address = excluded.ip_address, created_at = excluded.created_at
  `, [row.id, row.operator_id, row.operator_name, row.action, row.target_type, row.target_id, JSON.stringify(row.detail || {}), '127.0.0.1', row.created_at || new Date().toISOString()]);
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

async function main() {
  assertSeedTarget(connectionString);
  const pool = new Pool({ connectionString, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined });
  const client = await pool.connect();

  try {
    await client.query('begin');

    const users = {
      admin: await upsertUser(client, { id: uuid(1), name: '演示超级管理员', phone: '13900000000', student_no: 'ADMIN001', group_name: '设备中心', email: 'admin.demo@example.com', password: '123456', role: 'super_admin', status: 'active', created_at: atDay(-60, 9).toISOString() }),
      zhang: await upsertUser(client, { id: uuid(2), name: '张三', phone: '13800000001', student_no: 'S2026001', group_name: '材料学院', email: 'zhangsan.demo@example.com', password: '123456', role: 'user', status: 'active', created_at: atDay(-35, 10).toISOString() }),
      li: await upsertUser(client, { id: uuid(3), name: '李四', phone: '13800000002', student_no: 'S2026002', group_name: '电子学院', email: 'lisi.demo@example.com', password: '123456', role: 'user', status: 'active', created_at: atDay(-18, 11).toISOString() }),
      wang: await upsertUser(client, { id: uuid(4), name: '王五（待审核）', phone: '13800000003', student_no: 'S2026003', group_name: '生命学院', email: 'wangwu.demo@example.com', password: '123456', role: 'user', status: 'pending', created_at: atDay(-1, 15).toISOString(), last_login_at: null })
    };

    await client.query(`
      insert into admin_roles (id, user_id, role_key, permissions, note, created_at, updated_at)
      values ($1,$2,'super_admin',$3::jsonb,'演示超级管理员，拥有全部权限',now(),now())
      on conflict (user_id) do update set role_key = 'super_admin', permissions = excluded.permissions, note = excluded.note, updated_at = now()
    `, [uuid(90), users.admin, JSON.stringify(['*'])]);

    const deviceIds = {};
    const devices = [
      { id: uuid(101), device_code: 'DEMO-MIC-001', name: '荧光显微镜', category: '成像分析', location: 'A 楼 301', manager: '赵老师', status: 'available', allow_reservation: true, description: '用于细胞样品荧光观察，支持多通道成像。', usage_notice: '使用前请检查镜头洁净度，结束后关闭光源。' },
      { id: uuid(102), device_code: 'DEMO-OSC-001', name: '数字示波器', category: '电子测量', location: 'B 楼 205', manager: '钱老师', status: 'reserved', allow_reservation: true, description: '4 通道数字示波器，适合电路调试与信号采集。', usage_notice: '探头倍率需和软件设置一致。' },
      { id: uuid(103), device_code: 'DEMO-CAM-001', name: '高速摄像机', category: '影像采集', location: 'C 楼 108', manager: '孙老师', status: 'in_use', allow_reservation: true, description: '用于高速运动拍摄和过程分析。', usage_notice: '请提前准备存储卡并确认补光。' },
      { id: uuid(104), device_code: 'DEMO-INC-001', name: '恒温培养箱', category: '生命科学', location: 'D 楼 412', manager: '周老师', status: 'abnormal_pending', allow_reservation: false, description: '用于样品恒温培养和稳定性观察。', usage_notice: '当前温度波动异常，待处理期间暂停预约。' },
      { id: uuid(105), device_code: 'DEMO-3DP-001', name: '3D 打印机', category: '加工制造', location: '创新工坊', manager: '吴老师', status: 'maintenance', allow_reservation: false, description: '用于 PLA/ABS 快速原型打印。', usage_notice: '喷头维护中，恢复后开放预约。' },
      { id: uuid(106), device_code: 'DEMO-OLD-001', name: '停用旧设备', category: '历史设备', location: '仓库', manager: '管理员', status: 'disabled', allow_reservation: false, description: '演示停用状态。', usage_notice: '该设备不再开放预约。' }
    ];
    for (const device of devices) deviceIds[device.device_code] = await upsertDevice(client, device);
    await upsertDeviceSlots(client, deviceIds);

    const batches = [
      { id: uuid(201), user_id: users.zhang, device_codes: 'DEMO-MIC-001,DEMO-OSC-001', time_slots: '明天上午、后天下午', purpose: '演示：多设备多日期预约待审核', status: 'pending', created_at: atDay(-1, 16).toISOString(), submit_note: '希望连续两天完成观察和信号采集。' },
      { id: uuid(202), user_id: users.li, device_codes: 'DEMO-OSC-001', time_slots: '后天下午', purpose: '演示：已通过预约', status: 'approved', created_at: atDay(-2, 14).toISOString(), admin_note: '演示管理员已通过。' },
      { id: uuid(203), user_id: users.zhang, device_codes: 'DEMO-CAM-001', time_slots: '今天使用中', purpose: '演示：当前使用中', status: 'approved', created_at: atDay(-3, 9).toISOString(), admin_note: '已开始使用。' },
      { id: uuid(204), user_id: users.li, device_codes: 'DEMO-MIC-001', time_slots: '过去一周已完成', purpose: '演示：历史完成记录', status: 'completed', created_at: atDay(-8, 10).toISOString(), admin_note: '使用完成。' },
      { id: uuid(205), user_id: users.wang, device_codes: 'DEMO-INC-001', time_slots: '故障设备预约', purpose: '演示：故障设备被拒绝', status: 'rejected', created_at: atDay(-1, 11).toISOString(), admin_note: '设备异常待处理，暂不可预约。' }
    ];
    for (const batch of batches) await upsertBatch(client, batch);

    const reservations = [
      { id: uuid(301), item_id: uuid(401), batch_id: uuid(201), device_id: deviceIds['DEMO-MIC-001'], user_id: users.zhang, start_time: atDay(1, 8).toISOString(), end_time: atDay(1, 12).toISOString(), purpose: batches[0].purpose, status: 'pending', slot_key: 'morning', created_at: batches[0].created_at },
      { id: uuid(302), item_id: uuid(402), batch_id: uuid(201), device_id: deviceIds['DEMO-OSC-001'], user_id: users.zhang, start_time: atDay(2, 12).toISOString(), end_time: atDay(2, 17).toISOString(), purpose: batches[0].purpose, status: 'pending', slot_key: 'afternoon', created_at: batches[0].created_at },
      { id: uuid(303), item_id: uuid(403), batch_id: uuid(202), device_id: deviceIds['DEMO-OSC-001'], user_id: users.li, start_time: atDay(3, 12).toISOString(), end_time: atDay(3, 17).toISOString(), purpose: batches[1].purpose, status: 'approved', slot_key: 'afternoon', admin_note: '演示管理员已通过', approved_at: atDay(-1, 9).toISOString(), created_at: batches[1].created_at },
      { id: uuid(304), item_id: uuid(404), batch_id: uuid(203), device_id: deviceIds['DEMO-CAM-001'], user_id: users.zhang, start_time: atDay(0, 8).toISOString(), end_time: atDay(0, 22).toISOString(), purpose: batches[2].purpose, status: 'in_use', slot_key: 'daytime', admin_note: '已开始使用', approved_at: atDay(-2, 10).toISOString(), created_at: batches[2].created_at },
      { id: uuid(305), item_id: uuid(405), batch_id: uuid(204), device_id: deviceIds['DEMO-MIC-001'], user_id: users.li, start_time: atDay(-7, 8).toISOString(), end_time: atDay(-7, 12).toISOString(), purpose: batches[3].purpose, status: 'completed', slot_key: 'morning', admin_note: '已完成归还', approved_at: atDay(-8, 13).toISOString(), created_at: batches[3].created_at },
      { id: uuid(306), item_id: uuid(406), batch_id: uuid(205), device_id: deviceIds['DEMO-INC-001'], user_id: users.wang, start_time: atDay(4, 8).toISOString(), end_time: atDay(4, 12).toISOString(), purpose: batches[4].purpose, status: 'rejected', slot_key: 'morning', admin_note: batches[4].admin_note, created_at: batches[4].created_at }
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
      ['wechat_bind', users.li, '李四', '13800000002', '演示：用户完成微信绑定', atDay(-3, 12).toISOString()]
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

    await seedChatDemo(client, users);

    await client.query('commit');
    console.log('Demo data is ready.');
    console.log('Demo normal user: 13800000001 / 123456');
    console.log('Demo normal user: 13800000002 / 123456');
    console.log('Demo pending user: 13800000003 / 123456');
    console.log('Demo super admin user: 13900000000 / 123456');
    console.log('Open admin.html and login with the admin user or configured admin console password to view dashboard, analytics, reservation batches, faults and logs.');
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
