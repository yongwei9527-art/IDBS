function normalizeUserRequest(row = {}) {
  return {
    ...row,
    locked: ['confirmed', 'rejected', 'closed', 'change_requested'].includes(row.status),
    can_edit: row.status === 'pending',
    can_cancel: row.status === 'pending',
    can_request_change: row.status === 'confirmed'
  };
}

function createFaultRequestService(context = {}) {
  const {
    assertText,
    createUserNotification,
    fail,
    getById,
    getDeviceByCode,
    log,
    markDeviceFaultReportsResolved,
    notifyReservationUsersForDevice,
    nowIso,
    ok,
    parseBoolean,
    query,
    requireAdminRole,
    requireUser,
    uuid,
    withTransaction
  } = context;

  async function reportDeviceFault(payload, token) {
    const user = await requireUser(token);
    const recordId = String(payload.record_id || payload.recordId || '').trim();
    const deviceCode = String(payload.device_code || payload.deviceCode || '').trim();
    const issueType = String(payload.issue_type || payload.issueType || 'fault').trim().slice(0, 50);
    const severity = String(payload.severity || 'normal').trim().slice(0, 30) || 'normal';
    const description = assertText(payload.description || payload.note, 'description', 1000);
    const photos = Array.isArray(payload.photos) ? payload.photos.slice(0, 5).map((value) => String(value).slice(0, 500)).filter(Boolean) : [];
    let record = null;
    let device = null;

    if (recordId) {
      record = await getById('borrow_records', recordId);
      if (!record) return fail('使用记录不存在。', 404, 3004);
      if (record.user_id !== user.id) return fail('不能为其他用户的记录报备故障。', 403, 1003);
      device = await getById('devices', record.device_id);
    } else if (deviceCode) {
      device = await getDeviceByCode(deviceCode);
    }

    if (!device) return fail('设备不存在。', 404, 3004);
    const report = {
      id: uuid(),
      device_id: device.id,
      user_id: user.id,
      borrow_record_id: record?.id || null,
      reservation_id: record?.reservation_id || null,
      issue_type: issueType,
      description,
      photos,
      status: 'pending',
      severity,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query('insert into device_fault_reports (id, device_id, user_id, borrow_record_id, reservation_id, reservation_item_id, issue_type, severity, description, photos, status, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [
        report.id, report.device_id, report.user_id, report.borrow_record_id, report.reservation_id, record?.reservation_item_id || null, report.issue_type, report.severity, report.description, JSON.stringify(report.photos), report.status, report.created_at, report.updated_at
      ]);
      if (record?.reservation_item_id) {
        await client.query('update reservation_items set status = $1, updated_at = $2 where id = $3', ['faulted', nowIso(), record.reservation_item_id]);
      }
      await client.query('update devices set status = $1, allow_reservation = false, last_condition = $2, updated_at = $3 where id = $4', ['abnormal_pending', issueType, nowIso(), device.id]);
      await notifyReservationUsersForDevice(device, {
        type: 'device_fault',
        title: '预约设备临时不可用',
        content: '你预约的设备 {device_code} {device_name} 有用户上报异常，管理员正在处理。你的预约不会被取消，但设备当前暂时不可用；维修恢复后会再次通知你。预约时间：{start_time} - {end_time}',
        related_type: 'fault_report',
        related_id: report.id
      }, txQuery);
      await log('report_device_fault', `Reported device fault: ${issueType}`, user, device.id, report.id, txQuery);
    });
    return ok({ message: '故障已提交', report });
  }

  async function createUserRequest(payload, token) {
    const user = await requireUser(token);
    const title = assertText(payload.title, 'title', 120);
    const description = assertText(payload.description || payload.content, 'description', 1500);
    const category = String(payload.category || 'feature').trim().slice(0, 50) || 'feature';
    const priority = String(payload.priority || 'normal').trim().slice(0, 30) || 'normal';
    const deviceCode = String(payload.device_code || payload.deviceCode || '').trim();
    const device = deviceCode ? await getDeviceByCode(deviceCode) : null;
    if (deviceCode && !device) return fail('设备不存在。', 404, 3004);
    const row = {
      id: uuid(),
      user_id: user.id,
      device_id: device?.id || null,
      category,
      title,
      description,
      priority,
      status: 'pending',
      created_at: nowIso(),
      updated_at: nowIso()
    };
    await query('insert into user_requests (id, user_id, device_id, category, title, description, priority, status, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
      row.id, row.user_id, row.device_id, row.category, row.title, row.description, row.priority, row.status, row.created_at, row.updated_at
    ]);
    await log('create_user_request', `Created user request: ${title}`, user, row.device_id, row.id);
    return ok({ message: '需求已提交，等待管理员确认。', request: normalizeUserRequest(row) });
  }

  async function listMyUserRequests(_, token) {
    const user = await requireUser(token);
    const rows = await query(`
      select r.*, d.device_code, d.name as device_name
      from user_requests r
      left join devices d on d.id = r.device_id
      where r.user_id = $1
      order by r.created_at desc
    `, [user.id]);
    return ok({ requests: (rows || []).map(normalizeUserRequest) });
  }

  async function updateUserRequest(payload, token) {
    const user = await requireUser(token);
    const requestId = assertText(payload.request_id || payload.id, 'request_id', 60);
    const row = await getById('user_requests', requestId);
    if (!row) return fail('需求不存在。', 404, 3004);
    if (row.user_id !== user.id) return fail('不能修改其他用户的需求。', 403, 1003);
    if (row.status !== 'pending') return fail('管理员确认后不能直接修改，请先提交修改申请。', 409, 3001);
    const title = assertText(payload.title || row.title, 'title', 120);
    const description = assertText(payload.description || payload.content || row.description, 'description', 1500);
    const category = String(payload.category || row.category || 'feature').trim().slice(0, 50);
    const priority = String(payload.priority || row.priority || 'normal').trim().slice(0, 30);
    await query('update user_requests set category = $1, title = $2, description = $3, priority = $4, updated_at = $5 where id = $6', [
      category, title, description, priority, nowIso(), requestId
    ]);
    await log('update_user_request', `Updated user request: ${title}`, user, row.device_id, row.id);
    return ok({ message: '需求已更新。' });
  }

  async function cancelUserRequest(payload, token) {
    const user = await requireUser(token);
    const requestId = assertText(payload.request_id || payload.id, 'request_id', 60);
    const row = await getById('user_requests', requestId);
    if (!row) return fail('需求不存在。', 404, 3004);
    if (row.user_id !== user.id) return fail('不能撤回其他用户的需求。', 403, 1003);
    if (row.status !== 'pending') return fail('管理员确认后不能撤回，请先提交修改申请。', 409, 3001);
    await query('update user_requests set status = $1, updated_at = $2 where id = $3', ['cancelled', nowIso(), requestId]);
    await log('cancel_user_request', `Cancelled user request: ${row.title}`, user, row.device_id, row.id);
    return ok({ message: '需求已撤回。' });
  }

  async function requestUserRequestChange(payload, token) {
    const user = await requireUser(token);
    const requestId = assertText(payload.request_id || payload.id, 'request_id', 60);
    const reason = assertText(payload.reason || payload.note, 'reason', 500);
    const row = await getById('user_requests', requestId);
    if (!row) return fail('需求不存在。', 404, 3004);
    if (row.user_id !== user.id) return fail('不能申请修改其他用户的需求。', 403, 1003);
    if (row.status !== 'confirmed') return fail('只有已确认的需求需要提交修改申请。', 409, 3001);
    await query('update user_requests set status = $1, change_request_note = $2, updated_at = $3 where id = $4', [
      'change_requested', reason, nowIso(), requestId
    ]);
    await log('request_user_request_change', `Requested change for user request: ${row.title}`, user, row.device_id, row.id);
    return ok({ message: '修改申请已提交，等待管理员处理。' });
  }

  async function adminListUserRequests(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'ops'], ['user.manage', 'reservation.view']);
    const status = String(params.status || '').trim();
    const sqlParams = [];
    let where = '';
    if (status) {
      sqlParams.push(status);
      where = `where r.status = $${sqlParams.length}`;
    }
    const rows = await query(`
      select r.*, u.name as user_name, u.phone as user_phone, u.student_no as user_student_no,
        u.wechat_nickname as user_wechat_nickname, u.wechat_openid as user_wechat_openid,
        d.device_code, d.name as device_name
      from user_requests r
      join users u on u.id = r.user_id
      left join devices d on d.id = r.device_id
      ${where}
      order by r.created_at desc
    `, sqlParams);
    return ok({ requests: (rows || []).map(normalizeUserRequest) });
  }

  async function adminReviewUserRequest(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin', 'ops'], ['user.manage']);
    const requestId = assertText(payload.request_id || payload.id, 'request_id', 60);
    const status = String(payload.status || '').trim();
    if (!['pending', 'confirmed', 'rejected', 'closed'].includes(status)) return fail('不支持的需求状态。', 400, 2001);
    const adminNote = String(payload.admin_note || payload.adminNote || '').trim().slice(0, 500);
    const row = await getById('user_requests', requestId);
    if (!row) return fail('需求不存在。', 404, 3004);
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query(`
        update user_requests
        set status = $1,
          admin_note = $2,
          confirmed_by = case when $1 = 'confirmed' then $3 else confirmed_by end,
          confirmed_at = case when $1 = 'confirmed' then $4 else confirmed_at end,
          locked_at = case when $1 in ('confirmed','rejected','closed') then $4 when $1 = 'pending' then null else locked_at end,
          updated_at = $4
        where id = $5
      `, [status, adminNote, admin.user_id || admin.id || null, nowIso(), requestId]);
      const statusTextMap = { pending: '管理员已允许你继续修改该需求。', confirmed: '管理员已同意并锁定你的需求。', rejected: '管理员已驳回你的需求。', closed: '管理员已关闭你的需求。' };
      await createUserNotification({
        user_id: row.user_id,
        type: 'user_request',
        title: `需求上报处理结果：${row.title}`,
        content: `${statusTextMap[status] || '需求状态已更新。'}${adminNote ? ` 管理员备注：${adminNote}` : ''}`,
        related_type: 'user_request',
        related_id: row.id,
        device_id: row.device_id || null
      }, txQuery);
      await log('review_user_request', `Updated user request ${requestId} to ${status}`, admin, row.device_id, row.id, txQuery);
    });
    return ok({ message: '需求状态已更新。' });
  }

  async function adminListFaultReports(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'ops'], ['fault.manage', 'device.manage']);
    const status = String(params.status || '').trim();
    const sqlParams = [];
    let where = '';
    if (status) {
      sqlParams.push(status);
      where = `where f.status = $${sqlParams.length}`;
    }
    const rows = await query(`
      select f.*, d.device_code, d.name as device_name, d.location as device_location, u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from device_fault_reports f
      join devices d on d.id = f.device_id
      left join users u on u.id = f.user_id
      ${where}
      order by f.created_at desc
    `, sqlParams);
    return ok({ reports: rows || [] });
  }

  async function adminResolveFaultReport(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin', 'ops'], ['fault.manage', 'device.manage']);
    const reportId = assertText(payload.report_id || payload.reportId, 'report_id', 60);
    const status = String(payload.status || 'resolved').trim();
    if (!['pending', 'processing', 'resolved', 'closed'].includes(status)) return fail('不支持的故障状态。', 400, 2001);
    const adminNote = String(payload.admin_note || payload.adminNote || '').trim().slice(0, 500);
    const setAvailable = parseBoolean(payload.set_available ?? payload.setAvailable);
    const keepMaintenance = parseBoolean(payload.keep_maintenance ?? payload.keepMaintenance);
    const report = await getById('device_fault_reports', reportId);
    if (!report) return fail('故障记录不存在。', 404, 3004);
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query('update device_fault_reports set status = $1, admin_note = $2, updated_at = $3, resolved_at = $4 where id = $5', [
        status, adminNote, nowIso(), ['resolved', 'closed'].includes(status) ? nowIso() : null, reportId
      ]);
      if (status === 'processing') {
        await client.query('update devices set status = $1, allow_reservation = false, updated_at = $2 where id = $3', ['maintenance', nowIso(), report.device_id]);
      }
      if (['resolved', 'closed'].includes(status) && (keepMaintenance || !setAvailable)) {
        await client.query('update devices set status = $1, allow_reservation = false, updated_at = $2 where id = $3', ['maintenance', nowIso(), report.device_id]);
      }
      if (status === 'resolved' && setAvailable) {
        await client.query('update devices set status = $1, allow_reservation = true, updated_at = $2 where id = $3', ['available', nowIso(), report.device_id]);
        await markDeviceFaultReportsResolved(report.device_id, adminNote, admin, txQuery);
        await notifyReservationUsersForDevice(report.device_id, {
          type: 'device_recovered',
          title: '预约设备已恢复可用',
          content: '你预约的设备 {device_code} {device_name} 已由管理员处理并恢复为可预约状态。你的原预约仍然有效，请按原预约时间使用：{start_time} - {end_time}',
          related_type: 'fault_report',
          related_id: reportId
        }, txQuery);
      }
      await log('resolve_device_fault', `Updated fault report to ${status}`, admin, report.device_id, reportId, txQuery);
    });
    return ok({ message: '故障状态已更新。' });
  }

  return {
    adminListFaultReports,
    adminListUserRequests,
    adminResolveFaultReport,
    adminReviewUserRequest,
    cancelUserRequest,
    createUserRequest,
    listMyUserRequests,
    reportDeviceFault,
    requestUserRequestChange,
    updateUserRequest
  };
}

module.exports = { createFaultRequestService, normalizeUserRequest };
