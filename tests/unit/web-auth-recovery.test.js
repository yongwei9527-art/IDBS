const test = require('node:test');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const apiEntry = path.resolve(__dirname, '../../web/src/lib/api.ts');
const bundledApi = esbuild.buildSync({
  entryPoints: [apiEntry],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  write: false,
  define: { 'import.meta.env.VITE_API_ORIGIN': '""', 'import.meta.env.DEV': 'true' }
}).outputFiles[0].text;

function response(status, body = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function loadApi(fetchImpl, options = {}) {
  const values = options.values || new Map();
  const dispatchedEvents = [];
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
  const context = {
    module: { exports: {} },
    exports: {},
    require,
    fetch: fetchImpl,
    Response,
    URL,
    localStorage,
    window: {
      dispatchEvent(event) {
        dispatchedEvents.push(event);
        return true;
      },
      location: { origin: options.locationOrigin || 'http://127.0.0.1:5173' }
    },
    Event,
    CustomEvent: globalThis.CustomEvent || class CustomEvent extends Event {}
  };
  context.exports = context.module.exports;
  vm.runInNewContext(bundledApi, context, { filename: apiEntry });
  Object.defineProperties(context.module.exports, {
    __storage: { value: values },
    __events: { value: dispatchedEvents }
  });
  return context.module.exports;
}

test('transient refresh network failure preserves the existing access token', async () => {
  let calls = 0;
  const api = loadApi(async () => {
    calls++;
    if (calls === 1) return response(401, { code: 1001 });
    throw new TypeError('network unavailable');
  });
  api.tokenStore.set('existing-test-token');
  await assert.rejects(api.request('/private'));
  assert.equal(api.tokenStore.get(), 'existing-test-token');
});

test('refresh 503 preserves the existing access token', async () => {
  let calls = 0;
  const api = loadApi(async () => (++calls === 1 ? response(401, { code: 1001 }) : response(503, { code: 5000 })));
  api.tokenStore.set('existing-test-token');
  await assert.rejects(api.request('/private'));
  assert.equal(api.tokenStore.get(), 'existing-test-token');
});

test('final refresh 401 clears the invalid access token', async () => {
  let calls = 0;
  const api = loadApi(async () => (++calls === 1 ? response(401, { code: 1001 }) : response(401, { code: 1001 })));
  api.tokenStore.set('expired-test-token');
  await assert.rejects(api.request('/private'));
  assert.equal(api.tokenStore.get(), null);
});

test('successful refresh retries the original request once', async () => {
  let calls = 0;
  const api = loadApi(async () => {
    calls++;
    if (calls === 1) return response(401, { code: 1001 });
    if (calls === 2) return response(200, { data: { access_token: 'renewed-test-token' } });
    return response(200, { data: { ok: true } });
  });
  api.tokenStore.set('expired-test-token');
  const result = await api.request('/private');
  assert.deepEqual(result, { ok: true });
  assert.equal(api.tokenStore.get(), 'renewed-test-token');
  assert.equal(calls, 3);
});

test('AuthProvider attempts cookie refresh when local access storage is empty', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/features/auth/use-auth.tsx'), 'utf8');
  assert.match(source, /if \(!token\) token = await authApi\.refreshToken\(\)/);
});
test('switching API servers clears origin-bound tokens before the next request', async () => {
  const calls = [];
  const api = loadApi(async (url, options) => {
    calls.push({ url: String(url), options });
    return response(200, { data: { ok: true } });
  }, { locationOrigin: 'https://app-shell.example' });

  api.saveApiOrigin('https://server-a.example');
  api.tokenStore.set('server-a-access-token');
  assert.equal(api.tokenStore.get(), 'server-a-access-token');

  api.saveApiOrigin('https://server-b.example');
  assert.equal(api.tokenStore.get(), null);
  await api.request('/me');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://server-b.example/api/v5/me');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(api.__storage.has('laboratory-management-system.refresh_token'), false);
});

test('a refresh response from the previous API server cannot restore its token after a switch', async () => {
  let releaseRefresh;
  let markRefreshStarted;
  const refreshStarted = new Promise((resolve) => { markRefreshStarted = resolve; });
  let calls = 0;
  const api = loadApi(async (url) => {
    calls += 1;
    if (calls === 1) return response(401, { code: 1001 });
    assert.equal(String(url), 'https://server-a.example/api/v5/auth/refresh');
    markRefreshStarted();
    return new Promise((resolve) => { releaseRefresh = resolve; });
  }, { locationOrigin: 'https://app-shell.example' });

  api.saveApiOrigin('https://server-a.example');
  api.tokenStore.set('expired-server-a-token');
  const pending = api.request('/private');
  await refreshStarted;

  api.saveApiOrigin('https://server-b.example');
  releaseRefresh(response(200, { data: { access_token: 'late-server-a-token' } }));

  await assert.rejects(pending);
  assert.equal(api.getApiOrigin(), 'https://server-b.example');
  assert.equal(api.tokenStore.get(), null);
  assert.equal(api.__storage.has('laboratory-management-system.access_token'), false);
});

