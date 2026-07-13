const test = require('node:test');
const assert = require('node:assert/strict');
const { createBorrowReturnService } = require('../../src/services/domains/reservations/borrow-return-service');

function context(overrides = {}) {
  const calls = [];
  return {
    calls,
    service: createBorrowReturnService({
      assertText(value) { if (!String(value || '').trim()) throw new Error('required'); return String(value).trim(); },
      fail(message, status, code) { return { ok: false, message, status, code }; },
      getById: async (table, id) => table === 'borrow_records' ? { id, device_id: 'device-1', status: 'return_pending' } : null,
      log: async () => {},
      nowIso: () => '2026-07-12T12:00:00.000Z',
      ok: (data) => ({ ok: true, data }),
      query: async () => [],
      requireAdminRole: async () => ({ admin: { id: 'admin-1' } }),
      uuid: () => 'receive-1',
      withTransaction: async (run) => run({ query: async (sql, params = []) => { calls.push({ sql: String(sql), params }); return { rowCount: 1, rows: [] }; } }),
      ...overrides
    })
  };
}

test('return acceptance restores availability and persists the handover audit record', async () => {
  const { service, calls } = context();
  const result = await service.adminReviewReturn({ id: 'record-1', approved: true, review_note: '设备完好' }, 'token');
  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'returned');
  assert.ok(calls.some((call) => call.sql.includes('insert into receive_records')));
  const deviceUpdate = calls.find((call) => call.sql.includes('update devices set status'));
  assert.deepEqual(deviceUpdate.params, ['available', true, 'admin-1', '2026-07-12T12:00:00.000Z', 'device-1']);
});

test('return task queue separates overdue use, pending acceptance, and abnormal returns', async () => {
  const { service } = context({
    query: async () => [
      { id: 'a', status: 'in_use' },
      { id: 'b', status: 'return_pending' },
      { id: 'c', status: 'abnormal_pending' }
    ]
  });
  const result = await service.adminListReturnTasks({}, 'token');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.summary, { overdue_borrows: 1, pending_acceptance: 1, abnormal_returns: 1 });
});
