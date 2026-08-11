const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createFcmPushService } = require('../../src/services/domains/notifications/fcm-push-service');

const TOKEN_SECRET = 'unit-test-fcm-token-secret-that-is-long-enough-2026';
const deviceToken = `fcm-test:${'a'.repeat(120)}`;
const user = { id: '00000000-0000-4000-8000-000000000001' };
const secondUser = { id: '00000000-0000-4000-8000-000000000003' };
const deviceId = '00000000-0000-4000-8000-000000000002';
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const accountObject = {
  type: 'service_account',
  client_email: 'push-test@example.iam.gserviceaccount.com',
  project_id: 'push-test-project',
  private_key: privateKeyPem
};

function response(ok, payload, status = ok ? 200 : 500) {
  return { ok, status, json: async () => payload };
}

function nextResult(queue, fallback, context) {
  const value = queue.length ? queue.shift() : fallback;
  if (typeof value === 'function') return value(context);
  if (value instanceof Error) throw value;
  return value;
}

function harness({
  configured = false,
  tokenSecret = TOKEN_SECRET,
  serviceAccount = configured ? accountObject : null,
  oauthResponses = [],
  messageResponses = [],
  onQuery,
  requestTimeoutMs,
  requireUser = async (auth) => auth?.user || user
} = {}) {
  const calls = [];
  const fetchRequests = [];
  const updates = [];
  let storedDevice = null;
  let oauthCount = 0;
  let messageCount = 0;

  async function defaultQuery(text, params) {
    if (text.includes('insert into user_push_devices')) {
      storedDevice = {
        id: params[0],
        user_id: params[1],
        token_hash: params[3],
        token_ciphertext: params[4]
      };
      return [];
    }
    if (text.includes('select id, token_ciphertext from user_push_devices')) return storedDevice ? [storedDevice] : [];
    if (text.includes('select count(*)')) return [{ active_device_count: storedDevice ? 1 : 0 }];
    if (text.includes('update user_push_devices')) updates.push({ text, params });
    return [];
  }

  const service = createFcmPushService({
    crypto,
    tokenSecret,
    fcmServiceAccountJson: serviceAccount ? JSON.stringify(serviceAccount) : '',
    fetchImpl: async (url, init) => {
      const request = { url: String(url), init };
      fetchRequests.push(request);
      if (request.url.includes('oauth2.googleapis.com')) {
        oauthCount += 1;
        return nextResult(oauthResponses, response(true, {
          access_token: `test-access-token-${oauthCount}`,
          expires_in: 3600
        }), request);
      }
      messageCount += 1;
      return nextResult(messageResponses, response(true, {
        name: `projects/push-test-project/messages/test-message-${messageCount}`
      }), request);
    },
    query: async (sql, params = []) => {
      const text = String(sql);
      calls.push({ text, params });
      if (onQuery) {
        const override = await onQuery({ text, params, storedDevice, defaultQuery });
        if (override !== undefined) return override;
      }
      return defaultQuery(text, params);
    },
    requireUser,
    ok: (data) => ({ ok: true, data }),
    fail: (message, status, code) => ({ ok: false, message, status, code }),
    uuid: () => deviceId,
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs })
  });

  return {
    calls,
    fetchRequests,
    oauthCount: () => oauthCount,
    messageCount: () => messageCount,
    service,
    storedDevice: () => storedDevice,
    updates
  };
}

async function registerAndSend(ctx, options = {}) {
  const registration = await ctx.service.registerPushDevice({ token: deviceToken, platform: 'android' }, { user });
  assert.equal(registration.ok, true);
  return ctx.service.sendPushMessage({ userIds: [user.id], route: '/chat', ...options });
}

function failureUpdate(ctx, code) {
  return ctx.updates.find(({ params }) => params[1] === code);
}

test('push registration encrypts tokens, binds the authenticated user, and atomically transfers duplicates', async () => {
  const ctx = harness();
  const first = await ctx.service.registerPushDevice({ token: deviceToken, platform: 'android' }, { user });
  const second = await ctx.service.registerPushDevice({ token: deviceToken }, { user: secondUser });

  assert.deepEqual(first, { ok: true, data: { registered: true, platform: 'android' } });
  assert.deepEqual(second, first);
  const inserts = ctx.calls.filter(({ text }) => text.includes('insert into user_push_devices'));
  assert.equal(inserts.length, 2);
  assert.match(inserts[1].text, /on conflict \(token_hash\).*user_id = excluded\.user_id/s);
  assert.equal(inserts[0].params[1], user.id);
  assert.equal(inserts[1].params[1], secondUser.id);
  assert.equal(ctx.storedDevice().user_id, secondUser.id);
  assert.notEqual(inserts[0].params[3], crypto.createHash('sha256').update(deviceToken).digest('hex'));
  assert.notEqual(inserts[0].params[4], deviceToken);
  assert.equal(inserts[0].params[4].startsWith('v1.'), true);
  assert.equal(inserts.flatMap(({ params }) => params).includes(deviceToken), false);
  assert.equal(JSON.stringify([first, second]).includes(deviceToken), false);
});

