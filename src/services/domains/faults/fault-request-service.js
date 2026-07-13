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
    lockDeviceSchedule,
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
    const reasonCategory = String(payload.reason_category || payload.reasonCategory || 'unknown').trim().slice(0, 50) || 'unknown';
    const impact = severity === 'urgent' ? { autoAction: 'cancel_future', current: true, future: true, notify: true, backup: true } : severity === 'high' ? { autoAction: 'maintenance', current: true, future: true, notify: true, backup: false } : { autoAction: 'inspect', current: false, future: false, notify: false, backup: false };
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
      reason_category: reasonCategory,
      auto_action: impact.autoAction,
      impact_current_borrow: impact.current,
      impact_future_reservations: impact.future,
      notify_affected_users: impact.notify,
      transfer_to_backup: impact.backup,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await lockDeviceSchedule(client, device.id);
      await client.query('insert into device_fault_reports (id, device_id, user_id, borrow_record_id, reservation_id, reservation_item_id, issue_type, severity, reason_category, auto_action, impact_current_borrow, impact_future_reservations, notify_affected_users, transfer_to_backup, description, photos, status, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)', [
        report.id, report.device_id, report.user_id, report.borrow_record_id, report.reservation_id, record?.reservation_item_id || null, report.issue_type, report.severity, report.reason_category, report.auto_action, report.impact_current_borrow, report.impact_future_reservations, report.notify_affected_users, report.transfer_to_backup, report.description, JSON.stringify(report.photos), report.status, report.created_at, report.updated_at
      ]);
      if (record?.reservation_item_id) {
        await client.query('update reservation_items set status = $1, updated_at = $2 where id = $3', ['faulted', nowIso(), record.reservation_item_id]);
      }
      if (impact.future) {
        await client.query('update devices set status = $1, allow_reservation = false, last_condition = $2, updated_at = $3 where id = $4', ['maintenance', issueType, nowIso(), device.id]);
        await notifyReservationUsersForDevice(device, {
          type: 'device_fault', title: impact.autoAction === 'cancel_future' ? '设备紧急故障，请调整实验安排' : '预约设备临时不可用',
          content: impact.autoAction === 'cancel_future' ? '你预约的 {device_code} {device_name} 发生紧急故障，请立即联系管理员调整设备或实验时段。预约时间：{time_range}' : '你预约的设备 {device_code} {device_name} 已进入维护，管理员正在处理。预约时间：{time_range}',
          related_type: 'fault_report', related_id: report.id
        }, txQuery);
      }
      await log('report_device_fault', `Reported device fault: ${issueType}`, user, device.id, report.id, txQuery);
    });
    return ok({ message: '故障已提交', report });
  }

  async function listMyFaultReports(params = {}, token) {
    const user = await requireUser(token);
    const status = String(params.status || '').trim();
    const sqlParams = [user.id];
    const clauses = ['f.user_id = $1'];
    if (status) {
      sqlParams.push(status);
      clauses.push(`f.status = $${sqlParams.length}`);
    }
    const rows = await query(`
      select f.*, d.device_code, d.name as device_name, d.location as device_location
      from device_fault_reports f
      join devices d on d.id = f.device_id
      where ${clauses.join(' and ')}
      order by f.created_at desc
    `, sqlParams);
    return ok({ reports: rows || [] });
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
    await requireAdminRole(token, ['super_admin', 'admin'], ['user.manage', 'reservation.view', 'reservation.approve']);
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
    const { admin, role } = await requireAdminRole(token, ['super_admin', 'admin'], ['user.manage', 'reservation.approve']);
    const requestId = assertText(payload.request_id || payload.id, 'request_id', 60);
    const status = String(payload.status || '').trim();
    if (!['pending', 'confirmed', 'rejected', 'closed'].includes(status)) return fail('不支持的需求状态。', 400, 2001);
    const adminNote = String(payload.admin_note || payload.adminNote || '').trim().slice(0, 500);
    const row = await getById('user_requests', requestId);
    if (!row) return fail('需求不存在。', 404, 3004);
    const roleKey = String(role?.role_key || '').trim();
    const rolePermissions = Array.isArray(role?.permissions) ? role.permissions : [];
    const hasPermission = (permission) => rolePermissions.includes('*') || rolePermissions.includes(permission) || roleKey === 'super_admin';
    const canReviewGeneralRequest = hasPermission('user.manage');
    const canReviewReservationRequest = canReviewGeneralRequest || (row.category === 'reservation' && hasPermission('reservation.approve'));
    if (!canReviewReservationRequest) return fail('当前账号无权处理该类诉求。', 403, 1003);
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
    await requireAdminRole(token, ['super_admin', 'admin'], ['fault.manage', 'device.manage', 'device.view']);
    const status = String(params.status || '').trim();
    const deviceCode = String(params.device_code || params.deviceCode || params.device || '').trim();
    const sqlParams = [];
    const clauses = [];
    if (status) {
      sqlParams.push(status);
      clauses.push(`f.status = $${sqlParams.length}`);
    }
    if (deviceCode) {
      sqlParams.push(deviceCode);
      clauses.push(`d.device_code = $${sqlParams.length}`);
    }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
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
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['fault.manage', 'device.manage']);
    const reportId = assertText(payload.report_id || payload.reportId, 'report_id', 60);
    const status = String(payload.status || 'resolved').trim();
    if (!['pending', 'processing', 'resolved', 'closed'].includes(status)) return fail('不支持的故障状态。', 400, 2001);
    const adminNote = String(payload.admin_note || payload.adminNote || '').trim().slice(0, 500);
    const setAvailable = parseBoolean(payload.set_available ?? payload.setAvailable);
    const keepMaintenance = parseBoolean(payload.keep_maintenance ?? payload.keepMaintenance);
    const report = await getById('device_fault_reports', reportId);
    if (!report) return fail('故障记录不存在。', 404, 3004);
    const resolution = await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await lockDeviceSchedule(client, report.device_id);
      await client.query('update device_fault_reports set status = $1, admin_note = $2, updated_at = $3, resolved_at = $4 where id = $5', [
        status, adminNote, nowIso(), ['resolved', 'closed'].includes(status) ? nowIso() : null, reportId
      ]);
      if (status === 'processing') {
        await client.query('update devices set status = $1, allow_reservation = false, updated_at = $2 where id = $3', ['maintenance', nowIso(), report.device_id]);
      }
      if (['resolved', 'closed'].includes(status) && (keepMaintenance || !setAvailable)) {
        await client.query('update devices set status = $1, allow_reservation = false, updated_at = $2 where id = $3', ['maintenance', nowIso(), report.device_id]);
      }
      let recoveryBlocked = false;
      if (status === 'resolved' && setAvailable) {
        const activeWindow = await client.query(`select 1 from device_maintenance_windows where device_id=$1 and status in ('scheduled','active') and start_time <= now() and end_time > now() limit 1`, [report.device_id]);
        const openWorkOrder = await client.query(`select 1 from device_maintenance_work_orders where device_id=$1 and status in ('pending','in_progress') limit 1`, [report.device_id]);
        recoveryBlocked = Boolean(activeWindow.rowCount || openWorkOrder.rowCount);
        if (!recoveryBlocked) {
          await client.query('update devices set status = $1, allow_reservation = true, updated_at = $2 where id = $3', ['available', nowIso(), report.device_id]);
          await markDeviceFaultReportsResolved(report.device_id, adminNote, admin, txQuery);
          await notifyReservationUsersForDevice(report.device_id, { type: 'device_recovered', title: 'Device available again', content: 'Your reserved device {device_code} {device_name} is available again. Your original reservation remains valid: {time_range}', related_type: 'fault_report', related_id: reportId }, txQuery);
        } else {
          await client.query('update devices set status = $1, allow_reservation = false, updated_at = $2 where id = $3', ['maintenance', nowIso(), report.device_id]);
        }
      }
      await log('resolve_device_fault', { message: 'Updated fault report', status, recovery_blocked: recoveryBlocked }, admin, report.device_id, reportId, txQuery);
      return { recoveryBlocked };
    });
    return ok({ message: resolution?.recoveryBlocked ? 'Fault status was updated, but the device has open maintenance work and remains unavailable.' : 'Fault status updated.', recovery_blocked: Boolean(resolution?.recoveryBlocked) });
  }

  return {
    adminListFaultReports,
    adminListUserRequests,
    adminResolveFaultReport,
    adminReviewUserRequest,
    cancelUserRequest,
    createUserRequest,
    listMyFaultReports,
    listMyUserRequests,
    reportDeviceFault,
    requestUserRequestChange,
    updateUserRequest
  };
}

module.exports = { createFaultRequestService, normalizeUserRequest };



