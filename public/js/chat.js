const chatAdminView = qs('admin') === '1';
const chatBackHref = qs('back') || (chatAdminView ? 'admin.html#overview' : '');
const initialChatUserId = qs('user_id') || qs('target_user_id') || '';
const initialContactAdmin = ['1', 'true'].includes(String(qs('contact_admin') || qs('admin_contact') || '').toLowerCase());
const initialDeviceCode = qs('device_code') || '';
const initialReservationId = qs('reservation_id') || '';
const initialBatchId = qs('batch_id') || qs('reservation_batch_id') || '';
const initialFaultId = qs('fault_id') || qs('report_id') || '';
const initialRequestId = qs('request_id') || qs('user_request_id') || '';
const initialContextType = qs('context_type') || '';
const initialContextTitle = qs('context_title') || '';

let chatUsers = [];
let chatConversations = [];
let activeConversationId = '';
let activeConversation = null;
let activeMessages = [];
let activeMessagesPage = { has_more: false, next_before: null, loading: false };
let currentChatUser = null;
let selectedGroupUserIds = new Set();
let selectedAddMemberIds = new Set();
let mentionedUserIds = new Set();
let memberToolMode = '';
let selectedActionMemberId = '';
let membersDrawerOpen = false;
let activeMentionRange = null;
let chatEvents = null;
let chatPollTimer = null;
let chatRefreshTimer = null;
let chatRealtimeMode = 'offline';
let activeChatContext = buildInitialChatContext();
let chatContextCardSent = false;

function chatApiOptions(options = {}) {
  return { ...options, admin: chatAdminView };
}