test('unregister is idempotent, owner-scoped, and does not disclose token ownership', async () => {
  const ctx = harness();
  await ctx.service.registerPushDevice({ token: deviceToken }, { user: secondUser });
  const result = await ctx.service.unregisterPushDevice({ token: deviceToken }, { user });

  assert.deepEqual(result, { ok: true, data: { revoked: true } });
  const revoke = ctx.updates.find(({ text }) => text.includes("status = 'revoked'"));
  assert.ok(revoke);
  assert.match(revoke.text, /where user_id = \$1 and token_hash = \$2 and status = \$3/);
  assert.equal(revoke.params[0], user.id);
  assert.equal(revoke.params.includes(deviceToken), false);
});

test('invalid tokens, platforms, and authenticated user ids are rejected before database access', async () => {
  const ctx = harness();
  const invalidTokens = [
    null,
    {},
    'a'.repeat(31),
    `${deviceToken} `,
    `${deviceToken}\n`,
    `令${'a'.repeat(40)}`,
    'a'.repeat(4097)
  ];
  for (const token of invalidTokens) {
    const result = await ctx.service.registerPushDevice({ token }, { user });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(JSON.stringify(result).includes(String(token)), false);
  }
  assert.equal((await ctx.service.registerPushDevice({ token: deviceToken, platform: 'ios' }, { user })).ok, false);
  assert.equal((await ctx.service.registerPushDevice({ token: deviceToken }, { user: { id: 'not-a-uuid' } })).ok, false);
  assert.equal(ctx.calls.length, 0);
});

test('an invalid token secret fails closed without a fixed fallback key', async () => {
  const ctx = harness({ configured: true, tokenSecret: 'change-me-please' });

  assert.equal(ctx.service.isConfigured(), false);
  const registration = await ctx.service.registerPushDevice({ token: deviceToken }, { user });
  const removal = await ctx.service.unregisterPushDevice({ token: deviceToken }, { user });
  const delivery = await ctx.service.sendPushMessage({ userIds: [user.id] });

  assert.deepEqual(registration, { ok: false, message: 'Push notifications are unavailable.', status: 503, code: 5000 });
  assert.deepEqual(removal, registration);
  assert.deepEqual(delivery, { attempted: 0, delivered: 0, skipped: true });
  assert.equal(ctx.calls.length, 0);
  assert.equal(ctx.fetchRequests.length, 0);
});

test('unconfigured or malformed FCM credentials safely skip network delivery', async () => {
  for (const serviceAccount of [null, { ...accountObject, private_key: 'not-a-private-key' }]) {
    const ctx = harness({ configured: true, serviceAccount });
    const result = await ctx.service.sendPushMessage({ userIds: [user.id], route: '/chat' });
    assert.deepEqual(result, { attempted: 0, delivered: 0, skipped: true });
    assert.equal(ctx.fetchRequests.length, 0);
  }
});

test('OAuth JWT is RS256 signed with bounded claims and access tokens are cached across concurrent sends', async () => {
  let releaseAuthorization;
  const authorizationGate = new Promise((resolve) => { releaseAuthorization = resolve; });
  const ctx = harness({
    configured: true,
    oauthResponses: [async () => {
      await authorizationGate;
      return response(true, { access_token: 'cached-access-token', expires_in: 3600 });
    }]
  });
  await ctx.service.registerPushDevice({ token: deviceToken }, { user });

  const first = ctx.service.sendPushMessage({ userIds: [user.id] });
  const second = ctx.service.sendPushMessage({ userIds: [user.id, user.id] });
  releaseAuthorization();
  const results = await Promise.all([first, second]);
  const third = await ctx.service.sendPushMessage({ userIds: [user.id] });

  assert.equal(ctx.oauthCount(), 1);
  assert.equal(ctx.messageCount(), 3);
  assert.ok([...results, third].every((result) => result.delivered === 1));

  const oauthRequest = ctx.fetchRequests.find(({ url }) => url.includes('oauth2.googleapis.com'));
  const params = new URLSearchParams(oauthRequest.init.body);
  assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const assertion = params.get('assertion');
  const [encodedHeader, encodedClaims, encodedSignature] = assertion.split('.');
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8'));
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
  assert.equal(claims.iss, accountObject.client_email);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    keys.publicKey,
    Buffer.from(encodedSignature, 'base64url')
  ), true);
  assert.equal(assertion.includes('PRIVATE KEY'), false);
});

