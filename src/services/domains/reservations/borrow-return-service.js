function createBorrowReturnService(context = {}) {
  const {
    appendUsageLog,
    assertText,
    durationMinutes,
    fail,
    getById,
    getReservationItemById,
    getSecurityConfig,
    log,
    notifyReservationUsersForDevice,
    nowIso,
    ok,
    requireUser,
    uuid,
    withTransaction
  } = context;

  async function startUse(payload, token) {
    const user = await requireUser(token);
    const requestedId = payload.reservation_item_id || payload.reservationItemId || payload.item_id || payload.reservation_id;
    const reservationItem = await getReservationItemById(requestedId);
    if (!reservationItem) return fail('预约不存在。', 404, 3004);
    if (reservationItem.user_id !== user.id) return fail('不能操作其他用户的预约。', 403, 1003);
    if (reservationItem.status !== 'approved') return fail('预约尚未通过审核。', 409, 3001);
    const now = new Date();
    const startAllowed = new Date(new Date(reservationItem.start_time).getTime() - 15 * 60_000);
    if (now < startAllowed) return fail('还未到可开始使用时间。', 409, 3001);
    if (now > new Date(reservationItem.end_time)) return fail('预约时间已结束。', 409, 3001);
    const device = await getById('devices', reservationItem.device_id);
    if (!device || ['in_use', 'maintenance', 'disabled', 'abnormal_pending'].includes(device.status)) {
      return fail('设备当前不可用。', 409, 3001);
    }
    const record = { id: uuid(), reservation_id: reservationItem.reservation_id, reservation_item_id: reservationItem.id, device_id: reservationItem.device_id, user_id: user.id, borrow_time: nowIso(), expected_return_time: reservationItem.end_time, status: 'in_use', created_at: nowIso(), updated_at: nowIso() };
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query('insert into borrow_records (id, reservation_id, reservation_item_id, device_id, user_id, borrow_time, expected_return_time, status, actual_start_time, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [record.id, record.reservation_id, record.reservation_item_id, record.device_id, record.user_id, record.borrow_time, record.expected_return_time, record.status, record.borrow_time, record.created_at, record.updated_at]);
      if (reservationItem.reservation_id) await client.query('update reservations set status = $1, updated_at = $2 where id = $3', ['in_use', nowIso(), reservationItem.reservation_id]);
      await client.query('update reservation_items set status = $1, updated_at = $2 where id = $3', ['in_use', nowIso(), reservationItem.id]);
      await client.query('update devices set status = $1, updated_at = $2 where id = $3', ['in_use', nowIso(), reservationItem.device_id]);
      await appendUsageLog('BORROW', record, user, device, { operator_name: user.name }, txQuery);
      await log('start_use', '开始使用设备', user, reservationItem.device_id, record.id, txQuery);
    });
    return ok({ message: '已开始使用', record });
  }

  async function submitReturn(payload, token) {
    const user = await requireUser(token);
    const recordId = assertText(payload.record_id, 'record_id', 60);
    const returnCondition = String(payload.return_condition || 'normal').trim().slice(0, 50);
    const returnNote = String(payload.return_note || '').trim().slice(0, 500);
    const returnPhotos = Array.isArray(payload.return_photos) ? payload.return_photos.slice(0, 5).map((value) => String(value).slice(0, 500)) : [];
    const config = await getSecurityConfig();
    if (config.require_return_photo && !returnPhotos.length) {
      return fail('请上传归还照片后再提交。', 400, 2001);
    }
    const record = await getById('borrow_records', recordId);
    if (!record) return fail('Borrow record not found', 404, 3004);
    if (record.user_id !== user.id) return fail('不能归还其他用户的设备。', 403, 1003);
    if (record.status !== 'in_use') return fail('该记录不在使用中。', 409, 3001);
    const returnTime = nowIso();
    const duration = durationMinutes(record.borrow_time, returnTime);
    const isOverdue = record.expected_return_time ? new Date(returnTime) > new Date(record.expected_return_time) : false;
    const abnormal = returnCondition && returnCondition !== 'normal';
    const nextDeviceStatus = abnormal ? 'abnormal_pending' : 'available';
    const nextRecordStatus = abnormal ? 'abnormal_pending' : 'returned';
    const device = await getById('devices', record.device_id);
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query('update borrow_records set return_time = $1, duration_minutes = $2, return_condition = $3, return_note = $4, return_photos = $5, status = $6, is_overdue = $7, actual_end_time = $8, updated_at = $9 where id = $10', [returnTime, duration, returnCondition, returnNote, JSON.stringify(returnPhotos), nextRecordStatus, isOverdue, returnTime, nowIso(), record.id]);
      await client.query('update devices set status = $1, allow_reservation = $2, last_return_photo = $3, last_return_user = $4, last_return_time = $5, last_condition = $6, updated_at = $7 where id = $8', [nextDeviceStatus, !abnormal, returnPhotos[0] || null, user.name, returnTime, returnCondition, nowIso(), record.device_id]);
      if (abnormal) {
        await notifyReservationUsersForDevice(record.device_id, {
          type: 'device_fault',
          title: '预约设备临时不可用',
          content: '你预约的设备 {device_code} {device_name} 归还时被标记为异常，管理员正在处理。你的预约不会被取消，但设备当前暂时不可用；维修恢复后会再次通知你。预约时间：{start_time} - {end_time}',
          related_type: 'borrow_record',
          related_id: record.id
        }, txQuery);
      }
      if (record.reservation_id) {
        await client.query('update reservations set status = $1, updated_at = $2 where id = $3', ['completed', nowIso(), record.reservation_id]);
      }
      if (record.reservation_item_id) {
        await client.query('update reservation_items set status = $1, updated_at = $2 where id = $3', [abnormal ? 'faulted' : 'completed', nowIso(), record.reservation_item_id]);
      }
      await appendUsageLog('RETURN', { ...record, return_time: returnTime, duration_minutes: duration, return_condition: returnCondition, return_note: returnNote, status: nextRecordStatus }, user, device, { operator_name: user.name }, txQuery);
      await log('submit_return', `Submitted return: ${returnCondition || 'normal'}`, user, record.device_id, record.id, txQuery);
    });
    return ok({ message: abnormal ? '异常已提交' : '已归还' });
  }

  return { startUse, submitReturn };
}

module.exports = { createBorrowReturnService };