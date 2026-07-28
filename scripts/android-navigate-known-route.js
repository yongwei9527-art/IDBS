const WebSocket = require('ws');

const route = process.argv[2];
const allowedRoutes = new Set([
  '/devices',
  '/reserve',
  '/me/reservations',
  '/me/profile',
  '/materials',
  '/calendar',
  '/borrow',
  '/faults',
  '/notifications',
  '/support/contacts',
  '/admin/dashboard',
  '/admin/devices',
  '/admin/reservations',
  '/admin/users',
  '/admin/faults',
  '/admin/maintenance',
  '/admin/requests',
  '/admin/stats',
  '/admin/export',
  '/admin/system',
  '/admin/audit'
]);

if (!allowedRoutes.has(route)) {
  throw new Error('Route is not in the audited static-route allowlist.');
}

async function main() {
  const targets = await fetch('http://127.0.0.1:9222/json').then((response) => response.json());
  const target = targets.find((item) => item.type === 'page');
  if (!target) throw new Error('No debuggable WebView page found.');

  const origin = new URL(target.url).origin;
  if (origin !== 'https://localhost' && origin !== 'http://127.0.0.1:5173') {
    throw new Error('Unexpected WebView origin.');
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;

  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Page.navigate', { url: `${origin}${route}` });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  socket.close();
  process.stdout.write('Known route navigation completed.\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
