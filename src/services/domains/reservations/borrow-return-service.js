const fs = require('fs');
const path = require('path');

function createBorrowReturnService(context = {}) {
  const {
    appendUsageLog,
    assertText,
    createUserNotification,
    durationMinutes,
    fail,
    getById,
    getReservationItemById,
    getSecurityConfig,
    log,
    notifyReservationUsersForDevice,
    nowIso,
    ok,
    query,
    requireAdminRole,
    requireUser,
    safeFilename,
    uploadDir,
    uuid,
    withTransaction
  } = context;

  function extFromUploadUrl(url) {
    const clean = String(url || '').split('?')[0].split('#')[0];
    const ext = path.extname(clean).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function archiveTimeText(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '').replace(/[^0-9]/g, '').slice(0, 12) || '未知时间';
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
  }

  function isAllowedReturnPhotoUrl(url) {
    const text = String(url || '').trim();
    return text.startsWith('/uploads/') || /^https?:\/\//i.test(text);
  }

  function localUploadPathFromUrl(url) {
    const text = String(url || '').trim();
    if (!text.startsWith('/uploads/')) return null;
    const relative = decodeURIComponent(text.replace(/^\/uploads\//, '')).replace(/\\/g, '/');
    if (relative.includes('..')) return null;
    const full = path.resolve(uploadDir || path.join(process.cwd(), 'uploads'), relative);
    const root = path.resolve(uploadDir || path.join(process.cwd(), 'uploads'));
    return full.startsWith(root + path.sep) || full === root ? full : null;
  }

  async function nextReturnFolderName({ device, user, returnTime }) {
    const safe = typeof safeFilename === 'function'
      ? safeFilename
      : (value) => String(value || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    // 归还归档目录会出现在图片 URL 中，不能包含使用人的姓名、电话等个人信息。
    // 使用随机标识避免枚举和个人信息泄露，同时保留时间便于管理员排查。
    const timeText = archiveTimeText(returnTime);
    const randomId = String(typeof uuid === 'function' ? uuid() : `${Date.now()}-${Math.random()}`)
      .replace(/[^a-zA-Z0-9-]/g, '')
      .slice(0, 24);
    const base = safe(`return-${timeText}-${randomId}`);
    const returnsRoot = path.join(uploadDir || path.join(process.cwd(), 'uploads'), 'returns');
    await fs.promises.mkdir(returnsRoot, { recursive: true });
    let folder = base;
    let index = 1;
    while (true) {
      const target = path.join(returnsRoot, folder);
      try {
        await fs.promises.mkdir(target);
        return { folder, dir: target };
      } catch (error) {
        if (error && error.code === 'EEXIST') {
          index += 1;
          folder = safe(`${base}-${index}`);
          continue;
        }
        throw error;
      }
    }
  }

  async function archiveReturnPhotos(photoUrls, { device, user, returnTime }) {
    if (!Array.isArray(photoUrls) || !photoUrls.length) return { photos: [], folder: '' };
    const safe = typeof safeFilename === 'function'
      ? safeFilename
      : (value) => String(value || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const { folder, dir } = await nextReturnFolderName({ device, user, returnTime });
    const deviceName = safe(device?.name || device?.device_code || '设备图片');
    const archived = [];
    for (let index = 0; index < photoUrls.length; index += 1) {
      const url = photoUrls[index];
      const source = localUploadPathFromUrl(url);
      const ext = extFromUploadUrl(url);
      const filename = `${deviceName}${index === 0 ? '' : `_${index + 1}`}${ext}`;
      const target = path.join(dir, filename);
      if (source) {
        try {
          await fs.promises.copyFile(source, target);
          archived.push(`/uploads/returns/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`);
          continue;
        } catch (_) {
          // 如果旧文件已被清理，保留原始 URL，不阻断归还。
        }
      }
      archived.push(String(url));
    }
    return { photos: archived, folder };
  }

  function resultRows(result) {
    return Array.isArray(result) ? result : (result?.rows || []);
  }

  async function startReservationItem(itemId, options = {}) {
    const source = options.source === 'auto' ? 'auto' : 'manual';
    const now = new Date(options.nowValue || nowIso());
    if (Number.isNaN(now.getTime())) return { state: 'invalid_time', message: '开始时间无效。' };
    return withTransaction(async (client) => {
      const itemResult = await client.query(`select ri.*, u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
        from reservation_items ri join users u on u.id=ri.user_id
        where ri.id=$1 and ri.deleted_at is null for update of ri`, [itemId]);
      const reservationItem = resultRows(itemResult)[0];
      if (!reservationItem) return { state: 'not_found', message: '预约不存在。' };
      if (options.userId && reservationItem.user_id !== options.userId) return { state: 'forbidden', message: '不能操作其他用户的预约。' };
      if (reservationItem.status === 'in_use') {
        const existingResult = await client.query("select * from borrow_records where reservation_item_id=$1 and status in ('in_use','return_pending','abnormal_pending','overdue') order by created_at desc limit 1", [reservationItem.id]);
        return { state: 'already_started', record: resultRows(existingResult)[0] || null, reservationItem };
      }
      if (reservationItem.status !== 'approved') return { state: 'not_approved', message: '预约尚未通过审核。', reservationItem };

      const startAt = new Date(reservationItem.start_time);
      const endAt = new Date(reservationItem.end_time);
      const threshold = source === 'auto'
        ? new Date(startAt.getTime() + 30 * 60_000)
        : new Date(startAt.getTime() - 15 * 60_000);
      if (now < threshold) return { state: 'too_early', message: source === 'auto' ? '尚未超过预约开始时间 30 分钟。' : '还未到可开始使用时间。', reservationItem };
      if (now >= endAt) return { state: 'ended', message: '预约时间已结束。', reservationItem };

      const deviceResult = await client.query('select * from devices where id=$1 and deleted_at is null for update', [reservationItem.device_id]);
      const device = resultRows(deviceResult)[0];
      if (!device || ['in_use', 'maintenance', 'disabled', 'abnormal_pending'].includes(String(device.status || ''))) {
        return { state: 'device_unavailable', message: '设备当前不可用。', reservationItem, device };
      }

      const timestamp = now.toISOString();
      const user = { id: reservationItem.user_id, name: reservationItem.user_name, phone: reservationItem.user_phone, student_no: reservationItem.user_student_no, role: 'user' };
      const record = {
        id: uuid(), reservation_id: reservationItem.reservation_id, reservation_item_id: reservationItem.id,
        device_id: reservationItem.device_id, device_code: device.device_code, device_name: device.name,
        user_id: reservationItem.user_id, borrow_time: timestamp, expected_return_time: reservationItem.end_time,
        status: 'in_use', created_at: timestamp, updated_at: timestamp
      };
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query('insert into borrow_records (id, reservation_id, reservation_item_id, device_id, user_id, borrow_time, expected_return_time, status, actual_start_time, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [record.id, record.reservation_id, record.reservation_item_id, record.device_id, record.user_id, record.borrow_time, record.expected_return_time, record.status, record.borrow_time, record.created_at, record.updated_at]);
      if (reservationItem.reservation_id) await client.query('update reservations set status=$1, updated_at=$2 where id=$3', ['in_use', timestamp, reservationItem.reservation_id]);
      await client.query('update reservation_items set status=$1, updated_at=$2 where id=$3', ['in_use', timestamp, reservationItem.id]);
      await client.query('update devices set status=$1, updated_at=$2 where id=$3', ['in_use', timestamp, reservationItem.device_id]);
      await appendUsageLog('BORROW', record, user, device, { operator_name: source === 'auto' ? '系统自动开始' : user.name }, txQuery);
      await log(source === 'auto' ? 'auto_start_use' : 'start_use', source === 'auto' ? '预约开始 30 分钟后自动开始使用' : '开始使用设备', user, reservationItem.device_id, record.id, txQuery);
      return { state: 'started', record, reservationItem, device, user };
    });
  }

  async function startUse(payload, token) {
    const user = await requireUser(token);
    const requestedId = payload.reservation_item_id || payload.reservationItemId || payload.item_id || payload.reservation_id;
    const result = await startReservationItem(requestedId, { userId: user.id, source: 'manual' });
    if (result.state === 'started') return ok({ message: '已开始使用', record: result.record });
    if (result.state === 'already_started') return ok({ message: '该设备已在使用中', record: result.record });
    const status = result.state === 'not_found' ? 404 : result.state === 'forbidden' ? 403 : 409;
    const code = result.state === 'not_found' ? 3004 : result.state === 'forbidden' ? 1003 : 3001;
    return fail(result.message || '当前不能开始使用。', status, code);
  }

  async function startReservationBatch(payload, token) {
    const user = await requireUser(token);
    const batchId = assertText(payload.batch_id || payload.batchId || payload.id, 'batch_id', 60);
    const batch = await getById('reservation_batches', batchId);
    if (!batch) return fail('预约批次不存在。', 404, 3004);
    if (batch.user_id !== user.id) return fail('不能操作其他用户的预约。', 403, 1003);
    const items = await query(`select ri.id, ri.status, ri.start_time, ri.end_time, d.device_code, d.name as device_name
      from reservation_items ri join devices d on d.id=ri.device_id
      where ri.batch_id=$1 and ri.deleted_at is null order by ri.start_time asc, d.device_code asc`, [batchId]);
    const started = [];
    const blockers = [];
    let waitingCount = 0;
    let alreadyStartedCount = 0;
    for (const item of items || []) {
      if (item.status === 'in_use') { alreadyStartedCount += 1; continue; }
      if (item.status !== 'approved') continue;
      const result = await startReservationItem(item.id, { userId: user.id, source: 'manual' });
      if (result.state === 'started') started.push(result.record);
      else if (result.state === 'already_started') alreadyStartedCount += 1;
      else if (result.state === 'too_early') waitingCount += 1;
      else blockers.push({ item_id: item.id, device_code: item.device_code, device_name: item.device_name, reason: result.message || '当前不能开始' });
    }
    const message = started.length
      ? `已开始 ${started.length} 台设备${waitingCount ? `，另有 ${waitingCount} 项尚未到开始时间` : ''}${blockers.length ? `，${blockers.length} 项未能开始` : ''}`
      : waitingCount ? '本批次设备尚未到可开始时间。' : alreadyStartedCount ? '本批次已开始使用。' : blockers[0]?.reason || '本批次没有可开始的设备。';
    const detailedMessage = started.length && blockers.length
      ? `${message}（${blockers[0].device_code || blockers[0].device_name || '设备'}：${blockers[0].reason}）`
      : message;
    return ok({ message: detailedMessage, batch_id: batchId, started_count: started.length, waiting_count: waitingCount, already_started_count: alreadyStartedCount, blocked_count: blockers.length, records: started, blockers });
  }

  async function autoStartDueReservations(nowValue = nowIso()) {
    const now = new Date(nowValue);
    if (Number.isNaN(now.getTime())) return { started_count: 0, blocked_count: 0 };
    const dueItems = await query(`select ri.id from reservation_items ri
      where ri.status='approved' and ri.deleted_at is null
        and ri.start_time + interval '30 minutes' <= $1 and ri.end_time > $1
      order by ri.start_time asc limit 200`, [now.toISOString()]);
    let startedCount = 0;
    let blockedCount = 0;
    for (const item of dueItems || []) {
      const result = await startReservationItem(item.id, { source: 'auto', nowValue: now.toISOString() });
      if (result.state === 'started') {
        startedCount += 1;
        if (typeof createUserNotification === 'function') {
          try {
            await createUserNotification({
              user_id: result.record.user_id, type: 'reservation_auto_started', title: '预约已自动开始',
              content: `${result.record.device_code || ''} ${result.record.device_name || '设备'} 已按规则转为使用中，预计归还时间不变。`.trim(),
              related_type: 'borrow_record', related_id: result.record.id, device_id: result.record.device_id,
              reservation_id: result.record.reservation_id || null
            });
          } catch (_) {
            // 通知失败不能回滚已经生效的设备使用状态，后续通知任务仍可继续运行。
          }
        }
      } else if (!['already_started', 'not_approved'].includes(result.state)) blockedCount += 1;
    }
    return { started_count: startedCount, blocked_count: blockedCount };
  }

  async function precheckBorrowExtension(payload, token) {
    const user = await requireUser(token);
    const recordId = assertText(payload.record_id || payload.id, 'record_id', 60);
    const record = await getById('borrow_records', recordId);
    if (!record) return fail('借用记录不存在。', 404, 3004);
    if (record.user_id !== user.id) return fail('不能续约其他用户的借用记录。', 403, 1003);
    const reasons = [];
    const now = new Date();
    const currentEnd = new Date(record.expected_return_time);
    if (record.status !== 'in_use') reasons.push({ code: 'not_in_use', message: '仅使用中的设备可以续约。' });
    if (Number.isNaN(currentEnd.getTime()) || currentEnd <= now) reasons.push({ code: 'return_due', message: '当前借用已到预计归还时间，不能在线续约，请联系管理员处理。' });
    const device = await getById('devices', record.device_id);
    if (!device || device.allow_reservation === false || ['maintenance', 'disabled', 'abnormal_pending'].includes(String(device.status || ''))) reasons.push({ code: 'device_paused', message: '设备目前不可续约：已暂停预约、维护中或存在待处理异常。' });
    const noShowRows = await query("select count(*)::int as count from reservation_items where user_id = $1 and start_time >= now() - interval '90 days' and status = 'no_show'", [user.id]);
    if (Number(noShowRows?.[0]?.count || 0) >= 2) reasons.push({ code: 'credit_restriction', message: '近 90 天已有 2 次爽约，当前不能续约，请联系管理员复核。' });
    const requestedText = String(payload.expected_return_time || payload.extend_to || '').trim();
    const reservationItem = record.reservation_item_id ? await getReservationItemById(record.reservation_item_id) : null;
    const plannedMinutes = reservationItem ? Math.max(15, Math.round((new Date(reservationItem.end_time).getTime() - new Date(reservationItem.start_time).getTime()) / 60_000)) : 60;
    const defaultEnd = new Date(currentEnd.getTime() + plannedMinutes * 60_000);
    const requestedEnd = requestedText ? new Date(requestedText) : defaultEnd;
    const maxEnd = new Date(Math.min(currentEnd.getTime() + 8 * 60 * 60_000, new Date(record.borrow_time || currentEnd).getTime() + 12 * 60 * 60_000));
    if (Number.isNaN(requestedEnd.getTime()) || requestedEnd <= currentEnd) reasons.push({ code: 'invalid_time', message: '续约结束时间必须晚于当前预计归还时间。' });
    if (requestedEnd > maxEnd) reasons.push({ code: 'daily_limit', message: '已超过续约上限：单次最多延长 8 小时，连续使用最多 12 小时。' });
    let nextConflict = null;
    if (!Number.isNaN(currentEnd.getTime())) {
      const conflictSql = "select id, start_time, end_time, 'reservation' as conflict_type from reservation_items where device_id = $1 and id <> $4 and status = any($5) and start_time < $3 and end_time > $2 union all select id, start_time, end_time, 'maintenance' as conflict_type from device_maintenance_windows where device_id = $1 and status in ('scheduled','active') and start_time < $3 and end_time > $2 order by start_time asc limit 1";
      const conflicts = await query(conflictSql, [record.device_id, currentEnd.toISOString(), maxEnd.toISOString(), reservationItem?.id || '', ['pending', 'approved', 'in_use']]);
      nextConflict = conflicts?.[0] || null;
      if (nextConflict && requestedEnd > new Date(nextConflict.start_time)) reasons.push({ code: nextConflict.conflict_type === 'maintenance' ? 'maintenance_conflict' : 'next_reservation', message: nextConflict.conflict_type === 'maintenance' ? '设备即将进入维护时段，无法续约到所选时间。' : '下一时段已有预约，无法续约到所选时间。', conflict_end: nextConflict.start_time });
    }
    const availableUntil = nextConflict ? new Date(Math.min(new Date(nextConflict.start_time).getTime(), maxEnd.getTime())) : maxEnd;
    return ok({ available: reasons.length === 0, record_id: record.id, current_end: currentEnd.toISOString(), default_end: defaultEnd.toISOString(), available_until: availableUntil.toISOString(), reasons, next_conflict: nextConflict ? { type: nextConflict.conflict_type, start_time: nextConflict.start_time, end_time: nextConflict.end_time } : null });
  }

  async function extendBorrow(payload, token) {
    const user = await requireUser(token);
    const recordId = assertText(payload.record_id || payload.id, 'record_id', 60);
    const record = await getById('borrow_records', recordId);
    if (!record) return fail('借用记录不存在。', 404, 3004);
    if (record.user_id !== user.id) return fail('不能续约其他用户的借用记录。', 403, 1003);
    if (record.status !== 'in_use') return fail('仅使用中的设备可以续约。', 409, 3001);
    const currentEnd = new Date(record.expected_return_time);
    if (Number.isNaN(currentEnd.getTime()) || currentEnd <= new Date()) return fail('当前借用已到预计归还时间，不能在线续约，请联系管理员处理。', 409, 3001);
    const reservationItem = record.reservation_item_id ? await getReservationItemById(record.reservation_item_id) : null;
    const plannedMinutes = reservationItem
      ? Math.max(15, Math.round((new Date(reservationItem.end_time).getTime() - new Date(reservationItem.start_time).getTime()) / 60_000))
      : 60;
    const requestedEndText = String(payload.expected_return_time || payload.extend_to || '').trim();
    const requestedEnd = requestedEndText ? new Date(requestedEndText) : new Date(currentEnd.getTime() + plannedMinutes * 60_000);
    if (Number.isNaN(requestedEnd.getTime()) || requestedEnd <= currentEnd) return fail('续约结束时间必须晚于当前预计归还时间。', 400, 2001);
    if (requestedEnd.getTime() - currentEnd.getTime() > 8 * 60 * 60_000) return fail('单次最多续约 8 小时，请联系管理员安排更长使用。', 409, 3001);
    const eligibility = await precheckBorrowExtension({ record_id: record.id, expected_return_time: requestedEnd.toISOString() }, token);
    if (!eligibility.available) return fail(eligibility.reasons?.[0]?.message || '当前条件不满足续约规则', 409, 3001);
    const startIso = currentEnd.toISOString();
    const endIso = requestedEnd.toISOString();
    const result = await withTransaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext('idbs-device-schedule'), hashtext($1))", [String(record.device_id)]);
      const conflicts = await client.query(`select id, start_time, end_time, 'reservation' as conflict_type from reservation_items where device_id = $1 and id <> $4 and status = any($5) and start_time < $3 and end_time > $2 union all select id, start_time, end_time, 'maintenance' as conflict_type from device_maintenance_windows where device_id = $1 and status in ('scheduled','active') and start_time < $3 and end_time > $2`, [record.device_id, startIso, endIso, reservationItem?.id || '', ['pending', 'approved', 'in_use']]);
      if (conflicts.rows?.length) return { conflict: conflicts.rows[0] };
      const updatedAt = nowIso();
      await client.query('update borrow_records set expected_return_time = $1, updated_at = $2 where id = $3', [endIso, updatedAt, record.id]);
      if (reservationItem?.id) {
        await client.query("update reservation_items set end_time = $1, reservation_date = (start_time at time zone 'Asia/Shanghai')::date, updated_at = $2 where id = $3", [endIso, updatedAt, reservationItem.id]);
        if (reservationItem.reservation_id) await client.query('update reservations set end_time = $1, updated_at = $2 where id = $3', [endIso, updatedAt, reservationItem.reservation_id]);
      }
      const updated = { ...record, expected_return_time: endIso, updated_at: updatedAt };
      await log('extend_borrow', { message: '续约设备使用时间', borrow_record_id: record.id, reservation_item_id: reservationItem?.id || record.reservation_item_id, old_expected_return_time: record.expected_return_time, expected_return_time: endIso, mode: requestedEndText ? 'manual' : 'next_slot' }, user, record.device_id, record.id, (sql, params = []) => client.query(sql, params));
      return { updated };
    });
    if (result.conflict) return fail(result.conflict.conflict_type === 'maintenance' ? '所选续约时间与设备维护冲突。' : '所选续约时间已有其他预约，无法续约。', 409, 3001);
    return ok({ message: requestedEndText ? '已按所选时间续约。' : '已续约至下一时段。', record: result.updated, default_minutes: plannedMinutes });
  }

  async function submitReturn(payload, token) {
    const user = await requireUser(token);
    const recordId = assertText(payload.record_id, 'record_id', 60);
    const rawReturnCondition = String(payload.return_condition || 'normal').trim().slice(0, 50);
    const normalizedCondition = rawReturnCondition.toLowerCase();
    const isNormalCondition = ['normal', 'ok', 'good', '正常', '完好', '良好'].includes(normalizedCondition) || ['正常', '完好', '良好'].includes(rawReturnCondition);
    const returnCondition = isNormalCondition ? 'normal' : rawReturnCondition;
    const returnNote = String(payload.return_note || '').trim().slice(0, 500);
    const requestedAbnormalReason = String(payload.abnormal_reason_category || payload.abnormalReasonCategory || '').trim().toLowerCase();
    const requestedOverdueReason = String(payload.overdue_reason_category || payload.overdueReasonCategory || '').trim().toLowerCase();
    const abnormalReason = ['missing_accessory', 'appearance_damage', 'operation_abnormal', 'other'].includes(requestedAbnormalReason) ? requestedAbnormalReason : 'other';
    const overdueReason = ['experiment_not_finished', 'awaiting_result', 'forgot_return', 'other'].includes(requestedOverdueReason) ? requestedOverdueReason : 'other';
    let returnPhotos = Array.isArray(payload.return_photos)
      ? payload.return_photos.slice(0, 5).map((value) => String(value || '').trim().slice(0, 500)).filter(Boolean)
      : [];
    if (returnPhotos.some((url) => !isAllowedReturnPhotoUrl(url))) {
      return fail('归还照片地址不安全，请重新上传后再提交。', 400, 2001);
    }
    const record = await getById('borrow_records', recordId);
    if (!record) return fail('使用记录不存在。', 404, 3004);
    if (record.user_id !== user.id) return fail('不能归还其他用户的设备。', 403, 1003);
    if (record.status !== 'in_use') return fail('该记录不在使用中。', 409, 3001);
    const returnTime = nowIso();
    const duration = durationMinutes(record.borrow_time, returnTime);
    const isOverdue = record.expected_return_time ? new Date(returnTime) > new Date(record.expected_return_time) : false;
    const abnormal = !isNormalCondition;
    const device = await getById('devices', record.device_id);
    const config = await getSecurityConfig();
    const returnMode = String(device?.return_mode || (config.require_return_photo ? 'image_required' : 'image_optional')).trim();
    const requirePhoto = abnormal || returnMode === 'image_required' || Boolean(config.require_return_photo && returnMode !== 'confirm_only');
    const requireNote = Boolean(device?.return_require_note) && !returnNote;
    if (requirePhoto && !returnPhotos.length) {
      return fail(abnormal ? '异常归还需要上传设备照片。' : '该设备要求上传归还照片。', 400, 2001);
    }
    if (requireNote) return fail('该设备要求填写归还说明。', 400, 2001);
    // A return is a handover request. Keep the device unavailable until an authorised operator completes acceptance.
    const nextDeviceStatus = 'abnormal_pending';
    const nextRecordStatus = abnormal ? 'abnormal_pending' : 'return_pending';
    const archivedReturn = await archiveReturnPhotos(returnPhotos, { device, user, returnTime });
    returnPhotos = archivedReturn.photos;
    const returnArchiveFolder = archivedReturn.folder;
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query('update borrow_records set return_time = $1, duration_minutes = $2, return_condition = $3, return_note = $4, return_photos = $5, status = $6, is_overdue = $7, actual_end_time = $8, updated_at = $9, return_archive_folder = $10, return_archive_photos = $11, abnormal_reason_category = $12, overdue_reason_category = $13 where id = $14', [returnTime, duration, returnCondition, returnNote, JSON.stringify(returnPhotos), nextRecordStatus, isOverdue, returnTime, nowIso(), returnArchiveFolder || null, JSON.stringify(returnPhotos), abnormal ? abnormalReason : null, isOverdue ? overdueReason : null, record.id]);
      await client.query('update devices set status = $1, allow_reservation = $2, last_return_photo = $3, last_return_user = $4, last_return_time = $5, last_condition = $6, updated_at = $7 where id = $8', [nextDeviceStatus, false, returnPhotos[0] || null, user.name, returnTime, returnCondition, nowIso(), record.device_id]);
      if (abnormal) {
        await notifyReservationUsersForDevice(record.device_id, {
          type: 'device_fault',
          title: '预约设备临时不可用',
          content: '你预约的设备 {device_code} {device_name} 归还时被标记为异常，管理员正在处理。你的预约不会被取消，但设备当前暂时不可用；维修恢复后会再次通知你。预约时间：{time_range}',
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
      await log('submit_return', {
        message: `提交归还： ${returnCondition || '正常'}`,
        return_mode: returnMode,
        require_photo: requirePhoto,
        photos: returnPhotos,
        return_archive_folder: returnArchiveFolder || ''
      }, user, record.device_id, record.id, txQuery);
    });
    return ok({
      message: abnormal ? '异常归还已提交，等待管理员处理。' : '归还已提交，等待管理员验收。',
      return_archive_folder: returnArchiveFolder || '',
      return_archive_photos: returnPhotos
    });
  }

  async function supplementReturnMaterials(payload, token) {
    const user = await requireUser(token);
    const recordId = assertText(payload.record_id || payload.id, 'record_id', 60);
    const record = await getById('borrow_records', recordId);
    if (!record) return fail('归还记录不存在。', 404, 3004);
    if (record.user_id !== user.id) return fail('不能补充其他用户的归还材料。', 403, 1003);
    if (record.status !== 'abnormal_pending' || !record.return_material_required) {
      return fail('该归还记录当前没有待补充材料。', 409, 3001);
    }
    const note = String(payload.return_supplement_note || payload.note || '').trim().slice(0, 500);
    const photoUrls = Array.isArray(payload.return_supplement_photos || payload.photos)
      ? (payload.return_supplement_photos || payload.photos).slice(0, 5).map((value) => String(value || '').trim().slice(0, 500)).filter(Boolean)
      : [];
    if (!note && !photoUrls.length) return fail('请补充照片或情况说明。', 400, 2001);
    if (photoUrls.some((url) => !isAllowedReturnPhotoUrl(url))) {
      return fail('补充照片地址不安全，请重新上传。', 400, 2001);
    }
    const device = await getById('devices', record.device_id);
    const supplementedAt = nowIso();
    const late = Boolean(record.return_material_deadline && new Date(supplementedAt) > new Date(record.return_material_deadline));
    const archived = await archiveReturnPhotos(photoUrls, { device, user, returnTime: supplementedAt });
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query(`update borrow_records set return_supplement_note=$1, return_supplement_photos=$2,
        return_supplemented_at=$3, return_material_required=false, return_material_late=$4, updated_at=$3
        where id=$5`, [note || null, JSON.stringify(archived.photos), supplementedAt, late, record.id]);
      await log('supplement_return_materials', {
        message: late ? '超时补充归还材料' : '补充归还材料',
        borrow_record_id: record.id,
        photo_count: archived.photos.length,
        late
      }, user, record.device_id, record.id, txQuery);
    });
    return ok({
      message: late ? '材料已补充，但已超过截止时间，管理员将据此复核。' : '归还材料已补充，等待管理员复核。',
      supplemented_at: supplementedAt,
      late,
      photos: archived.photos
    });
  }

async function adminListReturnTasks(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['return.view', 'return.confirm', 'return.image_review', 'device.manage']);
    const limit = Math.max(1, Math.min(Number(params.limit) || 100, 200));
    const tasks = await query(`select b.id, b.device_id, b.user_id, b.borrow_time, b.expected_return_time, b.return_time,
        b.return_condition, b.return_note, b.return_photos, b.status, b.is_overdue, b.return_archive_photos,
        b.return_material_required, b.return_material_deadline, b.return_supplement_note,
        b.return_supplement_photos, b.return_supplemented_at, b.return_material_late,
        d.device_code, d.name as device_name, u.name as user_name
      from borrow_records b
      join devices d on d.id=b.device_id
      join users u on u.id=b.user_id
      where b.deleted_at is null and (
        b.status in ('return_pending','abnormal_pending')
        or (b.status='in_use' and b.expected_return_time is not null and b.expected_return_time < now())
      )
      order by case when b.status='in_use' then 0 else 1 end, b.expected_return_time asc nulls last, b.return_time asc nulls last
      limit $1`, [limit]);
    const summary = {
      overdue_borrows: tasks.filter((item) => item.status === 'in_use').length,
      pending_acceptance: tasks.filter((item) => item.status === 'return_pending').length,
      abnormal_returns: tasks.filter((item) => item.status === 'abnormal_pending').length
    };
    return ok({ tasks, summary });
  }

  async function adminReviewReturn(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['return.confirm']);
    const recordId = assertText(payload.record_id || payload.id, 'record_id', 60);
    const approved = payload.approved === true || payload.approved === 'true';
    const reviewNote = String(payload.review_note || payload.reviewNote || '').trim().slice(0, 500);
    const record = await getById('borrow_records', recordId);
    if (!record) return fail('归还记录不存在。', 404, 3004);
    if (!['return_pending', 'abnormal_pending'].includes(record.status)) return fail('该归还记录当前无需验收。', 409, 3001);
    const now = nowIso();
    const requestingSupplement = !approved && record.status === 'return_pending';
    const resolvingAbnormal = approved && record.status === 'abnormal_pending';
    const deadline = requestingSupplement ? new Date(Date.now() + 60 * 60_000).toISOString() : record.return_material_deadline || null;
    const unresolvedBeforeDeadline = resolvingAbnormal && record.return_material_required && !record.return_supplemented_at
      && deadline && new Date(deadline) > new Date(now);
    if (unresolvedBeforeDeadline) return fail('用户补充材料尚未提交，截止时间前不能关闭该归还任务。', 409, 3001);
    const materialDefaulted = Boolean(resolvingAbnormal && record.return_material_required && !record.return_supplemented_at);
    const nextRecordStatus = approved ? 'returned' : 'abnormal_pending';
    const nextDeviceStatus = approved && record.status === 'return_pending' ? 'available' : 'abnormal_pending';
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query(`update borrow_records set status=$1, return_reviewed_by=$2, return_reviewed_at=$3,
        return_review_note=$4, return_material_required=case when $5 then true else return_material_required end,
        return_material_deadline=case when $5 then $6 else return_material_deadline end,
        return_material_late=case when $7 then true else return_material_late end,
        updated_by=$2, updated_at=$3 where id=$8`, [nextRecordStatus, admin.user_id || admin.id || null, now, reviewNote || null, requestingSupplement, deadline, materialDefaulted, record.id]);
      await client.query('insert into receive_records (id, device_id, previous_record_id, receiver_user_id, receive_time, confirm_status, receive_note) values ($1,$2,$3,$4,$5,$6,$7)', [uuid(), record.device_id, record.id, admin.user_id || admin.id || null, now, approved ? 'accepted' : 'abnormal', reviewNote || null]);
      await client.query('update devices set status=$1, allow_reservation=$2, updated_by=$3, updated_at=$4 where id=$5', [nextDeviceStatus, nextDeviceStatus === 'available', admin.user_id || admin.id || null, now, record.device_id]);
      await log('review_return_handover', { message: resolvingAbnormal ? '异常归还用户责任已闭环' : approved ? '归还验收通过' : '归还验收标记异常', borrow_record_id: record.id, approved, review_note: reviewNote, material_deadline: deadline, material_defaulted: materialDefaulted }, admin, record.device_id, record.id, txQuery);
    });
    if (requestingSupplement && typeof createUserNotification === 'function') {
      await createUserNotification({
        user_id: record.user_id,
        type: 'return_material_required',
        title: '归还材料需要补充',
        content: `管理员将本次归还标记为异常，请在 ${new Date(deadline).toLocaleString('zh-CN', { hour12: false })} 前补充照片或说明。`,
        related_type: 'borrow_record',
        related_id: record.id
      });
    }
    const message = resolvingAbnormal
      ? '用户归还责任已闭环，设备继续保持异常待处理。'
      : approved
        ? '归还验收通过，设备已恢复可预约。'
        : requestingSupplement
          ? '已标记异常，并通知用户在 1 小时内补充材料。'
          : '异常状态已保留，设备继续暂停预约。';
    return ok({ message, record_id: record.id, status: nextRecordStatus, material_deadline: deadline });
  }

  return { adminListReturnTasks, adminReviewReturn, autoStartDueReservations, extendBorrow, precheckBorrowExtension, startReservationBatch, startUse, submitReturn, supplementReturnMaterials };
}

module.exports = { createBorrowReturnService };