test('FCM payload is generic, uses an allowlisted route, and excludes chat and identity data', async () => {
  const ctx = harness({ configured: true });
  const ids = Array.from({ length: 520 }, (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  await ctx.service.registerPushDevice({ token: deviceToken }, { user });
  const result = await ctx.service.sendPushMessage({
    userIds: ['invalid-user', user.id, user.id, ...ids],
    route: 'https://evil.example/steal?token=secret'
  });

  assert.deepEqual(result, { attempted: 1, delivered: 1, skipped: false });
  const selection = ctx.calls.find(({ text }) => text.includes('select id, token_ciphertext'));
  assert.equal(selection.params[0].length, 500);
  assert.equal(new Set(selection.params[0]).size, 500);
  assert.ok(selection.params[0].every((id) => /^[0-9a-f-]{36}$/.test(id)));

  const messageRequest = ctx.fetchRequests.find(({ url }) => url.includes('fcm.googleapis.com'));
  const payload = JSON.parse(messageRequest.init.body).message;
  assert.deepEqual(payload.notification, { title: '新消息提醒', body: '您收到一条新消息' });
  assert.deepEqual(payload.data, { route: '/chat' });
  const visiblePayload = JSON.stringify({ notification: payload.notification, data: payload.data });
  for (const forbidden of ['hello', 'Sender', '13800000000', 'password', 'cookie', 'jwt', deviceToken, 'evil.example']) {
    assert.equal(visiblePayload.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
  const successUpdate = ctx.updates.find(({ text }) => text.includes('failure_count = 0'));
  assert.ok(successUpdate);
  assert.deepEqual(successUpdate.params, [deviceId, 'active']);
});

test('corrupt encrypted tokens are invalidated locally and are never sent to FCM', async () => {
  const ctx = harness({
    configured: true,
    onQuery: async ({ text }) => {
      if (text.includes('select id, token_ciphertext')) {
        return [{ id: deviceId, token_ciphertext: 'v1.invalid.invalid.invalid.extra' }];
      }
      return undefined;
    }
  });
  const result = await ctx.service.sendPushMessage({ userIds: [user.id] });

  assert.deepEqual(result, { attempted: 1, delivered: 0, skipped: false });
  assert.equal(ctx.messageCount(), 0);
  assert.deepEqual(
    failureUpdate(ctx, 'token_decryption_failed').params,
    [deviceId, 'token_decryption_failed', true, 'active']
  );
});

test('UNREGISTERED and typed INVALID_ARGUMENT invalidate devices without persisting provider messages', async (t) => {
  const cases = [
    {
      name: 'UNREGISTERED detail',
      status: 404,
      payload: {
        error: {
          status: 'NOT_FOUND',
          message: `provider echoed ${deviceToken} and ${privateKeyPem}`,
          details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }]
        }
      },
      code: 'unregistered'
    },
    {
      name: 'top-level UNREGISTERED',
      status: 404,
      payload: { error: { status: 'UNREGISTERED' } },
      code: 'unregistered'
    },
    {
      name: 'typed INVALID_ARGUMENT',
      status: 400,
      payload: {
        error: {
          status: 'INVALID_ARGUMENT',
          details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'INVALID_ARGUMENT' }]
        }
      },
      code: 'invalid_argument'
    }
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const ctx = harness({ configured: true, messageResponses: [response(false, item.payload, item.status)] });
      const result = await registerAndSend(ctx);
      assert.deepEqual(result, { attempted: 1, delivered: 0, skipped: false });
      const update = failureUpdate(ctx, item.code);
      assert.ok(update);
      assert.deepEqual(update.params, [deviceId, item.code, true, 'active']);
      const stored = JSON.stringify(update);
      assert.equal(stored.includes(deviceToken), false);
      assert.equal(stored.includes(privateKeyPem), false);
    });
  }
});

test('top-level INVALID_ARGUMENT does not invalidate a token without a typed FCM token error', async () => {
  const ctx = harness({
    configured: true,
    messageResponses: [response(false, { error: { status: 'INVALID_ARGUMENT', message: deviceToken } }, 400)]
  });
  const result = await registerAndSend(ctx);

  assert.deepEqual(result, { attempted: 1, delivered: 0, skipped: false });
  assert.deepEqual(failureUpdate(ctx, 'delivery_failed').params, [deviceId, 'delivery_failed', false, 'active']);
});

