const test = require('node:test');
const assert = require('node:assert/strict');
const { createUserService } = require('../../src/services/domains/users/user-service');
const { assertText } = require('../../src/services/core/validation');
const { fail, ok } = require('../../src/services/core/service-utils');

const FIXED_NOW = '2026-07-27T03:00:00.000Z';
const FIXED_EXPIRY = '2026-07-28T03:00:00.000Z';
const GENERATED_TEMPORARY_PASSWORD = '1'.repeat(12);

function createHarness(options = {}) {
  const operatorRole = options.operatorRole || 'super_admin';
  const operatorId = options.operatorId || 'operator-1';
  const operatorPermissions = options.operatorPermissions || (operatorRole === 'super_admin' ? ['*'] : ['user.manage']);
  const targetRole = options.targetRole || 'user';
  const assignedAdminRole = options.assignedAdminRole || null;
  const statements = [];
  const auditCalls = [];
  const hashCalls = [];
  const authCalls = [];
  let transactionCount = 0;

  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      statements.push({ sql: normalized, params });
      if (normalized.startsWith('update users')) return { rowCount: 1, rows: [] };
      if (normalized.startsWith('update refresh_token_sessions')) {
        return { rowCount: options.revokedSessions ?? 2, rows: [] };
      }
      throw new Error(`Unexpected SQL in password reset test: ${normalized}`);
    }
  };

  const service = createUserService({
    assertText,
    fail,
    getById: async (table, id) => table === 'users' && id === 'user-1'
      ? { id, role: targetRole, status: 'active' }
      : null,
    hashPassword: async (password, salt) => {
      hashCalls.push({ password, salt });
      return 'hashed-value';
    },
    log: async (...args) => auditCalls.push(args),
    nowIso: () => FIXED_NOW,
    ok,
    queryOne: async (sql, params) => {
      assert.match(String(sql), /from admin_roles/i);
      assert.deepEqual(params, ['user-1']);
      return assignedAdminRole;
    },
    randomBytes: (size) => {
      assert.ok(size === 16 || size === 24);
      return Buffer.alloc(size, 0xab);
    },
    requireAdminRole: async (token, roles, permissions) => {
      authCalls.push({ token, roles, permissions });
      return {
        admin: { id: operatorId, role: operatorRole, permissions: operatorPermissions },
        role: { role_key: operatorRole, permissions: operatorPermissions }
      };
    },
    withTransaction: async (work) => {
      transactionCount += 1;
      return work(client);
    }
  });

  return {
    service,
    statements,
    auditCalls,
    hashCalls,
    authCalls,
    get transactionCount() { return transactionCount; }
  };
}

test('highest-privilege administrator gets a random 12-digit temporary password and revokes sessions atomically', async () => {
  const harness = createHarness({ revokedSessions: 3 });
  const result = await harness.service.adminResetUserPassword({
    user_id: 'user-1'
  }, 'operator-token');

  assert.equal(result.ok, true);
  assert.equal(result.temporary_password, GENERATED_TEMPORARY_PASSWORD);
  assert.match(result.temporary_password, /^\d{12}$/);
  assert.equal(result.temporary_password_expires_at, FIXED_EXPIRY);
  assert.equal(result.password_reset_required, true);
  assert.equal(result.refresh_sessions_revoked, 3);
  assert.equal(result.access_token_max_minutes, 15);
  assert.deepEqual(harness.authCalls, [{
    token: 'operator-token',
    roles: ['super_admin'],
    permissions: ['*']
  }]);
  assert.equal(harness.transactionCount, 1);
  assert.deepEqual(harness.hashCalls, [{
    password: GENERATED_TEMPORARY_PASSWORD,
    salt: 'ab'.repeat(16)
  }]);

  assert.equal(harness.statements.length, 2);
  assert.match(harness.statements[0].sql, /set password_hash = \$1, password_salt = \$2/);
  assert.match(harness.statements[0].sql, /password_reset_required = true/);
  assert.match(harness.statements[0].sql, /temporary_password_expires_at = \$3/);
  assert.match(harness.statements[0].sql, /role <> 'super_admin'/);
  assert.match(harness.statements[0].sql, /not exists/);
  assert.match(harness.statements[0].sql, /permissions \? '\*'/);
  assert.deepEqual(harness.statements[0].params, ['hashed-value', 'ab'.repeat(16), FIXED_EXPIRY, FIXED_NOW, 'user-1']);
  assert.match(harness.statements[1].sql, /update refresh_token_sessions/);
  assert.match(harness.statements[1].sql, /where subject = \$2 and revoked_at is null/);
  assert.deepEqual(harness.statements[1].params, [FIXED_NOW, 'user-1']);

  assert.equal(harness.auditCalls.length, 1);
  const [action, detail, operator, deviceId, recordId, txQuery] = harness.auditCalls[0];
  assert.equal(action, 'reset_user_password');
  assert.equal(detail.refresh_sessions_revoked, 3);
  assert.equal(detail.access_token_max_minutes, 15);
  assert.equal(JSON.stringify(detail).includes(GENERATED_TEMPORARY_PASSWORD), false);
  assert.equal(operator.id, 'operator-1');
  assert.equal(deviceId, null);
  assert.equal(recordId, 'user-1');
  assert.equal(typeof txQuery, 'function');
});

