const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createCryptoUtils } = require('../../src/services/core/crypto-utils');
const { buildRuntimeStatus, corsOriginList, isValidHttpOrigin, isWeakAdminPassword, loadConfig } = require('../../src/config/env');
const { createDistributedRateLimiter } = require('../../src/lib/security');
const { postgresSslOptions } = require('../../src/lib/postgres-ssl');
const { createAuthService } = require('../../src/services/domains/auth/auth-service');
const { isHealthProbeRequest } = require('../../src/app/create-app');

test('password hashes use scrypt and legacy SHA-256 hashes remain verifiable', async () => {
  const utils = createCryptoUtils({ crypto, tokenSecret: 'test-secret-that-is-long-enough-for-tests' });
  const password = 'correct horse battery staple';
  const salt = '0123456789abcdef0123456789abcdef';
  const modernHash = await utils.hashPassword(password, salt);
  const legacyHash = crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');

  assert.match(modernHash, /^[a-f0-9]{128}$/);
  assert.equal(utils.needsPasswordRehash(modernHash), false);
  assert.equal(await utils.verifyPassword(password, salt, modernHash), true);
  assert.equal(await utils.verifyPassword('wrong', salt, modernHash), false);
  assert.equal(utils.needsPasswordRehash(legacyHash), true);
  assert.equal(await utils.verifyPassword(password, salt, legacyHash), true);
});

test('production runtime rejects placeholder secrets, weak passwords, and wildcard CORS', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    ADMIN_PASSWORD: 'admin',
    TOKEN_SECRET: 'change-me-please',
    DATABASE_URL: 'postgresql://example.invalid/idbs',
    CORS_ORIGIN: '*'
  });
  const runtime = buildRuntimeStatus(config);

  assert.equal(runtime.ready, false);
  assert.ok(runtime.errors.length >= 3);
});

test('administrator password policy rejects short, placeholder, and repeated passwords', () => {
  assert.equal(isWeakAdminPassword('elevenchars'), true);
  assert.equal(isWeakAdminPassword('password'), true);
  assert.equal(isWeakAdminPassword('aaaaaaaaaaaa'), true);
  assert.equal(isWeakAdminPassword('IDBS_strong_admin_2026'), false);
});

test('production configuration validates origins, ports, and rate-limit bounds', () => {
  assert.equal(isValidHttpOrigin('https://idbs.example.edu'), true);
  assert.equal(isValidHttpOrigin('https://idbs.example.edu/path'), false);
  assert.equal(isValidHttpOrigin('javascript:alert(1)'), false);
  assert.deepEqual(corsOriginList({ corsOrigin: 'https://idbs.example.edu/, http://127.0.0.1:3000' }), [
    'https://idbs.example.edu',
    'http://127.0.0.1:3000'
  ]);

  const runtime = buildRuntimeStatus(loadConfig({
    NODE_ENV: 'production',
    PORT: '70000',
    ADMIN_PASSWORD: 'IDBS_strong_admin_2026',
    TOKEN_SECRET: 'IDBS_token_secret_at_least_32_characters_2026',
    DATABASE_URL: 'postgresql://example.invalid/idbs',
    CORS_ORIGIN: 'https://idbs.example.edu/path',
    AUTH_RATE_LIMIT_MAX: '0',
    API_RATE_LIMIT_WINDOW_MS: '500'
  }));
  assert.equal(runtime.ready, false);
  assert.ok(runtime.errors.some((message) => message.startsWith('CORS_ORIGIN')));
  assert.ok(runtime.errors.some((message) => message.startsWith('PORT')));
  assert.ok(runtime.errors.some((message) => message.startsWith('AUTH_RATE_LIMIT_MAX')));
  assert.ok(runtime.errors.some((message) => message.startsWith('API_RATE_LIMIT_WINDOW_MS')));
});

test('server fails before listening when production configuration is unsafe', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '..', '..', 'server.js')], {
    cwd: path.resolve(__dirname, '..', '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ADMIN_PASSWORD: 'admin',
      TOKEN_SECRET: 'change-me-please',
      DATABASE_URL: 'postgresql://127.0.0.1:1/idbs',
      CORS_ORIGIN: '*'
    }
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Production configuration rejected/);
});

test('health probes bypass database-backed public access checks', () => {
  assert.equal(isHealthProbeRequest({ method: 'GET', path: '/health' }), true);
  assert.equal(isHealthProbeRequest({ method: 'HEAD', path: '/ready' }), true);
  assert.equal(isHealthProbeRequest({ method: 'POST', path: '/health' }), false);
  assert.equal(isHealthProbeRequest({ method: 'GET', path: '/api/v5/me' }), false);
});
test('distributed rate limiter enforces a shared counter', async () => {
  let count = 0;
  const limiter = createDistributedRateLimiter({
    max: 1,
    windowMs: 60_000,
    consume: async () => ({ count: ++count, expiresAt: new Date(Date.now() + 60_000) })
  });
  const req = { ip: '127.0.0.1', headers: {}, socket: {}, requestId: 'test' };
  let nextCalls = 0;
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  await limiter(req, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  await limiter(req, res, () => { nextCalls += 1; });
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.code, 3001);
  assert.ok(Number(res.headers['Retry-After']) >= 1);
});

test('PostgreSQL TLS verifies certificates by default', () => {
  assert.equal(postgresSslOptions({ PGSSL: 'false' }), undefined);
  assert.deepEqual(postgresSslOptions({ PGSSL: 'true' }), { rejectUnauthorized: true });
  assert.deepEqual(postgresSslOptions({ PGSSL: 'true', PGSSL_CA: 'line1\\nline2' }), {
    rejectUnauthorized: true,
    ca: 'line1\nline2'
  });
});

test('historical default administrator seed is not a login bypass', async () => {
  const auth = createAuthService({
    adminPassword: 'strong-environment-admin-password',
    assertText: (value) => String(value),
    getAdminAuthConfig: async () => ({
      has_custom_admin_password: false,
      default_admin_password_seed: 'IDBS123456'
    }),
    verifySecret: (left, right) => left === right,
    makeToken: () => 'token',
    ok: (data) => ({ ok: true, data }),
    fail: (message, status, code) => ({ ok: false, message, status, code })
  });

  const rejected = await auth.adminLogin({ password: 'IDBS123456' });
  assert.equal(rejected.ok, false);
  const accepted = await auth.adminLogin({ password: 'strong-environment-admin-password' });
  assert.equal(accepted.ok, true);
});
