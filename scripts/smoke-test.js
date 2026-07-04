require('dotenv').config();

const baseUrl = ((process.argv[2] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, ''));
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.text();
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch (_) {
    json = null;
  }
  return { response, body, json };
}

async function check(name, path, expectedStatuses = [200], options = {}) {
  const { response, body, json } = await request(path, options);
  const contentType = response.headers.get('content-type') || '';
  const expectsJson = path.startsWith('/api') || path === '/health' || path === '/ready';
  const validJson = !expectsJson || (contentType.includes('application/json') && json && (response.ok ? json.ok !== false : json.ok === false));
  const ok = expectedStatuses.includes(response.status) && validJson;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} -> ${response.status}`);
  if (!ok) {
    console.log(body.slice(0, 1000));
    process.exitCode = 1;
  }
  return { response, body, json, ok };
}

async function checkAdminEndpoints() {
  if (!adminPassword) {
    console.log('SKIP admin endpoints -> SMOKE_ADMIN_PASSWORD/ADMIN_PASSWORD is not set');
    return;
  }

  const login = await check('admin login', '/api/admin/auth/login', [200], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: adminPassword })
  });
  const token = login.json?.data?.token;
  if (!token) {
    console.log('FAIL admin login token -> missing token in response');
    process.exitCode = 1;
    return;
  }

  const auth = { Authorization: `Bearer ${token}` };
  await check('admin dashboard', '/api/admin/dashboard', [200], { headers: auth });
  await check('admin analytics overview', '/api/admin/analytics/overview?range=7d', [200], { headers: auth });
  await check('admin analytics device usage', '/api/admin/analytics/device-usage', [200], { headers: auth });
  await check('admin analytics time heatmap', '/api/admin/analytics/time-heatmap?range=7d', [200], { headers: auth });
  await check('admin analytics faults', '/api/admin/analytics/faults?range=7d', [200], { headers: auth });
  await check('admin operation logs', '/api/admin/operation-logs?limit=5', [200], { headers: auth });
  const users = await check('admin users', '/api/admin/users', [200], { headers: auth });
  const firstUser = users.json?.data?.users?.[0];
  if (firstUser?.id) {
    await check('admin user detail', `/api/admin/users/${encodeURIComponent(firstUser.id)}/detail`, [200], { headers: auth });
  }
  const devices = await check('admin devices', '/api/admin/devices', [200], { headers: auth });
  const firstDevice = devices.json?.data?.devices?.[0];
  if (firstDevice?.id) {
    await check('admin device detail', `/api/admin/devices/${encodeURIComponent(firstDevice.id)}/detail`, [200], { headers: auth });
  }
  await check('admin export usage', '/api/admin/exports/usage', [200], { headers: auth });
  await check('admin export device summary', '/api/admin/exports/device_summary', [200], { headers: auth });
  await check('chat users', '/api/chat/users', [200], { headers: auth });
  await check('chat conversations', '/api/chat/conversations', [200], { headers: auth });
  await checkChatEvents(token);
}

async function checkChatEvents(token) {
  const ctrl = new AbortController();
  let timer = null;
  try {
    const response = await fetch(`${baseUrl}/api/chat/events?token=${encodeURIComponent(token)}`, { signal: ctrl.signal });
    const contentType = response.headers.get('content-type') || '';
    const ok = response.status === 200 && contentType.includes('text/event-stream');
    console.log(`${ok ? 'PASS' : 'FAIL'} chat events -> ${response.status}`);
    if (!ok) process.exitCode = 1;
    timer = setTimeout(() => ctrl.abort(), 2000);
    const chunk = await response.body.getReader().read();
    const text = Buffer.from(chunk.value || []).toString('utf8');
    if (!text.includes('event: ready')) {
      console.log('FAIL chat events ready -> missing ready event');
      process.exitCode = 1;
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.log(`FAIL chat events -> ${error.message}`);
      process.exitCode = 1;
    }
  } finally {
    if (timer) clearTimeout(timer);
    ctrl.abort();
  }
}

async function main() {
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error(`Invalid SMOKE_BASE_URL: ${baseUrl}`);
  }

  console.log(`Smoke testing ${baseUrl}`);
  await check('health', '/health', [200]);
  await check('ready', '/ready', [200, 503]);
  await check('device list', '/api/devices', [200]);
  await check('notifications require auth', '/api/notifications', [401]);
  await check('reservation precheck requires auth', '/api/reservation-batches/precheck', [401], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  await checkAdminEndpoints();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
