const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createChatService } = require('../../src/services/domains/chat/chat-service');

const sender = { id: 'sender-1', name: 'Sender', phone: '13800000000', role: 'user' };
const recipientId = 'recipient-1';
const conversationId = 'conversation-1';
const managementGroup = {
  id: 'management-group-1',
  type: 'group',
  system_key: 'lab_management',
  is_system: true,
  title: 'Management group',
  retention_days: 7
};

function createChatServiceHarness() {
  const published = [];
  let id = 0;
  const client = {
    async query() {
      return { rowCount: 1, rows: [] };
    }
  };
  const service = createChatService({
    adminPermissionContextForUser: async () => ({ canAnnounce: false, canKick: false, permissions: [] }),
    assertText(value) {
      const text = String(value || '').trim();
      if (!text) throw new Error('required');
      return text;
    },
    authTokenFromReq: () => 'test-token',
    createUserNotification: async () => {},
    fail: (message, status, code) => ({ ok: false, message, status, code }),
    log: async () => {},
    nowIso: () => '2026-07-29T12:00:00.000Z',
    ok: (data) => ({ ok: true, data }),
    parseBoolean: () => false,
    async query(sql) {
      const text = String(sql);
      if (text.includes('select user_id from chat_participants where conversation_id = $1 and user_id <> $2')) {
        return [{ user_id: recipientId }];
      }
      return { rowCount: 0, rows: [] };
    },
    async queryOne(sql) {
      if (String(sql).includes('from chat_conversations c') && String(sql).includes('where c.id = $1 and p.user_id = $2')) {
        return { ...managementGroup, id: conversationId };
      }
      return null;
    },
    realtimePublisher: async (channel, event) => {
      published.push({ channel, event });
    },
    requireUser: async () => sender,
    async rowsFrom(_runQuery, sql) {
      const text = String(sql);
      if (text.includes('select * from chat_conversations where system_key = $1')) return [managementGroup];
      return [];
    },
    resolveServiceAuth: () => ({ user_id: sender.id }),
    uuid: () => `message-${++id}`,
    withTransaction: async (run) => run(client)
  });
  return { published, service };
}

function parseSsePayloads(writes) {
  return writes
    .filter((entry) => entry.startsWith('data: '))
    .map((entry) => JSON.parse(entry.slice('data: '.length)));
}

test('chat message events mark only notification recipients while SSE and conversation payloads remain shared', async () => {
  const { published, service } = createChatServiceHarness();
  const request = new EventEmitter();
  const writes = [];
  const response = {
    writeHead() {},
    flushHeaders() {},
    write(value) { writes.push(String(value)); }
  };

  await service.streamChatEvents(request, response);
  const result = await service.sendChatMessage({ conversation_id: conversationId, content: 'hello' }, 'test-token');
  request.emit('close');

  assert.equal(result.ok, true);

  const senderNotification = published.find(({ channel }) => channel === `notifications:${sender.id}`);
  const recipientNotification = published.find(({ channel }) => channel === `notifications:${recipientId}`);
  const conversationEvent = published.find(({ channel }) => channel === `chat:${conversationId}`);

  assert.ok(senderNotification, 'sender receives a notification-channel event');
  assert.ok(recipientNotification, 'recipient receives a notification-channel event');
  assert.ok(conversationEvent, 'conversation channel receives the shared event');
  assert.equal(senderNotification.event.payload.is_sender, true);
  assert.equal(recipientNotification.event.payload.is_sender, false);
  assert.equal(Object.hasOwn(conversationEvent.event.payload, 'is_sender'), false);

  const messagePayload = parseSsePayloads(writes).find((payload) => payload.message?.conversation_id === conversationId);
  assert.ok(messagePayload, 'sender SSE stream receives the message payload');
  assert.equal(Object.hasOwn(messagePayload, 'is_sender'), false);
});
