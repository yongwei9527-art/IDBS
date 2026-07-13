const { WebSocketServer } = require('ws');
const { verifyJwt } = require('./auth');

const AUTH_TIMEOUT_MS = 10_000;
const MESSAGE_WINDOW_MS = 60_000;
const MESSAGE_LIMIT = 120;

/**
 * 统一 WebSocket 网关：实时通知 + 聊天 + 审批/借还状态变化。
 * 客户端连接后必须先发送 { type: 'auth', token }，避免把令牌暴露在 URL/代理日志中。
 */
function createWsGateway(server, options = {}) {
  const {
    authorizeChannel = async () => false,
    resolvePrincipal = async (payload) => payload,
    isOriginAllowed = () => true
  } = options;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const channels = new Map();

  function ensureChannel(name) {
    if (!channels.has(name)) channels.set(name, new Set());
    return channels.get(name);
  }

  function send(ws, message) {
    if (ws.readyState !== 1) return false;
    ws.send(typeof message === 'string' ? message : JSON.stringify(message));
    return true;
  }

  function broadcast(channel, message) {
    const subscribers = channels.get(channel);
    if (!subscribers) return 0;
    let delivered = 0;
    for (const ws of [...subscribers]) {
      if (send(ws, message)) delivered += 1;
      else subscribers.delete(ws);
    }
    if (!subscribers.size) channels.delete(channel);
    return delivered;
  }

  function subscribe(ws, channel) {
    ensureChannel(channel).add(ws);
    if (!ws.subscriptions) ws.subscriptions = new Set();
    ws.subscriptions.add(channel);
  }

  function unsubscribeAll(ws) {
    if (!ws.subscriptions) return;
    for (const channel of ws.subscriptions) {
      const subscribers = channels.get(channel);
      if (!subscribers) continue;
      subscribers.delete(ws);
      if (!subscribers.size) channels.delete(channel);
    }
    ws.subscriptions.clear();
  }

  function withinMessageLimit(ws) {
    const now = Date.now();
    if (!ws.messageWindow || now - ws.messageWindow.startedAt >= MESSAGE_WINDOW_MS) {
      ws.messageWindow = { startedAt: now, count: 1 };
      return true;
    }
    ws.messageWindow.count += 1;
    return ws.messageWindow.count <= MESSAGE_LIMIT;
  }

  async function attachAuth(ws, token) {
    const verified = verifyJwt(token, { type: 'access' });
    if (!verified) {
      ws.close(4401, 'unauthorized');
      return null;
    }
    const payload = await resolvePrincipal(verified);
    if (!payload?.sub) {
      ws.close(4403, 'principal unavailable');
      return null;
    }
    unsubscribeAll(ws);
    ws.auth = payload;
    clearTimeout(ws.authTimer);
    subscribe(ws, `notifications:${payload.sub}`);
    send(ws, { type: 'ready', channel: 'system', payload: { sub: payload.sub, role: payload.role } });
    return payload;
  }

  async function onMessage(ws, raw) {
    if (!withinMessageLimit(ws)) {
      ws.close(4429, 'too many messages');
      return;
    }

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (_) {
      send(ws, { type: 'error', payload: { code: 'invalid_json', message: '消息格式不正确。' } });
      return;
    }
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'auth' && typeof message.token === 'string') {
      await attachAuth(ws, message.token);
      return;
    }
    if (!ws.auth) {
      send(ws, { type: 'error', payload: { code: 'authentication_required', message: '请先完成连接鉴权。' } });
      return;
    }

    if (message.type === 'subscribe' && typeof message.channel === 'string') {
      const channel = message.channel.trim().slice(0, 160);
      const allowed = channel === `notifications:${ws.auth.sub}`
        || await authorizeChannel(ws.auth, channel);
      if (!allowed) {
        send(ws, { type: 'error', channel, payload: { code: 'channel_forbidden', message: '没有权限订阅该实时频道。' } });
        return;
      }
      subscribe(ws, channel);
      send(ws, { type: 'subscribed', channel });
      return;
    }

    if (message.type === 'unsubscribe' && typeof message.channel === 'string') {
      const channel = message.channel.trim().slice(0, 160);
      const subscribers = channels.get(channel);
      if (subscribers) {
        subscribers.delete(ws);
        if (!subscribers.size) channels.delete(channel);
      }
      ws.subscriptions?.delete(channel);
      return;
    }

    if (message.type === 'ping') send(ws, { type: 'pong' });
  }

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/api/v5/ws') {
      socket.destroy();
      return;
    }
    if (!isOriginAllowed(req.headers.origin || '', req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.auth = null;
      ws.subscriptions = new Set();
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (raw) => {
        onMessage(ws, raw).catch(() => ws.close(1011, 'realtime error'));
      });
      ws.on('close', () => {
        clearTimeout(ws.authTimer);
        unsubscribeAll(ws);
      });
      ws.authTimer = setTimeout(() => {
        if (!ws.auth) ws.close(4401, 'authentication timeout');
      }, AUTH_TIMEOUT_MS);
    });
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) {}
    }
  }, 30_000);
  interval.unref?.();

  return {
    wss,
    broadcast,
    close() {
      clearInterval(interval);
      for (const ws of wss.clients) ws.close(1001, 'server shutdown');
      wss.close();
    }
  };
}

module.exports = { createWsGateway };
