const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { build } = require('esbuild');

const pairingSourcePath = path.resolve(__dirname, '../../web/src/lib/app-pairing.ts');
const loginSource = fs.readFileSync(path.resolve(__dirname, '../../web/src/features/auth/login-page.tsx'), 'utf8');
const downloadSource = fs.readFileSync(path.resolve(__dirname, '../../public/download.html'), 'utf8');
const appConfigSource = fs.readFileSync(path.resolve(__dirname, '../../src/routes/v5/app-config.js'), 'utf8');

function successfulConfig(serverUrl, overrides = {}) {
  return {
    app_name: '实验室管理系统',
    server_url: serverUrl,
    web_url: `${serverUrl}/v5/`,
    api_base_url: `${serverUrl}/api/v5`,
    download_url: `${serverUrl}/download`,
    apk_download_url: `${serverUrl}/download/app.apk`,
    pairing_scheme: 'labapp://pair',
    pairing_app_link_path: '/api/v5/app-pairing/link',
    pairing_available: true,
    pairing_unavailable_reason: null,
    organization_name: 'Test Laboratory',
    instance_name: 'Test Server',
    instance_id: 'test-instance-0001',
    instance_fingerprint: 'a'.repeat(64),
    ...overrides
  };
}

function pairingLink(serverUrl, token = 'a'.repeat(48)) {
  const parameters = new URLSearchParams({ v: '2', server: serverUrl, token });
  return `labapp://pair?${parameters.toString()}`;
}

async function loadPairingModule(options = {}) {
  const state = {
    native: Boolean(options.native),
    savedOrigins: [],
    nativeSaved: [],
    logoutCount: 0,
    operations: [],
    acknowledgements: 0,
    removedListeners: 0,
    listener: null,
    pending: options.pending || { pending: false },
    retained: options.retained || null,
    serverConfiguration: options.serverConfiguration || { configured: false },
    storedOrigin: options.storedOrigin || ''
  };

  state.runtime = {
    getInstallationId: async () => ({ installationId: 'test-installation-0001' }),
    getServerConfiguration: async () => state.serverConfiguration,
    saveServerConfiguration: async ({ serverUrl }) => {
      state.nativeSaved.push(serverUrl);
      state.operations.push(`native-save:${serverUrl}`);
      return { configured: true, serverUrl };
    },
    getPendingServerPairing: async () => state.pending,
    acknowledgeServerPairing: async () => { state.acknowledgements += 1; },
    addListener: async (eventName, listener) => {
      assert.equal(eventName, 'serverPairingLink');
      state.listener = listener;
      if (state.retained) queueMicrotask(() => listener(state.retained));
      return {
        remove: async () => {
          state.removedListeners += 1;
          state.listener = null;
        }
      };
    }
  };

  globalThis.__appPairingTestState = state;
  if (!globalThis.crypto) globalThis.crypto = webcrypto;

  const result = await build({
    entryPoints: [pairingSourcePath],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'capacitor-test-double',
        setup(build) {
          build.onResolve({ filter: /^@capacitor\/core$/ }, () => ({ path: 'capacitor', namespace: 'capacitor-test-double' }));
          build.onLoad({ filter: /.*/, namespace: 'capacitor-test-double' }, () => ({
            loader: 'js',
            contents: `
              export const Capacitor = {
                isNativePlatform: () => globalThis.__appPairingTestState.native,
                getPlatform: () => globalThis.__appPairingTestState.native ? 'android' : 'web'
              };
              export function registerPlugin() { return globalThis.__appPairingTestState.runtime; }
            `
          }));
        }
      },
      {
        name: 'auth-api-test-double',
        setup(build) {
          build.onResolve({ filter: /^\.\/auth-api$/ }, () => ({ path: 'auth-api', namespace: 'auth-api-test-double' }));
          build.onLoad({ filter: /.*/, namespace: 'auth-api-test-double' }, () => ({
            loader: 'js',
            contents: `
              export const authApi = {
                logout() {
                  globalThis.__appPairingTestState.logoutCount += 1;
                  globalThis.__appPairingTestState.operations.push('logout');
                }
              };
            `
          }));
        }
      },
      {
        name: 'api-test-double',
        setup(build) {
          build.onResolve({ filter: /^\.\/api$/ }, () => ({ path: 'api', namespace: 'api-test-double' }));
          build.onLoad({ filter: /.*/, namespace: 'api-test-double' }, () => ({
            loader: 'js',
            contents: `
              export function saveApiOrigin(value) {
                globalThis.__appPairingTestState.savedOrigins.push(value);
                globalThis.__appPairingTestState.operations.push('save-origin:' + value);
                globalThis.__appPairingTestState.storedOrigin = value;
                return value;
              }
              export function getApiOrigin() {
                return globalThis.__appPairingTestState.storedOrigin;
              }
            `
          }));
        }
      }
    ]
  });

  const loaded = { exports: {} };
  Function('module', 'exports', 'require', result.outputFiles[0].text)(loaded, loaded.exports, require);
  return { api: loaded.exports, state };
}

