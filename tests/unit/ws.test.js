const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocket } = require('ws');
const { issueJwt } = require('../../src/lib/auth');
const { createWsGateway } = require('../../src/lib/ws');

function messageQueue(ws) {
  const queued = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      waiter.resolve(message);
    } else queued.push(message);
  });
  return function next(predicate, timeoutMs = 2000) {
    const index = queued.findIndex(predicate);
    if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), timeoutMs);
      waiters.push({
        predicate,
        resolve(message) {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });
  };
}

test('WebSocket authenticates in the first frame and rejects unauthorized channels', async (t) => {
  const previousSecret = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = 'unit-test-token-secret-that-is-at-least-32-characters';
  const server = http.createServer();
  const gateway = createWsGateway(server, {
    resolvePrincipal: async (auth) => auth,
    authorizeChannel: async (auth, channel) => auth.sub === 'user-1' && channel === 'chat:allowed'
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    gateway.close();
    await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.TOKEN_SECRET;
    else process.env.TOKEN_SECRET = previousSecret;
  });

  const address = server.address();
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/v5/ws`);
  const next = messageQueue(ws);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  const token = issueJwt({ sub: 'user-1', role: 'user', scope: 'user', perms: [] }, { type: 'access' });
  ws.send(JSON.stringify({ type: 'auth', token }));
  const ready = await next((message) => message.type === 'ready');
  assert.equal(ready.payload.sub, 'user-1');

  ws.send(JSON.stringify({ type: 'subscribe', channel: 'chat:forbidden' }));
  const denied = await next((message) => message.type === 'error');
  assert.equal(denied.payload.code, 'channel_forbidden');

  ws.send(JSON.stringify({ type: 'subscribe', channel: 'chat:allowed' }));
  await next((message) => message.type === 'subscribed' && message.channel === 'chat:allowed');
  gateway.broadcast('chat:allowed', { type: 'new_message', channel: 'chat:allowed', payload: { id: 'm1' } });
  const event = await next((message) => message.type === 'new_message');
  assert.equal(event.payload.id, 'm1');
  ws.close();
});
