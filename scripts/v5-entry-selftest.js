const http = require('http');
const path = require('path');
const { createApp } = require('../src/app/create-app');

function createServiceMock() {
  return new Proxy({ shouldBlockIpAccess: async () => false }, {
    get(target, prop) { return prop in target ? target[prop] : async () => ({ ok: true, data: {} }); }
  });
}

async function startServer() {
  const app = createApp({
    config: {
      publicDir: path.join(__dirname, '..', 'public'), uploadDir: path.join(__dirname, '..', 'uploads'),
      corsOrigin: '*', apiRateLimitWindowMs: 60_000, apiRateLimitMax: 100, authRateLimitWindowMs: 60_000, authRateLimitMax: 100
    },
    db: {}, service: createServiceMock(), server: null
  });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, resolve); });
  return server;
}

async function expectStatus(baseUrl, pathAndQuery, expectedStatus) {
  const response = await fetch(`${baseUrl}${pathAndQuery}`, { redirect: 'manual' });
  if (response.status !== expectedStatus) throw new Error(`${pathAndQuery} expected ${expectedStatus}, got ${response.status}`);
  console.log('status ok', pathAndQuery, response.status);
}

(async () => {
  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const root = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    if (root.status !== 302 || root.headers.get('location') !== '/v5/') throw new Error('root must redirect to the canonical /v5/ entry');
    await expectStatus(baseUrl, '/v5/', 200);
    await expectStatus(baseUrl, '/v5/login', 200);
    for (const oldPath of ['/v3', '/v3/login', '/index.html', '/login.html', '/register.html', '/admin.html', '/reserve.html', '/my.html', '/calendar.html', '/calendar-detail.html', '/chat.html', '/device.html']) {
      await expectStatus(baseUrl, oldPath, 404);
    }
    await expectStatus(baseUrl, '/api/v3/devices', 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error('V5 entry selftest failed');
  console.error(error);
  process.exit(1);
});