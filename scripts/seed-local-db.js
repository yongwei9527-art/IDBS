const crypto = require('crypto');
const { Pool } = require('pg');
const { postgresSslOptions } = require('../src/lib/postgres-ssl');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || 'postgresql://idbs_user:generated-by-installer@127.0.0.1:5432/idbs';

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  }).toString('hex');
}

function assertLocalDatabase(urlText) {
  const url = new URL(urlText);
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!localHosts.has(url.hostname) && process.env.ALLOW_NON_LOCAL_SEED !== '1') {
    throw new Error('Refusing to seed a non-local database. Set ALLOW_NON_LOCAL_SEED=1 if this is intentional.');
  }
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function atLocalHour(daysFromNow, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date;
}

async function upsertUser(client, user) {
  const salt = user.salt || `local-${user.phone}`;
  const result = await client.query(`
    insert into users (name, phone, student_no, group_name, email, password_hash, password_salt, role, status, is_banned, created_at, updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,now(),now())
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
      updated_at = now()
    returning id
  `, [
    user.name,
    user.phone,
    user.student_no,
    user.group_name,
    user.email,
    hashPassword(user.password, salt),
    salt,
    user.role,
    user.status
  ]);
  return result.rows[0].id;
}

async function upsertDevice(client, device) {
  const result = await client.query(`
    insert into devices (device_code, name, category, location, manager, status, allow_reservation, description, usage_notice, instruction_photos, created_at, updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now(),now())
    on conflict (device_code) do update set
      name = excluded.name,
      category = excluded.category,
      location = excluded.location,
      manager = excluded.manager,
      status = excluded.status,
      allow_reservation = excluded.allow_reservation,
      description = excluded.description,
      usage_notice = excluded.usage_notice,
      instruction_photos = excluded.instruction_photos,
      updated_at = now()
    returning id
  `, [
    device.device_code,
    device.name,
    device.category,
    device.location,
    device.manager,
    device.status,
    device.allow_reservation,
    device.description,
    device.usage_notice,
    JSON.stringify(device.instruction_photos || [])
  ]);
  return result.rows[0].id;
}

