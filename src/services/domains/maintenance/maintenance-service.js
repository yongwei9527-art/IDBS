function createMaintenanceService(context = {}) {
  const { assertText, createUserNotification, fail, getById, lockDeviceSchedule, log, nowIso, ok, parseBoolean, query, requireAdminRole, uuid, withTransaction } = context;
  const planStatuses = new Set(['active', 'paused', 'archived']);
  const workOrderStatuses = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
  const windowStatuses = new Set(['scheduled', 'active', 'completed', 'cancelled']);

  function parseDate(value, field) {
    const date = new Date(String(value || ''));
    if (Number.isNaN(date.getTime())) return fail(field + ' \u65f6\u95f4\u683c\u5f0f\u65e0\u6548', 400, 2001);
    return date.toISOString();
  }

  async function ensureDevice(deviceId) {
    const device = await getById('devices', deviceId);
    if (!device) throw Object.assign(new Error('\u8bbe\u5907\u4e0d\u5b58\u5728'), { status: 404, code: 3004 });
    return device;
  }


  async function ensureActiveAssignee(userId) {
    if (!userId) return null;
    const user = await getById('users', userId);
    if (!user) return fail('Maintenance assignee does not exist', 404, 3004);
    if (user.status !== 'active' || user.is_banned) return fail('Maintenance assignee must be active and not banned', 409, 3001);
    return user;
  }

  async function validateWorkOrderLinks({ deviceId, planId, faultReportId, assignedTo }) {
    if (planId) {
      const plan = await getById('device_maintenance_plans', planId);
      if (!plan) return fail('Maintenance plan does not exist', 404, 3004);
      if (plan.device_id !== deviceId) return fail('Maintenance plan does not belong to this device', 409, 3001);
      if (plan.status === 'archived') return fail('Archived maintenance plans cannot create work orders', 409, 3001);
    }
    if (faultReportId) {
      const fault = await getById('device_fault_reports', faultReportId);
      if (!fault) return fail('Fault report does not exist', 404, 3004);
      if (fault.device_id !== deviceId) return fail('Fault report does not belong to this device', 409, 3001);
    }
    const assignee = await ensureActiveAssignee(assignedTo);
    if (assignee?.ok === false) return assignee;
    return null;
  }

  async function notifyAffectedReservations(client, device, window, actor) {
    const result = await client.query(
      `select id, user_id, reservation_id, start_time, end_time from reservation_items
       where device_id = $1 and status = any($2) and start_time < $4 and end_time > $3`,
      [device.id, ['pending', 'approved', 'in_use'], window.start_time, window.end_time]
    );
    for (const item of result.rows || []) {
      await createUserNotification({
        user_id: item.user_id,
        type: 'maintenance_window',
        title: '\u7ef4\u62a4\u65f6\u95f4\u901a\u77e5',
        content: '\u8bbe\u5907 ' + (device.device_code || '') + ' ' + (device.name || '') + ' \u5728\u60a8\u7684\u9884\u7ea6\u65f6\u95f4\u5185\u5b89\u6392\u4e86\u7ef4\u62a4\uff0c\u8bf7\u53ca\u65f6\u5173\u6ce8\u6700\u65b0\u901a\u77e5\u3002',
        related_type: 'maintenance_window',
        related_id: window.id,
        device_id: device.id,
        reservation_id: item.reservation_id
      }, (sql, params) => client.query(sql, params));
    }
    await log('maintenance_window_notify', { message: '\u5df2\u901a\u77e5\u53d7\u5f71\u54cd\u9884\u7ea6 ' + (result.rowCount || 0) + ' \u6761', window_id: window.id }, actor, device.id, window.id, (sql, params) => client.query(sql, params));
    return result.rowCount || 0;
  }

  async function adminListMaintenancePlans(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['device.manage', 'fault.manage', 'device.view']);
    const status = String(params.status || '').trim();
    const rows = await query(`select p.*, d.device_code, d.name as device_name, d.status as device_status
      from device_maintenance_plans p join devices d on d.id = p.device_id
      where ($1 = '' or p.status = $1) order by p.next_due_at nulls last, p.created_at desc`, [status]);
    return ok({ plans: rows || [] });
  }

  async function adminCreateMaintenancePlan(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['device.manage', 'fault.manage']);
    const deviceId = assertText(payload.device_id || payload.deviceId, 'device_id', 60);
    await ensureDevice(deviceId);
    const title = assertText(payload.title, 'title', 120);
    const maintenanceType = String(payload.maintenance_type || payload.maintenanceType || 'inspection').trim().slice(0, 40) || 'inspection';
    const intervalDays = Number(payload.interval_days || payload.intervalDays || 0);
    if (!Number.isInteger(intervalDays) || intervalDays < 0 || intervalDays > 3650) return fail('\u7ef4\u62a4\u5468\u671f\u5fc5\u987b\u4e3a 0-3650 \u4e4b\u95f4\u7684\u6574\u6570', 400, 2001);
    const nextDueAt = payload.next_due_at || payload.nextDueAt ? parseDate(payload.next_due_at || payload.nextDueAt, 'next_due_at') : null;
    const status = String(payload.status || 'active');
    if (!planStatuses.has(status)) return fail('\u7ef4\u62a4\u72b6\u6001\u65e0\u6548', 400, 2001);
    const plan = { id: uuid(), device_id: deviceId, title, maintenance_type: maintenanceType, interval_days: intervalDays, next_due_at: nextDueAt, status, notes: String(payload.notes || '').trim().slice(0, 1500), created_at: nowIso() };
    await withTransaction(async (client) => {
      await client.query('insert into device_maintenance_plans (id, device_id, title, maintenance_type, interval_days, next_due_at, status, notes, created_by, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)', [plan.id, plan.device_id, plan.title, plan.maintenance_type, plan.interval_days, plan.next_due_at, plan.status, plan.notes, admin.user_id || admin.id || null, plan.created_at]);
      await log('create_maintenance_plan', { message: '\u7ef4\u62a4\u8ba1\u5212\u5df2\u521b\u5efa', plan_id: plan.id, title }, admin, deviceId, plan.id, (sql, params) => client.query(sql, params));
    });
    return ok({ message: '\u7ef4\u62a4\u8ba1\u5212\u5df2\u521b\u5efa', plan });
  }

  async function adminUpdateMaintenancePlan(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['device.manage', 'fault.manage']);
    const id = assertText(payload.id || payload.plan_id || payload.planId, 'id', 60);
    const plan = await getById('device_maintenance_plans', id);
    if (!plan) return fail('\u7ef4\u62a4\u8ba1\u5212\u4e0d\u5b58\u5728', 404, 3004);
    const status = String(payload.status || plan.status);
    if (!planStatuses.has(status)) return fail('\u7ef4\u62a4\u72b6\u6001\u65e0\u6548', 400, 2001);
    const intervalDays = payload.interval_days === undefined && payload.intervalDays === undefined ? Number(plan.interval_days || 0) : Number(payload.interval_days ?? payload.intervalDays);
    if (!Number.isInteger(intervalDays) || intervalDays < 0 || intervalDays > 3650) return fail('\u7ef4\u62a4\u5468\u671f\u5fc5\u987b\u4e3a 0-3650 \u4e4b\u95f4\u7684\u6574\u6570', 400, 2001);
    const nextDueAt = payload.next_due_at === undefined && payload.nextDueAt === undefined ? plan.next_due_at : ((payload.next_due_at || payload.nextDueAt) ? parseDate(payload.next_due_at || payload.nextDueAt, 'next_due_at') : null);
    await withTransaction(async (client) => {
      await client.query('update device_maintenance_plans set title=$1, maintenance_type=$2, interval_days=$3, next_due_at=$4, status=$5, notes=$6, updated_at=$7 where id=$8', [String(payload.title || plan.title).trim().slice(0, 120), String(payload.maintenance_type || payload.maintenanceType || plan.maintenance_type).trim().slice(0, 40), intervalDays, nextDueAt, status, String(payload.notes === undefined ? plan.notes || '' : payload.notes).trim().slice(0, 1500), nowIso(), id]);
      await log('update_maintenance_plan', { message: '\u7ef4\u62a4\u8ba1\u5212\u5df2\u66f4\u65b0', plan_id: id, status }, admin, plan.device_id, id, (sql, params) => client.query(sql, params));
    });
    return ok({ message: '\u7ef4\u62a4\u8ba1\u5212\u5df2\u66f4\u65b0' });
  }

  async function adminListMaintenanceWorkOrders(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['device.manage', 'fault.manage', 'device.view']);
    const status = String(params.status || '').trim();
    const rows = await query(`select w.*, d.device_code, d.name as device_name, p.title as plan_title, u.name as assignee_name
      from device_maintenance_work_orders w join devices d on d.id = w.device_id
      left join device_maintenance_plans p on p.id = w.plan_id left join users u on u.id = w.assigned_to
      where ($1 = '' or w.status = $1) order by coalesce(w.window_start, w.created_at) desc`, [status]);
    return ok({ work_orders: rows || [] });
  }

  async function adminCreateMaintenanceWorkOrder(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['device.manage', 'fault.manage']);
    const deviceId = assertText(payload.device_id || payload.deviceId, 'device_id', 60);
    const device = await ensureDevice(deviceId);
    const title = assertText(payload.title, 'title', 120);
    const startTime = parseDate(payload.window_start || payload.start_time || payload.startTime, 'window_start');
    const endTime = parseDate(payload.window_end || payload.end_time || payload.endTime, 'window_end');
    if (new Date(endTime) <= new Date(startTime)) return fail('\u7ef4\u62a4\u7a97\u53e3\u7ed3\u675f\u65f6\u95f4\u5fc5\u987b\u665a\u4e8e\u5f00\u59cb\u65f6\u95f4', 400, 2001);
    const planId = String(payload.plan_id || payload.planId || '').trim() || null;
    const faultReportId = String(payload.fault_report_id || payload.faultReportId || '').trim() || null;
    const assignedTo = String(payload.assigned_to || payload.assignedTo || '').trim() || null;
    const linkValidation = await validateWorkOrderLinks({ deviceId, planId, faultReportId, assignedTo });
    if (linkValidation) return linkValidation;
    const id = uuid(); const windowId = uuid(); const now = nowIso();
    const workOrder = { id, device_id: deviceId, title, maintenance_type: String(payload.maintenance_type || payload.maintenanceType || 'inspection').trim().slice(0, 40) || 'inspection', status: 'pending', window_start: startTime, window_end: endTime };
    let affectedReservations = 0;
    await withTransaction(async (client) => {
      await lockDeviceSchedule(client, deviceId);
      await client.query('insert into device_maintenance_windows (id, device_id, plan_id, title, start_time, end_time, status, created_by, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)', [windowId, deviceId, planId, title, startTime, endTime, 'scheduled', admin.user_id || admin.id || null, now]);
      await client.query('insert into device_maintenance_work_orders (id, device_id, plan_id, maintenance_window_id, fault_report_id, title, maintenance_type, status, assigned_to, description, window_start, window_end, created_by, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)', [id, deviceId, planId, windowId, faultReportId, title, workOrder.maintenance_type, 'pending', assignedTo, String(payload.description || '').trim().slice(0, 1500), startTime, endTime, admin.user_id || admin.id || null, now]);
      affectedReservations = await notifyAffectedReservations(client, device, { id: windowId, start_time: startTime, end_time: endTime }, admin);
      await log('create_maintenance_work_order', { message: '\u7ef4\u62a4\u5de5\u5355\u5df2\u66f4\u65b0', work_order_id: id, window_id: windowId }, admin, deviceId, id, (sql, params) => client.query(sql, params));
    });
    return ok({ message: '\u7ef4\u62a4\u5de5\u5355\u5df2\u521b\u5efa', work_order: workOrder, affected_reservations: affectedReservations });
  }

  async function adminUpdateMaintenanceWorkOrder(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['device.manage', 'fault.manage']);
    const id = assertText(payload.id || payload.work_order_id || payload.workOrderId, 'id', 60);
    const workOrder = await getById('device_maintenance_work_orders', id);
    if (!workOrder) return fail('\u7ef4\u62a4\u5de5\u5355\u4e0d\u5b58\u5728', 404, 3004);
    const status = String(payload.status || workOrder.status);
    if (!workOrderStatuses.has(status)) return fail('Invalid maintenance status', 400, 2001);
    if (['completed', 'cancelled'].includes(workOrder.status) && status !== workOrder.status) return fail('Completed maintenance work orders cannot be reopened', 409, 3001);
    const assigneeChanged = payload.assigned_to !== undefined || payload.assignedTo !== undefined;
    const assignedTo = !assigneeChanged ? workOrder.assigned_to : (String(payload.assigned_to ?? payload.assignedTo ?? '').trim() || null);
    if (assigneeChanged) {
      const assigneeValidation = await ensureActiveAssignee(assignedTo);
      if (assigneeValidation?.ok === false) return assigneeValidation;
    }
    const now = nowIso();
    let recovery = { requested: false, recovered: false, blocked: false, blockers: [] };
    await withTransaction(async (client) => {
      await lockDeviceSchedule(client, workOrder.device_id);
      const startedAt = status === 'in_progress' && !workOrder.started_at ? now : workOrder.started_at;
      const completedAt = ['completed', 'cancelled'].includes(status) ? now : workOrder.completed_at;
      await client.query('update device_maintenance_work_orders set status=$1, assigned_to=$2, result_note=$3, started_at=$4, completed_at=$5, updated_at=$6 where id=$7', [status, assignedTo, String(payload.result_note === undefined ? workOrder.result_note || '' : payload.result_note).trim().slice(0, 1500), startedAt, completedAt, now, id]);
      if (status === 'in_progress') {
        await client.query('update device_maintenance_windows set status=$1, updated_at=$2 where id=$3', ['active', now, workOrder.maintenance_window_id]);
        await client.query('update devices set status=$1, allow_reservation=false, updated_at=$2 where id=$3', ['maintenance', now, workOrder.device_id]);
      }
      if (['completed', 'cancelled'].includes(status)) {
        await client.query('update device_maintenance_windows set status=$1, updated_at=$2 where id=$3', [status === 'completed' ? 'completed' : 'cancelled', now, workOrder.maintenance_window_id]);
        if (workOrder.plan_id && status === 'completed') {
          const plan = await client.query('select interval_days from device_maintenance_plans where id=$1', [workOrder.plan_id]);
          const interval = Number(plan.rows?.[0]?.interval_days || 0);
          await client.query("update device_maintenance_plans set last_completed_at=$1, next_due_at=case when $2 > 0 then $1::timestamptz + ($2::text || ' days')::interval else next_due_at end, updated_at=$1 where id=$3", [now, interval, workOrder.plan_id]);
        }
        const restore = parseBoolean(payload.restore_available ?? payload.restoreAvailable);
        if (restore) {
          recovery.requested = true;
          const [activeWindow, openFault, openWorkOrder] = await Promise.all([
            client.query(`select 1 from device_maintenance_windows where device_id=$1 and status in ('scheduled','active') and start_time <= now() and end_time > now() limit 1`, [workOrder.device_id]),
            client.query(`select 1 from device_fault_reports where device_id=$1 and status in ('pending','processing') limit 1`, [workOrder.device_id]),
            client.query(`select 1 from device_maintenance_work_orders where device_id=$1 and id <> $2 and status in ('pending','in_progress') limit 1`, [workOrder.device_id, workOrder.id])
          ]);
          if (activeWindow.rowCount) recovery.blockers.push('active_maintenance_window');
          if (openFault.rowCount) recovery.blockers.push('open_fault_report');
          if (openWorkOrder.rowCount) recovery.blockers.push('open_maintenance_work_order');
          recovery.blocked = recovery.blockers.length > 0;
          if (!recovery.blocked) {
            await client.query('update devices set status=$1, allow_reservation=true, updated_at=$2 where id=$3', ['available', now, workOrder.device_id]);
            recovery.recovered = true;
          } else {
            await client.query('update devices set status=$1, allow_reservation=false, updated_at=$2 where id=$3', ['maintenance', now, workOrder.device_id]);
          }
        }
      }
      await log('update_maintenance_work_order', { message: '\u7ef4\u62a4\u5de5\u5355\u5df2\u66f4\u65b0', work_order_id: id, status }, admin, workOrder.device_id, id, (sql, params) => client.query(sql, params));
    });
    return ok({ message: '\u7ef4\u62a4\u5de5\u5355\u5df2\u66f4\u65b0', recovery });
  }

  async function adminMaintenanceOverview(_params, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['device.manage', 'fault.manage', 'device.view']);
    const [plans, orders, windows, schedulerRows] = await Promise.all([
      query(`select count(*) filter (where status='active')::int as active, count(*) filter (where status='active' and next_due_at < now())::int as overdue from device_maintenance_plans`),
      query(`select count(*) filter (where status='pending')::int as pending, count(*) filter (where status='in_progress')::int as in_progress, count(*) filter (where status in ('pending','in_progress') and window_end < now())::int as overdue from device_maintenance_work_orders`),
      query(`select count(*) filter (where status in ('scheduled','active') and start_time <= now() and end_time > now())::int as active_windows, count(*) filter (where status in ('scheduled','active') and end_time < now())::int as overdue_windows from device_maintenance_windows`),
      query(`select status, scheduled_for, started_at, finished_at, error_message from scheduled_job_runs where job_name=$1 order by scheduled_for desc limit 1`, ['maintenance-window-lifecycle'])
    ]);
    return ok({
      summary: {
        active_plans: plans[0]?.active || 0,
        overdue_plans: plans[0]?.overdue || 0,
        pending_work_orders: orders[0]?.pending || 0,
        in_progress_work_orders: orders[0]?.in_progress || 0,
        overdue_work_orders: orders[0]?.overdue || 0,
        active_windows: windows[0]?.active_windows || 0,
        overdue_windows: windows[0]?.overdue_windows || 0
      },
      scheduler: schedulerRows[0] || { status: 'never_run', scheduled_for: null, finished_at: null, error_message: null }
    });
  }

  async function runMaintenanceWindowLifecycle(nowValue = nowIso()) {
    const now = new Date(nowValue).toISOString();
    const result = { activated: 0, overdue_notifications: 0 };
    await withTransaction(async (client) => {
      const due = await client.query(`select w.id, w.device_id, w.title, o.id as work_order_id
        from device_maintenance_windows w join device_maintenance_work_orders o on o.maintenance_window_id = w.id
        where w.status = 'scheduled' and w.start_time <= $1 and o.status in ('pending','in_progress')`, [now]);
      for (const window of due.rows || []) {
        await lockDeviceSchedule(client, window.device_id);
        const changed = await client.query(`update device_maintenance_windows set status='active', updated_at=$1 where id=$2 and status='scheduled'`, [now, window.id]);
        if (!changed.rowCount) continue;
        await client.query(`update devices set status='maintenance', allow_reservation=false, updated_at=$1 where id=$2`, [now, window.device_id]);
        await log('activate_maintenance_window', { message: 'Maintenance window activated automatically', window_id: window.id, work_order_id: window.work_order_id }, { role: 'system' }, window.device_id, window.id, (sql, params) => client.query(sql, params));
        result.activated += 1;
      }
      const overdue = await client.query(`select w.id, w.device_id, w.title, o.id as work_order_id, o.assigned_to, o.created_by
        from device_maintenance_windows w join device_maintenance_work_orders o on o.maintenance_window_id = w.id
        where w.status in ('scheduled','active') and w.end_time < $1 and o.status in ('pending','in_progress')`, [now]);
      for (const window of overdue.rows || []) {
        for (const userId of new Set([window.assigned_to, window.created_by].filter(Boolean))) {
          const exists = await client.query(`select 1 from user_notifications where user_id=$1 and type='maintenance_window_overdue' and related_id=$2 limit 1`, [userId, window.id]);
          if (exists.rowCount) continue;
          const written = await createUserNotification({ user_id: userId, type: 'maintenance_window_overdue', title: 'Maintenance window overdue', content: 'Maintenance window ' + (window.title || '') + ' has passed its scheduled end time and still requires attention.', related_type: 'maintenance_window', related_id: window.id, device_id: window.device_id }, (sql, params) => client.query(sql, params));
          if (written) result.overdue_notifications += 1;
        }
        await log('maintenance_window_overdue', { message: 'Maintenance window overdue', window_id: window.id, work_order_id: window.work_order_id }, { role: 'system' }, window.device_id, window.id, (sql, params) => client.query(sql, params));
      }
    });
    return result;
  }

  return { adminCreateMaintenancePlan, adminCreateMaintenanceWorkOrder, adminListMaintenancePlans, adminListMaintenanceWorkOrders, adminMaintenanceOverview, adminUpdateMaintenancePlan, adminUpdateMaintenanceWorkOrder, runMaintenanceWindowLifecycle };
}
module.exports = { createMaintenanceService };