function firstQueryValue(...values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function buildInitialChatContext() {
  const type = String(initialContextType || '').trim();
  const deviceCode = firstQueryValue(initialDeviceCode, qs('device'));
  const common = {
    device_code: deviceCode,
    device_name: qs('device_name') || '',
    user_name: qs('user_name') || '',
    user_phone: qs('user_phone') || '',
    status: qs('status') || '',
    title: initialContextTitle
  };
  const inferredType = initialFaultId ? 'fault' : initialRequestId ? 'request' : (initialReservationId || initialBatchId) ? 'reservation' : deviceCode ? 'device' : '';
  const contextType = {
    fault_report: 'fault',
    user_request: 'request',
    reservation_batch: 'reservation',
    reservation_item: 'reservation'
  }[type] || type || inferredType;
  if (contextType === 'fault') {
    return {
      type: 'fault',
      message_type: 'fault_card',
      title: initialContextTitle || `故障报备 ${deviceCode || initialFaultId || ''}`.trim(),
      detail: qs('issue_type') || qs('description') || '设备故障处理沟通',
      content: initialContextTitle || `故障卡片：${deviceCode || initialFaultId || '待处理'}`,
      related_type: 'fault_report',
      related_id: initialFaultId || deviceCode,
      prefill: `关于故障报备 ${deviceCode || initialFaultId || ''}：`,
      metadata: { ...common, fault_id: initialFaultId, issue_type: qs('issue_type') || '', description: qs('description') || '' }
    };
  }
  if (contextType === 'request') {
    return {
      type: 'request',
      message_type: 'user_request_card',
      title: initialContextTitle || `需求上报 ${initialRequestId || ''}`.trim(),
      detail: qs('description') || '用户需求处理沟通',
      content: initialContextTitle || `需求卡片：${initialRequestId || '待处理'}`,
      related_type: 'user_request',
      related_id: initialRequestId,
      prefill: `关于需求上报 ${initialRequestId || ''}：`,
      metadata: { ...common, request_id: initialRequestId, description: qs('description') || '' }
    };
  }
  if (contextType === 'reservation') {
    const id = initialReservationId || initialBatchId;
    return {
      type: 'reservation',
      message_type: 'reservation_card',
      title: initialContextTitle || `预约 ${id || ''}`.trim(),
      detail: [deviceCode, qs('start_time'), qs('end_time')].filter(Boolean).join(' · ') || '预约审批沟通',
      content: initialContextTitle || `预约卡片：${id || deviceCode || '待确认'}`,
      related_type: initialBatchId ? 'reservation_batch' : 'reservation',
      related_id: id,
      prefill: `关于预约 ${deviceCode || id || ''}：`,
      metadata: { ...common, reservation_id: initialReservationId, batch_id: initialBatchId, start_time: qs('start_time') || '', end_time: qs('end_time') || '' }
    };
  }
  if (contextType === 'device') {
    return {
      type: 'device',
      message_type: 'device_card',
      title: initialContextTitle || `设备 ${deviceCode}`,
      detail: qs('device_name') || '设备咨询沟通',
      content: initialContextTitle || `设备卡片：${deviceCode}`,
      related_type: 'device',
      related_id: deviceCode,
      prefill: `咨询设备 ${deviceCode}：`,
      metadata: { ...common }
    };
  }
  return null;
}

function requireChatLogin() {
  if (chatAdminView) {
    if (isAdminLoggedIn()) return true;
    location.replace('admin.html');
    return false;
  }
  if (isLoggedIn()) return true;
  location.replace('login.html');
  return false;
}

function userOptionLabel(user) {
  return `${user.name || '-'} ${user.phone || ''}${user.role && user.role !== 'user' ? `（${user.role}）` : ''}`.trim();
}

function userSearchText(user) {
  return `${user.name || ''} ${user.phone || ''} ${user.student_no || ''} ${user.wechat_nickname || ''}`.toLowerCase();
}

function conversationTitle(conversation) {
  if (!conversation) return '请选择会话';
  if (conversation.type === 'direct') {
    const peer = (conversation.participants || []).find((user) => user.id !== currentChatUser?.id);
    return peer ? peer.name : (conversation.title || '一对一聊天');
  }
  return conversation.title || '群聊';
}

function setChatRealtimeMode(mode, text = '') {
  chatRealtimeMode = mode;
  const badge = document.getElementById('chat-realtime-status');
  if (!badge) return;
  const labels = {
    sse: '实时连接',
    polling: '轮询更新',
    connecting: '连接中',
    offline: '离线'
  };
  badge.className = `badge ${mode === 'sse' ? 'success' : mode === 'polling' ? 'warn' : 'info'}`;
  badge.textContent = text || labels[mode] || labels.offline;
}

function scheduleChatRefresh(reason = 'event') {
  clearTimeout(chatRefreshTimer);
  chatRefreshTimer = setTimeout(async () => {
    try {
      await loadConversations(activeConversationId);
    } catch (error) {
      if (reason !== 'poll') showToast('warn', `聊天更新失败：${error.message}`);
    }
  }, 250);
}

function memberById(userId) {
  return (activeConversation?.participants || []).find((member) => member.id === userId)
    || chatUsers.find((user) => user.id === userId);
}

function activeMemberIds() {
  return new Set((activeConversation?.participants || []).map((member) => member.id));
}

function canManageGroup(conversation = activeConversation) {
  if (!conversation || conversation.type !== 'group') return false;
  const me = (conversation.participants || []).find((member) => member.id === currentChatUser?.id);
  return ['admin', 'super_admin'].includes(currentChatUser?.role)
    || ['owner', 'admin'].includes(me?.participant_role);
}

function canDissolveGroup(conversation = activeConversation) {
  if (!conversation || conversation.type !== 'group' || isManagementGroup(conversation)) return false;
  return conversation.created_by === currentChatUser?.id;
}

function canLeaveGroup(conversation = activeConversation) {
  if (!conversation || conversation.type !== 'group' || isManagementGroup(conversation)) return false;
  return !canDissolveGroup(conversation);
}

function isManagementGroup(conversation = activeConversation) {
  return conversation?.system_key === 'lab_management'
    || (conversation?.title === '实验管理总群' && (conversation?.is_system || conversation?.type === 'group'));
}

function canAnnounceAll(conversation = activeConversation) {
  if (!conversation || conversation.type !== 'group') return false;
  return currentChatUser?.role === 'super_admin' || currentChatUser?.can_announce;
}

function canKickMembers(conversation = activeConversation) {
  if (!conversation || conversation.type !== 'group') return false;
  return (currentChatUser?.role === 'super_admin' || currentChatUser?.can_kick) && canManageGroup(conversation);
}

function wouldSelectAllContacts(extraIds = [], baseIds = []) {
  const otherContactCount = chatUsers.length;
  if (otherContactCount <= 2) return false;
  const memberIds = new Set(baseIds);
  for (const id of extraIds) memberIds.add(id);
  memberIds.delete(currentChatUser?.id);
  return memberIds.size >= otherContactCount;
}

function renderPicker(containerId, users, selectedSet, actionName) {
  const box = document.getElementById(containerId);
  if (!box) return;
  if (!users.length) {
    box.innerHTML = '<div class="empty-state">没有匹配联系人。</div>';
    return;
  }
  box.innerHTML = users.map((user) => `
    <button type="button" class="chat-user-option ${selectedSet.has(user.id) ? 'selected' : ''}" data-chat-action="${actionName}" data-user-id="${escapeHtml(user.id)}">
      <span class="chat-check">${selectedSet.has(user.id) ? '✓' : '+'}</span>
      <span><strong>${escapeHtml(user.name || '-')}</strong><small>${escapeHtml(user.phone || '-')}</small></span>
    </button>
  `).join('');
}

function filteredChatUsers(filterId, excludedIds = new Set()) {
  const keyword = (document.getElementById(filterId)?.value || '').trim().toLowerCase();
  return chatUsers.filter((user) => {
    if (user.id === currentChatUser?.id || excludedIds.has(user.id)) return false;
    return !keyword || userSearchText(user).includes(keyword);
  });
}

function renderUserOptions() {
  const direct = document.getElementById('direct-user');
  if (direct) {
    direct.innerHTML = '<option value="">选择联系人</option>' + chatUsers
      .map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(userOptionLabel(user))}</option>`)
      .join('');
  }
  renderGroupUserPicker();
  renderSelectedGroupUsers();
  renderAddMemberPicker();
}

function renderGroupUserPicker() {
  renderPicker('group-user-picker', filteredChatUsers('group-user-filter'), selectedGroupUserIds, 'toggle-group-user');
}

function renderSelectedGroupUsers() {
  const box = document.getElementById('group-selected-users');
  if (!box) return;
  const selected = chatUsers.filter((user) => selectedGroupUserIds.has(user.id));
  box.innerHTML = selected.length
    ? selected.map((user) => `<span class="selected-chip">${escapeHtml(user.name || '-')}<button type="button" data-chat-action="remove-group-user" data-user-id="${escapeHtml(user.id)}">×</button></span>`).join('')
    : '<span class="muted">尚未选择群成员。</span>';
}

function renderAddMemberPicker() {
  renderPicker('add-member-picker', filteredChatUsers('add-member-filter', activeMemberIds()), selectedAddMemberIds, 'toggle-add-member');
}

function renderConversations() {
  const box = document.getElementById('conversation-list');
  if (!box) return;
  if (!chatConversations.length) {
    box.innerHTML = '<div class="empty-state">暂无会话。</div>';
    return;
  }
  box.innerHTML = chatConversations.map((conversation) => `
    <button type="button" class="conversation-item ${conversation.id === activeConversationId ? 'active' : ''}" data-conversation-id="${escapeHtml(conversation.id)}">
      <strong>${escapeHtml(conversationTitle(conversation))}</strong>
      <span>${conversation.type === 'group' ? '群聊' : '私聊'} · ${escapeHtml(conversation.participants?.length || 0)} 人</span>
      <small>${escapeHtml(conversation.latest_message?.content || '暂无消息')}</small>
      ${conversation.unread_count ? `<em>${escapeHtml(conversation.unread_count)}</em>` : ''}
    </button>
  `).join('');
}

function updateOlderMessagesButton() {
  const button = document.getElementById('load-older-messages-btn');
  if (!button) return;
  button.classList.toggle('hidden', !activeConversationId || !activeMessagesPage.has_more);
  button.disabled = !!activeMessagesPage.loading;
  button.textContent = activeMessagesPage.loading ? '加载中...' : '加载更早消息';
}

function mergeMessages(existing = [], incoming = []) {
  const byId = new Map();
  for (const message of [...existing, ...incoming]) {
    const key = message.id || message.client_message_id || `${message.sender_id}:${message.created_at}:${message.content}`;
    byId.set(key, message);
  }
  return [...byId.values()].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
}

function currentMentionRange(input) {
  if (!input) return null;
  const cursor = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, cursor);
  const atIndex = before.lastIndexOf('@');
  if (atIndex < 0) return null;
  const query = before.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  return { start: atIndex, end: cursor, query: query.toLowerCase() };
}

function hideMentionPanel() {
  const panel = document.getElementById('mention-panel');
  panel?.classList.add('hidden');
  if (panel) panel.innerHTML = '';
  activeMentionRange = null;
}

function insertMention(member, options = {}) {
  if ((!member?.id && !options.all) || !activeConversation || activeConversation.type !== 'group') return;
  const input = document.getElementById('message-content');
  if (!input) return;
  const mention = options.all ? '@全体成员 ' : `@${member.name || '成员'} `;
  const range = activeMentionRange || currentMentionRange(input);
  const start = range?.start ?? (input.selectionStart || input.value.length);
  const end = range?.end ?? (input.selectionEnd || input.value.length);
  input.value = `${input.value.slice(0, start)}${mention}${input.value.slice(end)}`;
  input.focus();
  const cursor = start + mention.length;
  input.setSelectionRange(cursor, cursor);
  if (member?.id) mentionedUserIds.add(member.id);
  hideMentionPanel();
}

function setMembersDrawerOpen(open) {
  membersDrawerOpen = !!open && activeConversation?.type === 'group';
  document.querySelector('.chat-members')?.classList.toggle('hidden', !membersDrawerOpen);
  document.getElementById('chat-members-overlay')?.classList.toggle('hidden', !membersDrawerOpen);
}

function renderGroupAnnouncement(conversation) {
  const box = document.getElementById('group-announcement');
  if (!box) return;
  if (!conversation || conversation.type !== 'group') {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const title = isManagementGroup(conversation) ? '实验总群公告' : '群公告';
  const text = conversation.announcement || (isManagementGroup(conversation)
    ? '重要通知由管理员在群内发布，请关注@全体成员消息。'
    : '暂无公告。群主可在群内发布重要通知，成员可在右上角查看群信息。');
  box.classList.remove('hidden');
  box.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span>`;
}

function setMemberToolMode(mode) {
  memberToolMode = memberToolMode === mode ? '' : mode;
  if (memberToolMode !== 'actions') selectedActionMemberId = '';
  document.getElementById('add-members-panel')?.classList.toggle('hidden', memberToolMode !== 'add');
  document.getElementById('member-actions-panel')?.classList.toggle('hidden', memberToolMode !== 'actions');
  document.getElementById('toggle-add-members-btn')?.classList.toggle('active', memberToolMode === 'add');
  document.getElementById('toggle-member-actions-btn')?.classList.toggle('active', memberToolMode === 'actions');
  renderAddMemberPicker();
  renderMembers(activeConversation);
  renderSelectedMemberInfo();
}

function renderMembers(conversation) {
  const toolActions = document.getElementById('member-tool-actions');
  const groupActions = document.getElementById('group-actions');
  const dissolveButton = document.getElementById('dissolve-group-btn');
  const leaveButton = document.getElementById('leave-group-btn');
  const drawerButton = document.getElementById('toggle-members-drawer-btn');
  const isGroup = conversation?.type === 'group';
  const canManage = canManageGroup(conversation);
  toolActions?.classList.toggle('hidden', !isGroup || !canManage);
  const showDissolve = canDissolveGroup(conversation);
  const showLeave = canLeaveGroup(conversation);
  groupActions?.classList.toggle('hidden', !isGroup && !showDissolve && !showLeave);
  drawerButton?.classList.toggle('hidden', !isGroup);
  dissolveButton?.classList.toggle('hidden', !showDissolve);
  leaveButton?.classList.toggle('hidden', !showLeave);
  if (!isGroup) setMembersDrawerOpen(false);

  const box = document.getElementById('member-list');
  if (!box) return;
  if (!conversation || !isGroup) {
    box.innerHTML = '<div class="empty-state">选择群聊后显示成员。</div>';
    return;
  }
  box.innerHTML = (conversation.participants || []).map((member) => `
    <button type="button" class="member-item ${selectedActionMemberId === member.id ? 'active' : ''}" data-chat-action="select-member" data-user-id="${escapeHtml(member.id)}">
      <span class="member-main">
        <strong>${escapeHtml(member.name || '-')}</strong>
        <span>${escapeHtml(member.phone || '-')}</span>
      </span>
      <span class="member-role">${member.participant_role === 'owner' ? '群主' : member.participant_role === 'admin' ? '管理' : ''}</span>
    </button>
  `).join('');
}

function renderSelectedMemberInfo() {
  const box = document.getElementById('selected-member-info');
  const directBtn = document.getElementById('member-direct-btn');
  const kickBtn = document.getElementById('member-kick-btn');
  if (!box) return;
  const member = memberById(selectedActionMemberId);
  const canKick = !!member && canKickMembers(activeConversation)
    && member.id !== currentChatUser?.id
    && member.role !== 'super_admin';
  directBtn?.toggleAttribute('disabled', !member);
  kickBtn?.toggleAttribute('disabled', !canKick);
  if (!member) {
    box.innerHTML = '<span class="muted">选择右侧成员后操作。</span>';
    return;
  }
  box.innerHTML = `
    <strong>${escapeHtml(member.name || '-')}</strong>
    <span>${escapeHtml(member.phone || '-')}</span>
      <small>${canKick ? (isManagementGroup(activeConversation) ? '可以私聊或踢出；踢出实验管理总群会暂停其预约资格。' : '可以私聊或踢出该成员。') : '可以发起私聊。'}</small>
  `;
}

function renderMentionPanel(conversation) {
  const panel = document.getElementById('mention-panel');
  const input = document.getElementById('message-content');
  if (!panel || !input) return;
  if (!conversation || conversation.type !== 'group') {
    hideMentionPanel();
    return;
  }
  const range = currentMentionRange(input);
  if (!range) {
    hideMentionPanel();
    return;
  }
  activeMentionRange = range;
  const members = (conversation.participants || [])
    .filter((member) => member.id !== currentChatUser?.id)
    .filter((member) => {
      const text = `${member.name || ''} ${member.phone || ''}`.toLowerCase();
      return !range.query || text.includes(range.query);
    });
  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="mention-title">选择提醒对象</div>
    <button type="button" class="mention-item mention-all" data-chat-action="mention-all">
      <strong>@全体成员</strong><span>${canAnnounceAll(conversation) ? '通知群内所有人' : '仅管理员可用'}</span>
    </button>
    ${members.map((member) => `<button type="button" class="mention-item ${mentionedUserIds.has(member.id) ? 'active' : ''}" data-chat-action="mention-member" data-user-id="${escapeHtml(member.id)}"><strong>${escapeHtml(member.name || '-')}</strong><span>${escapeHtml(member.phone || '-')}</span></button>`).join('') || '<div class="empty-state compact">未找到成员。</div>'}
  `;
}

function chatMessageAttachments(message = {}) {
  if (Array.isArray(message.attachments)) return message.attachments;
  if (typeof message.attachments === 'string') {
    try {
      const parsed = JSON.parse(message.attachments);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function chatMessageMetadata(message = {}) {
  if (message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)) return message.metadata;
  if (typeof message.metadata === 'string') {
    try {
      const parsed = JSON.parse(message.metadata);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return {};
}

function chatCardLabel(type) {
  return {
    device_card: '设备',
    reservation_card: '预约',
    fault_card: '故障',
    user_request_card: '需求'
  }[type] || '业务';
}

function chatContextHref(type, metadata = {}) {
  if (type === 'device_card' && metadata.device_code) return `device.html?code=${encodeURIComponent(metadata.device_code)}`;
  if (type === 'reservation_card') return chatAdminView ? 'admin.html#reservations' : 'my.html#reservations';
  if (type === 'fault_card') return chatAdminView ? 'admin.html#faults' : 'my.html#faults';
  if (type === 'user_request_card') return chatAdminView ? 'admin.html#requests' : 'my.html#requests';
  return '';
}

function renderChatContextPanel() {
  const panel = document.getElementById('chat-context-panel');
  if (!panel) return;
  if (!activeChatContext) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div>
      <strong>${escapeHtml(activeChatContext.title || '业务上下文')}</strong>
      <span>${escapeHtml(activeChatContext.detail || activeChatContext.related_id || '')}</span>
    </div>
    <div class="actions">
      <button type="button" class="secondary" data-chat-action="send-context-card" ${activeConversationId ? '' : 'disabled'}>${chatContextCardSent ? '再次发送卡片' : '发送卡片'}</button>
      <button type="button" class="secondary" data-chat-action="clear-context-card">移除</button>
    </div>
  `;
}

function renderMessageAttachments(message = {}) {
  const attachments = chatMessageAttachments(message);
  if (!attachments.length) return '';
  return `<div class="message-attachments">${attachments.map((item) => {
    const url = item.url || item.src || '';
    if (!url) return '';
    const name = item.name || item.filename || '附件';
    const isImage = item.type === 'image' || String(item.mime || '').startsWith('image/');
    if (isImage) {
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img class="chat-image-message" src="${escapeHtml(url)}" alt="${escapeHtml(name)}"></a>`;
    }
    return `<a class="message-file-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`;
  }).join('')}</div>`;
}

function renderMessageCard(message = {}) {
  const type = message.message_type || 'text';
  const metadata = chatMessageMetadata(message);
  const label = chatCardLabel(type);
  const title = message.content || metadata.title || label;
  const detail = metadata.description || metadata.detail || metadata.device_name || metadata.issue_type || metadata.status || '';
  const chips = [
    metadata.device_code ? `设备 ${metadata.device_code}` : '',
    metadata.reservation_id ? `预约 ${metadata.reservation_id}` : '',
    metadata.batch_id ? `批次 ${metadata.batch_id}` : '',
    metadata.fault_id ? `故障 ${metadata.fault_id}` : '',
    metadata.request_id ? `需求 ${metadata.request_id}` : ''
  ].filter(Boolean);
  const href = chatContextHref(type, metadata);
  const inner = `
    <strong>${escapeHtml(title)}</strong>
    ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
    ${chips.length ? `<div class="message-card-meta">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join('')}</div>` : ''}
  `;
  return href ? `<a class="message-card" href="${escapeHtml(href)}">${inner}</a>` : `<div class="message-card">${inner}</div>`;
}

function renderMessageBody(message = {}) {
  const type = message.message_type || 'text';
  const isCard = ['device_card', 'reservation_card', 'fault_card', 'user_request_card'].includes(type);
  if (isCard) return renderMessageCard(message) + renderMessageAttachments(message);
  const attachments = renderMessageAttachments(message);
  const text = message.content ? `<p>${escapeHtml(message.content || '')}</p>` : '';
  return `${text}${attachments}`;
}

function renderMessages(messages = [], conversation = null, options = {}) {
  const switched = activeConversation?.id !== conversation?.id;
  activeConversation = conversation;
  if (switched) {
    selectedAddMemberIds = new Set();
    mentionedUserIds = new Set();
    selectedActionMemberId = '';
    memberToolMode = '';
    membersDrawerOpen = false;
    hideMentionPanel();
  }
  document.getElementById('chat-title').textContent = conversationTitle(conversation);
  document.getElementById('chat-subtitle').textContent = conversation
    ? `${conversation.type === 'group' ? '群聊' : '私聊'} · ${conversation.participants?.length || 0} 人`
    : '消息会显示在这里。';
  renderMembers(conversation);
  renderMentionPanel(conversation);
  renderGroupAnnouncement(conversation);
  renderAddMemberPicker();
  renderSelectedMemberInfo();
  renderChatContextPanel();
  document.getElementById('add-members-panel')?.classList.toggle('hidden', memberToolMode !== 'add');
  document.getElementById('member-actions-panel')?.classList.toggle('hidden', memberToolMode !== 'actions');

  const list = document.getElementById('message-list');
  if (!conversation) {
    list.innerHTML = '<div class="empty-state">请选择或新建一个会话。</div>';
    activeMessagesPage = { has_more: false, next_before: null, loading: false };
    updateOlderMessagesButton();
    return;
  }
  const previousBottomGap = list.scrollHeight - list.scrollTop - list.clientHeight;
  list.innerHTML = messages.length ? messages.map((message) => {
    const mine = message.sender_id === currentChatUser?.id;
    const failed = message.local_status === 'failed';
    const sending = message.local_status === 'sending';
    return `
      <article class="message-bubble ${mine ? 'mine' : ''} ${failed ? 'failed' : sending ? 'sending' : ''}">
        <div><strong>${escapeHtml(message.sender_name || '-')}</strong><span>${escapeHtml(fmtTime(message.created_at))}</span></div>
        ${renderMessageBody(message)}
        <small class="message-status">${sending ? '发送中...' : failed ? '发送失败' : (mine ? '已发送' : '')}</small>
        ${failed ? `<button type="button" class="secondary" data-chat-action="retry-message" data-client-id="${escapeHtml(message.client_message_id || '')}">重试</button>` : ''}
      </article>
    `;
  }).join('') : '<div class="empty-state">暂无消息，发送第一条吧。</div>';
  updateOlderMessagesButton();
  if (options.preserveScroll) list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight - previousBottomGap);
  else if (options.keepPosition) return;
  else list.scrollTop = list.scrollHeight;
}

function firstAdminContact() {
  return chatUsers.find((user) => ['super_admin', 'admin'].includes(user.role)) || chatUsers[0] || null;
}

function applyInitialChatContext() {
  const input = document.getElementById('message-content');
  if (!input || input.value.trim()) return;
  if (activeChatContext?.prefill) {
    input.value = activeChatContext.prefill;
    input.focus();
  }
}

async function loadChatUsers() {
  const result = await callRestApi('/chat/users', chatApiOptions());
  chatUsers = result.users || [];
  currentChatUser = result.current_user || currentChatUser;
  renderUserOptions();
}

async function loadConversations(selectId = activeConversationId) {
  const result = await callRestApi('/chat/conversations', chatApiOptions());
  chatConversations = result.conversations || [];
  currentChatUser = result.current_user || currentChatUser;
  if (selectId && chatConversations.some((item) => item.id === selectId)) activeConversationId = selectId;
  else activeConversationId = chatConversations[0]?.id || '';
  renderConversations();
  if (activeConversationId) await loadMessages(activeConversationId);
  else renderMessages([], null);
}

async function loadMessages(conversationId) {
  activeConversationId = conversationId;
  renderConversations();
  const result = await callRestApi(`/chat/conversations/${encodeURIComponent(conversationId)}/messages?limit=80`, chatApiOptions());
  currentChatUser = result.current_user || currentChatUser;
  const conversation = result.conversation || chatConversations.find((item) => item.id === conversationId);
  activeMessages = result.messages || [];
  activeMessagesPage = result.page || { has_more: false, next_before: null, loading: false };
  renderMessages(activeMessages, conversation);
}

async function loadOlderMessages() {
  if (!activeConversationId || !activeMessagesPage.has_more || activeMessagesPage.loading) return;
  activeMessagesPage.loading = true;
  updateOlderMessagesButton();
  try {
    const before = activeMessagesPage.next_before;
    const query = before ? `?limit=80&before=${encodeURIComponent(before)}` : '?limit=80';
    const result = await callRestApi(`/chat/conversations/${encodeURIComponent(activeConversationId)}/messages${query}`, chatApiOptions());
    activeMessages = mergeMessages(result.messages || [], activeMessages);
    activeMessagesPage = result.page || { has_more: false, next_before: null, loading: false };
    renderMessages(activeMessages, result.conversation || activeConversation, { preserveScroll: true });
  } catch (error) {
    showToast('danger', `加载历史消息失败：${error.message}`);
  } finally {
    activeMessagesPage.loading = false;
    updateOlderMessagesButton();
  }
}

async function startDirectChat(userId = '') {
  const targetId = userId || document.getElementById('direct-user').value;
  if (!targetId) return showToast('warn', '请选择联系人');
  const result = await callRestApi('/chat/conversations', chatApiOptions({
    method: 'POST',
    body: { type: 'direct', user_id: targetId }
  }));
  activeConversationId = result.conversation?.id || '';
  await loadConversations(activeConversationId);
}

async function startGroupChat() {
  const userIds = [...selectedGroupUserIds];
  if (userIds.length < 2) return showToast('warn', '群聊至少选择两位成员');
  if (wouldSelectAllContacts(userIds)) return showToast('warn', '不能一次性把所有联系人拉进群，请选择具体成员。');
  const result = await callRestApi('/chat/conversations', chatApiOptions({
    method: 'POST',
    body: {
      type: 'group',
      title: document.getElementById('group-title').value,
      user_ids: userIds
    }
  }));
  selectedGroupUserIds = new Set();
  document.getElementById('group-title').value = '';
  renderUserOptions();
  activeConversationId = result.conversation?.id || '';
  await loadConversations(activeConversationId);
  showToast('success', '群聊已创建');
}

async function addMembersToGroup() {
  if (!activeConversation || activeConversation.type !== 'group') return showToast('warn', '请先选择群聊');
  const userIds = [...selectedAddMemberIds];
  if (!userIds.length) return showToast('warn', '请选择要添加的成员');
  if (wouldSelectAllContacts(userIds, activeMemberIds())) return showToast('warn', '不能把所有联系人一次性加入群聊。');
  const result = await callRestApi(`/chat/conversations/${encodeURIComponent(activeConversation.id)}/participants`, chatApiOptions({
    method: 'POST',
    body: { user_ids: userIds }
  }));
  selectedAddMemberIds = new Set();
  activeConversationId = result.conversation?.id || activeConversation.id;
  await loadConversations(activeConversationId);
  setMemberToolMode('');
  showToast('success', '成员已添加');
}

async function kickMember(userId) {
  if (!activeConversation || activeConversation.type !== 'group') return showToast('warn', '请先选择群聊');
  if (!canKickMembers(activeConversation)) return showToast('warn', '当前账号没有踢出成员权限');
  const member = memberById(userId);
  if (!member?.id) return showToast('warn', '请选择成员');
  const tip = isManagementGroup(activeConversation) ? '；该用户将失去预约资格，需重新审核同意后才会回到总群' : '';
  if (!confirm(`确认将 ${member.name || '该成员'} 踢出群聊吗${tip}？`)) return;
  const result = await callRestApi(`/chat/conversations/${encodeURIComponent(activeConversation.id)}/participants/${encodeURIComponent(member.id)}/remove`, chatApiOptions({
    method: 'POST'
  }));
  selectedActionMemberId = '';
  activeConversationId = result.conversation?.id || activeConversation.id;
  await loadConversations(activeConversationId);
  setMemberToolMode('actions');
  showToast('success', result.user_status === 'pending' ? '已踢出，账号已转为待批准' : '成员已踢出');
}

async function dissolveActiveGroup() {
  if (!activeConversation || activeConversation.type !== 'group') return showToast('warn', '请先选择群聊');
  if (isManagementGroup(activeConversation)) return showToast('warn', '实验管理总群不能解散');
  if (!canDissolveGroup(activeConversation)) return showToast('warn', '只有群创建者可以解散该群聊');
  if (!confirm(`确认解散「${conversationTitle(activeConversation)}」吗？此操作不可恢复。`)) return;
  await callRestApi(`/chat/conversations/${encodeURIComponent(activeConversation.id)}`, chatApiOptions({ method: 'DELETE' }));
  activeConversationId = '';
  activeConversation = null;
  await loadConversations('');
  showToast('success', '群聊已解散');
}

async function leaveActiveGroup() {
  if (!activeConversation || activeConversation.type !== 'group') return showToast('warn', '请先选择群聊');
  if (isManagementGroup(activeConversation)) return showToast('warn', '实验管理总群不能退出');
  if (canDissolveGroup(activeConversation)) return showToast('warn', '你是群创建者，请使用解散群聊');
  if (!confirm(`确认退出「${conversationTitle(activeConversation)}」吗？`)) return;
  await callRestApi(`/chat/conversations/${encodeURIComponent(activeConversation.id)}/leave`, chatApiOptions({ method: 'POST' }));
  activeConversationId = '';
  activeConversation = null;
  await loadConversations('');
  showToast('success', '已退出群聊');
}

async function sendActiveMessage() {
  if (!activeConversationId) return showToast('warn', '请先选择会话');
  const input = document.getElementById('message-content');
  const content = input.value.trim();
  if (!content) return showToast('warn', '请输入消息内容');
  if (content.includes('@全体成员') && !canAnnounceAll(activeConversation)) {
    return showToast('warn', '只有被授予权限的管理员可以@全体成员');
  }
  await sendChatPayload({
    message_type: 'text',
    content,
    mention_user_ids: [...mentionedUserIds],
    mention_all: content.includes('@全体成员')
  }, { clearInput: true });
}

async function sendChatPayload(payload = {}, options = {}) {
  if (!activeConversationId) return showToast('warn', '请先选择会话');
  const input = document.getElementById('message-content');
  const sendButton = document.getElementById('send-message-btn');
  const content = String(payload.content || '').trim();
  const messageType = payload.message_type || 'text';
  const clientMessageId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const optimisticMessage = {
    id: `local-${clientMessageId}`,
    client_message_id: clientMessageId,
    conversation_id: activeConversationId,
    sender_id: currentChatUser?.id,
    sender_name: currentChatUser?.name || '我',
    message_type: messageType,
    content,
    attachments: payload.attachments || [],
    metadata: payload.metadata || {},
    related_type: payload.related_type || '',
    related_id: payload.related_id || '',
    created_at: new Date().toISOString(),
    local_status: 'sending'
  };
  activeMessages = mergeMessages(activeMessages, [optimisticMessage]);
  renderMessages(activeMessages, activeConversation);
  const previousText = sendButton?.textContent || '发送';
  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = '发送中';
  }
  try {
    const result = await callRestApi(`/chat/conversations/${encodeURIComponent(activeConversationId)}/messages`, chatApiOptions({
      method: 'POST',
      body: {
        ...payload,
        content,
        client_message_id: clientMessageId
      }
    }));
    activeMessages = activeMessages.filter((message) => message.client_message_id !== clientMessageId);
    if (result.message) activeMessages = mergeMessages(activeMessages, [result.message]);
    if (options.clearInput && input) input.value = '';
    if (options.clearInput) mentionedUserIds = new Set();
    renderMessages(activeMessages, activeConversation);
    loadConversations(activeConversationId).catch(() => {});
    if (options.successMessage) showToast('success', options.successMessage);
  } catch (error) {
    activeMessages = activeMessages.map((message) => message.client_message_id === clientMessageId ? { ...message, local_status: 'failed' } : message);
    renderMessages(activeMessages, activeConversation);
    showToast('danger', `发送失败：${error.message}`);
  } finally {
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.textContent = previousText;
    }
  }
}

async function retryFailedMessage(clientMessageId) {
  const failed = activeMessages.find((message) => message.client_message_id === clientMessageId && message.local_status === 'failed');
  if (!failed) return;
  activeMessages = activeMessages.filter((message) => message.client_message_id !== clientMessageId);
  renderMessages(activeMessages, activeConversation);
  await sendChatPayload({
    message_type: failed.message_type || 'text',
    content: failed.content || '',
    attachments: chatMessageAttachments(failed),
    metadata: chatMessageMetadata(failed),
    related_type: failed.related_type || '',
    related_id: failed.related_id || ''
  });
}

async function sendContextCard() {
  if (!activeChatContext) return;
  await sendChatPayload({
    message_type: activeChatContext.message_type,
    content: activeChatContext.content,
    metadata: activeChatContext.metadata || {},
    related_type: activeChatContext.related_type || '',
    related_id: activeChatContext.related_id || ''
  }, { successMessage: '业务卡片已发送' });
  chatContextCardSent = true;
  renderChatContextPanel();
}

async function sendImageMessage(file) {
  if (!activeConversationId) return showToast('warn', '请先选择会话');
  if (!file) return;
  if (!String(file.type || '').startsWith('image/')) return showToast('warn', '请选择图片文件');
  const button = document.getElementById('attach-image-btn');
  const previousText = button?.textContent || '图片';
  if (button) {
    button.disabled = true;
    button.textContent = '上传中';
  }
  try {
    const url = await uploadPhoto(file, 'chat-images');
    if (!url) throw new Error('上传失败');
    await sendChatPayload({
      message_type: 'image',
      content: file.name || '图片',
      attachments: [{ type: 'image', url, name: file.name || '图片', mime: file.type || '', size: file.size || 0 }]
    });
  } catch (error) {
    showToast('danger', `图片发送失败：${error.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousText;
    }
  }
}

