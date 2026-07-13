const fs = require('fs');
const path = require('path');

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
          folder = safe(`${deviceText}_${timeText}_${userName}_${userPhone}_序号${index}`);
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
      message: abnormal ? '异常已提交' : '已归还',
      return_archive_folder: returnArchiveFolder || '',
      return_archive_photos: returnPhotos
    });
  }

async function adminListReturnTasks(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['return.view', 'return.confirm', 'return.image_review', 'device.manage']);
    const limit = Math.max(1, Math.min(Number(params.limit) || 100, 200));
    const tasks = await query(`select b.id, b.device_id, b.user_id, b.borrow_time, b.expected_return_time, b.return_time,
        b.return_condition, b.return_note, b.return_photos, b.status, b.is_overdue, b.return_archive_photos,
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
    const nextRecordStatus = approved && record.status === 'return_pending' ? 'returned' : 'abnormal_pending';
    const nextDeviceStatus = nextRecordStatus === 'returned' ? 'available' : 'abnormal_pending';
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query(`update borrow_records set status=$1, return_reviewed_by=$2, return_reviewed_at=$3,
        return_review_note=$4, updated_by=$2, updated_at=$3 where id=$5`, [nextRecordStatus, admin.user_id || admin.id || null, now, reviewNote || null, record.id]);
      await client.query('insert into receive_records (id, device_id, previous_record_id, receiver_user_id, receive_time, confirm_status, receive_note) values ($1,$2,$3,$4,$5,$6,$7)', [uuid(), record.device_id, record.id, admin.user_id || admin.id || null, now, approved ? 'accepted' : 'abnormal', reviewNote || null]);
      await client.query('update devices set status=$1, allow_reservation=$2, updated_by=$3, updated_at=$4 where id=$5', [nextDeviceStatus, nextDeviceStatus === 'available', admin.user_id || admin.id || null, now, record.device_id]);
      await log('review_return_handover', { message: approved ? '归还验收通过' : '归还验收标记异常', borrow_record_id: record.id, approved, review_note: reviewNote }, admin, record.device_id, record.id, txQuery);
    });
    return ok({ message: approved ? '归还验收通过，设备已恢复可预约。' : '归还已标记异常，设备保持不可预约。', record_id: record.id, status: nextRecordStatus });
  }

  return { adminListReturnTasks, adminReviewReturn, extendBorrow, startUse, submitReturn };
}

module.exports = { createBorrowReturnService };


