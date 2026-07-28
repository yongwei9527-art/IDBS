const test = require('node:test');
const assert = require('node:assert/strict');
const { createMaterialRequestService } = require('../../src/services/domains/materials/material-request-service');

function createHarness(options = {}) {
  const calls = [];
  const audits = [];
  const notifications = [];
  const row = options.row || { id: 'request-1', user_id: 'user-1', item_name: '水泥', quantity: '425', unit: '袋', status: 'pending' };
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      return { rowCount: 1, rows: [] };
    }
  };
  const context = {
    assertText(value, label, max) {
      const text = String(value || '').trim();
      if (!text || text.length > max) throw new Error(label + ' required');
      return text;
    },
    async createUserNotification(payload) { notifications.push(payload); },
    fail(message, status, code) { return { ok: false, message, status, code }; },
    async getById(table, id) { return table === 'material_requests' && id === 'request-1' ? row : null; },
    async log(...args) { audits.push(args); },
    nowIso() { return '2026-07-28T08:00:00.000Z'; },
    ok(data) { return { ok: true, data }; },
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).startsWith('select id, user_id')) return [{ id: 'request-1', user_id: 'user-1', item_name: '水泥', quantity: '2.5', unit: '袋', status: 'pending' }];
      return [];
    },
    async requireAdminRole() { return { admin: { id: 'admin-1' }, role: { permissions: ['user.manage'] } }; },
    async requireUser() { return { id: 'user-1' }; },
    uuid: () => 'request-1',
    async withTransaction(run) { return run(client); },
    ...options.context
  };
  return { service: createMaterialRequestService(context), calls, audits, notifications };
}

test('user can submit a structured material checklist request', async () => {
  const harness = createHarness();
  const result = await harness.service.createMaterialRequest({ item_name: '425 混凝土', quantity: '2.5', unit: '袋', purpose: '实验室地面修补' }, 'user-token');
  assert.equal(result.ok, true);
  assert.equal(result.data.request.status, 'pending');
  assert.equal(result.data.request.quantity, 2.5);
  const insert = harness.calls.find((call) => call.sql.includes('insert into material_requests'));
  assert.deepEqual(insert.params.slice(0, 7), ['request-1', 'user-1', '425 混凝土', 2.5, '袋', '实验室地面修补', 'pending']);
  assert.equal(harness.audits[0][0], 'create_material_request');
  assert.equal(JSON.stringify(harness.audits[0][1]).includes('425 混凝土'), false);
});

test('material request rejects missing unit and invalid quantity', async () => {
  const harness = createHarness();
  const invalidQuantity = await harness.service.createMaterialRequest({ item_name: '水泥', quantity: '0', unit: '袋' }, 'user-token');
  assert.equal(invalidQuantity.ok, false);
  assert.equal(invalidQuantity.status, 400);
  await assert.rejects(() => harness.service.createMaterialRequest({ item_name: '水泥', quantity: 1, unit: '' }, 'user-token'));
});

test('user can only cancel their pending material request', async () => {
  const harness = createHarness();
  const result = await harness.service.cancelMaterialRequest({ id: 'request-1' }, 'user-token');
  assert.equal(result.ok, true);
  assert.ok(harness.calls.some((call) => call.sql.includes('update material_requests set status')));

  const otherHarness = createHarness({ row: { id: 'request-1', user_id: 'other-user', status: 'pending' } });
  const forbidden = await otherHarness.service.cancelMaterialRequest({ id: 'request-1' }, 'user-token');
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.status, 403);
});

test('administrator approves then fulfills a request, notifying its owner without recording material content in audit', async () => {
  const approveHarness = createHarness();
  const approved = await approveHarness.service.adminReviewMaterialRequest({ id: 'request-1', status: 'approved', admin_note: '按库存准备' }, 'admin-token');
  assert.equal(approved.ok, true);
  assert.equal(approveHarness.notifications.length, 1);
  assert.equal(approveHarness.notifications[0].user_id, 'user-1');
  assert.equal(approveHarness.audits[0][0], 'review_material_request');
  assert.equal(JSON.stringify(approveHarness.audits[0][1]).includes('水泥'), false);

  const fulfilledHarness = createHarness({ row: { id: 'request-1', user_id: 'user-1', status: 'approved' } });
  const fulfilled = await fulfilledHarness.service.adminReviewMaterialRequest({ id: 'request-1', status: 'fulfilled' }, 'admin-token');
  assert.equal(fulfilled.ok, true);
  const update = fulfilledHarness.calls.find((call) => call.sql.includes('update material_requests'));
  assert.equal(update.params[0], 'fulfilled');

  const invalidHarness = createHarness();
  const invalid = await invalidHarness.service.adminReviewMaterialRequest({ id: 'request-1', status: 'fulfilled' }, 'admin-token');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 409);
});

test('list exposes only the authenticated user query and normalizes quantity', async () => {
  const harness = createHarness();
  const result = await harness.service.listMyMaterialRequests({}, 'user-token');
  assert.equal(result.ok, true);
  assert.equal(result.data.requests[0].quantity, 2.5);
  const select = harness.calls.find((call) => call.sql.startsWith('select id, user_id'));
  assert.deepEqual(select.params, ['user-1']);
});