async function main() {
  assertLocalDatabase(connectionString);

  const pool = new Pool({
    connectionString,
    ssl: postgresSslOptions()
  });

  const client = await pool.connect();
  try {
    await client.query('begin');

    const userId = await upsertUser(client, {
      name: '本地测试用户',
      phone: '13800000000',
      student_no: 'LOCAL001',
      group_name: '本地调试组',
      email: 'local-user@example.com',
      password: '123456',
      role: 'user',
      status: 'active'
    });

    const adminUserId = await upsertUser(client, {
      name: '本地管理员',
      phone: '13900000000',
      student_no: 'ADMIN001',
      group_name: '设备管理组',
      email: 'local-admin@example.com',
      password: '123456',
      role: 'admin',
      status: 'active'
    });

    await client.query(`
      insert into admin_roles (id, user_id, role_key, permissions, note, created_at, updated_at)
      values (gen_random_uuid(), $1, 'admin', $2::jsonb, 'Local seeded admin role', now(), now())
      on conflict (user_id) do update set
        role_key = excluded.role_key,
        permissions = excluded.permissions,
        note = excluded.note,
        updated_at = now()
    `, [adminUserId, JSON.stringify(['device.manage', 'device.view', 'reservation.approve', 'reservation.view', 'user.manage', 'stats.view'])]);

    const devices = [
      {
        device_code: 'LAB-MIC-001',
        name: '生物显微镜 A',
        category: '显微观察',
        location: '北楼 301',
        manager: '王老师',
        status: 'available',
        allow_reservation: true,
        description: '适合细胞切片、样品观察和课堂演示。',
        usage_notice: '使用前请确认镜头清洁，结束后关闭光源并盖好防尘罩。'
      },
      {
        device_code: 'LAB-OSC-001',
        name: '数字示波器',
        category: '电子测量',
        location: '电子实验室 205',
        manager: '李老师',
        status: 'available',
        allow_reservation: true,
        description: '用于信号波形观测、频率测量和电路调试。',
        usage_notice: '连接探头前请确认量程，避免高压输入损坏设备。'
      },
      {
        device_code: 'LAB-CAM-001',
        name: '高速摄像机',
        category: '图像采集',
        location: '创新实验室 102',
        manager: '赵老师',
        status: 'in_use',
        allow_reservation: true,
        description: '适合运动轨迹、快速过程和实验视频采集。',
        usage_notice: '借用时请同步登记存储卡和镜头配件。'
      },
      {
        device_code: 'LAB-3DP-001',
        name: '桌面 3D 打印机',
        category: '快速成型',
        location: '创客空间 1F',
        manager: '陈老师',
        status: 'maintenance',
        allow_reservation: false,
        description: '用于 PLA 原型件打印和结构验证。',
        usage_notice: '维护期间不可预约，恢复后请先进行试打印。'
      },
      {
        device_code: 'LAB-INC-001',
        name: '恒温培养箱',
        category: '生命科学',
        location: '北楼 412',
        manager: '周老师',
        status: 'abnormal_pending',
        allow_reservation: false,
        description: '用于样品恒温培养和稳定性观察。',
        usage_notice: '当前温控异常待处理，暂不开放预约。'
      }
    ];

    const deviceIds = {};
    for (const device of devices) {
      deviceIds[device.device_code] = await upsertDevice(client, device);
    }

    const pendingBatchId = '11111111-1111-4111-8111-111111111111';
    const approvedBatchId = '22222222-2222-4222-8222-222222222222';
    const pendingStart = atLocalHour(1, 9);
    const approvedStart = atLocalHour(2, 14);
    const inUseBorrowTime = addHours(new Date(), -1.5);
    const inUseReturnTime = addHours(new Date(), 2);

    await client.query(`
      insert into reservation_batches (id, user_id, device_codes, time_slots, purpose, status, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,now(),now())
      on conflict (id) do update set
        user_id = excluded.user_id,
        device_codes = excluded.device_codes,
        time_slots = excluded.time_slots,
        purpose = excluded.purpose,
        status = excluded.status,
        updated_at = now()
    `, [pendingBatchId, userId, 'LAB-MIC-001', `${pendingStart.toISOString()} - ${addHours(pendingStart, 2).toISOString()}`, '本地演示：显微观察预约', 'pending']);

    await client.query(`
      insert into reservation_batches (id, user_id, device_codes, time_slots, purpose, status, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,now(),now())
      on conflict (id) do update set
        user_id = excluded.user_id,
        device_codes = excluded.device_codes,
        time_slots = excluded.time_slots,
        purpose = excluded.purpose,
        status = excluded.status,
        updated_at = now()
    `, [approvedBatchId, userId, 'LAB-OSC-001', `${approvedStart.toISOString()} - ${addHours(approvedStart, 2).toISOString()}`, '本地演示：电路调试预约', 'approved']);

    await client.query(`
      insert into reservations (id, batch_id, device_id, user_id, start_time, end_time, purpose, status, admin_note, created_at, updated_at, approved_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now(),$10)
      on conflict (id) do update set
        batch_id = excluded.batch_id,
        device_id = excluded.device_id,
        user_id = excluded.user_id,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        purpose = excluded.purpose,
        status = excluded.status,
        admin_note = excluded.admin_note,
        updated_at = now(),
        approved_at = excluded.approved_at
    `, ['33333333-3333-4333-8333-333333333333', pendingBatchId, deviceIds['LAB-MIC-001'], userId, pendingStart.toISOString(), addHours(pendingStart, 2).toISOString(), '本地演示：显微观察预约', 'pending', null, null]);

    await client.query(`
      insert into reservations (id, batch_id, device_id, user_id, start_time, end_time, purpose, status, admin_note, created_at, updated_at, approved_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now(),$10)
      on conflict (id) do update set
        batch_id = excluded.batch_id,
        device_id = excluded.device_id,
        user_id = excluded.user_id,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        purpose = excluded.purpose,
        status = excluded.status,
        admin_note = excluded.admin_note,
        updated_at = now(),
        approved_at = excluded.approved_at
    `, ['44444444-4444-4444-8444-444444444444', approvedBatchId, deviceIds['LAB-OSC-001'], userId, approvedStart.toISOString(), addHours(approvedStart, 2).toISOString(), '本地演示：电路调试预约', 'approved', '本地演示数据已通过', new Date().toISOString()]);

    await client.query(`
      insert into reservation_items (id, batch_id, device_id, user_id, reservation_date, slot_key, start_time, end_time, status, reservation_id, created_at, updated_at, approved_at)
      values ($1,$2,$3,$4,($5::timestamptz at time zone 'Asia/Shanghai')::date,$6,$5,$7,$8,$9,now(),now(),$10)
      on conflict (id) do update set
        batch_id = excluded.batch_id,
        device_id = excluded.device_id,
        user_id = excluded.user_id,
        reservation_date = excluded.reservation_date,
        slot_key = excluded.slot_key,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        status = excluded.status,
        reservation_id = excluded.reservation_id,
        updated_at = now(),
        approved_at = excluded.approved_at
    `, ['33333333-3333-4333-8333-333333333334', pendingBatchId, deviceIds['LAB-MIC-001'], userId, pendingStart.toISOString(), 'custom', addHours(pendingStart, 2).toISOString(), 'pending', '33333333-3333-4333-8333-333333333333', null]);

    await client.query(`
      insert into reservation_items (id, batch_id, device_id, user_id, reservation_date, slot_key, start_time, end_time, status, reservation_id, created_at, updated_at, approved_at)
      values ($1,$2,$3,$4,($5::timestamptz at time zone 'Asia/Shanghai')::date,$6,$5,$7,$8,$9,now(),now(),$10)
      on conflict (id) do update set
        batch_id = excluded.batch_id,
        device_id = excluded.device_id,
        user_id = excluded.user_id,
        reservation_date = excluded.reservation_date,
        slot_key = excluded.slot_key,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        status = excluded.status,
        reservation_id = excluded.reservation_id,
        updated_at = now(),
        approved_at = excluded.approved_at
    `, ['44444444-4444-4444-8444-444444444445', approvedBatchId, deviceIds['LAB-OSC-001'], userId, approvedStart.toISOString(), 'custom', addHours(approvedStart, 2).toISOString(), 'approved', '44444444-4444-4444-8444-444444444444', new Date().toISOString()]);

    await client.query(`
      insert into borrow_records (id, reservation_id, device_id, user_id, borrow_time, expected_return_time, return_time, duration_minutes, return_condition, return_note, return_photos, status, is_overdue, created_at, updated_at)
      values ($1,null,$2,$3,$4,$5,null,null,null,null,'[]'::jsonb,'in_use',false,now(),now())
      on conflict (id) do update set
        device_id = excluded.device_id,
        user_id = excluded.user_id,
        borrow_time = excluded.borrow_time,
        expected_return_time = excluded.expected_return_time,
        return_time = null,
        duration_minutes = null,
        return_condition = null,
        return_note = null,
        return_photos = '[]'::jsonb,
        status = 'in_use',
        is_overdue = false,
        updated_at = now()
    `, ['55555555-5555-4555-8555-555555555555', deviceIds['LAB-CAM-001'], userId, inUseBorrowTime.toISOString(), inUseReturnTime.toISOString()]);

    await client.query(`
      insert into usage_log (id, record_id, device_id, user_id, action, device_code, device_name, user_name, user_phone, user_student_no, borrow_time, expected_return_time, record_status, operator_name, created_at)
      values ($1,$2,$3,$4,'BORROW',$5,$6,$7,$8,$9,$10,$11,'in_use',$7,now())
      on conflict (id) do update set
        record_id = excluded.record_id,
        device_id = excluded.device_id,
        user_id = excluded.user_id,
        device_code = excluded.device_code,
        device_name = excluded.device_name,
        user_name = excluded.user_name,
        user_phone = excluded.user_phone,
        user_student_no = excluded.user_student_no,
        borrow_time = excluded.borrow_time,
        expected_return_time = excluded.expected_return_time,
        record_status = excluded.record_status,
        operator_name = excluded.operator_name,
        created_at = now()
    `, ['66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555555', deviceIds['LAB-CAM-001'], userId, 'LAB-CAM-001', '高速摄像机', '本地测试用户', '13800000000', 'LOCAL001', inUseBorrowTime.toISOString(), inUseReturnTime.toISOString()]);

    await client.query('commit');
    console.log('Local seed data is ready.');
    console.log('User login: 13800000000 / 123456');
    console.log('Admin user login: 13900000000 / 123456');
    console.log('Admin console password remains configured separately.');
    console.log(`Seeded ${devices.length} devices, 2 reservations, and 1 active borrow record.`);
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
