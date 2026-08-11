const test = require('node:test');
const assert = require('node:assert/strict');
const { createUserService } = require('../../src/services/domains/users/user-service');

function baseContext(overrides = {}) {
  return {
    assertText(value) { const result = String(value || '').trim(); if (!result) throw new Error('required'); return result; },
    fail: (message, status = 400, code) => ({ ok: false, message, status, code }),
    ok: (data = {}) => ({ ok: true, ...data }),
    nowIso: () => '2026-08-01T00:00:00.000Z',
    query: async () => [],
    queryOne: async () => null,
    uuid: () => '00000000-0000-4000-8000-000000000001',
    randomBytes: (size) => Buffer.alloc(size, 7),
    hashPassword: async () => 'a'.repeat(128),
    requireAdminRole: async () => ({ admin: { id: 'admin-1', role: 'super_admin', name: 'Root' }, role: { role_key: 'super_admin', permissions: ['*'] } }),
    withTransaction: async (work) => work({ query: async () => ({ rows: [], rowCount: 0 }) }),
    createUserNotification: async () => true,
    log: async () => {},
    ...overrides
  };
}

test('public recovery request returns the same generic response for unknown accounts', async () => {
  const calls = [];
  const service = createUserService(baseContext({ query: async (sql, params) => { calls.push({ sql, params }); return []; } }));
  const result = await service.submitPasswordResetRequest({ phone: '13800000000', name: '张三', student_no: 'S1', mentor_name: '李老师' });
  assert.equal(result.ok, true);
  assert.match(result.message, /申请已提交/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /insert into password_reset_requests/i);
  assert.match(calls[0].sql, /select .* from users/si);
});

test('known account creates or refreshes one pending recovery request', async () => {
  const calls = [];
  const service = createUserService(baseContext({
    queryOne: async () => ({ id: 'user-1', role: 'user' }),
    query: async (sql, params) => { calls.push({ sql, params }); return []; }
  }));
  const result = await service.submitPasswordResetRequest({ phone: '13800000000', name: '张三', student_no: 'S1', major: '化学', mentor_name: '李老师', reason: '忘记密码' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /on conflict \(user_id\)/i);
  assert.equal(calls[0].params.includes('忘记密码'), true);
  assert.match(calls[0].sql, /expires_at=excluded\.expires_at/i);
  assert.match(calls[0].sql, /role <> 'super_admin'/i);
  assert.match(calls[0].sql, /permissions, '\[\]'::jsonb\) \? '\*'/i);
});

test('persistence failures keep the public recovery response generic', async () => {
  const originalError = console.error;
  const diagnostics = [];
  console.error = (...args) => diagnostics.push(args.join(' '));
  try {
    const service = createUserService(baseContext({ query: async () => { const error = new Error('sensitive database detail'); error.code = '42P01'; throw error; } }));
    const result = await service.submitPasswordResetRequest({ phone: '13800000000', name: '张三', student_no: 'S1', mentor_name: '李老师' });
    assert.equal(result.ok, true);
    assert.match(result.message, /申请已提交/);
    assert.equal(JSON.stringify(result).includes('database'), false);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].includes('sensitive'), false);
  } finally {
    console.error = originalError;
  }
});

test('highest administrator approval resets atomically and returns password only to caller', async () => {
  const sqlCalls = [];
  const auditDetails = [];
  const client = {
    async query(sql, params = []) {
      sqlCalls.push({ sql, params });
      if (/select \* from password_reset_requests/i.test(sql)) return { rows: [{ id: 'req-1', user_id: 'user-1', status: 'pending' }], rowCount: 1 };
      if (/select u\.\*.*from users/si.test(sql)) return { rows: [{ id: 'user-1', role: 'user', name: '张三' }], rowCount: 1 };
      if (/update refresh_token_sessions/i.test(sql)) return { rows: [], rowCount: 2 };
      return { rows: [], rowCount: 1 };
    }
  };
  const service = createUserService(baseContext({
    withTransaction: async (work) => work(client),
    createUserNotification: async (_payload, runQuery) => runQuery('insert into user_notifications values (1)'),
    log: async (_action, detail) => { auditDetails.push(detail); }
  }));
  const result = await service.adminReviewPasswordResetRequest({ request_id: 'req-1', approved: true }, {});
  assert.equal(result.ok, true);
  assert.match(result.temporary_password, /^\d{12}$/);
  assert.equal(result.password_reset_required, true);
  assert.equal(result.refresh_sessions_revoked, 2);
  assert.equal(sqlCalls.some(({ sql }) => /password_reset_required=true/i.test(sql)), true);
  assert.equal(JSON.stringify(auditDetails).includes(result.temporary_password), false);
});

test('wildcard-permission administrator targets are automatically rejected without a password change', async () => {
  const sqlCalls = [];
  const client = {
    async query(sql, params = []) {
      sqlCalls.push({ sql, params });
      if (/select \* from password_reset_requests/i.test(sql)) return { rows: [{ id: 'req-1', user_id: 'admin-2', status: 'pending', expires_at: '2026-08-08T00:00:00.000Z' }], rowCount: 1 };
      if (/select u\.\*.*from users/si.test(sql)) return { rows: [{ id: 'admin-2', role: 'admin', assigned_role_key: 'admin', assigned_permissions: ['*'] }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }
  };
  const service = createUserService(baseContext({ withTransaction: async (work) => work(client) }));
  const result = await service.adminReviewPasswordResetRequest({ request_id: 'req-1', approved: true }, {});
  assert.equal(result.ok, true);
  assert.equal(result.status, 'rejected');
  assert.equal(result.temporary_password, undefined);
  assert.equal(sqlCalls.some(({ sql }) => /update users\s+set password_hash/i.test(sql)), false);
});

test('expired recovery requests cannot change a password', async () => {
  const sqlCalls = [];
  const client = {
    async query(sql, params = []) {
      sqlCalls.push({ sql, params });
      if (/select \* from password_reset_requests/i.test(sql)) return { rows: [{ id: 'req-1', user_id: 'user-1', status: 'pending', expires_at: '2026-07-31T23:59:59.000Z' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }
  };
  const service = createUserService(baseContext({ withTransaction: async (work) => work(client) }));
  const result = await service.adminReviewPasswordResetRequest({ request_id: 'req-1', approved: true }, {});
  assert.equal(result.ok, true);
  assert.equal(result.status, 'expired');
  assert.equal(result.temporary_password, undefined);
  assert.equal(sqlCalls.some(({ sql }) => /update users/i.test(sql)), false);
});

test('public and review routes remain separated by highest-admin guards', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const authRoute = fs.readFileSync(path.resolve(__dirname, '../../src/routes/v5/auth.js'), 'utf8');
  const adminRoute = fs.readFileSync(path.resolve(__dirname, '../../src/routes/v5/admin.js'), 'utf8');
  assert.match(authRoute, /auth\/password-reset\/request/);
  assert.match(adminRoute, /password-reset-requests', requireRole\('super_admin'\)/);
  assert.match(adminRoute, /password-reset-requests\/:id\/review', requireRole\('super_admin'\)/);
  assert.match(adminRoute, /password-reset-requests[\s\S]+Cache-Control', 'private, no-store'/);
  const createApp = fs.readFileSync(path.resolve(__dirname, '../../src/app/create-app.js'), 'utf8');
  assert.match(createApp, /password-reset-ip/);
  assert.match(createApp, /password-reset-account/);
  assert.match(createApp, /password-reset-pair-ip/);
});
