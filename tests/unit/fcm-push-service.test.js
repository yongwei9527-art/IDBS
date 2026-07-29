const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createFcmPushService } = require('../../src/services/domains/notifications/fcm-push-service');

const deviceToken = `fcm-test-${'a'.repeat(120)}`;
const user = { id: '00000000-0000-4000-8000-000000000001' };

function response(ok, payload) {
  return { ok, json: async () => payload };
}

function harness({ configured = false } = {}) {
  const calls = [];
  const updates = [];
  let storedDevice = null;
  let fcmRequest = null;
  let fetchCalls = 0;
  const keys = configured ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }) : null;
  const account = configured ? JSON.stringify({
    client_email: 'push-test@example.iam.gserviceaccount.com',
    project_id: 'push-test-project',
    private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
  }) : '';
  const service = createFcmPushService({
    crypto,
    tokenSecret: 'unit-test-token-secret',
    fcmServiceAccountJson: account,
    fetchImpl: async (url, init) => {
      fetchCalls += 1;
      if (String(url).includes('oauth2.googleapis.com')) return response(true, { access_token: 'test-access-token', expires_in: 3600 });
      fcmRequest = { url, init };
      return response(true, { name: 'projects/push-test-project/messages/test-message' });
    },
    query: async (sql, params = []) => {
      const text = String(sql);
      calls.push({ text, params });
      if (text.includes('insert into user_push_devices')) {
        storedDevice = { id: params[0], user_id: params[1], token_hash: params[3], token_ciphertext: params[4] };
        return [];
      }
      if (text.includes('select id, token_ciphertext from user_push_devices')) return storedDevice ? [storedDevice] : [];
      if (text.includes('select count(*)')) return [{ active_device_count: storedDevice ? 1 : 0 }];
      if (text.includes('update user_push_devices')) updates.push(params);
      return [];
    },
    requireUser: async () => user,
    ok: (data) => ({ ok: true, data }),
    fail: (message, status, code) => ({ ok: false, message, status, code }),
    uuid: () => '00000000-0000-4000-8000-000000000002'
  });
  return { calls, fcmRequest: () => fcmRequest, fetchCalls: () => fetchCalls, service, updates };
}

test('push registration encrypts device tokens and never returns them', async () => {
  const ctx = harness();
  const result = await ctx.service.registerPushDevice({ token: deviceToken, platform: 'android' }, {});

  assert.deepEqual(result, { ok: true, data: { registered: true, platform: 'android' } });
  const insert = ctx.calls.find(({ text }) => text.includes('insert into user_push_devices'));
  assert.ok(insert);
  assert.notEqual(insert.params[3], crypto.createHash('sha256').update(deviceToken).digest('hex'));
  assert.notEqual(insert.params[4], deviceToken);
  assert.equal(insert.params[4].startsWith('v1.'), true);
  assert.equal(JSON.stringify(result).includes(deviceToken), false);
});

test('unconfigured FCM safely skips delivery without calling the network', async () => {
  const ctx = harness();
  const result = await ctx.service.sendPushMessage({ userIds: [user.id], route: '/chat' });
  assert.deepEqual(result, { attempted: 0, delivered: 0, skipped: true });
  assert.equal(ctx.fetchCalls(), 0);
});

test('FCM payload is generic and excludes chat and identity data', async () => {
  const ctx = harness({ configured: true });
  await ctx.service.registerPushDevice({ token: deviceToken, platform: 'android' }, {});
  const result = await ctx.service.sendPushMessage({ userIds: [user.id], route: '/chat' });

  assert.deepEqual(result, { attempted: 1, delivered: 1, skipped: false });
  const payload = JSON.parse(ctx.fcmRequest().init.body).message;
  assert.deepEqual(payload.notification, { title: '新消息提醒', body: '您收到一条新消息' });
  assert.deepEqual(payload.data, { route: '/chat' });
  const visiblePayload = JSON.stringify({ notification: payload.notification, data: payload.data });
  for (const forbidden of ['hello', 'Sender', '13800000000', 'password', 'cookie', 'jwt', deviceToken]) {
    assert.equal(visiblePayload.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
});