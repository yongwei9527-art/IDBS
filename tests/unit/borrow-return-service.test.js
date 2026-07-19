const test = require('node:test');
const assert = require('node:assert/strict');
const { createBorrowReturnService } = require('../../src/services/domains/reservations/borrow-return-service');

function context(overrides = {}) {
  const calls = [];
  return {
    calls,
    service: createBorrowReturnService({
      assertText(value) { if (!String(value || '').trim()) throw new Error('required'); return String(value).trim(); },
      createUserNotification: async () => {},
      fail(message, status, code) { return { ok: false, message, status, code }; },
      getById: async (table, id) => table === 'borrow_records' ? { id, device_id: 'device-1', status: 'return_pending' } : null,
      log: async () => {},
      nowIso: () => '2026-07-12T12:00:00.000Z',
      ok: (data) => ({ ok: true, data }),
      query: async () => [],
      requireAdminRole: async () => ({ admin: { id: 'admin-1' } }),
      requireUser: async () => ({ id: 'user-1', name: '测试用户' }),
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

test('marking a normal handover abnormal creates a one-hour material task and notifies the user', async () => {
  const notifications = [];
  const { service, calls } = context({
    getById: async (table, id) => table === 'borrow_records' ? { id, device_id: 'device-1', user_id: 'user-1', status: 'return_pending' } : null,
    createUserNotification: async (payload) => notifications.push(payload)
  });
  const result = await service.adminReviewReturn({ id: 'record-1', approved: false, review_note: '照片不清晰' }, 'token');
  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'abnormal_pending');
  assert.match(result.data.material_deadline, /^\d{4}-\d{2}-\d{2}T/);
  const recordUpdate = calls.find((call) => call.sql.includes('update borrow_records set status'));
  assert.equal(recordUpdate.params[4], true);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].user_id, 'user-1');
});

test('user can supplement an assigned abnormal return task with a note', async () => {
  const { service, calls } = context({
    getById: async (table, id) => {
      if (table === 'borrow_records') return { id, device_id: 'device-1', user_id: 'user-1', status: 'abnormal_pending', return_material_required: true, return_material_deadline: '2026-07-12T13:00:00.000Z' };
      if (table === 'devices') return { id, device_code: 'LAB-1', name: '测试设备' };
      return null;
    }
  });
  const result = await service.supplementReturnMaterials({ id: 'record-1', note: '已补充配件清单' }, 'token');
  assert.equal(result.ok, true);
  assert.equal(result.data.late, false);
  const update = calls.find((call) => call.sql.includes('return_supplement_note'));
  assert.equal(update.params[0], '已补充配件清单');
  assert.equal(update.params[3], false);
});

test('abnormal return cannot be closed while requested materials are still within deadline', async () => {
  const { service } = context({
    getById: async (table, id) => table === 'borrow_records' ? {
      id,
      device_id: 'device-1',
      user_id: 'user-1',
      status: 'abnormal_pending',
      return_material_required: true,
      return_material_deadline: new Date(Date.now() + 30 * 60_000).toISOString()
    } : null
  });
  const result = await service.adminReviewReturn({ id: 'record-1', approved: true }, 'token');
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

function startContext({ items, outsideRows }) {
  const writes = [];
  let sequence = 0;
  const devices = Object.fromEntries(Object.values(items).map((item) => [item.device_id, { id: item.device_id, device_code: item.device_code, name: item.device_name, status: 'available' }]));
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('from reservation_items ri join users')) return { rows: items[params[0]] ? [{ ...items[params[0]], user_name: '测试用户' }] : [] };
      if (text.startsWith('select * from devices')) return { rows: devices[params[0]] ? [devices[params[0]]] : [] };
      if (text.includes('from borrow_records where reservation_item_id')) return { rows: [] };
      writes.push({ sql: text, params });
      if (text.startsWith('update reservation_items')) items[params[2]].status = params[0];
      if (text.startsWith('update devices')) devices[params[2]].status = params[0];
      return { rows: [], rowCount: 1 };
    }
  };
  const service = createBorrowReturnService({
    appendUsageLog: async () => {},
    assertText: (value) => String(value),
    createUserNotification: async () => {},
    fail: (message, status, code) => ({ ok: false, message, status, code }),
    getById: async (table, id) => table === 'reservation_batches' ? { id, user_id: 'user-1' } : null,
    log: async () => {},
    nowIso: () => '2026-07-12T12:00:00.000Z',
    ok: (data) => ({ ok: true, data }),
    query: async (sql) => outsideRows(String(sql)),
    requireUser: async () => ({ id: 'user-1', name: '测试用户' }),
    uuid: () => `borrow-${++sequence}`,
    withTransaction: async (run) => run(client)
  });
  return { service, writes };
}

test('one-click batch start starts all eligible devices and leaves future items waiting', async () => {
  const items = {
    'item-1': { id: 'item-1', batch_id: 'batch-1', reservation_id: 'reservation-1', user_id: 'user-1', device_id: 'device-1', device_code: 'LAB-01', device_name: '显微镜', status: 'approved', start_time: '2026-07-12T11:50:00.000Z', end_time: '2026-07-12T13:00:00.000Z' },
    'item-2': { id: 'item-2', batch_id: 'batch-1', reservation_id: 'reservation-2', user_id: 'user-1', device_id: 'device-2', device_code: 'LAB-02', device_name: '离心机', status: 'approved', start_time: '2026-07-12T13:00:00.000Z', end_time: '2026-07-12T14:00:00.000Z' }
  };
  const { service, writes } = startContext({ items, outsideRows: () => Object.values(items) });
  const result = await service.startReservationBatch({ id: 'batch-1' }, 'token');
  assert.equal(result.ok, true);
  assert.equal(result.data.started_count, 1);
  assert.equal(result.data.waiting_count, 1);
  assert.equal(writes.filter((call) => call.sql.startsWith('insert into borrow_records')).length, 1);
});

test('approved reservations automatically start thirty minutes after their start time', async () => {
  const items = {
    'item-1': { id: 'item-1', batch_id: 'batch-1', reservation_id: 'reservation-1', user_id: 'user-1', device_id: 'device-1', device_code: 'LAB-01', device_name: '显微镜', status: 'approved', start_time: '2026-07-12T11:30:00.000Z', end_time: '2026-07-12T13:00:00.000Z' }
  };
  const { service, writes } = startContext({ items, outsideRows: (sql) => sql.includes("ri.status='approved'") ? [{ id: 'item-1' }] : [] });
  const result = await service.autoStartDueReservations('2026-07-12T12:00:00.000Z');
  assert.deepEqual(result, { started_count: 1, blocked_count: 0 });
  assert.equal(writes.filter((call) => call.sql.startsWith('insert into borrow_records')).length, 1);
  assert.equal(items['item-1'].status, 'in_use');
});
