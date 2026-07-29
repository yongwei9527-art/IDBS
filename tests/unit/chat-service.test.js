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

function createChatServiceHarness(options = {}) {
  const actor = options.actor || sender;
  const published = [];
  const pushCalls = [];
  const transactionQueries = [];
  let id = 0;
  const client = {
    async query(sql, params = []) {
      transactionQueries.push({ sql: String(sql), params });
      return { rowCount: 1, rows: [] };
    }
  };
  const service = createChatService({
    adminPermissionContextForUser: async () => ({
      canAnnounce: Boolean(options.canAnnounce),
      canKick: false,
      permissions: options.canAnnounce ? ['chat.announce'] : []
    }),
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
      if (text.includes("m.message_type = 'announcement'")) {
        return options.announcements || [];
      }
      if (text.includes('select p.conversation_id, p.role as participant_role')) return options.participants || [];
      if (text.includes('select distinct on (m.conversation_id)')) return options.latestMessages || [];
      if (text.includes('count(m.id)::int as unread_count')) return options.unreadRows || [];
      if (text.includes('select *') && text.includes('u.role as sender_role') && text.includes('from chat_messages m')) return options.messages || [];
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
    requireUser: async () => actor,
    sendPushMessage: async (input) => { pushCalls.push(input); },
    async rowsFrom(_runQuery, sql) {
      const text = String(sql);
      if (text.includes('select * from chat_conversations where system_key = $1')) return [managementGroup];
      return [];
    },
    resolveServiceAuth: () => ({ user_id: actor.id }),
    uuid: () => `message-${++id}`,
    withTransaction: async (run) => run(client)
  });
  return { actor, published, pushCalls, service, transactionQueries };
}

function parseSsePayloads(writes) {
  return writes
    .filter((entry) => entry.startsWith('data: '))
    .map((entry) => JSON.parse(entry.slice('data: '.length)));
}

test('chat message events mark only notification recipients while SSE and conversation payloads remain shared', async () => {
  const { published, pushCalls, service } = createChatServiceHarness();
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
  assert.equal(result.data.message.sender_phone, sender.phone, 'the sender can receive their own phone in the mutation response');
  assert.equal(conversationEvent.event.payload.message.sender_phone, '', 'shared realtime events never expose an ordinary sender phone');
  assert.equal(senderNotification.event.payload.is_sender, true);
  assert.equal(recipientNotification.event.payload.is_sender, false);
  assert.equal(Object.hasOwn(conversationEvent.event.payload, 'is_sender'), false);

  const messagePayload = parseSsePayloads(writes).find((payload) => payload.message?.conversation_id === conversationId);
  assert.ok(messagePayload, 'sender SSE stream receives the message payload');
  assert.equal(Object.hasOwn(messagePayload, 'is_sender'), false);
  assert.deepEqual(pushCalls, [{ userIds: [recipientId], route: '/chat' }]);
});

test('only an authorized administrator can publish a management-group announcement', async () => {
  const ordinary = createChatServiceHarness();
  const denied = await ordinary.service.publishChatAnnouncement({
    conversation_id: conversationId,
    title: 'Notice',
    content: 'Ordinary users cannot publish this.'
  }, 'test-token');
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);

  const administrator = createChatServiceHarness({
    actor: { id: 'admin-1', name: 'Administrator', phone: '13800000001', role: 'admin' },
    canAnnounce: true
  });
  const published = await administrator.service.publishChatAnnouncement({
    conversation_id: conversationId,
    title: 'Safety notice',
    content: 'Wear protective equipment before entering the laboratory.'
  }, 'test-token');

  assert.equal(published.ok, true);
  assert.equal(published.data.announcement.title, 'Safety notice');
  assert.ok(
    administrator.transactionQueries.some(({ sql }) => sql.includes("'announcement'")),
    'announcement is persisted as an immutable chat announcement version'
  );
  assert.deepEqual(administrator.pushCalls, [{ userIds: [recipientId], route: '/chat' }]);
});

test('management-group announcement history returns the latest and previous versions', async () => {
  const announcements = [
    { id: 'announcement-2', title: 'Current', content: 'Current notice', created_at: '2026-07-29T12:00:00.000Z' },
    { id: 'announcement-1', title: 'Previous', content: 'Previous notice', created_at: '2026-07-28T12:00:00.000Z' }
  ];
  const harness = createChatServiceHarness({ announcements });
  const result = await harness.service.listChatAnnouncements({ conversation_id: conversationId }, 'test-token');

  assert.equal(result.ok, true);
  assert.equal(result.data.latest.id, 'announcement-2');
  assert.deepEqual(result.data.announcements.map((item) => item.id), ['announcement-2', 'announcement-1']);
  assert.equal(result.data.can_edit, false);
});

test('ordinary chat users cannot receive peer phone numbers while admins retain operational access', async () => {
  const participants = [
    { conversation_id: conversationId, id: sender.id, name: sender.name, phone: sender.phone, role: 'user', participant_role: 'member' },
    { conversation_id: conversationId, id: 'peer-1', name: 'Peer', phone: '13900000001', role: 'user', participant_role: 'member' },
    { conversation_id: conversationId, id: 'admin-1', name: 'Administrator', phone: '13900000002', role: 'admin', participant_role: 'admin' }
  ];
  const messages = [
    { id: 'message-peer', conversation_id: conversationId, sender_id: 'peer-1', sender_name: 'Peer', sender_phone: '13900000001', sender_role: 'user', message_type: 'text', content: 'peer', created_at: '2026-07-29T11:00:00.000Z' },
    { id: 'message-admin', conversation_id: conversationId, sender_id: 'admin-1', sender_name: 'Administrator', sender_phone: '13900000002', sender_role: 'admin', message_type: 'text', content: 'admin', created_at: '2026-07-29T11:01:00.000Z' }
  ];

  const ordinary = createChatServiceHarness({ participants, messages });
  const ordinaryResult = await ordinary.service.listChatMessages({ conversation_id: conversationId }, 'test-token');
  assert.equal(ordinaryResult.ok, true);
  const ordinaryMembers = ordinaryResult.data.conversation.participants;
  assert.equal(ordinaryMembers.find((user) => user.id === sender.id).phone, sender.phone, 'a user can see their own phone');
  assert.equal(ordinaryMembers.find((user) => user.id === 'peer-1').phone, '', 'a peer user phone is redacted');
  assert.equal(ordinaryMembers.find((user) => user.id === 'admin-1').phone, '13900000002', 'an administrator contact remains visible');
  assert.equal(ordinaryResult.data.messages[0].sender_phone, '', 'peer phone is absent from message history');
  assert.equal(ordinaryResult.data.messages[1].sender_phone, '13900000002');
  assert.equal(Object.hasOwn(ordinaryResult.data.messages[0], 'sender_role'), false, 'internal sender role is not exposed');

  const adminActor = { id: 'admin-viewer', name: 'Admin Viewer', phone: '13900000003', role: 'admin' };
  const administrator = createChatServiceHarness({ actor: adminActor, participants, messages });
  const adminResult = await administrator.service.listChatMessages({ conversation_id: conversationId }, 'test-token');
  assert.equal(adminResult.data.conversation.participants.find((user) => user.id === 'peer-1').phone, '13900000001');
  assert.equal(adminResult.data.messages[0].sender_phone, '13900000001');
});