test('ordinary administrator cannot reset a user password', async () => {
  const harness = createHarness({ operatorRole: 'admin', operatorPermissions: ['user.manage'] });
  const result = await harness.service.adminResetUserPassword({
    user_id: 'user-1'
  }, 'operator-token');

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(harness.transactionCount, 0);
  assert.equal(harness.hashCalls.length, 0);
});

test('highest-privilege administrator can reset ordinary administrator passwords', async () => {
  for (const options of [
    { targetRole: 'admin' },
    { targetRole: 'user', assignedAdminRole: { role_key: 'admin', permissions: ['user.manage'] } }
  ]) {
    const harness = createHarness(options);
    const result = await harness.service.adminResetUserPassword({
      user_id: 'user-1'
    }, 'operator-token');
    assert.equal(result.ok, true);
    assert.equal(harness.transactionCount, 1);
    assert.equal(harness.hashCalls.length, 1);
  }
});

test('self and highest-privilege administrator targets are rejected', async () => {
  for (const options of [
    { targetRole: 'super_admin' },
    { targetRole: 'user', assignedAdminRole: { role_key: 'super_admin', permissions: ['*'] } },
    { targetRole: 'admin', assignedAdminRole: { role_key: 'admin', permissions: ['*'] } },
    { targetRole: 'admin', operatorId: 'user-1' }
  ]) {
    const harness = createHarness(options);
    const result = await harness.service.adminResetUserPassword({
      user_id: 'user-1'
    }, 'operator-token');
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(harness.transactionCount, 0);
    assert.equal(harness.hashCalls.length, 0);
  }
});
test('temporary password is only returned to the caller and never written to audit detail', async () => {
  const harness = createHarness();
  const result = await harness.service.adminResetUserPassword({ user_id: 'user-1' }, 'operator-token');
  assert.equal(result.temporary_password, GENERATED_TEMPORARY_PASSWORD);
  assert.equal(harness.auditCalls.length, 1);
  assert.equal(JSON.stringify(harness.auditCalls[0]).includes(GENERATED_TEMPORARY_PASSWORD), false);
});

