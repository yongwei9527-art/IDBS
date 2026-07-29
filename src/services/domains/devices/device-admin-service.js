function createDeviceAdminService(context = {}) {
  const {
    addNamesToBorrowRows,
    assertText,
    fail,
    effectiveRolePermissions,
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
    'return_mode',
    'return_require_note'
  ]);

  const allowedDeviceStatuses = ['available', 'reserved', 'in_use', 'maintenance', 'disabled', 'abnormal_pending'];
  const allowedReturnModes = ['confirm_only', 'image_optional', 'image_required'];

  function normalizeReturnMode(value) {
    const mode = String(value || 'image_required').trim();
    return allowedReturnModes.includes(mode) ? mode : 'image_required';
  }

  function canViewReturnArchive(role = {}) {
    const permissions = typeof effectiveRolePermissions === 'function'
      ? effectiveRolePermissions(role)
      : (Array.isArray(role.permissions) ? role.permissions : []);
    return permissions.includes('*') || ['return.view', 'return.confirm', 'return.image_review', 'return.export'].some((permission) => permissions.includes(permission));
  }

  function hideReturnArchiveFields(row = {}) {
    return {
      ...row,
      return_photos: [],
      return_archive_photos: [],
      return_archive_folder: '',
      return_archive_restricted: true
    };
  }

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
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['device.manage']);
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
      return_mode: normalizeReturnMode(payload.return_mode),
      return_require_note: payload.return_require_note === true,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query('insert into devices (id, device_code, name, category, location, manager, status, allow_reservation, description, usage_notice, cover_photo, instruction_photos, reservation_slot_keys, return_mode, return_require_note, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)', [row.id, row.device_code, row.name, row.category, row.location, row.manager, row.status, row.allow_reservation, row.description, row.usage_notice, row.cover_photo, JSON.stringify(row.instruction_photos), JSON.stringify(row.reservation_slot_keys), row.return_mode, row.return_require_note, row.created_at, row.updated_at]);
      await syncDeviceTimeSlots(row.id, row.reservation_slot_keys, txQuery);
      await log('create_device', `Created device ${deviceCode} ${name}`, admin, row.id, null, txQuery);
    });
    return ok({ message: '设备已创建。', device: withReservationSlotOptions(row) });
  }

  async function adminUpdateDevice(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['device.manage']);
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
      return fail('设备状态不正确。', 400, 2001);
    }
    if ('return_mode' in values) values.return_mode = normalizeReturnMode(values.return_mode);
    if ('return_require_note' in values) values.return_require_note = values.return_require_note === true;
    const keys = Object.keys(values);
    const sets = keys.map((key, index) => `${key} = $${index + 1}`);
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query(`update devices set ${sets.join(', ')} where id = $${keys.length + 1}`, [...keys.map((key) => ['instruction_photos', 'reservation_slot_keys'].includes(key) ? JSON.stringify(values[key]) : values[key]), id]);
      if ('reservation_slot_keys' in values) await syncDeviceTimeSlots(id, values.reservation_slot_keys, txQuery);
      await log('update_device', `Updated device ${id}`, admin, id, null, txQuery);
    });
    return ok({ message: '设备已更新。' });
  }

  async function adminGetDeviceDetail(params = {}, token) {
    const { role } = await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['device.manage', 'device.view', 'reservation.view', 'stats.view', 'return.view', 'return.confirm', 'return.image_review', 'return.export']);
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
    const canViewArchive = canViewReturnArchive(role);
    const borrowRows = await addNamesToBorrowRows(await query('select * from borrow_records where device_id = $1 order by borrow_time desc limit 80', [id]));
    const borrows = canViewArchive ? borrowRows : borrowRows.map(hideReturnArchiveFields);
    const faultReports = await query(`
      select f.*, u.name as user_name, u.phone as user_phone
      from device_fault_reports f
      left join users u on u.id = f.user_id
      where f.device_id = $1
      order by f.created_at desc
      limit 50
    `, [id]);
    return ok({ device: withReservationSlotOptions(device), reservations, borrows, fault_reports: faultReports || [], can_view_return_archive: canViewArchive });
  }

  async function adminSetDeviceAvailable(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['device.manage']);
    const deviceId = assertText(payload.device_id, 'device_id', 60);
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query('update devices set status = $1, allow_reservation = true, updated_at = $2 where id = $3', ['available', nowIso(), deviceId]);
      await markDeviceFaultReportsResolved(deviceId, '', admin, txQuery);
      await notifyReservationUsersForDevice(deviceId, {
        type: 'device_recovered',
        title: '预约设备已恢复可用',
        content: '你预约的设备 {device_code} {device_name} 已恢复为可预约状态。你的原预约仍然有效，请按原预约时间使用：{time_range}',
        related_type: 'device'
      }, txQuery);
      await log('set_device_available', 'Set device available', admin, deviceId, null, txQuery);
    });
    return ok({ message: '设备已恢复可用。' });
  }

  function deviceDeleteError(message, status = 400, code = 2001) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
  }

  function normalizeDeviceDeleteIds(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
      throw deviceDeleteError('device_ids must contain between 1 and 100 ids.');
    }
    const ids = value.map((id) => {
      if (typeof id !== 'string' || !id.trim() || id.trim().length > 60) {
        throw deviceDeleteError('device_ids contains an invalid id.');
      }
      return id.trim();
    });
    if (new Set(ids).size !== ids.length) {
      throw deviceDeleteError('device_ids must not contain duplicate ids.');
    }
    return ids;
  }

  async function requireSuperAdminForDeviceDeletion(token) {
    const { admin } = await requireAdminRole(token, ['super_admin'], []);
    if (admin.role !== 'super_admin' && admin.admin_role_key !== 'super_admin') {
      throw deviceDeleteError('\u53ea\u6709\u6700\u9ad8\u6743\u9650\u7ba1\u7406\u5458\u53ef\u4ee5\u5220\u9664\u8bbe\u5907\u3002', 403, 1003);
    }
    return admin;
  }

  async function deleteDevicesByIds(deviceIds, admin) {
    return withTransaction(async (client) => {
      const targets = [];
      for (const deviceId of deviceIds) {
        const locked = await client.query('select id, device_code, name, deleted_at from devices where id = $1 for update', [deviceId]);
        const device = locked.rows?.[0];
        if (!device || device.deleted_at) {
          throw deviceDeleteError('\u8bbe\u5907\u4e0d\u5b58\u5728\u6216\u5df2\u5220\u9664\u3002', 404, 3004);
        }
        targets.push(device);
      }

      const deletedAt = nowIso();
      const operatorId = admin.user_id || admin.id || null;
      for (const device of targets) {
        const updated = await client.query(`
          update devices
          set deleted_at = $1,
              status = 'disabled',
              allow_reservation = false,
              updated_by = $2,
              updated_at = $1
          where id = $3 and deleted_at is null
        `, [deletedAt, operatorId, device.id]);
        if (updated.rowCount !== 1) {
          throw deviceDeleteError('\u8bbe\u5907\u72b6\u6001\u5df2\u53d8\u5316\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002', 409, 3001);
        }
        const txQuery = (sql, params = []) => client.query(sql, params);
        await log('delete_device', {
          message: '\u8bbe\u5907\u5df2\u8f6f\u5220\u9664\uff0c\u5386\u53f2\u9884\u7ea6\u548c\u501f\u7528\u8bb0\u5f55\u5df2\u4fdd\u7559',
          soft_deleted: true
        }, admin, device.id, null, txQuery);
      }
      return targets.map((device) => ({ device_id: device.id, soft_deleted: true }));
    });
  }

  async function adminDeleteDevice(payload, token) {
    const admin = await requireSuperAdminForDeviceDeletion(token);
    const deviceIds = normalizeDeviceDeleteIds([payload.device_id]);
    const [result] = await deleteDevicesByIds(deviceIds, admin);
    return ok({ message: '\u8bbe\u5907\u5df2\u8f6f\u5220\u9664\u3002', ...result });
  }

  async function adminDeleteDevices(payload, token) {
    const admin = await requireSuperAdminForDeviceDeletion(token);
    const deviceIds = normalizeDeviceDeleteIds(payload.device_ids);
    const results = await deleteDevicesByIds(deviceIds, admin);
    return ok({
      message: '\u8bbe\u5907\u6279\u91cf\u8f6f\u5220\u9664\u5df2\u5b8c\u6210\u3002',
      requested_count: deviceIds.length,
      deleted_count: results.length,
      deleted_ids: deviceIds,
      failed_ids: [],
      results
    });
  }

  return {
    adminCreateDevice,
    adminDeleteDevice,
    adminDeleteDevices,
    adminGetDeviceDetail,
    adminSetDeviceAvailable,
    adminUpdateDevice
  };
}

module.exports = { createDeviceAdminService };



