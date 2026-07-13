const test = require('node:test');
const assert = require('node:assert/strict');
const { createMaintenanceService } = require('../../src/services/domains/maintenance/maintenance-service');

function createContext(overrides = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).startsWith('select id, user_id')) return { rowCount: 1, rows: [{ id: 'reservation-1', user_id: 'user-1', reservation_id: 'reservation-1' }] };
      if (String(sql).startsWith('select interval_days')) return { rowCount: 1, rows: [{ interval_days: 30 }] };
      if (String(sql).startsWith('select 1 from')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    }
  };
  const context = {
    assertText(value) { if (!String(value || '').trim()) throw new Error('required'); return String(value).trim(); },
    async createUserNotification() {},
    fail(message, status, code) { return { ok: false, message, status, code }; },
    async getById(table, id) {
      if (table === 'devices') return { id, device_code: 'D-01', name: 'Device' };
      if (table === 'device_maintenance_work_orders') return { id, device_id: 'device-1', maintenance_window_id: 'window-1', plan_id: 'plan-1', status: 'pending', assigned_to: null, result_note: null, started_at: null, completed_at: null };
      return null;
    },
    async lockDeviceSchedule(client, deviceId) { await client.query('select pg_advisory_xact_lock', [deviceId]); },
    async log() {},
    nowIso() { return '2026-07-12T10:00:00.000Z'; },
    ok(data) { return { ok: true, data }; },
    parseBoolean(value) { return value === true || value === 'true'; },
    async query() { return []; },
    async requireAdminRole() { return { admin: { id: 'admin-1' } }; },
    uuid: (() => { let id = 0; return () => `id-${++id}`; })(),
    async withTransaction(run) { return run(client); },
    ...overrides
  };
  return { context, calls };
}

test('creating a maintenance work order creates a reservation-blocking window and notifies overlaps', async () => {
  const { context, calls } = createContext();
  const service = createMaintenanceService(context);
  const result = await service.adminCreateMaintenanceWorkOrder({
    device_id: 'device-1', title: 'Inspection', maintenance_type: 'inspection',
    window_start: '2026-07-13T08:00:00Z', window_end: '2026-07-13T10:00:00Z'
  }, 'token');
  assert.equal(result.ok, true);
  assert.equal(result.data.affected_reservations, 1);
  assert.ok(calls.some((call) => call.sql.includes('insert into device_maintenance_windows')));
  assert.ok(calls.some((call) => call.sql.includes('insert into device_maintenance_work_orders')));
});

test('starting a work order puts the device into maintenance and blocks reservations', async () => {
  const { context, calls } = createContext();
  const service = createMaintenanceService(context);
  const result = await service.adminUpdateMaintenanceWorkOrder({ id: 'work-order-1', status: 'in_progress' }, 'token');
  assert.equal(result.ok, true);
  const deviceUpdate = calls.find((call) => call.sql.includes('update devices set status'));
  assert.deepEqual(deviceUpdate.params.slice(0, 2), ['maintenance', '2026-07-12T10:00:00.000Z']);
  assert.equal(deviceUpdate.params[2], 'device-1');
});