function createCompletionHarness(options = {}) {
  const statements = [];
  const hashCalls = [];
  const verifyCalls = [];
  const auditCalls = [];
  let transactionCount = 0;
  const lockedUser = {
    id: 'user-1',
    password_hash: 'temporary-hash',
    password_salt: 'temporary-salt',
    password_reset_required: true,
    temporary_password_expires_at: options.expiresAt || '2099-01-01T00:00:00.000Z'
  };
  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      statements.push({ sql: normalized, params });
      if (normalized.startsWith('select id, password_hash')) return { rows: [lockedUser], rowCount: 1 };
      if (normalized.startsWith('update users')) return { rows: [], rowCount: 1 };
      if (normalized.startsWith('update refresh_token_sessions')) return { rows: [], rowCount: 2 };
      throw new Error(`Unexpected SQL in required password completion test: ${normalized}`);
    }
  };
  const service = createUserService({
    assertText,
    fail,
    getRegistrationApprovalCode: () => ({ code: 'not-used' }),
    hashPassword: async (password, salt) => {
      hashCalls.push({ password, salt });
      return 'new-hash';
    },
    log: async (...args) => auditCalls.push(args),
    nowIso: () => FIXED_NOW,
    ok,
    randomBytes: (size) => {
      assert.equal(size, 16);
      return Buffer.alloc(size, 0xcd);
    },
    requireUser: async (token, settings) => {
      assert.equal(token, 'restricted-token');
      assert.deepEqual(settings, { allowPasswordReset: true });
      return { id: 'user-1', status: 'active', password_reset_required: true };
    },
    verifyPassword: async (password, salt, hash) => {
      verifyCalls.push({ password, salt, hash });
      return options.currentPasswordValid !== false;
    },
    withTransaction: async (work) => {
      transactionCount += 1;
      return work(client);
    }
  });
  return {
    service,
    statements,
    hashCalls,
    verifyCalls,
    auditCalls,
    get transactionCount() { return transactionCount; }
  };
}

test('required password completion verifies the temporary password, replaces the hash and revokes sessions', async () => {
  const harness = createCompletionHarness();
  const currentPassword = GENERATED_TEMPORARY_PASSWORD;
  const newPassword = 'new-password-value';
  const result = await harness.service.completeRequiredPasswordReset({
    current_password: currentPassword,
    new_password: newPassword
  }, 'restricted-token');

  assert.equal(result.ok, true);
  assert.equal(result.password_reset_required, false);
  assert.equal(harness.transactionCount, 1);
  assert.deepEqual(harness.verifyCalls, [{
    password: currentPassword,
    salt: 'temporary-salt',
    hash: 'temporary-hash'
  }]);
  assert.deepEqual(harness.hashCalls, [{
    password: newPassword,
    salt: 'cd'.repeat(16)
  }]);
  assert.match(harness.statements[1].sql, /password_reset_required = false/);
  assert.match(harness.statements[1].sql, /temporary_password_expires_at = null/);
  assert.match(harness.statements[2].sql, /update refresh_token_sessions/);
  assert.equal(JSON.stringify(harness.auditCalls).includes(currentPassword), false);
  assert.equal(JSON.stringify(harness.auditCalls).includes(newPassword), false);
});

test('required password completion rejects a wrong or expired temporary password', async () => {
  const wrong = createCompletionHarness({ currentPasswordValid: false });
  await assert.rejects(
    wrong.service.completeRequiredPasswordReset({
      current_password: GENERATED_TEMPORARY_PASSWORD,
      new_password: 'new-password-value'
    }, 'restricted-token'),
    (error) => error.status === 401
  );
  assert.equal(wrong.hashCalls.length, 0);

  const expired = createCompletionHarness({ expiresAt: '2020-01-01T00:00:00.000Z' });
  await assert.rejects(
    expired.service.completeRequiredPasswordReset({
      current_password: GENERATED_TEMPORARY_PASSWORD,
      new_password: 'new-password-value'
    }, 'restricted-token'),
    (error) => error.status === 401
  );
  assert.equal(expired.verifyCalls.length, 0);
});

test('required password completion enforces 12 to 128 characters and rejects reuse', async () => {
  for (const newPassword of ['short', 'x'.repeat(129), GENERATED_TEMPORARY_PASSWORD]) {
    const harness = createCompletionHarness();
    const result = await harness.service.completeRequiredPasswordReset({
      current_password: GENERATED_TEMPORARY_PASSWORD,
      new_password: newPassword
    }, 'restricted-token');
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(harness.transactionCount, 0);
  }
});