function appendRealtimeMessage(message = {}) {
  if (!message?.id && !message?.content) return;
  activeMessages = mergeMessages(activeMessages, [message]);
  renderMessages(activeMessages, activeConversation);
  callRestApi(`/chat/conversations/${encodeURIComponent(activeConversationId)}/read`, chatApiOptions({ method: 'PATCH' })).catch(() => {});
}

function stopChatRealtime() {
  if (chatEvents) {
    chatEvents.close();
    chatEvents = null;
  }
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}

function startPollingFallback() {
  if (chatPollTimer) return;
  setChatRealtimeMode('polling');
  chatPollTimer = setInterval(() => scheduleChatRefresh('poll'), 7000);
}

function startChatRealtime() {
  stopChatRealtime();
  const token = getAuthTokenForContext(chatAdminView);
  if (!token || !window.EventSource) {
    startPollingFallback();
    return;
  }
  setChatRealtimeMode('connecting');
  chatEvents = new EventSource(buildRestUrl('/chat/events', { token }));
  chatEvents.addEventListener('ready', () => setChatRealtimeMode('sse'));
  chatEvents.addEventListener('message', (event) => {
    const data = JSON.parse(event.data || '{}');
    if (data.conversation_id === activeConversationId && data.message) {
      appendRealtimeMessage(data.message);
      loadConversations(activeConversationId).catch(() => {});
    } else if (!data.conversation_id || data.conversation_id === activeConversationId) scheduleChatRefresh('message');
    else loadConversations(activeConversationId).catch(() => {});
  });
  chatEvents.addEventListener('conversation_changed', () => scheduleChatRefresh('conversation'));
  chatEvents.addEventListener('conversation_deleted', (event) => {
    const data = JSON.parse(event.data || '{}');
    if (data.conversation_id === activeConversationId) activeConversationId = '';
    scheduleChatRefresh('conversation_deleted');
  });
  chatEvents.onerror = () => {
    if (chatEvents) {
      chatEvents.close();
      chatEvents = null;
    }
    startPollingFallback();
  };
}

