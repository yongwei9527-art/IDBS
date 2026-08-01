const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { buildRuntimeStatus, loadConfig } = require('../../src/config/env');

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
const serviceAccount = {
  type: 'service_account',
  project_id: 'firebase-config-test',
  client_email: 'firebase-test@example.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
};

test('Firebase service account supports a base64 deployment secret', () => {
  const encoded = Buffer.from(JSON.stringify(serviceAccount), 'utf8').toString('base64');
  const config = loadConfig({ FCM_SERVICE_ACCOUNT_JSON_BASE64: encoded });

  assert.deepEqual(JSON.parse(config.fcmServiceAccountJson), serviceAccount);
  assert.equal(config.fcmServiceAccountError, '');
});

test('invalid base64 Firebase configuration falls back to legacy raw JSON', () => {
  const raw = JSON.stringify(serviceAccount);
  const config = loadConfig({
    FCM_SERVICE_ACCOUNT_JSON_BASE64: 'not-valid-service-account-json',
    FCM_SERVICE_ACCOUNT_JSON: raw
  });

  assert.equal(config.fcmServiceAccountJson, raw);
  assert.equal(config.fcmServiceAccountError, '');
});

test('invalid Firebase configuration is rejected with a production diagnostic', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    FCM_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from('{"type":"not-a-service-account"}').toString('base64'),
    ADMIN_PASSWORD: 'StrongAdminPassword123!',
    TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
    CORS_ORIGIN: 'https://lab.example.com',
    DATABASE_URL: 'postgresql://example'
  });

  assert.equal(config.fcmServiceAccountJson, '');
  assert.match(config.fcmServiceAccountError, /invalid/i);
  assert.ok(buildRuntimeStatus(config).errors.some((message) => /Firebase FCM/i.test(message)));
});
