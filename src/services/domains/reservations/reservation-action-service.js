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
    parseReservationGroups: parseGroups = () => [],
    parseReservationSlots,
    query,
    requireAdminRole,
    requireUser,
    reservationDateText,
    rowsFrom,
    uuid,
    withTransaction
  } = context;

  async function noShowRestriction(userId) {
    const rows = await query("select count(*)::int as count from reservation_items where user_id = $1 and status = 'no_show' and start_time >= now() - interval '90 days'", [userId]);
    const count = Number(rows?.[0]?.count) || 0;
    return { count, restricted: count >= 2 };
  }

  function noShowRestrictionReason(count) {
    return `\u8fd1 90 \u5929\u5df2\u6709 ${count} \u6b21\u723d\u7ea6\uff0c\u6682\u65f6\u65e0\u6cd5\u63d0\u4ea4\u65b0\u7684\u9884\u7ea6\u3002`;
  }

  async function createReservation(payload, token) {
    const user = await requireUser(token);
    const restriction = await noShowRestriction(user.id);
    if (restriction.restricted) return fail(noShowRestrictionReason(restriction.count), 409, 3001);
    const purpose = String(payload.purpose || '').trim().slice(0, 200);
    const batchId = uuid();
    const unfinishedRecord = await query('select id from borrow_records where user_id = $1 and status = any($2) limit 1', [user.id, ['in_use', 'abnormal_pending', 'overdue']]).then((rows) => rows?.[0] || null);
    if (unfinishedRecord) {
      return fail('请先完成当前设备使用或归还。', 409, 3001);
    }
    const plans = [];
    for (const group of parseGroups(payload)) {
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
    if (!plans.length) return fail('请选择设备与时段', 400, 2001);
    const created = [];
    const selectedKeys = new Set();
    for (const plan of plans) {
      for (const device of plan.devices) {
          for (const { start, end } of plan.slots) {
          const selectedKey = `${device.id}:${start.toISOString()}:${end.toISOString()}`;
          if (selectedKeys.has(selectedKey)) return fail(`重复选择时段：${device.device_code}`, 409, 3001);
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
    const restriction = await noShowRestriction(user.id);
    if (restriction.restricted) {
      return ok({ available: false, total: 0, conflicts: [{ type: 'no_show_restriction', reason: noShowRestrictionReason(restriction.count), count: restriction.count }] });
    }
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
    for (const group of parseGroups(payload)) {
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
    const reservationItem = await getReservationItemById(requestedId);
    if (!reservationItem) return fail('\u53d6\u6d88\u7533\u8bf7\u4e0d\u5b58\u5728\u3002', 404, 3004);
    if (reservationItem.user_id !== user.id) return fail('\u65e0\u6743\u53d6\u6d88\u8be5\u9884\u7ea6\u3002', 403, 1003);
    const todayText = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
    const reservationDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(reservationItem.start_time));
    if (reservationDay < todayText) return fail('\u5386\u53f2\u9884\u7ea6\u4e0d\u53ef\u53d6\u6d88\u3002', 409, 3001);
    if (reservationDay === todayText) {
      if (!reservationItem.id || !reservationItem.batch_id || !['pending', 'approved'].includes(reservationItem.status)) return fail('\u5f53\u524d\u9884\u7ea6\u4e0d\u80fd\u63d0\u4ea4\u5f53\u65e5\u53d6\u6d88\u7533\u8bf7\u3002', 409, 3001);
      const reason = String(payload.cancel_reason || payload.reason || '').trim().slice(0, 500);
      const now = nowIso();
      await query(`update reservation_items set status = $1, cancel_previous_status = $2, cancel_requested_at = $3, cancel_request_note = $4, cancel_reviewed_by = null, cancel_reviewed_at = null, cancel_review_note = null, updated_at = $3 where id = $5`, ['cancel_requested', reservationItem.status, now, reason || null, reservationItem.id]);
      await log('request_same_day_reservation_cancellation', { message: '\u63d0\u4ea4\u5f53\u65e5\u53d6\u6d88\u7533\u8bf7', reason }, user, reservationItem.device_id, reservationItem.id);
      return ok({ message: '\u5df2\u63d0\u4ea4\u5f53\u65e5\u53d6\u6d88\u7533\u8bf7\uff0c\u7b49\u5f85\u7ba1\u7406\u5458\u5ba1\u6838\u3002', status: 'cancel_requested' });
    }
    if (!canCancelReservation(reservationItem)) return fail('\u5f53\u524d\u9884\u7ea6\u4e0d\u80fd\u53d6\u6d88\u3002', 409, 3001);
    if (reservationItem.id && reservationItem.batch_id) await query('update reservation_items set status = $1, updated_at = $2 where id = $3', ['cancelled', nowIso(), reservationItem.id]);
    await log('cancel_reservation', 'Cancelled reservation before reservation day', user, reservationItem.device_id, reservationItem.id);
    return ok({ message: '\u9884\u7ea6\u5df2\u53d6\u6d88\u3002', status: 'cancelled' });
  }

  async function cancelReservationItem(payload, token) {
    return cancelReservation({ ...payload, reservation_id: payload.id || payload.reservation_item_id || payload.reservation_id }, token);
  }

  async function adminReviewReservationCancellation(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['reservation.approve']);
    const itemId = assertText(payload.id || payload.reservation_item_id, 'reservation_item_id', 60);
    const approved = parseBoolean(payload.approved);
    const note = String(payload.admin_note || payload.review_note || '').trim().slice(0, 500);
    const item = await getReservationItemById(itemId);
    if (!item) return fail('\u53d6\u6d88\u7533\u8bf7\u4e0d\u5b58\u5728\u3002', 404, 3004);
    if (item.status !== 'cancel_requested') return fail('\u4ec5\u53ef\u5ba1\u6838\u5f53\u65e5\u53d6\u6d88\u7533\u8bf7\u3002', 409, 3001);
    const nextStatus = approved ? 'cancelled' : (item.cancel_previous_status === 'approved' ? 'approved' : 'pending');
    const now = nowIso();
    await withTransaction(async (client) => {
      await client.query(`update reservation_items set status=$1, cancel_reviewed_by=$2, cancel_reviewed_at=$3, cancel_review_note=$4, updated_by=$2, updated_at=$3 where id=$5`, [nextStatus, admin.user_id || admin.id || null, now, note || null, item.id]);
      if (item.reservation_id && approved) await client.query('update reservations set status=$1, updated_at=$2 where id=$3', ['cancelled', now, item.reservation_id]);
      await log('review_same_day_reservation_cancellation', { message: approved ? '\u5df2\u540c\u610f\u5f53\u65e5\u53d6\u6d88' : '\u5df2\u62d2\u7edd\u5f53\u65e5\u53d6\u6d88', approved, review_note: note }, admin, item.device_id, item.id, (sql, params = []) => client.query(sql, params));
    });
    return ok({ message: approved ? '\u5df2\u540c\u610f\u5f53\u65e5\u53d6\u6d88\u7533\u8bf7\u3002' : '\u5df2\u62d2\u7edd\u5f53\u65e5\u53d6\u6d88\u7533\u8bf7\uff0c\u9884\u7ea6\u4fdd\u6301\u539f\u72b6\u6001\u3002', status: nextStatus });
  }

  async function adminApproveReservationBatch(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['reservation.approve']);
    const batchId = assertText(payload.id || payload.batch_id || payload.batchId, 'batch_id', 60);
    const approved = parseBoolean(payload.approved);
    const adminNote = String(payload.admin_note || payload.adminNote || '').trim().slice(0, 500);
    const batch = await getById('reservation_batches', batchId);
    if (!batch) return fail('预约批次不存在', 404, 3004);
    const nextStatus = approved ? 'approved' : 'rejected';
    const approvedBy = admin.user_id || admin.id || null;
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
      await client.query(`update reservation_items set status = $1, admin_note = $2, approved_by = case when $1 = $3 then $7 else approved_by end, approved_at = case when $1 = $3 then $4 else approved_at end, updated_at = $4 where batch_id = $5 and status = $6 and reservation_items.end_time >= now()`, [nextStatus, adminNote, 'approved', nowIso(), batchId, 'pending', approvedBy]);
      for (const row of changedReservations || []) {
        await createReservationStatusNotification(row, nextStatus, adminNote, txQuery);
      }
      await log(approved ? 'approve_reservation_batch' : 'reject_reservation_batch', {
        message: `Updated reservation batch ${batchId} to ${nextStatus}`,
        batch_id: batchId,
        status: nextStatus,
        admin_note: adminNote,
        item_count: changedReservations.length,
        reservation_item_ids: changedReservations.map((row) => row.id),
        device_codes: changedReservations.map((row) => row.device_code).filter(Boolean)
      }, admin, null, batchId, txQuery);
    });
    return ok({ message: approved ? '已通过本次预约' : '已拒绝本次预约' });
  }

  async function adminApproveReservation(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['reservation.approve']);
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
        await log('approve_reservation', {
          message: '通过预约明细',
          reservation_item_id: reservationItem.id,
          batch_id: reservationItem.batch_id,
          status: 'approved',
          admin_note: adminNote,
          start_time: reservationItem.start_time,
          end_time: reservationItem.end_time
        }, admin, reservationItem.device_id, reservationItem.id, txQuery);
      });
      return ok({ message: '已通过预约' });
    }
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      if (reservationItem.reservation_id) await client.query('update reservations set status = $1, admin_note = $2, updated_at = $3 where id = $4', ['rejected', adminNote, nowIso(), reservationItem.reservation_id]);
      await client.query('update reservation_items set status = $1, admin_note = $2, updated_at = $3 where id = $4', ['rejected', adminNote, nowIso(), reservationItem.id]);
      await createReservationStatusNotification({ ...reservationItem, id: reservationItem.reservation_id || reservationItem.id }, 'rejected', adminNote, txQuery);
      await log('reject_reservation', {
        message: '拒绝预约明细',
        reservation_item_id: reservationItem.id,
        batch_id: reservationItem.batch_id,
        status: 'rejected',
        admin_note: adminNote,
        start_time: reservationItem.start_time,
        end_time: reservationItem.end_time
      }, admin, reservationItem.device_id, reservationItem.id, txQuery);
    });
    return ok({ message: '已拒绝预约' });
  }

  async function adminMarkReservationNoShow(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['reservation.approve']);
    const itemId = String(payload.id || payload.reservation_item_id || '').trim();
    if (!itemId) return fail('\u9884\u7ea6\u660e\u7ec6\u4e0d\u80fd\u4e3a\u7a7a\u3002', 400, 2001);
    const reservationItem = await getReservationItemById(itemId);
    if (!reservationItem) return fail('\u9884\u7ea6\u660e\u7ec6\u4e0d\u5b58\u5728\u3002', 404, 3004);
    const now = nowIso();
    const startedAt = new Date(reservationItem.start_time).getTime();
    const currentAt = new Date(now).getTime();
    if (reservationItem.status !== 'approved' || !Number.isFinite(startedAt) || startedAt > currentAt) {
      return fail('\u53ea\u80fd\u5728\u5df2\u6279\u51c6\u9884\u7ea6\u5f00\u59cb\u540e\u6807\u8bb0\u723d\u7ea6\u3002', 409, 3001);
    }
    const allowedCategories = ['forgot', 'plan_changed', 'schedule_conflict', 'other'];
    const requestedCategory = String(payload.no_show_reason_category || payload.noShowReasonCategory || 'other').trim().toLowerCase();
    const reasonCategory = allowedCategories.includes(requestedCategory) ? requestedCategory : 'other';
    const adminNote = String(payload.admin_note || payload.adminNote || '').trim().slice(0, 500);
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query('update reservation_items set status = $1, admin_note = $2, no_show_reason_category = $3, updated_at = $4, updated_by = $5 where id = $6', ['no_show', adminNote || null, reasonCategory, now, admin.user_id || admin.id || null, reservationItem.id]);
      if (reservationItem.reservation_id) {
        await client.query('update reservations set status = $1, admin_note = $2, updated_at = $3, updated_by = $4 where id = $5', ['no_show', adminNote || null, now, admin.user_id || admin.id || null, reservationItem.reservation_id]);
      }
      await log('mark_reservation_no_show', { reservation_item_id: reservationItem.id, reservation_id: reservationItem.reservation_id || null, reason_category: reasonCategory, admin_note: adminNote }, admin, reservationItem.device_id, reservationItem.id, txQuery);
    });
    return ok({ message: '\u5df2\u6807\u8bb0\u723d\u7ea6\u3002', status: 'no_show', reason_category: reasonCategory });
  }
  async function adminBulkApproveReservations(payload, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['reservation.approve']);
    const approved = parseBoolean(payload.approved ?? payload.approve);
    const batchIds = Array.isArray(payload.batch_ids) ? payload.batch_ids : [];
    const itemIds = Array.isArray(payload.item_ids) ? payload.item_ids : [];
    const adminNote = String(payload.admin_note || payload.adminNote || '').trim().slice(0, 500);
    const results = [];
    for (const batchId of batchIds.map((id) => String(id || '').trim()).filter(Boolean)) {
      const result = await adminApproveReservationBatch({ id: batchId, approved, admin_note: adminNote }, token);
      results.push({ type: 'batch', id: batchId, ok: result.ok !== false, message: result.message || result.data?.message || '' });
    }
    for (const itemId of itemIds.map((id) => String(id || '').trim()).filter(Boolean)) {
      const result = await adminApproveReservation({ reservation_id: itemId, approve: approved, admin_note: adminNote }, token);
      results.push({ type: 'item', id: itemId, ok: result.ok !== false, message: result.message || result.data?.message || '' });
    }
    if (!results.length) return fail('请选择要审批的预约。', 400, 2001);
    return ok({ message: `已处理 ${results.length} 个审批对象`, results });
  }

  return {
    adminApproveReservation,
    adminApproveReservationBatch,
    adminBulkApproveReservations,
    adminMarkReservationNoShow,
    cancelReservation,
    cancelReservationItem,
    createReservation,
    precheckReservation
  };
}

module.exports = { createReservationActionService };

