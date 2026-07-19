const { AppError } = require('../../../lib/app-error');
const {
  chatCardContent: buildChatCardContent,
  normalizeChatAttachments,
  normalizeChatMetadata,
  relatedIdForChatMessage: resolveRelatedIdForChatMessage,
  relatedTypeForChatMessage: resolveRelatedTypeForChatMessage
} = require('../../core/chat-utils');

const MANAGEMENT_GROUP_KEY = 'lab_management';
const MANAGEMENT_GROUP_TITLE = '实验管理总群';
const MANAGEMENT_GROUP_RETENTION_DAYS = 7;
const TEMP_GROUP_TTL_DAYS = 2;
const TEMP_GROUP_WARN_HOURS = 6;
const PENDING_ACCOUNT_TTL_DAYS = 3;
const CHAT_MESSAGE_TYPES = new Set(['text', 'image', 'file', 'system', 'device_card', 'reservation_card', 'fault_card', 'user_request_card']);
const CHAT_CARD_LABELS = {
  device_card: '设备卡片',
  reservation_card: '预约卡片',
  fault_card: '故障卡片',
  user_request_card: '需求卡片'
};
const CHAT_CARD_RELATED_TYPES = {
  device_card: 'device',
  reservation_card: 'reservation',
  fault_card: 'fault_report',
  user_request_card: 'user_request'
};

