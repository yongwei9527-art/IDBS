function createReservationActionService(context = {}) {
  const {
    assertText,
    canCancelReservation,
    checkConflict,
    createReservationStatusNotification,
    detectSlotKey,
    fail,
    getById,
    getDeviceByCode,
    getReservationItemById,
    log,
    minimumReservationDateText,
    nowIso,
    ok,
    parseBoolean,
    parseReservationDevices,
    parseReservationGroups,
    parseReservationSlots,
    query,
    requireAdminRole,
    requireUser,
    reservationDateText,
    resolveReservationId,
    rowsFrom,
    uuid,
    withTransaction
  } = context;

  async function createReservation(payload, token) {
    const user = await requireUser(token);
    const purpose = String(payload.purpose || '').trim().slice(0, 200);
    const batchId = uuid();
    const unfinishedRecord = await query('select id from borrow_records where user_id = $1 and status = any($2) limit 1', [user.id, ['in_use', 'abnormal_pending', 'overdue']]).then((rows) => rows?.[0] || null);
    if (unfinishedRecord) {
      return fail('请先完成当前设备使用或归还。', 409, 3001);
    }
    const plans = [];
    for (const group of parseReservationGroups(payload)) {
      const deviceCodes = parseReservationDevices(group);
      const devices = [];
      for (const deviceCode of deviceCodes) {
        const device = await getDeviceByCode(deviceCode);
        if (!device) return fail(`设备不存在：${deviceCode}`, 404, 3004);
        if (!device.allow_reservation || ['maintenance', 'disabled', 'abnormal_pending'].includes(device.status)) {
          return fail(`${device.device_code} 暂不可预约。`, 409, 3001);
        }
        devices.push(device);
      }
      const slots = parseReservationSlots(group, devices);
      const minReservationDate = minimumReservationDateText();
      for (const { start } of slots) {
        if (reservationDateText(start) < minReservationDate) {
          return fail('预约日期必须是明天或更晚日期，不能预约今天或过去日期。', 409, 3001);
        }
      }
      plans.push({ deviceCodes, devices, slots });
    }
    if (!plans.length) return fail('reservation_groups is required', 400, 2001);
    const created = [];
    const selectedKeys = new Set();
    for (const plan of plans) {
      for (const device of plan.devices) {
          for (const { start, end } of plan.slots) {
          const selectedKey = `${device.id}:${start.toISOString()}:${end.toISOString()}`;
          if (selectedKeys.has(selectedKey)) return fail(`Duplicate selected time slot for ${device.device_code}`, 409, 3001);
          selectedKeys.add(selectedKey);
        }
      }
    }
    for (const plan of plans) {
      for (const device of plan.devices) {
          for (const { start, end } of plan.slots) {
          const conflicts = await checkConflict(device.id, start.toISOString(), end.toISOString());
          if (conflicts.length) return fail(`Selected time slot is already occupied for ${device.device_code}`, 409, 3001);
        }
      }
    }
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query('insert into reservation_batches (id, user_id, device_codes, time_slots, purpose, status, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8)', [
        batchId,
        user.id,
        [...new Set(plans.flatMap((plan) => plan.deviceCodes))].join(','),
        plans.flatMap((plan) => plan.slots.map(({ start, end }) => `${plan.deviceCodes.join(',')} | ${start.toISOString()} - ${end.toISOString()}`)).join('\n'),
        purpose,
        'pending',
        nowIso(),
        nowIso()
      ]);
      for (const plan of plans) {
        for (const device of plan.devices) {
          for (const { start, end, key } of plan.slots) {
            const itemId = uuid();
            await client.query('insert into reservation_items (id, batch_id, device_id, user_id, reservation_date, slot_key, start_time, end_time, status, reservation_id, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
              itemId, batchId, device.id, user.id, reservationDateText(start), key || detectSlotKey(start, end), start.toISOString(), end.toISOString(), 'pending', null, nowIso(), nowIso()
            ]);
            created.push({ id: itemId, item_id: itemId, reservation_item_id: itemId, batch_id: batchId, device_id: device.id, user_id: user.id, start_time: start.toISOString(), end_time: end.toISOString(), purpose, status: 'pending', device_code: device.device_code });
            await log('create_reservation', `Created reservation item ${device.device_code} ${start.toISOString()} - ${end.toISOString()}`, user, device.id, itemId, txQuery);
          }
        }
      }
    });
    return ok({ message: `已提交 ${created.length} 条预约，等待审核`, batch_id: batchId, reservations: created });
  }

  async function precheckReservation(payload, token) {
    const user = await requireUser(token);
    const unfinishedRows = await query('select id, status from borrow_records where user_id = $1 and status = any($2) limit 1', [user.id, ['in_use', 'abnormal_pending', 'overdue']]);
    const unfinishedRecord = unfinishedRows?.[0] || null;
    if (unfinishedRecord) {
      return ok({
        available: false,
        total: 0,
        conflicts: [{
          type: 'unfinished_borrow',
          reason: '请先完成当前设备使用或归还流程，再提交新的预约。',
          status: unfinishedRecord.status
        }]
      });
    }

    const plans = [];
    const conflicts = [];
    for (const group of parseReservationGroups(payload)) {
      const deviceCodes = parseReservationDevices(group);
      const devices = [];
      for (const deviceCode of deviceCodes) {
        const device = await getDeviceByCode(deviceCode);
        if (!device) {
          conflicts.push({ type: 'missing_device', device_code: deviceCode, reason: `设备不存在：${deviceCode}` });
          continue;
        }
        if (!device.allow_reservation || ['maintenance', 'disabled', 'abnormal_pending'].includes(device.status)) {
          conflicts.push({
            type: 'device_unavailable',
            device_code: device.device_code,
            device_name: device.name,
            status: device.status,
            reason: `设备 ${device.device_code} 当前不可预约。`
          });
        }
        devices.push(device);
      }
      if (!devices.length) continue;
      const slots = parseReservationSlots(group, devices);
      const minReservationDate = minimumReservationDateText();
      for (const { start } of slots) {
        if (reservationDateText(start) < minReservationDate) {
          conflicts.push({
            type: 'invalid_date',
            reason: '预约日期必须是明天或更晚日期，不能预约今天或过去日期。',
            start_time: start.toISOString()
          });
        }
      }
      plans.push({ devices, slots });
    }

    const selectedKeys = new Set();
    const checks = [];
    for (const plan of plans) {
      for (const device of plan.devices) {
        for (const { start, end, label, key } of plan.slots) {
          const selectedKey = `${device.id}:${start.toISOString()}:${end.toISOString()}`;
          if (selectedKeys.has(selectedKey)) {
            conflicts.push({
              type: 'duplicate_selection',
              device_code: device.device_code,
              device_name: device.name,
              start_time: start.toISOString(),
              end_time: end.toISOString(),
              reason: `重复选择了 ${device.device_code} 的同一时间段。`
            });
            continue;
          }
          selectedKeys.add(selectedKey);
          checks.push({ device, start, end, label, key });
        }
      }
    }

    for (const item of checks) {
      const rows = await checkConflict(item.device.id, item.start.toISOString(), item.end.toISOString());
      for (const row of rows || []) {
        conflicts.push({
          type: 'occupied',
          device_code: item.device.device_code,
          device_name: item.device.name,
          slot_key: item.key || detectSlotKey(item.start, item.end),
          slot_label: item.label || '',
          start_time: item.start.toISOString(),
          end_time: item.end.toISOString(),
          conflict_start_time: row.start_time,
          conflict_end_time: row.end_time,
          conflict_status: row.status,
          reason: `${item.device.device_code} 在该时段已有预约或使用记录。`
        });
      }
    }

    return ok({
      available: conflicts.length === 0,
      total: checks.length,
      conflicts
    });
  }

  async function cancelReservation(payload, token) {
    const user = await requireUser(token);
    const requestedId = assertText(payload.reservation_item_id || payload.item_id || payload.reservation_id, 'reservation_item_id', 60);
    let reservationItem = await getReservationItemById(requestedId);
    let legacyReservation = null;
    if (!reservationItem) {
      const reservationId = await resolveReservationId(requestedId);
      legacyReservation = await getById('reservations', reservationId);
      if (legacyReservation) {
        const rows = await query('select * from reservation_items where reservation_id = $1 order by created_at desc limit 1', [legacyReservation.id]);
        reservationItem = rows?.[0] || legacyReservation;
      }
    }
    if (!reservationItem) return fail('Reservation not found', 404, 3004);
    if (reservationItem.user_id !== user.id) return fail('不能取消其他用户的预约。', 403, 1003);
    if (!canCancelReservation(reservationItem)) {
      return fail('预约当天不能取消，请联系管理员。', 409, 3001);
    }
    if (reservationItem.id && reservationItem.batch_id) {
      await query('update reservation_items set status = $1, updated_at = $2 where id = $3', ['cancelled', nowIso(), reservationItem.id]);
    }
    const legacyId = reservationItem.reservation_id || legacyReservation?.id || null;
    if (legacyId) await query('update reservations set status = $1, updated_at = $2 where id = $3', ['cancelled', nowIso(), legacyId]);
    await log('cancel_reservation', 'Cancelled reservation before reservation day', user, reservationItem.device_id, reservationItem.id || legacyId);
    return ok({ message: '已取消预约' });
  }

  async function cancelReservationItem(payload, token) {
    return cancelReservation({ reservation_id: payload.id || payload.reservation_item_id || payload.reservation_id }, token);
  }

  async function adminApproveReservationBatch(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin', 'ops'], ['reservation.approve']);
    const batchId = assertText(payload.id || payload.batch_id || payload.batchId, 'batch_id', 60);
    const approved = parseBoolean(payload.approved);
    const adminNote = String(payload.admin_note || payload.adminNote || '').trim().slice(0, 500);
    const batch = await getById('reservation_batches', batchId);
    if (!batch) return fail('Reservation batch not found', 404, 3004);
    const nextStatus = approved ? 'approved' : 'rejected';
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      const changedReservations = await rowsFrom(txQuery, `
        select ri.*, ri.id as id, ri.reservation_id, d.device_code, d.name as device_name
        from reservation_items ri
        join devices d on d.id = ri.device_id
        where ri.batch_id = $1 and ri.status = $2 and ri.end_time >= now()
        order by ri.start_time asc
      `, [batchId, 'pending']);
      await client.query(`update reservations set status = $1, admin_note = $2, approved_at = case when $1 = $3 then $4 else approved_at end, updated_at = $4 where batch_id = $5 and status = $6 and reservations.end_time >= now()`, [nextStatus, adminNote, 'approved', nowIso(), batchId, 'pending']);
      await client.query('update reservation_batches set status = $1, admin_note = $2, updated_at = $3 where id = $4', [nextStatus, adminNote, nowIso(), batchId]);
      await client.query(`update reservation_items set status = $1, admin_note = $2, approved_at = case when $1 = $3 then $4 else approved_at end, updated_at = $4 where batch_id = $5 and status = $6 and reservation_items.end_time >= now()`, [nextStatus, adminNote, 'approved', nowIso(), batchId, 'pending']);
      for (const row of changedReservations || []) {
        await createReservationStatusNotification(row, nextStatus, adminNote, txQuery);
      }
      await log(approved ? 'approve_reservation_batch' : 'reject_reservation_batch', `Updated reservation batch ${batchId} to ${nextStatus}`, admin, null, batchId, txQuery);
    });
    return ok({ message: approved ? '已通过本次预约' : '已拒绝本次预约' });
  }

  async function adminApproveReservation(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin', 'ops'], ['reservation.approve']);
    const requestedId = payload.reservation_item_id || payload.item_id || payload.reservation_id;
    const approve = !!payload.approve;
    const adminNote = String(payload.admin_note || '').trim().slice(0, 500);
    const reservationItem = await getReservationItemById(requestedId);
    if (!reservationItem) return fail('预约明细不存在。', 404, 3004);
    if (approve) {
      const conflicts = await checkConflict(reservationItem.device_id, reservationItem.start_time, reservationItem.end_time, reservationItem.id);
      if (conflicts.length) return fail('该时间段已被预约，请选择其他时间。', 409, 3001);
      await withTransaction(async (client) => {
        const txQuery = (sql, params = []) => client.query(sql, params);
        if (reservationItem.reservation_id) await client.query('update reservations set status = $1, admin_note = $2, approved_at = $3, updated_at = $4 where id = $5', ['approved', adminNote, nowIso(), nowIso(), reservationItem.reservation_id]);
        await client.query('update reservation_items set status = $1, admin_note = $2, approved_by = $3, approved_at = $4, updated_at = $4 where id = $5', ['approved', adminNote, admin.user_id || admin.id || null, nowIso(), reservationItem.id]);
        await client.query('update devices set updated_at = $1 where id = $2', [nowIso(), reservationItem.device_id]);
        await createReservationStatusNotification({ ...reservationItem, id: reservationItem.reservation_id || reservationItem.id }, 'approved', adminNote, txQuery);
        await log('approve_reservation', '通过预约明细', admin, reservationItem.device_id, reservationItem.id, txQuery);
      });
      return ok({ message: '已通过预约' });
    }
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      if (reservationItem.reservation_id) await client.query('update reservations set status = $1, admin_note = $2, updated_at = $3 where id = $4', ['rejected', adminNote, nowIso(), reservationItem.reservation_id]);
      await client.query('update reservation_items set status = $1, admin_note = $2, updated_at = $3 where id = $4', ['rejected', adminNote, nowIso(), reservationItem.id]);
      await createReservationStatusNotification({ ...reservationItem, id: reservationItem.reservation_id || reservationItem.id }, 'rejected', adminNote, txQuery);
      await log('reject_reservation', '拒绝预约明细', admin, reservationItem.device_id, reservationItem.id, txQuery);
    });
    return ok({ message: '已拒绝预约' });
  }

  return {
    adminApproveReservation,
    adminApproveReservationBatch,
    cancelReservation,
    cancelReservationItem,
    createReservation,
    precheckReservation
  };
}

module.exports = { createReservationActionService };
