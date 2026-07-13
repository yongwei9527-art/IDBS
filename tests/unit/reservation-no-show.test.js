const test = require('node:test');
const assert = require('node:assert/strict');
const { createReservationActionService } = require('../../src/services/domains/reservations/reservation-action-service');

function createContext(overrides = {}) {
  const calls = [];
  const context = {
    fail(message, status, code) { return { ok: false, message, status, code }; },
    ok(data) { return { ok: true, data }; },
    nowIso() { return '2026-07-12T10:00:00.000Z'; },
    uuid: (() => { let sequence = 0; return () => 'id-' + (++sequence); })(),
    async requireUser() { return { id: 'user-1' }; },
    async requireAdminRole() { return { admin: { id: 'admin-1' } }; },
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('from borrow_records')) return [];
      if (String(sql).includes("status = 'no_show'")) return [{ count: 0 }];
      return [];
    },
    async getReservationItemById() { return null; },
    async createReservationStatusNotification() {},
    async log() {},
    async withTransaction(run) {
      return run({
        async query(sql, params = []) {
          calls.push({ sql: String(sql), params });
          return { rows: [], rowCount: 1 };
        }
      });
    },
    ...overrides
  };
  return { context, calls };
}

test('reservation creation is blocked after two no-shows within 90 days', async () => {
  const { context } = createContext({
    async query(sql, params = []) {
      if (String(sql).includes('from borrow_records')) return [];
      if (String(sql).includes("status = 'no_show'")) return [{ count: 2 }];
      throw new Error('Unexpected query: ' + sql + ' ' + params.join(','));
    }
  });
  const result = await createReservationActionService(context).createReservation({}, 'token');
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.message, /90 天已有 2 次爽约/);
});

test('precheck reports the no-show restriction before submission', async () => {
  const { context } = createContext({
    async query(sql) {
      if (String(sql).includes('from borrow_records')) return [];
      if (String(sql).includes("status = 'no_show'")) return [{ count: 2 }];
      throw new Error('Unexpected query: ' + sql);
    }
  });
  const result = await createReservationActionService(context).precheckReservation({}, 'token');
  assert.equal(result.ok, true);
  assert.equal(result.data.available, false);
  assert.equal(result.data.conflicts[0].type, 'no_show_restriction');
  assert.match(result.data.conflicts[0].reason, /90 天已有 2 次爽约/);
});

test('an administrator can mark an approved, started reservation as no-show', async () => {
  const { context, calls } = createContext({
    async getReservationItemById() {
      return {
        id: 'item-1', reservation_id: 'reservation-1', batch_id: 'batch-1', user_id: 'user-1',
        device_id: 'device-1', status: 'approved', start_time: '2026-07-01T08:00:00.000Z'
      };
    }
  });
  const result = await createReservationActionService(context).adminMarkReservationNoShow({ id: 'item-1', admin_note: '未到场' }, 'token');
  assert.equal(result.ok, true);
  const itemUpdate = calls.find((call) => call.sql.includes('update reservation_items set status'));
  assert.deepEqual(itemUpdate.params, ['no_show', '\u672a\u5230\u573a', 'other', '2026-07-12T10:00:00.000Z', 'admin-1', 'item-1']);
  assert.ok(calls.some((call) => call.sql.includes('update reservations set status')));
});

test('future or non-approved reservations cannot be marked as no-show', async () => {
  const { context } = createContext({
    async getReservationItemById() {
      return { id: 'item-1', status: 'approved', start_time: '2026-08-01T08:00:00.000Z' };
    }
  });
  const result = await createReservationActionService(context).adminMarkReservationNoShow({ id: 'item-1' }, 'token');
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.message, /\u9884\u7ea6\u5f00\u59cb\u540e/);
});
