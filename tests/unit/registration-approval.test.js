const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthService } = require('../../src/services/domains/auth/auth-service');
const { createRegistrationApprovalCodeService } = require('../../src/services/domains/auth/registration-approval-code');
const crypto = require('node:crypto');
const { assertPassword, assertPhone, assertText } = require('../../src/services/core/validation');
const { fail, ok } = require('../../src/services/core/service-utils');

const PAYLOAD = {
  name: '演示注册用户',
  student_no: 'DEMO-STUDENT-001',
  phone: '13900000099',
  major: '演示专业',
  mentor_name: '演示导师',
  password: 'safe-password-value',
  approval_code: '7ADEMOCODE'
};

function createHarness(options = {}) {
  const queries = [];
  const events = [];
  const finalizeCalls = [];
  const hashCalls = [];
  const service = createAuthService({
    assertPassword,
    assertPhone,
    assertText,
    fail,
    finalizeUserLogin: async (user, context) => {
      finalizeCalls.push({ user, context });
      return ok({ token: 'test-token', user, role: 'user', permissions: [] });
    },
    hashPassword: async (password, salt) => {
      hashCalls.push({ password, salt });
      return 'stored-hash';
    },
    needsPasswordRehash: () => false,
    nowIso: () => '2026-07-28T04:00:00.000Z',
    ok,
    query: async (sql, params) => {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim().toLowerCase(), params });
      const status = options.approvalCodeAccepted ? 'active' : 'pending';
      return [{
        id: 'new-user-1',
        name: PAYLOAD.name,
        phone: PAYLOAD.phone,
        student_no: PAYLOAD.student_no,
        major: PAYLOAD.major,
        mentor_name: PAYLOAD.mentor_name,
        password_hash: 'stored-hash',
        password_salt: 'ab'.repeat(16),
        password_reset_required: false,
        role: 'user',
        status
      }];
    },
    queryOne: async () => options.duplicate || null,
    randomBytes: (size) => {
      assert.equal(size, 16);
      return Buffer.alloc(size, 0xab);
    },
    recordUserEvent: async (event) => events.push(event),
    uuid: () => 'new-user-1',
    verifyRegistrationApprovalCode: (value, verificationOptions = {}) => {
      assert.equal(value, PAYLOAD.approval_code);
      assert.equal(verificationOptions.lock, true);
      assert.equal(typeof verificationOptions.query, 'function');
      return Boolean(options.approvalCodeAccepted);
    }
  });
  return { service, queries, events, finalizeCalls, hashCalls };
}

test('valid approval code creates an active ordinary user without granting administrator privileges', async () => {
  const harness = createHarness({ approvalCodeAccepted: true });
  const result = await harness.service.registerUser(PAYLOAD, { ip: 'test-ip' });

  assert.equal(result.ok, true);
  assert.equal(result.user.role, 'user');
  assert.equal(result.user.status, 'active');
  assert.equal(harness.finalizeCalls.length, 1);
  assert.equal(harness.queries.length, 1);
  assert.match(harness.queries[0].sql, /insert into users/);
  assert.match(harness.queries[0].sql, /major, mentor_name/);
  assert.equal(harness.events[0].remark, 'approval_code_accepted');
  assert.equal(JSON.stringify(harness.events).includes(PAYLOAD.approval_code), false);
  assert.deepEqual(harness.hashCalls, [{
    password: PAYLOAD.password,
    salt: 'ab'.repeat(16)
  }]);
});

test('missing or invalid approval code creates a pending ordinary user for manual review', async () => {
  const harness = createHarness({ approvalCodeAccepted: false });
  const result = await harness.service.registerUser({ ...PAYLOAD, approval_code: '' }, {});

  assert.equal(result.ok, true);
  assert.equal(result.need_review, true);
  assert.equal(result.status, 'pending');
  assert.equal(harness.finalizeCalls.length, 0);
  assert.equal(harness.events[0].remark, 'pending_review');
});

test('registration rejects duplicate identifiers and passwords shorter than 12 characters', async () => {
  const duplicate = createHarness({ duplicate: { phone: PAYLOAD.phone } });
  const duplicateResult = await duplicate.service.registerUser(PAYLOAD, {});
  assert.equal(duplicateResult.ok, false);
  assert.equal(duplicateResult.status, 409);
  assert.equal(duplicate.queries.length, 0);

  const short = createHarness();
  const shortResult = await short.service.registerUser({ ...PAYLOAD, password: 'x'.repeat(11) }, {});
  assert.equal(shortResult.ok, false);
  assert.equal(shortResult.status, 400);
  assert.equal(short.queries.length, 0);
});

test('registration approval code is mixed, rotates on schedule and accepts the immediately previous window', () => {
  const codes = createRegistrationApprovalCodeService({
    crypto,
    secret: 'test-secret-that-is-long-enough-for-deterministic-tests',
    windowMs: 300_000
  });
  const firstTime = Date.parse('2026-07-28T04:00:00.000Z');
  const first = codes.get(firstTime);
  const next = codes.get(firstTime + 300_000);

  assert.match(first.code, /^\d[A-Z][0-9A-Z]{10}$/);
  assert.notEqual(first.code, next.code);
  assert.equal(codes.verify(first.code.toLowerCase(), firstTime), true);
  assert.equal(codes.verify(first.code, firstTime + 300_000), true);
  assert.equal(codes.verify(first.code, firstTime + 600_000), false);
});

test('registration approval code rotates every minute by default', () => {
  const codes = createRegistrationApprovalCodeService({
    crypto,
    secret: 'test-secret-that-is-long-enough-for-deterministic-tests'
  });
  const firstTime = Date.parse('2026-07-28T04:00:00.000Z');
  const first = codes.get(firstTime);
  const sameWindow = codes.get(firstTime + 59_999);
  const nextWindow = codes.get(firstTime + 60_000);

  assert.equal(first.code, sameWindow.code);
  assert.notEqual(first.code, nextWindow.code);
  assert.equal(first.refresh_seconds, 60);
  assert.equal(first.expires_at, '2026-07-28T04:01:00.000Z');
});

test('changing generation immediately creates a new code and invalidates the old generation', () => {
  const options = {
    crypto,
    secret: 'test-secret-that-is-long-enough-for-deterministic-tests'
  };
  const previousGeneration = createRegistrationApprovalCodeService({
    ...options,
    generation: 7
  });
  const currentGeneration = createRegistrationApprovalCodeService({
    ...options,
    generation: 8
  });
  const now = Date.parse('2026-07-28T04:00:30.000Z');
  const previous = previousGeneration.get(now);
  const current = currentGeneration.get(now);

  assert.notEqual(previous.code, current.code);
  assert.equal(previousGeneration.verify(previous.code, now), true);
  assert.equal(currentGeneration.verify(current.code, now), true);
  assert.equal(currentGeneration.verify(previous.code, now), false);
});

test('registration approval code metadata includes ttl_minutes and generation', () => {
  const codes = createRegistrationApprovalCodeService({
    crypto,
    secret: 'test-secret-that-is-long-enough-for-deterministic-tests',
    windowMs: 15 * 60_000,
    generation: 3
  });

  const result = codes.get(Date.parse('2026-07-28T04:00:00.000Z'));

  assert.equal(result.ttl_minutes, 15);
  assert.equal(result.generation, 3);
});
