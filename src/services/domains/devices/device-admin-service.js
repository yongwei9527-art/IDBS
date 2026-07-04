function createDeviceAdminService(context = {}) {
  const {
    addNamesToBorrowRows,
    assertText,
    fail,
    getById,
    isSafeUrl,
    log,
    normalizeReservationSlotOptions,
    normalizeReservationSlotKeys,
    notifyReservationUsersForDevice,
    nowIso,
    ok,
    query,
    requireAdminRole,
    uuid,
    withReservationSlotOptions,
    withTransaction,
    markDeviceFaultReportsResolved
  } = context;

  const allowedDeviceUpdateFields = new Set([
    'device_code',
    'name',
    'category',
    'location',
    'manager',
    'status',
    'allow_reservation',
    'description',
    'usage_notice',
    'cover_photo',
    'instruction_photos',
    'reservation_slot_keys',
    'last_return_photo',
    'last_return_user',
    'last_return_time',
    'last_condition'
  ]);

  const allowedDeviceStatuses = ['available', 'reserved', 'in_use', 'maintenance', 'disabled', 'abnormal_pending'];

  async function syncDeviceTimeSlots(deviceId, slotOptions = [], queryFn = query) {
    const normalizedSlots = normalizeReservationSlotOptions(slotOptions, []);
    await queryFn('delete from device_time_slots where device_id = $1', [deviceId]);
    for (const [index, slot] of normalizedSlots.entries()) {
      await queryFn(`
        insert into device_time_slots (device_id, slot_key, label, start_time, end_time, crosses_day, sort_order, enabled, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,true,$8)
        on conflict (device_id, slot_key) do update set
          label = excluded.label,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          crosses_day = excluded.crosses_day,
          sort_order = excluded.sort_order,
          enabled = true,
          updated_at = excluded.updated_at
      `, [deviceId, slot.key, slot.label, slot.start, slot.end, !!slot.crosses_midnight, (index + 1) * 10, nowIso()]);
    }
  }

  async function adminCreateDevice(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin', 'ops'], ['device.manage']);
    const deviceCode = assertText(payload.device_code, 'device_code', 50);
    const name = assertText(payload.name, 'name', 100);
    const row = {
      id: uuid(),
      device_code: deviceCode,
      name,
      category: String(payload.category || '').trim().slice(0, 50),
      location: String(payload.location || '').trim().slice(0, 100),
      manager: String(payload.manager || '').trim().slice(0, 50),
      status: allowedDeviceStatuses.includes(payload.status) ? payload.status : 'available',
      allow_reservation: payload.allow_reservation !== false,
      description: String(payload.description || '').trim().slice(0, 1000),
      usage_notice: String(payload.usage_notice || '').trim().slice(0, 1000),
      cover_photo: isSafeUrl(payload.cover_photo) ? String(payload.cover_photo).trim().slice(0, 500) : '',
      instruction_photos: Array.isArray(payload.instruction_photos) ? payload.instruction_photos.slice(0, 10).map((value) => (isSafeUrl(value) ? String(value).slice(0, 500) : '')).filter(Boolean) : [],
      reservation_slot_keys: normalizeReservationSlotOptions(payload.reservation_slot_keys || payload.reservationSlotKeys),
      created_at: nowIso(),
      updated_at: nowIso()
    };
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query('insert into devices (id, device_code, name, category, location, manager, status, allow_reservation, description, usage_notice, cover_photo, instruction_photos, reservation_slot_keys, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [row.id, row.device_code, row.name, row.category, row.location, row.manager, row.status, row.allow_reservation, row.description, row.usage_notice, row.cover_photo, JSON.stringify(row.instruction_photos), JSON.stringify(row.reservation_slot_keys), row.created_at, row.updated_at]);
      await syncDeviceTimeSlots(row.id, row.reservation_slot_keys, txQuery);
      await log('create_device', `Created device ${deviceCode} ${name}`, admin, row.id, null, txQuery);
    });
    return ok({ message: 'Device created', device: withReservationSlotOptions(row) });
  }

  async function adminUpdateDevice(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin', 'ops'], ['device.manage']);
    const id = assertText(payload.id, 'id', 60);
    const values = { updated_at: nowIso() };
    for (const [key, value] of Object.entries(payload || {})) {
      if (key !== 'id' && allowedDeviceUpdateFields.has(key)) values[key] = value;
    }
    if (typeof values.instruction_photos === 'string') values.instruction_photos = [];
    if ('cover_photo' in values && !isSafeUrl(values.cover_photo)) values.cover_photo = '';
    if (Array.isArray(values.instruction_photos)) values.instruction_photos = values.instruction_photos.filter(isSafeUrl).slice(0, 10);
    if ('reservation_slot_keys' in values) values.reservation_slot_keys = normalizeReservationSlotOptions(values.reservation_slot_keys);
    if ('device_code' in values) values.device_code = assertText(values.device_code, 'device_code', 50);
    if ('name' in values) values.name = assertText(values.name, 'name', 100);
    if ('category' in values) values.category = String(values.category || '').trim().slice(0, 50);
    if ('location' in values) values.location = String(values.location || '').trim().slice(0, 100);
    if ('manager' in values) values.manager = String(values.manager || '').trim().slice(0, 50);
    if ('description' in values) values.description = String(values.description || '').trim().slice(0, 1000);
    if ('usage_notice' in values) values.usage_notice = String(values.usage_notice || '').trim().slice(0, 1000);
    if ('status' in values && !allowedDeviceStatuses.includes(values.status)) {
      return fail('Invalid device status', 400, 2001);
    }
    const keys = Object.keys(values);
    const sets = keys.map((key, index) => `${key} = $${index + 1}`);
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query(`update devices set ${sets.join(', ')} where id = $${keys.length + 1}`, [...keys.map((key) => ['instruction_photos', 'reservation_slot_keys'].includes(key) ? JSON.stringify(values[key]) : values[key]), id]);
      if ('reservation_slot_keys' in values) await syncDeviceTimeSlots(id, values.reservation_slot_keys, txQuery);
      await log('update_device', `Updated device ${id}`, admin, id, null, txQuery);
    });
    return ok({ message: 'Device updated' });
  }

  async function adminGetDeviceDetail(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['device.manage', 'device.view', 'reservation.view', 'stats.view']);
    const id = assertText(params.device_id || params.id, 'device_id', 60);
    const device = await getById('devices', id);
    if (!device) return fail('设备不存在。', 404, 3004);
    const reservations = await query(`
      select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id,
        b.purpose, b.status as batch_status,
        u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from reservation_items ri
      join reservation_batches b on b.id = ri.batch_id
      join users u on u.id = ri.user_id
      where ri.device_id = $1
      order by ri.start_time desc
      limit 80
    `, [id]);
    const borrows = await addNamesToBorrowRows(await query('select * from borrow_records where device_id = $1 order by borrow_time desc limit 80', [id]));
    const faultReports = await query(`
      select f.*, u.name as user_name, u.phone as user_phone
      from device_fault_reports f
      left join users u on u.id = f.user_id
      where f.device_id = $1
      order by f.created_at desc
      limit 50
    `, [id]);
    return ok({ device: withReservationSlotOptions(device), reservations, borrows, fault_reports: faultReports || [] });
  }

  async function adminSetDeviceAvailable(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin', 'ops'], ['device.manage']);
    const deviceId = assertText(payload.device_id, 'device_id', 60);
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query('update devices set status = $1, allow_reservation = true, updated_at = $2 where id = $3', ['available', nowIso(), deviceId]);
      await markDeviceFaultReportsResolved(deviceId, '', admin, txQuery);
      await notifyReservationUsersForDevice(deviceId, {
        type: 'device_recovered',
        title: '预约设备已恢复可用',
        content: '你预约的设备 {device_code} {device_name} 已恢复为可预约状态。你的原预约仍然有效，请按原预约时间使用：{start_time} - {end_time}',
        related_type: 'device'
      }, txQuery);
      await log('set_device_available', 'Set device available', admin, deviceId, null, txQuery);
    });
    return ok({ message: 'Device is available again' });
  }

  return {
    adminCreateDevice,
    adminGetDeviceDetail,
    adminSetDeviceAvailable,
    adminUpdateDevice
  };
}

module.exports = { createDeviceAdminService };