test('temporary FCM failures are counted while devices remain active', async (t) => {
  for (const item of [
    { status: 429, providerStatus: 'RESOURCE_EXHAUSTED' },
    { status: 503, providerStatus: 'UNAVAILABLE' }
  ]) {
    await t.test(String(item.status), async () => {
      const ctx = harness({
        configured: true,
        messageResponses: [response(false, { error: { status: item.providerStatus } }, item.status)]
      });
      const result = await registerAndSend(ctx);
      assert.deepEqual(result, { attempted: 1, delivered: 0, skipped: false });
      const update = failureUpdate(ctx, 'temporary_failure');
      assert.ok(update);
      assert.deepEqual(update.params, [deviceId, 'temporary_failure', false, 'active']);
      assert.match(update.text, /failure_count = case when failure_count < 2147483647/);
    });
  }
});

test('an FCM authorization rejection clears the cache, refreshes once, and retries safely', async () => {
  const ctx = harness({
    configured: true,
    messageResponses: [
      response(false, { error: { status: 'UNAUTHENTICATED' } }, 401),
      response(true, { name: 'retried-message' }, 200)
    ]
  });
  const result = await registerAndSend(ctx);

  assert.deepEqual(result, { attempted: 1, delivered: 1, skipped: false });
  assert.equal(ctx.oauthCount(), 2);
  assert.equal(ctx.messageCount(), 2);
  const messages = ctx.fetchRequests.filter(({ url }) => url.includes('fcm.googleapis.com'));
  assert.equal(messages[0].init.headers.authorization, 'Bearer test-access-token-1');
  assert.equal(messages[1].init.headers.authorization, 'Bearer test-access-token-2');
  assert.equal(failureUpdate(ctx, 'authorization_failed'), undefined);
});

test('a repeated authorization rejection is counted but never invalidates the device', async () => {
  const ctx = harness({
    configured: true,
    messageResponses: [
      response(false, { error: { status: 'UNAUTHENTICATED' } }, 401),
      response(false, { error: { status: 'PERMISSION_DENIED' } }, 403)
    ]
  });
  const result = await registerAndSend(ctx);

  assert.deepEqual(result, { attempted: 1, delivered: 0, skipped: false });
  assert.equal(ctx.oauthCount(), 2);
  assert.equal(ctx.messageCount(), 2);
  assert.deepEqual(failureUpdate(ctx, 'authorization_failed').params, [deviceId, 'authorization_failed', false, 'active']);
});

test('OAuth failures are safely skipped without exposing credentials or querying device tokens', async () => {
  const sensitiveProviderError = `${privateKeyPem}\n${deviceToken}`;
  const ctx = harness({
    configured: true,
    oauthResponses: [response(false, { error: sensitiveProviderError }, 401)]
  });
  await ctx.service.registerPushDevice({ token: deviceToken }, { user });
  const result = await ctx.service.sendPushMessage({ userIds: [user.id] });

  assert.deepEqual(result, { attempted: 0, delivered: 0, skipped: true });
  assert.equal(ctx.oauthCount(), 1);
  assert.equal(ctx.messageCount(), 0);
  assert.equal(ctx.calls.some(({ text }) => text.includes('select id, token_ciphertext')), false);
  assert.equal(JSON.stringify(result).includes(deviceToken), false);
  assert.equal(JSON.stringify(result).includes(privateKeyPem), false);
});

test('network errors and timeouts increment a safe transport failure without leaking rejected values', async (t) => {
  await t.test('network rejection', async () => {
    const ctx = harness({
      configured: true,
      messageResponses: [new Error(`network rejected ${deviceToken} ${privateKeyPem}`)]
    });
    const result = await registerAndSend(ctx);
    assert.deepEqual(result, { attempted: 1, delivered: 0, skipped: false });
    assert.deepEqual(failureUpdate(ctx, 'transport_error').params, [deviceId, 'transport_error', false, 'active']);
    assert.equal(JSON.stringify(result).includes(deviceToken), false);
    assert.equal(JSON.stringify(ctx.updates).includes(privateKeyPem), false);
  });

  await t.test('request timeout', async () => {
    let aborted = false;
    const ctx = harness({
      configured: true,
      requestTimeoutMs: 10,
      messageResponses: [({ init }) => new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error(`aborted ${deviceToken}`));
        }, { once: true });
      })]
    });
    const result = await registerAndSend(ctx);
    assert.deepEqual(result, { attempted: 1, delivered: 0, skipped: false });
    assert.equal(aborted, true);
    assert.deepEqual(failureUpdate(ctx, 'transport_error').params, [deviceId, 'transport_error', false, 'active']);
  });
});

test('database failures resolve to generic results and never expose a device token', async () => {
  const ctx = harness({
    onQuery: async ({ text }) => {
      if (text.includes('insert into user_push_devices')) throw new Error(`database rejected ${deviceToken}`);
      return undefined;
    }
  });
  const result = await ctx.service.registerPushDevice({ token: deviceToken }, { user });

  assert.deepEqual(result, { ok: false, message: 'Push device registration failed.', status: 503, code: 5000 });
  assert.equal(JSON.stringify(result).includes(deviceToken), false);
});