test('manual pairing accepts only a strict HTTPS origin and persists no pairing token', async (t) => {
  const originalFetch = globalThis.fetch;
  const { api, state } = await loadPairingModule();
  const token = 'sensitive-pairing-token-'.padEnd(48, 'x');
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({ code: 0, data: successfulConfig('https://lab.example') })
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.__appPairingTestState;
  });

  const candidate = await api.pairFromLink(pairingLink('https://lab.example', token));
  assert.equal(candidate.config.server_url, 'https://lab.example');
  assert.equal(candidate.trust_status, 'first-use');
  assert.deepEqual(state.savedOrigins, []);
  await api.confirmPairing(candidate);
  assert.deepEqual(state.savedOrigins, ['https://lab.example']);
  assert.equal(state.savedOrigins.join('').includes(token), false);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/lab\.example\/api\/v5\/app-pairing\/exchange$/);

  for (const unsafeServer of [
    'http://192.0.2.10',
    'https://lab.example/path',
    'https://user:password@lab.example',
    'https://lab.example/?redirect=elsewhere',
    'https://lab.example/#fragment'
  ]) {
    await assert.rejects(api.pairFromLink(pairingLink(unsafeServer)), /Unable to complete server pairing/);
  }
  assert.equal(requests.length, 1);
});

test('display-name changes remain confirmable while cryptographic identity changes are blocked', async (t) => {
  const originalFetch = globalThis.fetch;
  const { api, state } = await loadPairingModule();
  let responseConfig = successfulConfig('https://lab.example');
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ code: 0, data: responseConfig })
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.__appPairingTestState;
  });

  const first = await api.pairFromLink(pairingLink('https://lab.example', 'd'.repeat(48)));
  await api.confirmPairing(first);
  assert.deepEqual(state.savedOrigins, ['https://lab.example']);

  responseConfig = successfulConfig('https://lab.example', {
    organization_name: 'Renamed Laboratory',
    instance_name: 'Renamed Server'
  });
  const renamed = await api.pairFromLink(pairingLink('https://lab.example', 'e'.repeat(48)));
  assert.equal(renamed.trust_status, 'recognized');
  assert.equal(renamed.can_confirm, true);
  await api.confirmPairing(renamed);

  responseConfig = successfulConfig('https://lab.example', { instance_fingerprint: 'b'.repeat(64) });
  const changedIdentity = await api.pairFromLink(pairingLink('https://lab.example', 'f'.repeat(48)));
  assert.equal(changedIdentity.trust_status, 'identity-mismatch');
  assert.equal(changedIdentity.can_confirm, false);
  await assert.rejects(api.confirmPairing(changedIdentity), /Unable to complete server pairing/);
  assert.equal(state.logoutCount, 0);
});

test('cross-origin pairing requires explicit approval and logs out before switching', async (t) => {
  const originalFetch = globalThis.fetch;
  const { api, state } = await loadPairingModule({ storedOrigin: 'https://old.example' });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ code: 0, data: successfulConfig('https://new.example') })
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.__appPairingTestState;
  });

  const candidate = await api.pairFromLink(pairingLink('https://new.example', 'g'.repeat(48)));
  assert.equal(candidate.trust_status, 'server-change');
  assert.equal(candidate.requires_server_switch_confirmation, true);
  await assert.rejects(api.confirmPairing(candidate), /Unable to complete server pairing/);
  assert.equal(state.logoutCount, 0);
  assert.deepEqual(state.savedOrigins, []);

  await api.confirmPairing(candidate, { allowServerSwitch: true });
  assert.equal(state.logoutCount, 1);
  assert.deepEqual(state.operations, ['logout', 'save-origin:https://new.example']);
  assert.deepEqual(state.savedOrigins, ['https://new.example']);
});

test('strict parser accepts same-origin HTTPS App Links and rejects v1 or ambiguous links', async (t) => {
  const originalFetch = globalThis.fetch;
  const { api } = await loadPairingModule();
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return { ok: true, json: async () => ({ code: 0, data: successfulConfig('https://lab.example') }) };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.__appPairingTestState;
  });

  const token = 'h'.repeat(48);
  const query = new URLSearchParams({ v: '2', server: 'https://lab.example', token });
  const candidate = await api.pairFromLink(`https://lab.example/api/v5/app-pairing/link?${query}`);
  assert.equal(candidate.config.server_url, 'https://lab.example');

  for (const link of [
    ` https://lab.example/api/v5/app-pairing/link?${query}`,
    `https://other.example/api/v5/app-pairing/link?${query}`,
    `https://lab.example/api/v5/app-pairing/link?${query}&extra=1`,
    pairingLink('https://lab.example', token).replace('v=2', 'v=1')
  ]) {
    await assert.rejects(api.pairFromLink(link), /Unable to complete server pairing/);
  }
  assert.equal(requests, 1);
});

