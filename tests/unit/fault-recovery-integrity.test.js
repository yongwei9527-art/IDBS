const test = require('node:test');
const assert = require('node:assert/strict');
const { createFaultRequestService } = require('../../src/services/domains/faults/fault-request-service');

function createContext(overrides = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('from device_maintenance_windows')) return { rowCount: 0, rows: [] };
      if (String(sql).includes('from device_maintenance_work_orders')) return { rowCount: 1, rows: [{ id: 'work-1' }] };
      return { rowCount: 1, rows: [] };
    }
  };
  return {
    calls,
    context: {
      assertText(value) { return String(value || '').trim(); },
      async createUserNotification() {},
      fail(message, status, code) { return { ok: false, message, status, code }; },
      async getById(table, id) { if (table === 'device_fault_reports') return { id, device_id: 'device-1' }; return null; },
      async getDeviceByCode() { return null; },
      async lockDeviceSchedule(clientArg, deviceId) { await clientArg.query('select pg_advisory_xact_lock', [deviceId]); },
      async log() {},
      async markDeviceFaultReportsResolved() {},
      async notifyReservationUsersForDevice() {},
      nowIso() { return '2026-07-12T10:00:00.000Z'; },
      ok(data) { return { ok: true, data }; },
      parseBoolean(value) { return value === true || value === 'true'; },
      async query() { return []; },
      async requireAdminRole() { return { admin: { id: 'admin-1' } }; },
      async requireUser() { return { id: 'user-1' }; },
      uuid() { return 'fault-1'; },
      async withTransaction(run) { return run(client); },
      ...overrides
    }
  };
}

test('fault resolution cannot reopen a device with an unfinished maintenance work order', async () => {
  const { context, calls } = createContext();
  const result = await createFaultRequestService(context).adminResolveFaultReport({ report_id: 'fault-1', status: 'resolved', set_available: true }, 'token');
  assert.equal(result.ok, true);
  assert.equal(result.data.recovery_blocked, true);
  assert.ok(calls.some((call) => call.sql.includes('pg_advisory_xact_lock')));
  const recovery = calls.find((call) => call.sql.includes('update devices set status') && call.params[0] === 'available');
  assert.equal(recovery, undefined);
  const blocked = calls.find((call) => call.sql.includes('update devices set status') && call.params[0] === 'maintenance');
  assert.ok(blocked);
});