test('maintenance work order rejects a plan belonging to another device', async () => {
  const { context } = createContext({
    async getById(table, id) {
      if (table === 'devices') return { id, device_code: 'D-01', name: 'Device' };
      if (table === 'device_maintenance_plans') return { id, device_id: 'other-device', status: 'active' };
      return null;
    }
  });
  const result = await createMaintenanceService(context).adminCreateMaintenanceWorkOrder({
    device_id: 'device-1', plan_id: 'plan-1', title: 'Inspection', window_start: '2026-07-13T08:00:00Z', window_end: '2026-07-13T10:00:00Z'
  }, 'token');
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test('completed maintenance work orders cannot be reopened', async () => {
  const { context } = createContext({
    async getById(table, id) {
      if (table === 'device_maintenance_work_orders') return { id, device_id: 'device-1', maintenance_window_id: 'window-1', plan_id: null, status: 'completed', assigned_to: null, result_note: '', started_at: null, completed_at: '2026-07-12T09:00:00.000Z' };
      return { id, device_code: 'D-01', name: 'Device' };
    }
  });
  const result = await createMaintenanceService(context).adminUpdateMaintenanceWorkOrder({ id: 'work-order-1', status: 'pending' }, 'token');
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test('maintenance lifecycle activates due windows and only sends one overdue notification', async () => {
  let overdueNotificationChecks = 0;
  const { context, calls } = createContext({
    async createUserNotification() { return true; },
    async getById(table, id) { if (table === 'users') return { id, status: 'active', is_banned: false }; return null; },
    async withTransaction(run) { return run({
      async query(sql, params = []) {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes("where w.status = 'scheduled' and w.start_time")) return { rowCount: 1, rows: [{ id: 'window-due', device_id: 'device-1', title: 'Due', work_order_id: 'work-1' }] };
        if (String(sql).includes("where w.status in ('scheduled','active') and w.end_time")) return { rowCount: 1, rows: [{ id: 'window-overdue', device_id: 'device-1', title: 'Overdue', work_order_id: 'work-2', assigned_to: 'user-1', created_by: 'admin-1' }] };
        if (String(sql).startsWith('select 1 from user_notifications')) { overdueNotificationChecks += 1; return { rowCount: 0, rows: [] }; }
        return { rowCount: 1, rows: [] };
      }
    }); }
  });
  const result = await createMaintenanceService(context).runMaintenanceWindowLifecycle('2026-07-12T10:00:00.000Z');
  assert.equal(result.activated, 1);
  assert.equal(result.overdue_notifications, 2);
  assert.equal(overdueNotificationChecks, 2);
  assert.ok(calls.some((call) => call.sql.includes("update device_maintenance_windows set status='active'")));
});

test('completion reports recovery blockers and keeps the device unavailable', async () => {
  const transactionCalls = [];
  const { context } = createContext({
    async getById(table, id) {
      if (table === 'device_maintenance_work_orders') return { id, device_id: 'device-1', maintenance_window_id: 'window-1', plan_id: null, status: 'in_progress', assigned_to: null, result_note: null, started_at: '2026-07-12T09:00:00.000Z', completed_at: null };
      return null;
    },
    async withTransaction(run) {
      return run({
        async query(sql, params = []) {
          const statement = String(sql);
          transactionCalls.push({ sql: statement, params });
          if (statement.includes('from device_maintenance_windows where device_id=$1')) return { rowCount: 1, rows: [{ present: 1 }] };
          if (statement.includes('from device_fault_reports')) return { rowCount: 0, rows: [] };
          if (statement.includes('from device_maintenance_work_orders where device_id=$1')) return { rowCount: 0, rows: [] };
          return { rowCount: 1, rows: [] };
        }
      });
    }
  });
  const result = await createMaintenanceService(context).adminUpdateMaintenanceWorkOrder({ id: 'work-order-1', status: 'completed', restore_available: true }, 'token');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.recovery, { requested: true, recovered: false, blocked: true, blockers: ['active_maintenance_window'] });
  const deviceUpdate = transactionCalls.filter((call) => call.sql.includes('update devices set status')).at(-1);
  assert.deepEqual(deviceUpdate.params, ['maintenance', '2026-07-12T10:00:00.000Z', 'device-1']);
});

test('maintenance overview exposes overdue counts and lifecycle scheduler state', async () => {
  const { context } = createContext({
    async query(sql) {
      const statement = String(sql);
      if (statement.includes('from device_maintenance_plans')) return [{ active: 1, overdue: 2 }];
      if (statement.includes('from device_maintenance_work_orders')) return [{ pending: 3, in_progress: 1, overdue: 4 }];
      if (statement.includes('from device_maintenance_windows')) return [{ active_windows: 1, overdue_windows: 5 }];
      if (statement.includes('from scheduled_job_runs')) return [{ status: 'failed', scheduled_for: '2026-07-12T10:00:00.000Z', started_at: '2026-07-12T10:00:01.000Z', finished_at: '2026-07-12T10:00:05.000Z', error_message: 'example' }];
      return [];
    }
  });
  const result = await createMaintenanceService(context).adminMaintenanceOverview({}, 'token');
  assert.equal(result.ok, true);
  assert.equal(result.data.summary.overdue_windows, 5);
  assert.equal(result.data.summary.overdue_work_orders, 4);
  assert.equal(result.data.scheduler.status, 'failed');
  assert.equal(result.data.scheduler.error_message, 'example');
});