function createChatService(context = {}) {
  const {
    adminPermissionContextForUser,
    assertText,
    authTokenFromReq,
    createUserNotification,
    fail,
    getById,
    log,
    nowIso,
    ok,
    parseBoolean,
    query,
    queryOne,
    realtimePublisher = async () => 0,
    requireUser,
    rowsFrom,
    uuid,
    resolveServiceAuth,
    withTransaction
  } = context;

  const chatEventClients = new Map();

  function chatCardContent(messageType, metadata = {}) {
    return buildChatCardContent(messageType, metadata, CHAT_CARD_LABELS);
  }

  function relatedTypeForChatMessage(messageType, payload = {}, metadata = {}) {
    return String(resolveRelatedTypeForChatMessage(messageType, payload, metadata, CHAT_CARD_RELATED_TYPES) || '').trim().slice(0, 60);
  }

  function relatedIdForChatMessage(payload = {}, metadata = {}) {
    return String(resolveRelatedIdForChatMessage('', payload, metadata) || '').trim().slice(0, 160);
  }

  async function assertChatReady() {
    return true;
  }

  function publicChatUser(user = {}) {
    return {
      id: user.id,
      name: user.name || '-',
      phone: user.phone || '',
      student_no: user.student_no || '',
      role: user.role || 'user',
      can_announce: Boolean(user.can_announce),
      can_kick: Boolean(user.can_kick),
      wechat_nickname: user.wechat_nickname || ''
    };
  }

  async function publicChatUserWithPermissions(user = {}) {
    const context = await adminPermissionContextForUser(user);
    return publicChatUser({ ...user, can_announce: context.canAnnounce, can_kick: context.canKick });
  }

  function isChatAdministrator(user = {}) {
    return ['admin', 'super_admin'].includes(String(user.role || ''));
  }

  async function conversationMatchesChatPolicy(conversation = {}) {
    if (!conversation?.id) return false;
    if (conversation.type === 'group') {
      if (isManagementGroup(conversation)) return true;
      const owner = conversation.created_by
        ? await queryOne('select role from users where id = $1 limit 1', [conversation.created_by])
        : null;
      return owner?.role === 'super_admin';
    }
    if (conversation.type !== 'direct') return false;
    const members = await query(`
      select u.role
      from chat_participants p
      join users u on u.id = p.user_id
      where p.conversation_id = $1
    `, [conversation.id]);
    return members.length === 2
      && members.some(isChatAdministrator)
      && members.some((member) => !isChatAdministrator(member));
  }

  async function requireChatActor(token) {
    const payload = resolveServiceAuth(token);
    if (!payload) throw new AppError('未登录或登录已过期。', { status: 401, code: 1001 });
    if (payload.user_id) return requireUser(token);
    if (['admin', 'super_admin'].includes(payload.role) || payload.admin_role_key) {
      const adminUser = await queryOne(`
        select *
        from users
        where status = 'active'
          and coalesce(is_banned, false) = false
          and role in ('super_admin','admin')
        order by case role when 'super_admin' then 0 else 1 end, created_at asc
        limit 1
      `);
      if (adminUser) return adminUser;
      throw new AppError('后台密码登录需要至少一个启用的管理员用户才能发起聊天。', { status: 409, code: 3001 });
    }
    throw new AppError('未登录或登录已过期。', { status: 401, code: 1001 });
  }

  async function resolveRealtimePrincipal(auth = {}) {
    const userId = String(auth.sub || '').trim();
    if (userId && userId !== 'admin') {
      const user = await queryOne(`
        select id, role
        from users
        where id = $1 and status = 'active' and coalesce(is_banned, false) = false
        limit 1
      `, [userId]);
      return user ? { ...auth, sub: user.id, role: auth.role || user.role } : null;
    }
    if (['admin', 'super_admin'].includes(auth.role) || auth.scope === 'admin') {
      const adminUser = await queryOne(`
        select id, role
        from users
        where status = 'active'
          and coalesce(is_banned, false) = false
          and role in ('super_admin','admin')
        order by case role when 'super_admin' then 0 else 1 end, created_at asc
        limit 1
      `);
      return adminUser ? { ...auth, sub: adminUser.id, role: auth.role || adminUser.role } : null;
    }
    return null;
  }

  async function canSubscribeChatChannel(userId, conversationId) {
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(conversationId))) return false;
    const participant = await queryOne(`
      select 1 as allowed
      from chat_participants p
      join chat_conversations c on c.id = p.conversation_id
      where p.user_id = $1 and p.conversation_id = $2
      limit 1
    `, [userId, conversationId]);
    return Boolean(participant);
  }

  function writeChatEvent(res, event, data = {}) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  function addChatEventClient(userId, res) {
    if (!chatEventClients.has(userId)) chatEventClients.set(userId, new Set());
    chatEventClients.get(userId).add(res);
  }

  function removeChatEventClient(userId, res) {
    const clients = chatEventClients.get(userId);
    if (!clients) return;
    clients.delete(res);
    if (!clients.size) chatEventClients.delete(userId);
  }

  async function publishChatEvent(userIds = [], event, data = {}) {
    const targetIds = [...new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    const payload = { ...data, server_time: nowIso() };
    const realtimeType = event === 'message' ? 'new_message' : event;
    for (const userId of targetIds) {
      const clients = chatEventClients.get(userId);
      if (clients) {
        for (const res of [...clients]) {
          try {
            writeChatEvent(res, event, payload);
          } catch (_) {
            removeChatEventClient(userId, res);
          }
        }
      }
      const channel = `notifications:${userId}`;
      await realtimePublisher(channel, { type: realtimeType, channel, payload });
    }
    const conversationId = String(data.conversation_id || '').trim();
    if (conversationId) {
      const channel = `chat:${conversationId}`;
      await realtimePublisher(channel, { type: realtimeType, channel, payload });
    }
  }

  async function streamChatEvents(req, res) {
    await assertChatReady();
    const actor = await requireChatActor(authTokenFromReq(req));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    addChatEventClient(actor.id, res);
    writeChatEvent(res, 'ready', { current_user: await publicChatUserWithPermissions(actor), server_time: nowIso() });
    const heartbeat = setInterval(() => {
      try {
        writeChatEvent(res, 'heartbeat', { server_time: nowIso() });
      } catch (_) {
        clearInterval(heartbeat);
        removeChatEventClient(actor.id, res);
      }
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      removeChatEventClient(actor.id, res);
    });
  }

  async function listChatUsers(params = {}, token) {
    await assertChatReady();
    await ensureManagementGroup();
    const actor = await requireChatActor(token);
    const keyword = String(params.keyword || '').trim();
    const sqlParams = [actor.id];
    let where = "where status = 'active' and coalesce(is_banned, false) = false and id <> $1";
    where += isChatAdministrator(actor)
      ? " and role not in ('super_admin','admin')"
      : " and role in ('super_admin','admin')";
    if (keyword) {
      sqlParams.push(`%${keyword}%`);
      where += ` and (name ilike $${sqlParams.length} or phone ilike $${sqlParams.length} or coalesce(student_no, '') ilike $${sqlParams.length})`;
    }
    const users = await query(`
      select id, name, phone, student_no, role, wechat_nickname
      from users
      ${where}
      order by case when role in ('super_admin','admin') then 0 else 1 end, name asc, created_at asc
      limit 100
    `, sqlParams);
    return ok({ users: (users || []).map(publicChatUser), current_user: await publicChatUserWithPermissions(actor) });
  }

  async function conversationForActor(conversationId, actorId) {
    const conversation = await queryOne(`
      select c.*
      from chat_conversations c
      join chat_participants p on p.conversation_id = c.id
      where c.id = $1 and p.user_id = $2
      limit 1
    `, [conversationId, actorId]);
    return conversation && await conversationMatchesChatPolicy(conversation) ? conversation : null;
  }

  async function directConversationBetween(actorId, targetId) {
    return queryOne(`
      select c.*
      from chat_conversations c
      join chat_participants p1 on p1.conversation_id = c.id and p1.user_id = $1
      join chat_participants p2 on p2.conversation_id = c.id and p2.user_id = $2
      where c.type = 'direct'
        and not exists (
          select 1 from chat_participants px
          where px.conversation_id = c.id and px.user_id <> all($3::uuid[])
        )
      limit 1
    `, [actorId, targetId, [actorId, targetId]]);
  }

  function allowsAllChatMembers(value) {
    const text = String(value || '').trim().toLowerCase();
    return value === true || text === 'true' || text === '1';
  }

  async function activeChatUserCount() {
    const row = await queryOne("select count(*)::int as count from users where status = 'active' and coalesce(is_banned, false) = false");
    return Number(row?.count || 0);
  }

  async function chatSystemColumnsReady() {
    return true;
  }

  async function cleanupExpiredPendingUsers(runQuery = query) {
    const result = await runQuery(`
      delete from users
      where status = 'pending'
        and coalesce(updated_at, created_at) < now() - ($1::int * interval '1 day')
        and not exists (select 1 from reservation_items ri where ri.user_id = users.id)
        and not exists (select 1 from reservation_batches rb where rb.user_id = users.id)
        and not exists (select 1 from borrow_records br where br.user_id = users.id)
    `, [PENDING_ACCOUNT_TTL_DAYS]);
    return Number(result.rowCount || 0);
  }

  async function cleanupManagementGroupMessages(conversationId, retentionDays = MANAGEMENT_GROUP_RETENTION_DAYS, runQuery = query) {
    if (!conversationId) return 0;
    const result = await runQuery(`
      delete from chat_messages
      where conversation_id = $1
        and created_at < now() - ($2::int * interval '1 day')
    `, [conversationId, retentionDays || MANAGEMENT_GROUP_RETENTION_DAYS]);
    return Number(result.rowCount || 0);
  }

  async function getManagementGroup() {
    await assertChatReady();
    return queryOne('select * from chat_conversations where system_key = $1 limit 1', [MANAGEMENT_GROUP_KEY]);
  }


  function formatExpireLabel(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch (_) {
      return String(iso);
    }
  }

  function remainingMs(expiresAt) {
    if (!expiresAt) return null;
    return new Date(expiresAt).getTime() - Date.now();
  }

  function remainingLabel(expiresAt) {
    const ms = remainingMs(expiresAt);
    if (ms == null) return '';
    if (ms <= 0) return '即将解散';
    const totalMinutes = Math.ceil(ms / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `剩余 ${days} 天 ${hours} 小时`;
    if (hours > 0) return `剩余 ${hours} 小时 ${minutes} 分`;
    return `剩余 ${minutes} 分钟`;
  }

  async function insertSystemChatMessage(conversationId, content, runQuery = query) {
    if (!conversationId || !content) return null;
    const id = uuid();
    const at = nowIso();
    await runQuery(`
      insert into chat_messages (
        id, conversation_id, sender_id, message_type, content, attachments, metadata, delivery_status, created_at
      ) values ($1,$2,null,'system',$3,'[]'::jsonb,'{}'::jsonb,'sent',$4)
    `, [id, conversationId, String(content).slice(0, 1500), at]);
    await runQuery('update chat_conversations set last_message_at = $1, updated_at = $1, last_message_preview = $2, last_message_type = $3 where id = $4', [
      at,
      String(content).slice(0, 200),
      'system',
      conversationId
    ]);
    return { id, conversation_id: conversationId, content, created_at: at, message_type: 'system' };
  }

  async function ensureTemporaryGroupExpiry(runQuery = query) {
    // Backfill expires_at for legacy temporary groups.
    await runQuery(`
      update chat_conversations
      set expires_at = created_at + ($1::int * interval '1 day'),
          retention_days = coalesce(retention_days, $1::int)
      where coalesce(is_system, false) = false
        and (system_key is null or system_key <> $2)
        and expires_at is null
    `, [TEMP_GROUP_TTL_DAYS, MANAGEMENT_GROUP_KEY]);
    await runQuery(`
      update chat_conversations
      set expires_at = null,
          dissolve_notified_at = null
      where system_key = $1
         or (coalesce(is_system, false) = true and title = $2)
    `, [MANAGEMENT_GROUP_KEY, MANAGEMENT_GROUP_TITLE]);
  }

  async function warnExpiringTemporaryGroups(runQuery = query) {
    const rows = await rowsFrom(runQuery, `
      select c.id, c.title, c.type, c.expires_at
      from chat_conversations c
      where c.expires_at is not null
        and c.expires_at > now()
        and c.expires_at <= now() + ($1::int * interval '1 hour')
        and c.dissolve_notified_at is null
        and coalesce(c.is_system, false) = false
        and (c.system_key is null or c.system_key <> $2)
    `, [TEMP_GROUP_WARN_HOURS, MANAGEMENT_GROUP_KEY]);

    let warned = 0;
    for (const group of rows || []) {
      const label = formatExpireLabel(group.expires_at);
      const isGroup = group.type === 'group';
      const title = group.title || (isGroup ? '临时群聊' : '私聊会话');
      const content = isGroup
        ? `「${title}」将于 ${label} 自动解散，聊天记录将一并清除。请尽快完成沟通。`
        : `「${title}」将于 ${label} 自动结束，聊天记录将一并清除。请尽快完成沟通。`;
      await insertSystemChatMessage(group.id, content, runQuery);
      const members = await rowsFrom(runQuery, 'select user_id from chat_participants where conversation_id = $1', [group.id]);
      for (const member of members || []) {
        await createUserNotification({
          user_id: member.user_id,
          type: 'chat',
          title: isGroup ? '临时群即将解散' : '临时私聊即将结束',
          content,
          related_type: 'chat_conversation',
          related_id: group.id
        });
      }
      await runQuery('update chat_conversations set dissolve_notified_at = $1, updated_at = $1 where id = $2', [nowIso(), group.id]);
      await publishChatEvent((members || []).map((m) => m.user_id), 'conversation_changed', {
        conversation_id: group.id,
        reason: 'expiring_soon'
      });
      warned += 1;
    }
    return warned;
  }

  async function dissolveTemporaryGroup(group, runQuery = query) {
    if (!group?.id) return false;
    if (isManagementGroup(group)) return false;
    const members = await rowsFrom(runQuery, 'select user_id from chat_participants where conversation_id = $1', [group.id]);
    const isGroup = group.type === 'group';
    const title = group.title || (isGroup ? '临时群聊' : '私聊会话');
    const content = isGroup
      ? `「${title}」已满 ${TEMP_GROUP_TTL_DAYS} 天，系统已自动解散并清除聊天记录。`
      : `「${title}」已满 ${TEMP_GROUP_TTL_DAYS} 天，系统已自动结束会话并清除聊天记录。`;
    // Notifications first (conversation will be deleted).
    for (const member of members || []) {
      await createUserNotification({
        user_id: member.user_id,
        type: 'chat',
        title: isGroup ? '临时群已自动解散' : '临时私聊已自动结束',
        content,
        related_type: 'chat_conversation',
        related_id: group.id
      });
    }
    // Cascade deletes messages + participants.
    await runQuery('delete from chat_conversations where id = $1', [group.id]);
    await publishChatEvent((members || []).map((m) => m.user_id), 'conversation_deleted', {
      conversation_id: group.id,
      reason: 'auto_dissolved'
    });
    return true;
  }

  async function cleanupExpiredTemporaryGroups(runQuery = query) {
    await ensureTemporaryGroupExpiry(runQuery);
    await warnExpiringTemporaryGroups(runQuery);
    const rows = await rowsFrom(runQuery, `
      select *
      from chat_conversations
      where expires_at is not null
        and expires_at <= now()
        and coalesce(is_system, false) = false
        and (system_key is null or system_key <> $1)
    `, [MANAGEMENT_GROUP_KEY]);
    let dissolved = 0;
    for (const group of rows || []) {
      try {
        if (await dissolveTemporaryGroup(group, runQuery)) dissolved += 1;
      } catch (error) {
        // continue other groups
      }
    }
    return dissolved;
  }

  async function ensureManagementGroup(runQuery = query) {
    await assertChatReady();
    await cleanupExpiredPendingUsers(runQuery);
    let groupRows = await rowsFrom(runQuery, 'select * from chat_conversations where system_key = $1 limit 1', [MANAGEMENT_GROUP_KEY]);
    let group = groupRows[0] || null;
    if (!group) {
      const id = uuid();
      const now = nowIso();
      await runQuery(`
        insert into chat_conversations (id, type, title, system_key, is_system, retention_days, created_at, updated_at)
        values ($1,'group',$2,$3,true,$4,$5,$5)
        on conflict (system_key) where system_key is not null do update set title = excluded.title, is_system = true, retention_days = excluded.retention_days, updated_at = excluded.updated_at
      `, [id, MANAGEMENT_GROUP_TITLE, MANAGEMENT_GROUP_KEY, MANAGEMENT_GROUP_RETENTION_DAYS, now]);
      groupRows = await rowsFrom(runQuery, 'select * from chat_conversations where system_key = $1 limit 1', [MANAGEMENT_GROUP_KEY]);
      group = groupRows[0] || null;
    }

    const activeUsers = await rowsFrom(runQuery, `
      select id, role
      from users
      where status = 'active' and coalesce(is_banned, false) = false
    `);
    for (const user of activeUsers || []) {
      await runQuery(`
        insert into chat_participants (conversation_id, user_id, role, joined_at)
        values ($1,$2,$3,$4)
        on conflict (conversation_id, user_id) do update set
          role = case when excluded.role = 'admin' then 'admin' else chat_participants.role end
      `, [group.id, user.id, ['super_admin', 'admin'].includes(user.role) ? 'admin' : 'member', nowIso()]);
    }
    await cleanupManagementGroupMessages(group.id, Number(group.retention_days || MANAGEMENT_GROUP_RETENTION_DAYS), runQuery);
    await cleanupExpiredTemporaryGroups(runQuery);
    return group;
  }

  function isManagementGroup(conversation = {}) {
    return conversation.system_key === MANAGEMENT_GROUP_KEY
      || (conversation.type === 'group' && conversation.title === MANAGEMENT_GROUP_TITLE && conversation.is_system);
  }

  function canDissolveGroup(conversation = {}, actor = {}) {
    if (!conversation || conversation.type !== 'group' || isManagementGroup(conversation)) return false;
    return conversation.created_by === actor.id;
  }

  async function addUserToManagementGroup(userId, runQuery = query) {
    if (!userId) return false;
    await assertChatReady();
    const group = await ensureManagementGroup(runQuery);
    const userRows = await rowsFrom(runQuery, 'select id, role, status, is_banned from users where id = $1 limit 1', [userId]);
    const user = userRows[0];
    if (!group || !user || user.status !== 'active' || user.is_banned) return false;
    await runQuery(`
      insert into chat_participants (conversation_id, user_id, role, joined_at)
      values ($1,$2,$3,$4)
      on conflict (conversation_id, user_id) do update set role = excluded.role
    `, [group.id, userId, ['super_admin', 'admin'].includes(user.role) ? 'admin' : 'member', nowIso()]);
    return true;
  }

  async function removeUserFromManagementGroup(userId, runQuery = query) {
    if (!userId) return false;
    await assertChatReady();
    const group = await getManagementGroup();
    if (!group) return false;
    await runQuery('delete from chat_participants where conversation_id = $1 and user_id = $2', [group.id, userId]);
    return true;
  }

  async function bootstrapSystem() {
    await ensureManagementGroup();
    return ok({ bootstrapped: true });
  }

  async function rejectFullMemberGroup(participantIds = [], allowAllMembers = false) {
    if (allowsAllChatMembers(allowAllMembers)) return null;
    const ids = [...new Set((participantIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    const activeCount = await activeChatUserCount();
    if (activeCount > 3 && ids.length >= activeCount) {
      return fail('不能一次性把所有启用用户加入群聊，请选择具体成员。', 409, 3001);
    }
    return null;
  }

  async function manageableChatGroup(conversationId, actor) {
    const conversation = await queryOne(`
      select c.*, p.role as actor_participant_role
      from chat_conversations c
      join chat_participants p on p.conversation_id = c.id and p.user_id = $2
      where c.id = $1
      limit 1
    `, [conversationId, actor.id]);
    if (!conversation) return { error: fail('会话不存在。', 404, 3004) };
    if (conversation.type !== 'group') return { error: fail('只有群聊支持该操作。', 400, 2001) };
    if (!isManagementGroup(conversation) && actor.role !== 'super_admin') {
      return { error: fail('仅超级管理员可以管理自建群聊。', 403, 1003) };
    }
    const canManage = ['admin', 'super_admin'].includes(actor.role)
      || ['owner', 'admin'].includes(conversation.actor_participant_role);
    if (!canManage) return { error: fail('只有群主或管理员可以管理群聊。', 403, 1003) };
    return { conversation };
  }

  async function requireChatPermission(actor, permissionKey, message) {
    if (actor?.role === 'super_admin') return null;
    if (!['admin', 'super_admin'].includes(actor?.role)) return fail(message || '没有聊天管理权限。', 403, 1003);
    const context = await adminPermissionContextForUser(actor);
    if (context.permissions.includes('*') || context.permissions.includes(permissionKey)) return null;
    return fail(message || '没有聊天管理权限。', 403, 1003);
  }

  async function hydrateChatConversations(conversations = [], actorId) {
    if (!conversations.length) return [];
    const ids = conversations.map((item) => item.id);
    const participants = await query(`
      select p.conversation_id, p.role as participant_role, p.joined_at, p.last_read_at,
        u.id, u.name, u.phone, u.student_no, u.role, u.wechat_nickname
      from chat_participants p
      join users u on u.id = p.user_id
      where p.conversation_id = any($1)
      order by p.joined_at asc, u.name asc
    `, [ids]);
    const latestMessages = await query(`
      select distinct on (m.conversation_id)
        m.conversation_id, m.content, m.created_at, u.name as sender_name
      from chat_messages m
      left join users u on u.id = m.sender_id
      where m.conversation_id = any($1)
      order by m.conversation_id, m.created_at desc
    `, [ids]);
    const unreadRows = await query(`
      select p.conversation_id, count(m.id)::int as unread_count
      from chat_participants p
      left join chat_messages m on m.conversation_id = p.conversation_id
        and m.sender_id <> $2
        and (p.last_read_at is null or m.created_at > p.last_read_at)
      where p.conversation_id = any($1) and p.user_id = $2
      group by p.conversation_id
    `, [ids, actorId]);
    const participantsMap = new Map();
    for (const row of participants || []) {
      if (!participantsMap.has(row.conversation_id)) participantsMap.set(row.conversation_id, []);
      participantsMap.get(row.conversation_id).push({
        ...publicChatUser(row),
        participant_role: row.participant_role,
        joined_at: row.joined_at,
        last_read_at: row.last_read_at
      });
    }
    const latestMap = new Map((latestMessages || []).map((row) => [row.conversation_id, row]));
    const unreadMap = new Map((unreadRows || []).map((row) => [row.conversation_id, Number(row.unread_count || 0)]));
    return conversations.map((conversation) => {
      const members = participantsMap.get(conversation.id) || [];
      const peer = conversation.type === 'direct' ? members.find((member) => member.id !== actorId) : null;
      const latest = latestMap.get(conversation.id);
      const expiresAt = conversation.expires_at || null;
      const isTempChat = !isManagementGroup(conversation)
        && !conversation.is_system
        && (conversation.type === 'group' || conversation.type === 'direct');
      return {
        ...conversation,
        title: conversation.title || (peer ? peer.name : '群聊'),
        participants: members,
        latest_message: latest ? {
          content: latest.content,
          created_at: latest.created_at,
          sender_name: latest.sender_name || ''
        } : null,
        unread_count: unreadMap.get(conversation.id) || 0,
        expires_at: expiresAt,
        is_temporary_group: isTempChat,
        is_temporary_chat: isTempChat,
        remaining_label: isTempChat ? remainingLabel(expiresAt) : '',
        auto_dissolve_days: isTempChat ? TEMP_GROUP_TTL_DAYS : null
      };
    });
  }

  async function listChatConversations(params = {}, token) {
    await assertChatReady();
    await ensureManagementGroup();
    const actor = await requireChatActor(token);
    const limit = Math.min(Math.max(Number(params.limit || 50) || 50, 1), 100);
    const rows = await query(`
      select c.*
      from chat_conversations c
      join chat_participants p on p.conversation_id = c.id
      where p.user_id = $1
      order by case when c.system_key = $2 then 0 else 1 end,
        coalesce(c.last_message_at, c.updated_at, c.created_at) desc
      limit $3
    `, [actor.id, MANAGEMENT_GROUP_KEY, limit]);
    const allowed = [];
    for (const conversation of rows || []) {
      if (await conversationMatchesChatPolicy(conversation)) allowed.push(conversation);
    }
    return ok({ conversations: await hydrateChatConversations(allowed, actor.id), current_user: await publicChatUserWithPermissions(actor) });
  }

  async function createChatConversation(payload = {}, token) {
    await assertChatReady();
    await ensureManagementGroup();
    const actor = await requireChatActor(token);
    const type = String(payload.type || (payload.user_id || payload.userId ? 'direct' : 'group')).trim();
    if (!['direct', 'group'].includes(type)) return fail('会话类型不正确。', 400, 2001);
    const rawIds = [
      ...(Array.isArray(payload.user_ids) ? payload.user_ids : []),
      ...(Array.isArray(payload.userIds) ? payload.userIds : []),
      payload.user_id || payload.userId || payload.target_user_id || payload.targetUserId || ''
    ].map((id) => String(id || '').trim()).filter(Boolean);
    const participantIds = [...new Set([actor.id, ...rawIds])];
    if (type === 'direct' && participantIds.length !== 2) return fail('请选择一个聊天对象。', 400, 2001);
    if (type === 'group' && participantIds.length < 3) return fail('群聊至少需要 3 人。', 400, 2001);
    const users = await query('select id, name, phone, role, status, is_banned from users where id = any($1)', [participantIds]);
    if ((users || []).length !== participantIds.length) return fail('聊天成员不存在。', 404, 3004);
    if ((users || []).some((user) => user.status !== 'active' || user.is_banned)) return fail('聊天成员包含未启用或被封禁账号。', 409, 3001);
    if (type === 'direct' && (!(users || []).some(isChatAdministrator) || !(users || []).some((user) => !isChatAdministrator(user)))) {
      return fail('私聊仅支持用户与管理员之间沟通。', 403, 1003);
    }
    if (type === 'group' && actor.role !== 'super_admin') return fail('仅超级管理员可以创建群聊。', 403, 1003);
    if (type === 'group') {
      const fullGroupError = await rejectFullMemberGroup(participantIds, payload.allow_all_members || payload.allowAllMembers);
      if (fullGroupError) return fullGroupError;
    }
    if (type === 'direct') {
      let existing = await directConversationBetween(actor.id, participantIds.find((id) => id !== actor.id));
      if (existing) {
        if (!existing.expires_at && !isManagementGroup(existing)) {
          await query(
            `update chat_conversations
             set expires_at = coalesce(expires_at, created_at + ($2::int * interval '1 day')),
                 retention_days = coalesce(retention_days, $2::int)
             where id = $1 and expires_at is null`,
            [existing.id, TEMP_GROUP_TTL_DAYS]
          );
          const refreshed = await query('select * from chat_conversations where id = $1', [existing.id]);
          existing = refreshed[0] || existing;
        }
        const hydrated = await hydrateChatConversations([existing], actor.id);
        return ok({ conversation: hydrated[0], existed: true });
      }
    }
    const conversationId = uuid();
    const now = nowIso();
    const title = type === 'group'
      ? String(payload.title || '').trim().slice(0, 120) || `${actor.name} 发起的群聊`
      : '';
    const expiresAt = new Date(Date.parse(now) + TEMP_GROUP_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await withTransaction(async (client) => {
      await client.query(
        'insert into chat_conversations (id, type, title, created_by, created_at, updated_at, last_message_at, retention_days, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [conversationId, type, title || null, actor.id, now, now, null, TEMP_GROUP_TTL_DAYS, expiresAt]
      );
      for (const userId of participantIds) {
        await client.query('insert into chat_participants (conversation_id, user_id, role, joined_at) values ($1,$2,$3,$4) on conflict do nothing', [
          conversationId, userId, userId === actor.id ? 'owner' : 'member', now
        ]);
      }
    });
    await log('create_chat_conversation', `Created ${type} chat`, actor, null, conversationId);
    if (expiresAt) {
      const expireLabel = formatExpireLabel(expiresAt);
      const sessionLabel = type === 'group' ? (title || '临时群聊') : '私聊会话';
      const systemText = type === 'group'
        ? `本群为临时协作群，将于 ${expireLabel} 自动解散并清除聊天记录（约 ${TEMP_GROUP_TTL_DAYS} 天后）。实验管理总群除外。`
        : `本会话为临时私聊，将于 ${expireLabel} 自动结束并清除聊天记录（约 ${TEMP_GROUP_TTL_DAYS} 天后）。`;
      await insertSystemChatMessage(conversationId, systemText);
      for (const userId of participantIds) {
        await createUserNotification({
          user_id: userId,
          type: 'chat',
          title: type === 'group' ? '临时群已创建' : '临时私聊已创建',
          content: `「${sessionLabel}」将于 ${expireLabel} 自动结束并清除聊天记录。`,
          related_type: 'chat_conversation',
          related_id: conversationId
        });
      }
    }
    const rows = await query('select * from chat_conversations where id = $1', [conversationId]);
    const conversation = (await hydrateChatConversations(rows, actor.id))[0];
    await publishChatEvent(participantIds, 'conversation_changed', {
      conversation_id: conversationId,
      reason: 'created'
    });
    return ok({ conversation });
  }

  async function addChatParticipants(payload = {}, token) {
    await assertChatReady();
    await ensureManagementGroup();
    const actor = await requireChatActor(token);
    const conversationId = assertText(payload.conversation_id || payload.id, 'conversation_id', 60);
    const managed = await manageableChatGroup(conversationId, actor);
    if (managed.error) return managed.error;
    const rawIds = [
      ...(Array.isArray(payload.user_ids) ? payload.user_ids : []),
      ...(Array.isArray(payload.userIds) ? payload.userIds : [])
    ].map((id) => String(id || '').trim()).filter(Boolean);
    const requestedIds = [...new Set(rawIds)].filter((id) => id !== actor.id);
    if (!requestedIds.length) return fail('请选择需要添加的群成员。', 400, 2001);
    const existingRows = await query('select user_id from chat_participants where conversation_id = $1', [conversationId]);
    const existingIds = new Set((existingRows || []).map((row) => row.user_id));
    const newIds = requestedIds.filter((id) => !existingIds.has(id));
    if (!newIds.length) return fail('所选用户已经在群聊中。', 409, 3001);
    const finalIds = [...new Set([...existingIds, ...newIds])];
    const fullGroupError = await rejectFullMemberGroup(finalIds, payload.allow_all_members || payload.allowAllMembers);
    if (fullGroupError) return fullGroupError;
    const users = await query('select id, name, phone, role, status, is_banned from users where id = any($1)', [newIds]);
    if ((users || []).length !== newIds.length) return fail('聊天成员不存在。', 404, 3004);
    if ((users || []).some((user) => user.status !== 'active' || user.is_banned)) return fail('聊天成员包含未启用或被封禁账号。', 409, 3001);
    const now = nowIso();
    await withTransaction(async (client) => {
      for (const userId of newIds) {
        await client.query('insert into chat_participants (conversation_id, user_id, role, joined_at) values ($1,$2,$3,$4) on conflict do nothing', [
          conversationId, userId, 'member', now
        ]);
      }
      await client.query('update chat_conversations set updated_at = $1 where id = $2', [now, conversationId]);
    });
    for (const userId of newIds) {
      await createUserNotification({
        user_id: userId,
        type: 'chat',
        title: '你被加入群聊',
        content: `${actor.name || '管理员'} 已将你加入「${managed.conversation.title || '群聊'}」。`,
        related_type: 'chat_conversation',
        related_id: conversationId
      });
    }
    await log('add_chat_participants', `Added ${newIds.length} members to chat ${conversationId}`, actor, null, conversationId);
    const rows = await query('select * from chat_conversations where id = $1', [conversationId]);
    await publishChatEvent(finalIds, 'conversation_changed', {
      conversation_id: conversationId,
      reason: 'participants_added'
    });
    return ok({ conversation: (await hydrateChatConversations(rows, actor.id))[0], added_count: newIds.length });
  }

  async function dissolveChatConversation(payload = {}, token) {
    await assertChatReady();
    await ensureManagementGroup();
    const actor = await requireChatActor(token);
    const conversationId = assertText(payload.conversation_id || payload.id, 'conversation_id', 60);
    const managed = await manageableChatGroup(conversationId, actor);
    if (managed.error) return managed.error;
    if (isManagementGroup(managed.conversation)) return fail('管理群不能解散。', 403, 1003);
    if (!canDissolveGroup(managed.conversation, actor)) return fail('只有群创建者可以解散该群聊。', 403, 1003);
    const members = await query('select user_id from chat_participants where conversation_id = $1 and user_id <> $2', [conversationId, actor.id]);
    await query('delete from chat_conversations where id = $1', [conversationId]);
    for (const member of members || []) {
      await createUserNotification({
        user_id: member.user_id,
        type: 'chat',
        title: '群聊已解散',
        content: `${actor.name || '管理员'} 已解散「${managed.conversation.title || '群聊'}」。`,
        related_type: 'chat_conversation',
        related_id: conversationId
      });
    }
    await log('dissolve_chat_conversation', `Dissolved chat ${conversationId}`, actor, null, conversationId);
    await publishChatEvent([actor.id, ...(members || []).map((member) => member.user_id)], 'conversation_deleted', {
      conversation_id: conversationId
    });
    return ok({ deleted: true, conversation_id: conversationId });
  }

  async function leaveChatConversation(payload = {}, token) {
    await assertChatReady();
    await ensureManagementGroup();
    const actor = await requireChatActor(token);
    const conversationId = assertText(payload.conversation_id || payload.id, 'conversation_id', 60);
    const conversation = await conversationForActor(conversationId, actor.id);
    if (!conversation) return fail('会话不存在。', 404, 3004);
    if (conversation.type !== 'group') return fail('只有群聊可以退出。', 400, 2001);
    if (isManagementGroup(conversation)) return fail('实验管理总群不能主动退出。', 403, 1003);
    if (canDissolveGroup(conversation, actor)) return fail('你是群创建者，请解散群聊或先转交群主。', 409, 3001);
    await query('delete from chat_participants where conversation_id = $1 and user_id = $2', [conversationId, actor.id]);
    await query('update chat_conversations set updated_at = $1 where id = $2', [nowIso(), conversationId]);
    await log('leave_chat_conversation', `Left chat ${conversationId}`, actor, null, conversationId);
    const remaining = await query('select user_id from chat_participants where conversation_id = $1', [conversationId]);
    await publishChatEvent([actor.id, ...(remaining || []).map((row) => row.user_id)], 'conversation_changed', {
      conversation_id: conversationId,
      reason: 'participant_left'
    });
    return ok({ left: true, conversation_id: conversationId });
  }

  async function listChatMessages(params = {}, token) {
    await assertChatReady();
    await ensureManagementGroup();
    const actor = await requireChatActor(token);
    const conversationId = assertText(params.conversation_id || params.id, 'conversation_id', 60);
    const conversation = await conversationForActor(conversationId, actor.id);
    if (!conversation) return fail('会话不存在。', 404, 3004);
    const limit = Math.min(Math.max(Number(params.limit || 80) || 80, 1), 200);
    const before = params.before ? new Date(params.before) : null;
    const beforeIso = before && Number.isFinite(before.getTime()) ? before.toISOString() : null;
    const managementGroup = isManagementGroup(conversation);
    if (managementGroup) {
      await cleanupManagementGroupMessages(conversationId, Number(conversation.retention_days || MANAGEMENT_GROUP_RETENTION_DAYS));
    }
    const rows = await query(`
      select *
      from (
        select m.*, u.name as sender_name, u.phone as sender_phone
        from chat_messages m
        left join users u on u.id = m.sender_id
        where m.conversation_id = $1
          ${beforeIso ? 'and m.created_at < $3' : ''}
          ${managementGroup ? `and m.created_at >= now() - ($${beforeIso ? 4 : 3}::int * interval '1 day')` : ''}
        order by m.created_at desc
        limit $2
      ) latest
      order by created_at asc
    `, [
      conversationId,
      limit,
      ...(beforeIso ? [beforeIso] : []),
      ...(managementGroup ? [Number(conversation.retention_days || MANAGEMENT_GROUP_RETENTION_DAYS)] : [])
    ]);
    await query('update chat_participants set last_read_at = $1 where conversation_id = $2 and user_id = $3', [nowIso(), conversationId, actor.id]);
    const hydrated = await hydrateChatConversations([conversation], actor.id);
    return ok({
      conversation: hydrated[0],
      messages: rows || [],
      current_user: await publicChatUserWithPermissions(actor),
      page: {
        limit,
        has_more: (rows || []).length === limit,
        next_before: (rows || [])[0]?.created_at || null
      }
    });
  }

  async function markChatConversationRead(payload = {}, token) {
    await assertChatReady();
    const actor = await requireChatActor(token);
    const conversationId = assertText(payload.conversation_id || payload.id, 'conversation_id', 60);
    const conversation = await conversationForActor(conversationId, actor.id);
    if (!conversation) return fail('会话不存在。', 404, 3004);
    const readAt = nowIso();
    await query('update chat_participants set last_read_at = $1 where conversation_id = $2 and user_id = $3', [readAt, conversationId, actor.id]);
    await query(`
      insert into chat_message_reads (message_id, user_id, read_at)
      select m.id, $2, $3
      from chat_messages m
      where m.conversation_id = $1
        and (m.sender_id is null or m.sender_id <> $2)
      on conflict (message_id, user_id) do update set read_at = excluded.read_at
    `, [conversationId, actor.id, readAt]);
    return ok({ conversation_id: conversationId, read_at: readAt });
  }

  async function removeChatParticipant(payload = {}, token) {
    await assertChatReady();
    await ensureManagementGroup();
    const actor = await requireChatActor(token);
    const conversationId = assertText(payload.conversation_id || payload.id, 'conversation_id', 60);
    const userId = assertText(payload.user_id || payload.userId, 'user_id', 60);
    if (userId === actor.id) return fail('不能移除自己。', 400, 2001);
    const managed = await manageableChatGroup(conversationId, actor);
    if (managed.error) return managed.error;
    const target = await getById('users', userId);
    if (!target) return fail('用户不存在。', 404, 3004);
    if (target.role === 'super_admin') return fail('不能移除最高权限管理员。', 403, 1003);
    const permissionError = await requireChatPermission(actor, 'chat.kick', '只有被授予“踢出群成员”权限的管理员可以踢出成员。');
    if (permissionError) return permissionError;
    const now = nowIso();
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await client.query('delete from chat_participants where conversation_id = $1 and user_id = $2', [conversationId, userId]);
      if (isManagementGroup(managed.conversation)) {
        await client.query(`
          update users
          set status = 'pending',
              approved_by = null,
              approved_at = null,
              updated_at = $1
          where id = $2 and role <> 'super_admin'
        `, [now, userId]);
      }
      await log('kick_chat_participant', `Removed user from chat ${conversationId}`, actor, null, userId, txQuery);
    });
    await createUserNotification({
      user_id: userId,
      type: 'chat',
      title: 'You were removed from a group',
      content: isManagementGroup(managed.conversation)
        ? 'Your account is pending approval again. Reservation permission is paused until an administrator approves it.'
        : `You were removed from ${managed.conversation.title || 'a group chat'}.`,
      related_type: 'chat_conversation',
      related_id: conversationId
    });
    await publishChatEvent([actor.id, userId], 'conversation_changed', {
      conversation_id: conversationId,
      reason: 'participant_removed'
    });
    const rows = await query('select * from chat_conversations where id = $1', [conversationId]);
    return ok({
      removed: true,
      user_status: isManagementGroup(managed.conversation) ? 'pending' : target.status,
      conversation: (await hydrateChatConversations(rows, actor.id))[0]
    });
  }

  async function sendChatMessage(payload = {}, token) {
    await assertChatReady();
    await ensureManagementGroup();
    const actor = await requireChatActor(token);
    const conversationId = assertText(payload.conversation_id || payload.id, 'conversation_id', 60);
    const rawMessageType = String(payload.message_type || payload.messageType || 'text').trim().toLowerCase();
    const messageType = CHAT_MESSAGE_TYPES.has(rawMessageType) ? rawMessageType : 'text';
    const attachments = normalizeChatAttachments(payload.attachments || payload.files || payload.file_urls || payload.fileUrls);
    const metadata = normalizeChatMetadata(payload.metadata || payload.context || {});
    let content = String(payload.content ?? payload.message ?? '').trim();
    if (content.length > 1500) throw new AppError('消息内容过长。', { status: 400, code: 2001 });
    if (!content) {
      if (messageType === 'image' && attachments.length) content = '图片';
      else if (messageType === 'file' && attachments.length) content = '文件';
      else if (CHAT_CARD_LABELS[messageType]) content = chatCardContent(messageType, metadata);
      else throw new AppError('请填写消息内容。', { status: 400, code: 2001 });
    }
    if (messageType === 'image' && !attachments.length) return fail('请上传图片附件。', 400, 2001);
    const mentionIds = [...new Set([
      ...(Array.isArray(payload.mention_user_ids) ? payload.mention_user_ids : []),
      ...(Array.isArray(payload.mentionUserIds) ? payload.mentionUserIds : [])
    ].map((id) => String(id || '').trim()).filter(Boolean))];
    const conversation = await conversationForActor(conversationId, actor.id);
    if (!conversation) return fail('会话不存在。', 404, 3004);
    const clientMessageId = String(payload.client_message_id || payload.clientMessageId || '').trim().slice(0, 120);
    if (clientMessageId) {
      const existing = await queryOne(`
        select m.*, u.name as sender_name, u.phone as sender_phone
        from chat_messages m
        left join users u on u.id = m.sender_id
        where m.sender_id = $1 and m.client_message_id = $2
        limit 1
      `, [actor.id, clientMessageId]);
      if (existing) return ok({ message: existing, duplicated: true });
    }
    const mentionAll = (parseBoolean(payload.mention_all ?? payload.mentionAll) || content.includes('@全体成员')) && conversation.type === 'group';
    if (mentionAll) {
      const permissionError = await requireChatPermission(actor, 'chat.announce', '只有被授予“群发公告 / @全体成员”权限的管理员可以@全体成员。');
      if (permissionError) return permissionError;
    }
    const message = {
      id: uuid(),
      conversation_id: conversationId,
      sender_id: actor.id,
      message_type: messageType,
      content,
      attachments,
      metadata,
      related_type: relatedTypeForChatMessage(messageType, payload, metadata) || null,
      related_id: relatedIdForChatMessage(payload, metadata) || null,
      client_message_id: clientMessageId || null,
      delivery_status: 'sent',
      created_at: nowIso()
    };
    await withTransaction(async (client) => {
      await client.query(`
        insert into chat_messages
          (id, conversation_id, sender_id, message_type, content, attachments, metadata, related_type, related_id, client_message_id, delivery_status, created_at)
        values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,'sent',$11)
      `, [
        message.id,
        message.conversation_id,
        message.sender_id,
        message.message_type,
        message.content,
        JSON.stringify(message.attachments),
        JSON.stringify(message.metadata),
        message.related_type,
        message.related_id,
        message.client_message_id,
        message.created_at
      ]);
      await client.query('update chat_conversations set last_message_at = $1, updated_at = $1 where id = $2', [message.created_at, conversationId]);
      await client.query('update chat_participants set last_read_at = $1 where conversation_id = $2 and user_id = $3', [message.created_at, conversationId, actor.id]);
    });
    const others = await query('select user_id from chat_participants where conversation_id = $1 and user_id <> $2', [conversationId, actor.id]);
    const otherIds = new Set((others || []).map((participant) => participant.user_id));
    const mentionedParticipantIds = new Set(mentionIds.filter((id) => otherIds.has(id)));
    for (const participant of others || []) {
      const mentioned = mentionAll || mentionedParticipantIds.has(participant.user_id);
      await createUserNotification({
        user_id: participant.user_id,
        type: 'chat',
        title: mentionAll ? '管理员@全体成员' : mentioned ? '有人在群聊中@你' : '新的聊天消息',
        content: `${actor.name || '有人'}：${content.slice(0, 80)}`,
        related_type: 'chat_conversation',
        related_id: conversationId
      });
    }
    await log('send_chat_message', `Sent chat message in ${conversationId}`, actor, null, message.id);
    await publishChatEvent([actor.id, ...(others || []).map((participant) => participant.user_id)], 'message', {
      conversation_id: conversationId,
      message: { ...message, sender_name: actor.name, sender_phone: actor.phone }
    });
    return ok({ message: { ...message, sender_name: actor.name, sender_phone: actor.phone } });
  }

  return {
    addChatParticipants,
    addUserToManagementGroup,
    bootstrapSystem,
    canSubscribeChatChannel,
    cleanupExpiredTemporaryGroups,
    createChatConversation,
    dissolveChatConversation,
    leaveChatConversation,
    listChatConversations,
    listChatMessages,
    listChatUsers,
    markChatConversationRead,
    removeChatParticipant,
    removeUserFromManagementGroup,
    resolveRealtimePrincipal,
    sendChatMessage,
    streamChatEvents
  };
}

module.exports = { createChatService };
