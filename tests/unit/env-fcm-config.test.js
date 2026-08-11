const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildRuntimeStatus, loadConfig } = require('../../src/config/env');

const rootDir = path.resolve(__dirname, '..', '..');
const readProjectFile = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

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

test('Firebase diagnostics never echo service-account fields or private-key material', () => {
  const sensitiveKey = '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----';
  const raw = JSON.stringify({
    type: 'service_account',
    project_id: 'sensitive-project-id',
    client_email: 'sensitive-account@example.iam.gserviceaccount.com',
    private_key: sensitiveKey
  });
  const config = loadConfig({
    NODE_ENV: 'production',
    FCM_SERVICE_ACCOUNT_JSON: raw,
    ADMIN_PASSWORD: 'StrongAdminPassword123!',
    TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
    CORS_ORIGIN: 'https://lab.example.com',
    DATABASE_URL: 'postgresql://example'
  });
  const serialized = JSON.stringify(buildRuntimeStatus(config));

  assert.match(config.fcmServiceAccountError, /invalid/i);
  assert.equal(serialized.includes(sensitiveKey), false);
  assert.equal(serialized.includes('sensitive-project-id'), false);
  assert.equal(serialized.includes('sensitive-account@example.iam.gserviceaccount.com'), false);
});

test('production runtime diagnostics reject missing, placeholder, and short TOKEN_SECRET values', () => {
  for (const tokenSecret of ['', 'change-me-please', 'short-token-secret']) {
    const status = buildRuntimeStatus(loadConfig({
      NODE_ENV: 'production',
      TOKEN_SECRET: tokenSecret,
      ADMIN_PASSWORD: 'StrongAdminPassword123!',
      CORS_ORIGIN: 'https://lab.example.com',
      DATABASE_URL: 'postgresql://example'
    }));
    assert.ok(status.errors.some((message) => /TOKEN_SECRET/.test(message)));
  }
});

test('production runtime diagnostics reject whitespace-padded and repeated-character secrets', () => {
  for (const tokenSecret of [` ${'a'.repeat(32)}`, `${'a'.repeat(32)} `, ' '.repeat(32), 'a'.repeat(32)]) {
    const status = buildRuntimeStatus(loadConfig({
      NODE_ENV: 'production',
      TOKEN_SECRET: tokenSecret,
      ADMIN_PASSWORD: 'StrongAdminPassword123!',
      CORS_ORIGIN: 'https://lab.example.com',
      DATABASE_URL: 'postgresql://example'
    }));
    assert.ok(status.errors.some((message) => /TOKEN_SECRET/i.test(message)));
  }
});

test('Android release workflow fails closed on missing official signing material', () => {
  const workflow = readProjectFile('.github/workflows/android-release.yml');
  for (const name of [
    'ANDROID_RELEASE_KEYSTORE_BASE64',
    'ANDROID_RELEASE_STORE_PASSWORD',
    'ANDROID_RELEASE_KEY_ALIAS',
    'ANDROID_RELEASE_KEY_PASSWORD'
  ]) {
    assert.match(workflow, new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`));
  }
  assert.match(workflow, /Required Android release signing secret is not configured: \$required/);
  assert.match(workflow, /No replacement key will be generated and no APK will be published/);
  assert.match(workflow, /EXPECTED_CERT_SHA256/);
  assert.match(workflow, /apksigner[^\n]*verify --verbose --print-certs/);
  assert.match(workflow, /needs: build-and-verify/);
  assert.match(workflow, /sha256sum --check/);
  assert.doesNotMatch(workflow, /keytool\s+-genkey|genkeypair|assembleDebug|signingConfigs\.debug/i);
  assert.ok(
    workflow.indexOf('Restore and validate official release keystore')
      < workflow.indexOf('Build signed APK and AAB'),
    'the official keystore must be validated before any release build'
  );
});

test('Firebase Actions configuration is optional, secret-safe, and project-checked', () => {
  const releaseWorkflow = readProjectFile('.github/workflows/android-release.yml');
  const checkWorkflow = readProjectFile('.github/workflows/check.yml');

  assert.match(releaseWorkflow, /GOOGLE_SERVICES_JSON_BASE64: \$\{\{ secrets\.GOOGLE_SERVICES_JSON_BASE64 \}\}/);
  assert.match(releaseWorkflow, /FCM_SERVICE_ACCOUNT_JSON_BASE64: \$\{\{ secrets\.FCM_SERVICE_ACCOUNT_JSON_BASE64 \}\}/);
  assert.match(releaseWorkflow, /firebase_enabled=false/);
  assert.match(releaseWorkflow, /FCM background push will be disabled/);
  assert.match(releaseWorkflow, /serviceAccount\.project_id !== android\?\.project_info\?\.project_id/);
  assert.match(releaseWorkflow, /Remove restored secrets/);
  assert.match(releaseWorkflow, /rm -f web\/android\/app\/google-services\.json/);
  assert.doesNotMatch(releaseWorkflow, /echo\s+['"]?\$\{?(?:GOOGLE_SERVICES_JSON_BASE64|FCM_SERVICE_ACCOUNT_JSON_BASE64|ANDROID_RELEASE_KEYSTORE_BASE64)/);
  assert.doesNotMatch(releaseWorkflow, /FCM_SERVICE_ACCOUNT_JSON_BASE64=.*>>\s*"?\$GITHUB_ENV/);

  assert.match(checkWorkflow, /android-without-firebase:/);
  assert.match(checkWorkflow, /test ! -e web\/android\/app\/google-services\.json/);
  assert.match(checkWorkflow, /testDebugUnitTest assembleDebug lintDebug/);
  assert.doesNotMatch(checkWorkflow, /secrets\./);
});

test('Firebase VPS configurator accepts file or environment secrets without printing them', () => {
  const script = readProjectFile('scripts/configure-firebase.sh');
  assert.match(script, /umask 077/);
  assert.match(script, /FCM_SERVICE_ACCOUNT_JSON_BASE64/);
  assert.match(script, /FCM_SERVICE_ACCOUNT_JSON/);
  assert.match(script, /input_mode=base64/);
  assert.match(script, /input_mode=json/);
  assert.match(script, /install -o root -g root -m 600/);
  assert.match(script, /unset encoded FCM_SERVICE_ACCOUNT_JSON_BASE64 FCM_SERVICE_ACCOUNT_JSON/);
  assert.doesNotMatch(script, /set -x|echo\s+"?\$\{?FCM_SERVICE_ACCOUNT_JSON/);
});