test('pairing failures expose a generic error instead of server details', async (t) => {
  const originalFetch = globalThis.fetch;
  const { api } = await loadPairingModule();
  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ code: 5000, message: 'DATABASE_URL and administrator password leaked here' })
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.__appPairingTestState;
  });

  await assert.rejects(api.pairFromLink(pairingLink('https://lab.example')), (error) => {
    assert.match(error.message, /Unable to complete server pairing/);
    assert.doesNotMatch(error.message, /DATABASE_URL|administrator password/);
    return true;
  });
});

test('running App receives the native pairing event and removes its listener on cleanup', async (t) => {
  const originalFetch = globalThis.fetch;
  const { api, state } = await loadPairingModule({ native: true });
  let pairedResolve;
  const paired = new Promise((resolve) => { pairedResolve = resolve; });
  let pairedCount = 0;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ code: 0, data: successfulConfig('https://lab.example') })
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.__appPairingTestState;
  });

  const remove = await api.subscribeNativeServerPairing({
    onPairingCandidate: (candidate) => {
      pairedCount += 1;
      pairedResolve(candidate);
    },
    onError: () => assert.fail('native event pairing should succeed')
  });
  assert.equal(typeof state.listener, 'function');
  state.listener({ version: '2', serverUrl: 'https://lab.example', pairingToken: 'b'.repeat(48) });
  const candidate = await paired;

  assert.equal(candidate.config.server_url, 'https://lab.example');
  assert.equal(candidate.trust_status, 'first-use');
  assert.equal(pairedCount, 1);
  assert.deepEqual(state.nativeSaved, []);
  await api.confirmPairing(candidate);
  assert.deepEqual(state.nativeSaved, ['https://lab.example']);
  assert.equal(state.acknowledgements, 1);
  await remove();
  assert.equal(state.removedListeners, 1);
  assert.equal(state.listener, null);
});

test('retained event and startup pending recovery exchange the same token only once', async (t) => {
  const originalFetch = globalThis.fetch;
  const payload = { version: '2', serverUrl: 'https://lab.example', pairingToken: 'c'.repeat(48) };
  const { api, state } = await loadPairingModule({ native: true, retained: payload, pending: { pending: true, pairing: payload } });
  let requestCount = 0;
  let pairedResolve;
  const paired = new Promise((resolve) => { pairedResolve = resolve; });
  globalThis.fetch = async () => {
    requestCount += 1;
    return { ok: true, json: async () => ({ code: 0, data: successfulConfig('https://lab.example') }) };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.__appPairingTestState;
  });

  const remove = await api.subscribeNativeServerPairing({
    onPairingCandidate: pairedResolve,
    onError: () => assert.fail('pending pairing should succeed')
  });
  await paired;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requestCount, 1);
  assert.equal(state.acknowledgements, 1);
  await remove();
});

test('native fallback does not overwrite a manually stored HTTP or HTTPS server', async (t) => {
  for (const storedOrigin of ['http://192.0.2.10', 'https://manual.example']) {
    await t.test(storedOrigin, async () => {
      const { api, state } = await loadPairingModule({
        native: true,
        storedOrigin,
        serverConfiguration: { configured: true, serverUrl: 'https://old-pairing.example' }
      });
      const restored = await api.restoreNativeServerConfiguration();
      assert.equal(restored, storedOrigin);
      assert.deepEqual(state.savedOrigins, []);
      delete globalThis.__appPairingTestState;
    });
  }
});

test('login and download UI state the real HTTP and system-camera security boundaries', () => {
  assert.match(loginSource, /window\.confirm\(/);
  assert.match(loginSource, /target\.protocol !== 'http:'/);
  assert.match(loginSource, /isLoopbackHost\(target\.hostname\)/);
  assert.equal((loginSource.match(/confirmInsecureCredentialSubmission\(\)/g) || []).length, 4);
  assert.match(downloadSource, /手机系统相机/);
  assert.match(downloadSource, /当前版本没有内置相机扫描器/);
  assert.match(downloadSource, /data\.pairing_uri/);
  assert.match(downloadSource, /只配置服务器地址，不会自动登录/);
  assert.match(downloadSource, /id="apk-download"/);
  assert.match(appConfigSource, /apk_download_url/);
  assert.match(appConfigSource, /apkDownload.href = apkUrl.href/);
});