function bindChatEvents() {
  document.addEventListener('click', (event) => {
    const actionTarget = event.target.closest('[data-chat-action]');
    if (!actionTarget) return;
    const action = actionTarget.dataset.chatAction;
    const userId = actionTarget.dataset.userId;
    if (action === 'toggle-group-user') {
      selectedGroupUserIds.has(userId) ? selectedGroupUserIds.delete(userId) : selectedGroupUserIds.add(userId);
      renderGroupUserPicker();
      renderSelectedGroupUsers();
    } else if (action === 'remove-group-user') {
      selectedGroupUserIds.delete(userId);
      renderGroupUserPicker();
      renderSelectedGroupUsers();
    } else if (action === 'toggle-add-member') {
      selectedAddMemberIds.has(userId) ? selectedAddMemberIds.delete(userId) : selectedAddMemberIds.add(userId);
      renderAddMemberPicker();
    } else if (action === 'select-member') {
      selectedActionMemberId = userId;
      if (!memberToolMode) memberToolMode = 'actions';
      renderMembers(activeConversation);
      renderSelectedMemberInfo();
      document.getElementById('member-actions-panel')?.classList.toggle('hidden', memberToolMode !== 'actions');
      document.getElementById('toggle-member-actions-btn')?.classList.toggle('active', memberToolMode === 'actions');
    } else if (action === 'mention-member') {
      insertMention(memberById(userId));
    } else if (action === 'mention-all') {
      if (!canAnnounceAll(activeConversation)) return showToast('warn', '当前账号没有@全体成员权限');
      insertMention(null, { all: true });
    } else if (action === 'retry-message') {
      retryFailedMessage(actionTarget.dataset.clientId || '').catch((error) => showToast('danger', error.message));
    } else if (action === 'send-context-card') {
      sendContextCard().catch((error) => showToast('danger', error.message));
    } else if (action === 'clear-context-card') {
      activeChatContext = null;
      renderChatContextPanel();
    }
  });
  document.getElementById('conversation-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-conversation-id]');
    if (button) loadMessages(button.dataset.conversationId).catch((error) => showToast('danger', error.message));
  });
  document.getElementById('group-user-filter')?.addEventListener('input', renderGroupUserPicker);
  document.getElementById('add-member-filter')?.addEventListener('input', renderAddMemberPicker);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#mention-panel') && !event.target.closest('.chat-composer')) hideMentionPanel();
  });
  document.getElementById('toggle-members-drawer-btn')?.addEventListener('click', () => setMembersDrawerOpen(!membersDrawerOpen));
  document.getElementById('close-members-drawer-btn')?.addEventListener('click', () => setMembersDrawerOpen(false));
  document.getElementById('chat-members-overlay')?.addEventListener('click', () => setMembersDrawerOpen(false));
  document.getElementById('message-content')?.addEventListener('input', () => renderMentionPanel(activeConversation));
  document.getElementById('message-content')?.addEventListener('click', () => renderMentionPanel(activeConversation));
  document.getElementById('clear-group-selection-btn')?.addEventListener('click', () => {
    selectedGroupUserIds = new Set();
    renderGroupUserPicker();
    renderSelectedGroupUsers();
  });
  document.getElementById('toggle-add-members-btn')?.addEventListener('click', () => {
    if (!activeConversation || activeConversation.type !== 'group') return showToast('warn', '请先选择群聊');
    setMemberToolMode('add');
  });
  document.getElementById('toggle-member-actions-btn')?.addEventListener('click', () => {
    if (!activeConversation || activeConversation.type !== 'group') return showToast('warn', '请先选择群聊');
    setMemberToolMode('actions');
  });
  document.getElementById('member-direct-btn')?.addEventListener('click', () => {
    if (!selectedActionMemberId) return showToast('warn', '请选择成员');
    startDirectChat(selectedActionMemberId).catch((error) => showToast('danger', error.message));
  });
  document.getElementById('member-kick-btn')?.addEventListener('click', () => {
    if (!selectedActionMemberId) return showToast('warn', '请选择成员');
    kickMember(selectedActionMemberId).catch((error) => showToast('danger', error.message));
  });
  document.getElementById('confirm-add-members-btn')?.addEventListener('click', () => addMembersToGroup().catch((error) => showToast('danger', error.message)));
  document.getElementById('dissolve-group-btn')?.addEventListener('click', () => dissolveActiveGroup().catch((error) => showToast('danger', error.message)));
  document.getElementById('leave-group-btn')?.addEventListener('click', () => leaveActiveGroup().catch((error) => showToast('danger', error.message)));
  document.getElementById('reload-chat-btn')?.addEventListener('click', () => loadConversations().catch((error) => showToast('danger', error.message)));
  document.getElementById('start-direct-chat-btn')?.addEventListener('click', () => startDirectChat().catch((error) => showToast('danger', error.message)));
  document.getElementById('start-group-chat-btn')?.addEventListener('click', () => startGroupChat().catch((error) => showToast('danger', error.message)));
  document.getElementById('send-message-btn')?.addEventListener('click', () => sendActiveMessage().catch((error) => showToast('danger', error.message)));
  document.getElementById('attach-image-btn')?.addEventListener('click', () => {
    document.getElementById('chat-image-input')?.click();
  });
  document.getElementById('chat-image-input')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    sendImageMessage(file).catch((error) => showToast('danger', error.message));
  });
  document.getElementById('load-older-messages-btn')?.addEventListener('click', () => loadOlderMessages());
  document.getElementById('message-content')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      sendActiveMessage().catch((error) => showToast('danger', error.message));
    }
  });
}

async function bootChat() {
  if (!requireChatLogin()) return;
  bindChatEvents();
  try {
    await loadChatUsers();
    if (initialChatUserId) await startDirectChat(initialChatUserId);
    else if (!chatAdminView && initialContactAdmin) {
      const adminContact = firstAdminContact();
      if (adminContact?.id) await startDirectChat(adminContact.id);
      else await loadConversations();
    }
    else await loadConversations();
    applyInitialChatContext();
    startChatRealtime();
  } catch (error) {
    showPageMessage('chat-message', 'danger', error.message);
    renderMessages([], null);
    startPollingFallback();
  }
}

bootChat();