test('server switches clear AuthProvider state and React Query caches', () => {
  const authSource = fs.readFileSync(path.resolve(__dirname, '../../web/src/features/auth/use-auth.tsx'), 'utf8');
  const mainSource = fs.readFileSync(path.resolve(__dirname, '../../web/src/main.tsx'), 'utf8');
  assert.match(authSource, /api-origin-changed[\s\S]*?setMe\(null\)[\s\S]*?setIsReady\(true\)/);
  assert.doesNotMatch(authSource, /tokenStore\.get\(\) \|\| token/);
  assert.match(mainSource, /api-origin-changed[\s\S]*?queryClient\.cancelQueries\(\)[\s\S]*?queryClient\.clear\(\)/);
});

test('USB Vite development always uses the same-origin API proxy', () => {
  const api = loadApi(async () => response(200, { data: {} }));
  api.saveApiOrigin('http://127.0.0.1:3000');
  assert.equal(api.getApiOrigin(), '');
  assert.equal(api.getApiBase(), '/api/v5');
});

test('API requests disable browser caching to prevent empty 304 auth responses', async () => {
  let receivedOptions;
  const api = loadApi(async (_url, options) => {
    receivedOptions = options;
    return response(200, { data: { ok: true } });
  });
  await api.request('/me');
  assert.equal(receivedOptions.cache, 'no-store');
});

test('login page redirects an already restored session without another login', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/features/auth/login-page.tsx'), 'utf8');
  assert.match(source, /if \(!auth\.isReady \|\| !auth\.isLoggedIn\) return/);
  assert.match(source, /getLoginRedirect\(\) \|\| APP_PATHS\.devices/);
  assert.match(source, /auth\.isLoggedIn \? 'redirecting' : 'loading'/);
});

test('offline Capacitor uses native HTTP so the HttpOnly refresh cookie survives cross-origin API calls', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../web/capacitor.config.ts'), 'utf8');
  assert.match(source, /CapacitorHttp:\s*\{\s*enabled:\s*true/);
  assert.doesNotMatch(source, /refresh_token[^\\n]*localStorage/i);
});

test('offline Capacitor avoids the Android pre-document safe-area injector race', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../web/capacitor.config.ts'), 'utf8');
  assert.match(source, /SystemBars:\s*\{[\s\S]*?insetsHandling:\s*'disable'/);
});

test('debug APK overlay preserves native HTTP and safe-area settings', () => {
  const overlay = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../web/android/app/src/debug/assets/capacitor.config.json'),
      'utf8'
    )
  );
  assert.equal(overlay.server.url, undefined);
  assert.equal(overlay.plugins.CapacitorHttp.enabled, true);
  assert.equal(overlay.plugins.SystemBars.insetsHandling, 'disable');
});

test('Android build uses root-absolute assets and a dedicated output directory', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../web/package.json'), 'utf8')
  );
  assert.match(packageJson.scripts.build, /vite build --mode web/);
  assert.match(packageJson.scripts['build:android'], /vite build --mode android --base=\//);
  assert.match(packageJson.scripts['build:android'], /--outDir=dist-android/);
  assert.doesNotMatch(packageJson.scripts['build:android'], /--base=\.\//);

  const capacitorConfig = fs.readFileSync(
    path.resolve(__dirname, '../../web/capacitor.config.ts'),
    'utf8'
  );
  assert.match(capacitorConfig, /webDir:\s*'dist-android'/);
  assert.doesNotMatch(capacitorConfig, /webDir:\s*'\.\.\/public\/v5'/);

  const viteConfig = fs.readFileSync(
    path.resolve(__dirname, '../../web/vite.config.ts'),
    'utf8'
  );
  assert.match(viteConfig, /mode === 'web'/);
  assert.match(viteConfig, /import\.meta\.env\.VITE_API_ORIGIN/);
  assert.match(viteConfig, /JSON\.stringify\(''\)/);

  const debugOverlay = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../web/android/app/src/debug/assets/capacitor.config.json'),
      'utf8'
    )
  );
  assert.equal(debugOverlay.webDir, 'dist-android');
});
test('registration approval code is masked by default and only revealed temporarily', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../web/src/features/users/user-access-management-page.tsx'),
    'utf8'
  );
  assert.match(source, /data-sensitive-approval-code/);
  assert.match(source, /revealed \? query\.data\.code : '•••• •••• ••••'/);
  assert.match(source, /setRevealed\(false\)[\s\S]*?10_000/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?void copyCode\(\);[\s\S]*?\}, 650\)/);
});
