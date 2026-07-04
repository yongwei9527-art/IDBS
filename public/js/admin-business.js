// Admin business modules: devices, users and reservation approval.
// Loaded before admin.js so tab routing and delegated action buttons can call these functions.

let editingDeviceId = '';
let adminDeviceRows = [];

function adminChatHref(userId = '', params = {}) {
  const query = new URLSearchParams({ admin: '1', back: 'admin.html#overview' });
  if (userId) query.set('user_id', userId);
  Object.entries(params || {}).forEach(([key, value]) => {
    const text = String(value ?? '').trim();
    if (text) query.set(key, text.slice(0, 160));
  });
  return `chat.html?${query.toString()}`;
}

function shortRows(rows = [], renderRow, emptyText = '暂无记录。') {
  if (!rows.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  return `<div class="table-wrap compact"><table>${rows.map(renderRow).join('')}</table></div>`;
}

function adminChatLink(userId = '', label = '沟通', params = {}) {
  if (!userId) return '';
  return `<a class="secondary" href="${escapeHtml(adminChatHref(userId, params))}">${escapeHtml(label)}</a>`;
}

function renderUserList(users = []) {
  const container = document.getElementById('userList');
  const allSelected = users.length > 0 && users.every((user) => selectedUserIds.has(user.id));
  container.innerHTML = users.length ? `
    <div class="table-wrap">
      <table>
        <tr>
          <th><input type="checkbox" id="user-select-all" ${allSelected ? 'checked' : ''}></th>
          <th>姓名</th><th>UUID</th><th>手机号</th><th>学号/工号</th><th>状态</th><th>微信</th><th>封禁</th><th>操作</th>
        </tr>
        ${users.map((user) => `
          <tr>
            <td><input type="checkbox" class="user-select-box" data-user-id="${escapeHtml(user.id)}" ${selectedUserIds.has(user.id) ? 'checked' : ''}></td>
            <td>${escapeHtml(user.name || '-')}</td>
            <td class="mono">${escapeHtml(user.id || '-')}</td>
            <td>${escapeHtml(user.phone || '-')}</td>
            <td>${escapeHtml(user.student_no || '-')}</td>
            <td>${statusBadge(user.status)}</td>
            <td>${user.wechat_bound ? `<span class="badge info">${escapeHtml(user.wechat_nickname || '微信用户')}</span><br><span class="muted">${escapeHtml(user.wechat_openid_masked || '已绑定')}</span>` : '<span class="muted">未绑定</span>'}</td>
            <td>${user.is_banned ? '<span class="badge danger">已封禁</span>' : '<span class="badge success">正常</span>'}</td>
            <td class="actions">
              <button data-admin-action="set-user-status" data-user-id="${escapeHtml(user.id)}" data-status="active">通过</button>
              <button class="secondary" data-admin-action="toggle-user-ban" data-user-id="${escapeHtml(user.id)}" data-banned="${user.is_banned ? 'false' : 'true'}">${user.is_banned ? '解除封禁' : '封禁'}</button>
              <button class="danger" data-admin-action="delete-user" data-user-id="${escapeHtml(user.id)}">删除</button>
              ${user.wechat_bound ? `<button class="warning" data-admin-action="unbind-wechat" data-user-id="${escapeHtml(user.id)}">解绑微信</button>` : ''}
              ${adminChatLink(user.id, '沟通', { back: 'admin.html#users' })}
              <button class="secondary" data-admin-action="toggle-user-detail" data-user-id="${escapeHtml(user.id)}">详情</button>
            </td>
          </tr>
          <tr id="user_detail_${escapeHtml(user.id)}" class="hidden"><td colspan="9"><div class="soft-panel">点击详情加载。</div></td></tr>
        `).join('')}
      </table>
    </div>` : '<div class="empty-state">暂无用户。</div>';

  const selectAll = document.getElementById('user-select-all');
  if (selectAll) {
    selectAll.addEventListener('change', (event) => {
      const checked = event.target.checked;
      users.forEach((user) => {
        if (checked) selectedUserIds.add(user.id);
        else selectedUserIds.delete(user.id);
      });
      renderUserList(users);
    });
  }

  container.querySelectorAll('.user-select-box').forEach((box) => {
    box.addEventListener('change', (event) => {
      const userId = event.target.dataset.userId;
      if (event.target.checked) selectedUserIds.add(userId);
      else selectedUserIds.delete(userId);
      renderUserList(users);
    });
  });
}

function syncUserSelectionButtons() {
  const deleteButton = document.getElementById('delete-selected-users-btn');
  if (deleteButton) deleteButton.disabled = selectedUserIds.size === 0;
}

async function toggleUserDetail(userId) {
  if (typeof openDrawer === 'function') {
    openDrawer({ title: '用户详情', subtitle: '预约、使用、故障和需求记录', content: '<div class="card card-center"><p class="muted">正在加载用户详情...</p></div>' });
    try {
      const result = await callRestApi(`/admin/users/${encodeURIComponent(userId)}/detail`, { admin: true });
      setDrawerContent(renderUserDetailContent(result));
    } catch (error) {
      setDrawerContent(`<div class="alert danger">${escapeHtml(error.message)}</div>`);
    }
    return;
  }
  const row = document.getElementById(`user_detail_${userId}`);
  if (!row) return;
  row.classList.toggle('hidden');
  if (row.classList.contains('hidden')) return;
  const box = row.querySelector('.soft-panel');
  if (!box || box.dataset.loaded === '1') return;
  setLoading(box, '正在加载用户详情...');
  try {
    const result = await callRestApi(`/admin/users/${encodeURIComponent(userId)}/detail`, { admin: true });
    box.dataset.loaded = '1';
    box.innerHTML = renderUserDetailContent(result);
  } catch (error) {
    showPageMessage(box, 'danger', error.message);
  }
}

function renderUserDetailContent(result = {}) {
  const user = result.user || {};
  return `
      <div class="section-head compact-head">
        <div>
          <h3>${escapeHtml(user.name || '-')} 的使用画像</h3>
          <p class="muted">${escapeHtml(user.phone || '-')} · ${escapeHtml(user.student_no || '-')} · ${escapeHtml(user.role || 'user')}</p>
        </div>
        ${adminChatLink(user.id, '沟通', { back: 'admin.html#users' })}
      </div>
      <div class="kpi compact-kpi">
        <div class="soft-panel"><span class="metric-label">预约</span><strong>${escapeHtml((result.reservations || []).length)}</strong></div>
        <div class="soft-panel"><span class="metric-label">使用</span><strong>${escapeHtml((result.borrows || []).length)}</strong></div>
        <div class="soft-panel"><span class="metric-label">故障</span><strong>${escapeHtml((result.fault_reports || []).length)}</strong></div>
        <div class="soft-panel"><span class="metric-label">需求</span><strong>${escapeHtml((result.requests || []).length)}</strong></div>
      </div>
      <h4>最近预约</h4>
      ${shortRows((result.reservations || []).slice(0, 8), (item) => `<tr><td>${escapeHtml(item.device_code || '-')}</td><td>${escapeHtml(fmtTime(item.start_time))}</td><td>${statusBadge(item.status)}</td><td>${escapeHtml(item.admin_note || item.purpose || '-')}</td></tr>`)}
      <h4>最近使用</h4>
      ${shortRows((result.borrows || []).slice(0, 8), (item) => `<tr><td>${escapeHtml(item.device_code || '-')}</td><td>${escapeHtml(fmtTime(item.borrow_time))}</td><td>${escapeHtml(fmtTime(item.return_time))}</td><td>${statusBadge(item.status)}</td></tr>`)}
      <h4>故障与需求</h4>
      ${shortRows([...(result.fault_reports || []).slice(0, 5), ...(result.requests || []).slice(0, 5)], (item) => `<tr><td>${escapeHtml(item.device_code || '-')}</td><td>${escapeHtml(item.issue_type || item.title || '-')}</td><td>${statusBadge(item.status)}</td><td>${escapeHtml(fmtTime(item.created_at))}</td></tr>`)}
    `;
}

async function createDevice() {
  try {
    let photo = '';
    const photoInput = document.getElementById('cover_photo');
    if (photoInput?.files?.[0]) {
      photo = await uploadPhoto(photoInput.files[0], 'device-photos');
    }
    const payload = {
      device_code: fieldValue('device_code'),
      name: fieldValue('device_name'),
      category: fieldValue('category'),
      location: fieldValue('location'),
      manager: fieldValue('manager'),
      status: fieldValue('status') || 'available',
      allow_reservation: fieldValue('status') === 'available',
      description: fieldValue('description'),
      usage_notice: fieldValue('usage_notice'),
      reservation_slot_keys: getDeviceSlotKeys()
    };
    if (photo) payload.cover_photo = photo;
    await callRestApi(editingDeviceId ? `/admin/devices/${encodeURIComponent(editingDeviceId)}` : '/admin/devices', {
      method: editingDeviceId ? 'PUT' : 'POST',
      admin: true,
      body: payload
    });
    showToast('success', editingDeviceId ? '设备已更新' : '设备已创建');
    resetDeviceForm();
    refreshAdminSummary().catch(() => {});
    loadDevices();
  } catch (error) {
    handleAdminError(error);
  }
}

function resetDeviceForm() {
  editingDeviceId = '';
  ['device_code', 'device_name', 'category', 'location', 'manager', 'description', 'usage_notice'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.value = '';
  });
  const status = document.getElementById('status');
  if (status) status.value = 'available';
  const photoInput = document.getElementById('cover_photo');
  if (photoInput) photoInput.value = '';
  document.getElementById('create-device-btn').textContent = '添加设备';
  document.getElementById('cancel-device-edit-btn')?.classList.add('hidden');
  renderDeviceSlotOptions();
}

function editDeviceFromList(deviceId) {
  const device = adminDeviceRows.find((item) => item.id === deviceId);
  if (!device) return showToast('warn', '未找到设备信息');
  editingDeviceId = device.id;
  document.getElementById('device_code').value = device.device_code || '';
  document.getElementById('device_name').value = device.name || '';
  document.getElementById('status').value = device.status || 'available';
  document.getElementById('category').value = device.category || '';
  document.getElementById('location').value = device.location || '';
  document.getElementById('manager').value = device.manager || '';
  document.getElementById('description').value = device.description || '';
  document.getElementById('usage_notice').value = device.usage_notice || '';
  document.getElementById('create-device-btn').textContent = '保存设备修改';
  document.getElementById('cancel-device-edit-btn')?.classList.remove('hidden');
  const deviceSlotOptions = Array.isArray(device.reservation_slot_options) ? device.reservation_slot_options : [];
  const keys = deviceSlotOptions.map((slot) => slot.key).filter(Boolean);
  renderDeviceSlotOptions(keys.length ? keys : undefined, deviceSlotOptions.length ? mergeReservationSlotPresets(deviceSlotOptions) : reservationSlotPresets);
  document.getElementById('device_code')?.focus();
}

async function loadDevices() {
  const container = document.getElementById('deviceList');
  setLoading(container, '正在加载设备...');
  try {
    const result = await callRestApi('/admin/devices', { admin: true });
    const devices = result.devices || result.list || [];
    adminDeviceRows = devices;
    container.innerHTML = devices.length ? `
      <div class="table-wrap">
        <table>
          <tr><th>编号</th><th>名称</th><th>位置</th><th>状态</th><th>预约时段</th><th>当前使用</th><th>下个预约</th><th>操作</th></tr>
          ${devices.map((device) => `
            <tr>
              <td class="mono">${escapeHtml(device.device_code)}</td>
              <td>${escapeHtml(device.name)}</td>
              <td>${escapeHtml(device.location || '-')}</td>
              <td>${statusBadge(device.status)}</td>
              <td>${escapeHtml(slotLabels(device.reservation_slot_options))}</td>
              <td>${device.current_borrow ? `${escapeHtml(device.current_borrow.user_name || '-')}<br>${escapeHtml(device.current_borrow.user_phone || '-')}` : '<span class="muted">无</span>'}</td>
              <td>${device.next_reservation ? `${escapeHtml(device.next_reservation.user_name || '-')}<br>${escapeHtml(device.next_reservation.user_phone || '-')}<br>${escapeHtml(fmtTime(device.next_reservation.start_time))}` : '<span class="muted">无</span>'}</td>
              <td class="actions">
                <button class="secondary" data-admin-action="edit-device" data-device-id="${escapeHtml(device.id)}">编辑</button>
                <button class="secondary" data-admin-action="toggle-device-history" data-device-id="${escapeHtml(device.id)}">历史</button>
                ${device.status === 'available'
                  ? `<button class="warning" data-admin-action="set-device-status" data-device-id="${escapeHtml(device.id)}" data-status="maintenance">维修</button><button class="danger" data-admin-action="set-device-status" data-device-id="${escapeHtml(device.id)}" data-status="disabled">停用</button>`
                  : `<button data-admin-action="set-device-available" data-device-id="${escapeHtml(device.id)}">恢复可预约</button>`}
              </td>
            </tr>
            <tr id="device_history_${escapeHtml(device.id)}" class="hidden"><td colspan="8"><div class="soft-panel">点击历史加载。</div></td></tr>
          `).join('')}
        </table>
      </div>` : '<div class="empty-state">暂无设备。</div>';
  } catch (error) {
    handleAdminError(error, container);
  }
}

async function setAvailable(id) {
  try {
    await callRestApi(`/admin/devices/${encodeURIComponent(id)}/availability`, {
      method: 'PUT',
      admin: true
    });
    showToast('success', '设备已恢复可预约');
    refreshAdminSummary().catch(() => {});
    loadDevices();
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function setDeviceStatus(id, status) {
  const labels = { maintenance: '维修中', disabled: '停用' };
  if (!confirm(`确认将设备设为${labels[status] || status}吗？设为不可用后用户不能新预约。`)) return;
  try {
    await callRestApi(`/admin/devices/${encodeURIComponent(id)}`, {
      method: 'PUT',
      admin: true,
      body: { status, allow_reservation: false }
    });
    showToast('success', '设备状态已更新');
    refreshAdminSummary().catch(() => {});
    loadDevices();
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function toggleDeviceHistory(deviceId) {
  if (typeof openDrawer === 'function') {
    openDrawer({ title: '设备详情', subtitle: '预约、使用和故障历史', content: '<div class="card card-center"><p class="muted">正在加载设备历史...</p></div>' });
    try {
      const result = await callRestApi(`/admin/devices/${encodeURIComponent(deviceId)}/detail`, { admin: true });
      setDrawerContent(renderDeviceHistoryContent(result));
    } catch (error) {
      setDrawerContent(`<div class="alert danger">${escapeHtml(error.message)}</div>`);
    }
    return;
  }
  const row = document.getElementById(`device_history_${deviceId}`);
  if (!row) return;
  row.classList.toggle('hidden');
  if (row.classList.contains('hidden')) return;
  const box = row.querySelector('.soft-panel');
  if (!box || box.dataset.loaded === '1') return;
  setLoading(box, '正在加载设备历史...');
  try {
    const result = await callRestApi(`/admin/devices/${encodeURIComponent(deviceId)}/detail`, { admin: true });
    box.dataset.loaded = '1';
    box.innerHTML = renderDeviceHistoryContent(result);
  } catch (error) {
    showPageMessage(box, 'danger', error.message);
  }
}

function renderDeviceHistoryContent(result = {}) {
  const device = result.device || {};
  return `
      <div class="section-head compact-head">
        <div>
          <h3>${escapeHtml(device.device_code || '-')} ${escapeHtml(device.name || '')}</h3>
          <p class="muted">${escapeHtml(device.location || '-')} · ${escapeHtml(device.manager || '-')}</p>
        </div>
        <a class="secondary" href="device.html?code=${encodeURIComponent(device.device_code || '')}">打开详情页</a>
      </div>
      <h4>预约记录</h4>
      ${shortRows((result.reservations || []).slice(0, 12), (item) => `<tr><td>${escapeHtml(item.user_name || '-')}</td><td>${escapeHtml(fmtTime(item.start_time))}</td><td>${escapeHtml(fmtTime(item.end_time))}</td><td>${statusBadge(item.status)}</td></tr>`)}
      <h4>使用历史</h4>
      ${shortRows((result.borrows || []).slice(0, 12), (item) => `<tr><td>${escapeHtml(item.user_name || '-')}</td><td>${escapeHtml(fmtTime(item.borrow_time))}</td><td>${escapeHtml(fmtTime(item.return_time))}</td><td>${statusBadge(item.status)}</td></tr>`)}
      <h4>故障历史</h4>
      ${shortRows((result.fault_reports || []).slice(0, 12), (item) => `<tr><td>${escapeHtml(item.user_name || '-')}</td><td>${escapeHtml(item.issue_type || '-')}</td><td>${statusBadge(item.status)}</td><td>${escapeHtml(fmtTime(item.created_at))}</td></tr>`)}
    `;
}

async function loadUsers() {
  const container = document.getElementById('userList');
  setLoading(container, '正在加载用户...');
  try {
    const result = await callRestApi('/admin/users', { admin: true });
    const users = result.users || [];
    renderUserList(users);
    syncUserSelectionButtons();
  } catch (error) {
    showPageMessage(container, 'danger', error.message);
  }
}

async function setUserStatus(id, status) {
  try {
    await callRestApi(`/admin/users/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      admin: true,
      body: { status }
    });
    showToast('success', status === 'active' ? '用户已通过审核' : '用户状态已更新');
    refreshAdminSummary().catch(() => {});
    loadUsers();
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function toggleBan(id, banned) {
  try {
    await callRestApi(`/admin/users/${encodeURIComponent(id)}/ban`, {
      method: 'PUT',
      admin: true,
      body: { is_banned: banned }
    });
    showToast('success', banned ? '用户已封禁' : '用户已解除封禁');
    loadUsers();
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function unbindWechat(id) {
  if (!confirm('确认解除该用户的微信绑定吗？')) return;
  try {
    await callRestApi(`/admin/users/${encodeURIComponent(id)}/wechat-binding`, {
      method: 'DELETE',
      admin: true
    });
    showToast('success', '微信绑定已解除');
    loadUsers();
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function deleteUser(id) {
  if (!confirm('确认删除该用户吗？该操作不可恢复。')) return;
  try {
    await callRestApi(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      admin: true
    });
    showToast('success', '用户已删除');
    selectedUserIds.delete(id);
    refreshAdminSummary().catch(() => {});
    loadUsers();
    syncUserSelectionButtons();
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function deleteSelectedUsers() {
  const ids = [...selectedUserIds];
  if (!ids.length) return showToast('warning', '请先选择要删除的用户');
  if (!confirm(`确认删除选中的 ${ids.length} 个用户吗？该操作不可恢复。`)) return;
  try {
    for (const id of ids) {
      await callRestApi(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', admin: true });
    }
    showToast('success', '选中用户已删除');
    selectedUserIds.clear();
    refreshAdminSummary().catch(() => {});
    loadUsers();
    syncUserSelectionButtons();
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function fetchAdminReservationResult(scope = 'current') {
  const query = `scope=${encodeURIComponent(scope)}`;
  try {
    return await callRestApi(`/admin/reservation-batches?${query}`, { admin: true });
  } catch (_) {
    return await callRestApi(`/admin/bookings?${query}`, { admin: true });
  }
}

function reservationResultRecordCount(result = {}) {
  const batches = result.batches || [];
  if (batches.length) {
    return batches.reduce((total, batch) => total + (Number(batch.item_count) || Number(batch.history_item_count) || Number(batch.current_item_count) || 1), 0);
  }
  return (result.reservations || []).length;
}

let activeReservationBoardFilter = 'all';
let reservationHistoryFilters = { start: '', end: '', person: '', device: '' };
let currentReservationDetailDialog = null;
const expandedReservationBatchKeys = new Set();

async function loadReservations() {
  const container = document.getElementById('reservationList');
  setLoading(container, '正在加载预约...');
  try {
    const [result, historyResult] = await Promise.all([
      fetchAdminReservationResult('current'),
      fetchAdminReservationResult('history').catch(() => ({}))
    ]);
    const historyTotal = reservationResultRecordCount(historyResult);
    if (activeReservationBoardFilter === 'history') {
      const historyBatches = historyResult.batches || [];
      if (historyBatches.length) {
        container.innerHTML = renderReservationBatchBoard(historyBatches, { scope: 'history', emptyText: '暂无历史预约记录。', activeFilter: 'history' });
        restoreExpandedReservationDetails(container);
        return;
      }
      const historyReservations = historyResult.reservations || [];
      container.innerHTML = historyReservations.length
        ? renderReservationTableSection('历史预约记录', historyReservations, 'history')
        : '<div class="empty-state">暂无历史预约记录。</div>';
      return;
    }
    const batches = result.batches || [];
    if (batches.length) {
      container.innerHTML = renderReservationBatchBoard(batches, { scope: 'current', emptyText: '暂无当前预约记录。', historyTotal, activeFilter: activeReservationBoardFilter });
      restoreExpandedReservationDetails(container);
      return;
    }
    const reservations = result.reservations || [];
    container.innerHTML = reservations.length
      ? renderReservationTableSection('当前预约记录', reservations, 'current')
      : '<div class="empty-state">暂无当前预约记录。</div>';
  } catch (error) {
    showPageMessage(container, 'danger', error.message);
  }
}

async function loadReservationHistory() {
  const container = document.getElementById('reservationHistoryList');
  setLoading(container, '正在加载历史记录...');
  try {
    const result = await fetchAdminReservationResult('history');
    const batches = result.batches || [];
    if (batches.length) {
      container.innerHTML = renderReservationBatchBoard(batches, { scope: 'history', emptyText: '暂无历史预约记录。', activeFilter: 'history' });
      restoreExpandedReservationDetails(container);
      return;
    }
    const reservations = result.reservations || [];
    container.innerHTML = reservations.length
      ? renderReservationTableSection('历史预约记录', reservations, 'history')
      : '<div class="empty-state">暂无历史预约记录。</div>';
  } catch (error) {
    showPageMessage(container, 'danger', error.message);
  }
}

function renderReservationTableSection(title, reservations = [], scope = 'current') {
  if (!reservations.length) return '';
  const isHistory = scope === 'history';
  return `
    <section class="soft-panel reservation-section">
      <div class="section-head compact-head"><div><h3>${escapeHtml(title)}</h3></div></div>
      <div class="table-wrap">
        <table>
          <tr><th>设备</th><th>预约人</th><th>联系方式</th><th>时段</th><th>状态</th><th>操作</th></tr>
          ${reservations.map((row) => `
            <tr>
              <td>${escapeHtml(row.device_name || '-')}<br><span class="muted mono">${escapeHtml(row.device_code || '-')}</span></td>
              <td>${escapeHtml(row.user_name || '-')}<br><span class="muted">${escapeHtml(row.user_student_no || '-')}</span></td>
              <td>${escapeHtml(row.user_phone || '-')}</td>
              <td>${escapeHtml(fmtTime(row.start_time))}<br>${escapeHtml(fmtTime(row.end_time))}</td>
              <td>${statusBadge(row.status)}${isHistory ? '<br><span class="badge info">历史</span>' : ''}</td>
              <td class="actions">
                ${!isHistory && row.status === 'pending' ? `<button data-admin-action="approve-reservation" data-reservation-id="${escapeHtml(row.id)}" data-approve="true">通过</button><button class="danger" data-admin-action="approve-reservation" data-reservation-id="${escapeHtml(row.id)}" data-approve="false">拒绝</button>` : '<span class="muted">-</span>'}
                ${adminChatLink(row.user_id, '沟通', { back: 'admin.html#reservations', context_type: 'reservation', reservation_id: row.id, device_code: row.device_code, user_name: row.user_name, user_phone: row.user_phone, start_time: row.start_time, end_time: row.end_time })}
              </td>
            </tr>
          `).join('')}
        </table>
      </div>
    </section>`;
}

function reservationBatchSortScore(batch) {
  if (Number(batch.pending_count) > 0) return 0;
  if (batch.status === 'approved') return 1;
  if (batch.status === 'rejected') return 2;
  return 3;
}

function reservationBatchScheduleText(batch = {}) {
  const timeSlotText = String(batch.time_slots || batch.time_slot || '').trim();
  const startValue = batch.first_start_time || batch.start_time || '';
  const endValue = batch.last_end_time || batch.end_time || '';
  if (!startValue && !endValue) return timeSlotText;
  const start = fmtTime(startValue || endValue);
  const end = fmtTime(endValue || startValue);
  return start === end ? start : `${start} 至 ${end}`;
}

function reservationTimeRows(batch = {}) {
  if (Array.isArray(batch.reservation_times)) return batch.reservation_times.map((item) => String(item || '').trim()).filter(Boolean);
  return splitBatchListValue(batch.reservation_times || batch.item_times || batch.time_slots || batch.time_slot);
}

function splitBatchListValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[、,，;；|\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function reservationBatchDeviceRows(batch = {}) {
  const previewRows = splitBatchListValue(batch.reservation_preview_rows).map((item) => {
    const [name = '', code = '', time = ''] = String(item || '').split('｜');
    return { name: name.trim(), code: code.trim(), time: time.trim() };
  }).filter((item) => item.name || item.code || item.time);
  const names = splitBatchListValue(batch.device_names || batch.device_name || batch.device_codes || batch.device_code);
  const codes = splitBatchListValue(batch.device_codes || batch.device_code);
  const times = reservationTimeRows(batch);
  if (previewRows.length) {
    return previewRows.map((row, index) => ({
      name: row.name || names[index] || names[0] || batch.device_name || `设备 ${index + 1}`,
      code: row.code || codes[index] || codes[0] || '',
      time: row.time || times[index] || times[0] || reservationBatchScheduleText(batch) || '时间未设置'
    }));
  }
  const total = Math.max(names.length, codes.length, Number(batch.device_count) || 0, 1);
  const scheduleText = reservationBatchScheduleText(batch) || '时间未设置';
  return Array.from({ length: total }).map((_, index) => {
    const name = names[index] || names[0] || batch.device_name || `设备 ${index + 1}`;
    const code = codes[index] || codes[0] || '';
    return { name, code, time: times[index] || times[0] || scheduleText };
  });
}

function renderReservationBatchPreview(batch = {}, scope = 'current') {
  const rows = reservationBatchDeviceRows(batch);
  const safeBatchId = escapeHtml(batch.id || '');
  const safeScope = escapeHtml(scope);
  const safeTitle = escapeHtml(batch.user_name || batch.user_id || '预约');
  return `
    <button type="button" class="reservation-batch-purpose reservation-batch-preview" data-admin-action="open-batch-detail" data-batch-id="${safeBatchId}" data-batch-scope="${safeScope}" data-batch-title="${safeTitle}" data-batch-preview-id="${safeBatchId}" title="点击查看全部预约明细">
      <div class="reservation-preview-scroll" title="可向下滑动查看更多设备">
        ${rows.map((row) => `
          <div class="reservation-preview-row">
            <div><strong>${escapeHtml(row.name || '-')}</strong>${row.code ? `<span class="muted mono">${escapeHtml(row.code)}</span>` : ''}</div>
            <span>${escapeHtml(row.time)}</span>
          </div>`).join('')}
      </div>
    </button>`;
}

function reservationBatchGroupKey(batch = {}, scope = 'current') {
  if (scope === 'history' || batch.is_history === true) return 'history';
  const pending = Number(batch.pending_count) || 0;
  const approved = Number(batch.approved_count) || 0;
  const rejected = Number(batch.rejected_count) || 0;
  if (pending > 0 || batch.status === 'pending') return 'pending';
  if (batch.status === 'rejected' || (rejected > 0 && approved === 0)) return 'rejected';
  if (batch.status === 'approved' || approved > 0 || ['in_use', 'completed'].includes(batch.status)) return 'approved';
  return 'other';
}

function renderReservationSummaryCard(label, value, attrs = '', hint = '') {
  return `
    <button type="button" class="soft-panel reservation-summary-card" ${attrs}>
      <span class="metric-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
    </button>`;
}

function reservationSummaryCardAttrs(filterKey, activeFilter = 'all', scope = 'current') {
  const safeFilter = escapeHtml(filterKey);
  const safeScope = escapeHtml(scope);
  const isActive = activeFilter === filterKey || (scope === 'history' && filterKey === 'history');
  const titleMap = {
    pending: '点击查看待批准预约',
    approved: '点击查看已通过预约',
    rejected: '点击查看已拒绝预约',
    history: '点击查看预约成功且使用完毕的历史记录'
  };
  const title = titleMap[filterKey] || '点击筛选预约记录';
  return `data-admin-action="filter-reservation-board" data-reservation-filter="${safeFilter}" data-reservation-scope="${safeScope}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}" ${isActive ? 'aria-pressed="true"' : 'aria-pressed="false"'}`;
}

function reservationFilterText(value) {
  return String(value || '').trim().toLowerCase();
}

function reservationFilterDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function applyHistoryReservationFilters(batches = []) {
  const start = reservationHistoryFilters.start || '';
  const end = reservationHistoryFilters.end || '';
  const person = reservationFilterText(reservationHistoryFilters.person);
  const device = reservationFilterText(reservationHistoryFilters.device);
  return batches.filter((batch) => {
    const batchDate = reservationFilterDate(batch.last_end_time || batch.first_start_time || batch.created_at);
    if (start && batchDate && batchDate < start) return false;
    if (end && batchDate && batchDate > end) return false;
    if (person) {
      const personText = reservationFilterText(`${batch.user_name || ''} ${batch.user_phone || ''} ${batch.user_id || ''}`);
      if (!personText.includes(person)) return false;
    }
    if (device) {
      const deviceText = reservationFilterText(`${batch.device_name || ''} ${batch.device_code || ''} ${batch.device_names || ''} ${batch.device_codes || ''}`);
      if (!deviceText.includes(device)) return false;
    }
    return true;
  });
}

function renderHistoryReservationFilters(total = 0, visible = 0) {
  return `
    <div class="filter-card reservation-history-filters">
      <div class="section-head compact-head">
        <div>
          <h4>历史筛选</h4>
        </div>
        <span class="reservation-section-count">${escapeHtml(visible)} / ${escapeHtml(total)} 条</span>
      </div>
      <div class="toolbar">
        <div>
          <label for="reservation_history_start">开始日期</label>
          <input id="reservation_history_start" type="date" value="${escapeHtml(reservationHistoryFilters.start)}">
        </div>
        <div>
          <label for="reservation_history_end">结束日期</label>
          <input id="reservation_history_end" type="date" value="${escapeHtml(reservationHistoryFilters.end)}">
        </div>
        <div>
          <label for="reservation_history_person">人物</label>
          <input id="reservation_history_person" value="${escapeHtml(reservationHistoryFilters.person)}" placeholder="姓名 / 手机">
        </div>
        <div>
          <label for="reservation_history_device">设备</label>
          <input id="reservation_history_device" value="${escapeHtml(reservationHistoryFilters.device)}" placeholder="设备名 / 编号">
        </div>
        <div class="actions">
          <button type="button" data-admin-action="apply-history-filter">筛选</button>
          <button type="button" class="secondary" data-admin-action="reset-history-filter">清空</button>
        </div>
      </div>
    </div>`;
}

function renderReservationStatusSection(key, title, batches = [], options = {}) {
  const emptyText = options.emptyText || '暂无记录。';
  return `
    <section id="reservation_section_${escapeHtml(key)}" class="reservation-status-section" data-reservation-section="${escapeHtml(key)}">
      <div class="reservation-section-head">
        <div>
          <h4>${escapeHtml(title)}</h4>
          <p class="muted">${escapeHtml(options.description || '')}</p>
        </div>
        <span class="reservation-section-count">${escapeHtml(batches.length)} 条</span>
      </div>
      ${batches.length
        ? batches.map((batch) => renderReservationBatchCard(batch, options)).join('')
        : `<div class="empty-state reservation-empty-subsection">${escapeHtml(emptyText)}</div>`}
    </section>`;
}

function historyReservationGroupKey(batch = {}) {
  const name = String(batch.user_name || batch.user_id || '-').trim().toLowerCase();
  const phone = String(batch.user_phone || '-').trim().toLowerCase();
  return `${name}::${phone}`;
}

function buildHistoryReservationGroups(batches = []) {
  const groupMap = new Map();
  batches.forEach((batch) => {
    const key = historyReservationGroupKey(batch);
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        ...batch,
        id: `history_group_${key.replace(/[^a-z0-9_-]+/gi, '_')}`,
        __historyGroup: true,
        history_records: [],
        item_count: 0,
        device_count: 0,
        date_count: 0,
        pending_count: 0,
        approved_count: 0,
        rejected_count: 0
      });
    }
    const group = groupMap.get(key);
    group.history_records.push(batch);
    group.item_count += Number(batch.item_count) || 0;
    group.device_count += Number(batch.device_count) || 0;
    group.date_count += Number(batch.date_count) || 0;
    group.pending_count += Number(batch.pending_count) || 0;
    group.approved_count += Number(batch.approved_count) || 0;
    group.rejected_count += Number(batch.rejected_count) || 0;
    const endTime = new Date(batch.last_end_time || batch.created_at || 0);
    if (!group.last_end_time || endTime > new Date(group.last_end_time || 0)) group.last_end_time = batch.last_end_time || batch.created_at;
    const createdAt = new Date(batch.created_at || 0);
    if (!group.created_at || createdAt > new Date(group.created_at || 0)) group.created_at = batch.created_at;
  });
  return Array.from(groupMap.values()).map((group) => ({
    ...group,
    history_record_count: group.history_records.length,
    purpose: group.history_records.length > 1
      ? `共 ${group.history_records.length} 次历史预约，点击查看全部记录。`
      : (group.history_records[0]?.purpose || group.purpose || '历史预约记录')
  })).sort((a, b) => new Date(b.last_end_time || b.created_at || 0) - new Date(a.last_end_time || a.created_at || 0));
}

function renderReservationBatchBoard(batches = [], options = {}) {
  if (!batches.length) return `<div class="empty-state">${escapeHtml(options.emptyText || '暂无预约记录。')}</div>`;
  const scope = options.scope || 'current';
  const activeFilter = options.activeFilter || (scope === 'history' ? 'history' : 'all');
  const sorted = [...batches].sort((a, b) => {
    if (scope === 'history') return new Date(b.last_end_time || b.created_at || 0) - new Date(a.last_end_time || a.created_at || 0);
    const score = reservationBatchSortScore(a) - reservationBatchSortScore(b);
    if (score !== 0) return score;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
  const summary = sorted.reduce((acc, batch) => {
    acc.pending += Number(batch.pending_count) || (batch.status === 'pending' ? 1 : 0);
    acc.approved += Number(batch.approved_count) || 0;
    acc.rejected += Number(batch.rejected_count) || 0;
    acc.history += Number(batch.history_item_count) || (scope === 'history' ? (Number(batch.item_count) || 1) : 0);
    return acc;
  }, { pending: 0, approved: 0, rejected: 0, history: 0 });
  if (scope !== 'history') summary.history = Number(options.historyTotal ?? summary.history) || 0;

  const historyRows = scope === 'history' ? applyHistoryReservationFilters(sorted) : [];

  const grouped = sorted.reduce((acc, batch) => {
    const key = reservationBatchGroupKey(batch, scope);
    if (!acc[key]) acc[key] = [];
    acc[key].push(batch);
    return acc;
  }, { pending: [], approved: [], rejected: [], history: [], other: [] });

  const sections = scope === 'history'
    ? [
        { key: 'history', title: '历史记录', rows: historyRows, description: '', emptyText: '暂无历史预约记录。' }
      ]
    : [
        { key: 'pending', title: '待批准预约', rows: grouped.pending, description: '', emptyText: '暂无待批准预约。' },
        { key: 'approved', title: '已通过预约', rows: grouped.approved, description: '', emptyText: '暂无已通过预约。' },
        { key: 'rejected', title: '已拒绝预约', rows: grouped.rejected, description: '', emptyText: '暂无已拒绝预约。' },
        ...(grouped.other.length ? [{ key: 'other', title: '其他当前预约', rows: grouped.other, description: '', emptyText: '暂无其他预约。' }] : [])
      ];

  const visibleSections = activeFilter && activeFilter !== 'all'
    ? sections.filter((section) => section.key === activeFilter)
    : sections;
  const filterTitleMap = { pending: '待批准', approved: '已通过', rejected: '已拒绝', history: '历史记录' };
  const activeFilterNotice = activeFilter && activeFilter !== 'all'
    ? `<div class="reservation-filter-notice">当前只显示：<strong>${escapeHtml(filterTitleMap[activeFilter] || activeFilter)}</strong>${scope !== 'history' ? '<button type="button" class="secondary" data-admin-action="filter-reservation-board" data-reservation-filter="all" data-reservation-scope="current">显示全部</button>' : ''}</div>`
    : '';

  return `
    <div class="reservation-board">
      <div class="reservation-board-summary">
        ${renderReservationSummaryCard('待批准', summary.pending, reservationSummaryCardAttrs('pending', activeFilter, scope), '筛选待批准')}
        ${renderReservationSummaryCard('已通过', summary.approved, reservationSummaryCardAttrs('approved', activeFilter, scope), '筛选已通过')}
        ${renderReservationSummaryCard('已拒绝', summary.rejected, reservationSummaryCardAttrs('rejected', activeFilter, scope), '筛选已拒绝')}
        ${renderReservationSummaryCard('历史筛选', summary.history, reservationSummaryCardAttrs('history', activeFilter, scope), scope === 'history' ? '当前历史筛选' : '按时间/人物/设备筛选')}
      </div>
      ${scope === 'history' ? renderHistoryReservationFilters(sorted.length, historyRows.length) : ''}
      ${activeFilterNotice}
      <div class="reservation-batch-list reservation-grouped-list">
        ${visibleSections.length ? visibleSections.map((section) => renderReservationStatusSection(section.key, section.title, section.rows, { ...options, description: section.description, emptyText: section.emptyText })).join('') : '<div class="empty-state">暂无对应预约记录。</div>'}
      </div>
    </div>`;
}

function renderReservationBatchCard(batch, options = {}) {
  const pending = Number(batch.pending_count) || 0;
  const scope = options.scope || (batch.is_history ? 'history' : 'current');
  const isHistory = scope === 'history' || batch.is_history === true;
  const actionable = !isHistory && pending > 0;
  const scheduleText = reservationBatchScheduleText(batch);
  const batchTitle = batch.user_name || batch.user_id || '预约';
  return `
    <article class="reservation-batch-card reservation-batch-compact ${actionable ? 'is-pending' : ''}" data-admin-action="open-batch-detail" data-batch-id="${escapeHtml(batch.id)}" data-batch-scope="${escapeHtml(scope)}" data-batch-title="${escapeHtml(batchTitle)}" role="button" tabindex="0" aria-label="查看预约设备明细">
      <div class="reservation-batch-main">
        <div>
          <div class="reservation-batch-title">
            <strong>${escapeHtml(batch.user_name || batch.user_id || '-')}</strong>
            ${statusBadge(batch.status)}
            ${isHistory ? '<span class="badge info">历史</span>' : ''}
          </div>
          <div class="muted reservation-batch-meta">${escapeHtml(batch.user_phone || '-')} · ${escapeHtml(fmtTime(batch.created_at))}</div>
          <div class="reservation-batch-stats reservation-batch-stats-inline">
            <span>${escapeHtml(batch.device_count ?? '-')} 台设备</span>
            <span>${escapeHtml(batch.date_count ?? '-')} 天</span>
            <span>${escapeHtml(batch.item_count ?? '-')} 条明细</span>
          </div>
        </div>
      </div>
      <div class="reservation-batch-hint">点击查看设备明细</div>
      <div class="reservation-batch-footer">
        <div class="actions">
          ${adminChatLink(batch.user_id, '沟通', { back: 'admin.html#reservations', context_type: 'reservation_batch', batch_id: batch.id, user_name: batch.user_name, user_phone: batch.user_phone, status: batch.status })}
          ${actionable ? `<button data-admin-action="approve-reservation-batch" data-batch-id="${escapeHtml(batch.id)}" data-approve="true">整批通过</button><button class="danger" data-admin-action="approve-reservation-batch" data-batch-id="${escapeHtml(batch.id)}" data-approve="false">整批拒绝</button>` : ''}
        </div>
      </div>
      <div id="batch_detail_${escapeHtml(batch.id)}" class="reservation-detail-panel hidden">
        <div class="soft-panel" id="batch_detail_box_${escapeHtml(batch.id)}">正在等待展开。</div>
      </div>
    </article>`;
}

function reservationBatchExpandKey(batchId = '', scope = 'current') {
  return `${scope || 'current'}::${batchId}`;
}

function renderHistoryReservationGroupCard(group, options = {}) {
  const records = group.history_records || [];
  const latest = records[0] || group;
  const recordsHtml = records.map((record, index) => {
    const recordSchedule = reservationBatchScheduleText(record);
    return `
      <article class="history-reservation-record">
        <div>
          <strong>历史预约 ${index + 1}</strong>
          ${statusBadge(record.status)}
          <div class="muted">提交于 ${escapeHtml(fmtTime(record.created_at))}${recordSchedule ? ` · ${escapeHtml(recordSchedule)}` : ''}</div>
          <div class="reservation-batch-purpose">${escapeHtml(record.purpose || '未填写预约用途')}</div>
        </div>
        <div class="reservation-batch-stats">
          <span>${escapeHtml(record.device_count ?? '-')} 台设备</span>
          <span>${escapeHtml(record.date_count ?? '-')} 天</span>
          <span>${escapeHtml(record.item_count ?? '-')} 条明细</span>
        </div>
        <div class="actions">
          <button data-admin-action="open-batch-detail" data-batch-id="${escapeHtml(record.id)}" data-batch-scope="history" data-batch-title="${escapeHtml(record.user_name || group.user_name || record.user_id || '历史预约')}">查看明细</button>
        </div>
      </article>`;
  }).join('');
  return `
    <article class="reservation-batch-card history-reservation-group">
      <div class="reservation-batch-main">
        <div>
          <div class="reservation-batch-title">
            <strong>${escapeHtml(group.user_name || group.user_id || '-')}</strong>
            <span class="badge info">历史合并</span>
          </div>
          <div class="muted">${escapeHtml(group.user_phone || '-')} · 最近提交于 ${escapeHtml(fmtTime(latest.created_at))}</div>
          <div class="reservation-batch-stats reservation-batch-stats-inline">
            <span>${escapeHtml(group.history_record_count ?? records.length)} 次预约</span>
            <span>${escapeHtml(group.device_count ?? '-')} 台设备</span>
            <span>${escapeHtml(group.date_count ?? '-')} 天</span>
            <span>${escapeHtml(group.item_count ?? '-')} 条明细</span>
          </div>
        </div>
      </div>
      <button type="button" class="reservation-batch-purpose history-group-toggle" data-admin-action="toggle-history-group" data-group-id="${escapeHtml(group.id)}">
        ${escapeHtml(group.purpose || '点击查看全部历史预约记录')}
      </button>
      <div class="reservation-batch-footer">
        <div class="actions">
          <button data-admin-action="toggle-history-group" data-group-id="${escapeHtml(group.id)}">查看全部记录</button>
          ${adminChatLink(group.user_id, '沟通', { back: 'admin.html#reservations', context_type: 'reservation_history', user_name: group.user_name, user_phone: group.user_phone, status: 'history' })}
        </div>
      </div>
      <div id="history_group_detail_${escapeHtml(group.id)}" class="reservation-detail-panel hidden">
        <div class="history-reservation-records">${recordsHtml || '<div class="empty-state">暂无历史预约记录。</div>'}</div>
      </div>
    </article>`;
}

function ensureReservationDetailPopoverHost() {
  let host = document.getElementById('reservation-detail-popover-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'reservation-detail-popover-host';
    document.body.appendChild(host);
  }
  return host;
}

function closeReservationDetailPopover() {
  const host = document.getElementById('reservation-detail-popover-host');
  if (host) host.innerHTML = '';
  document.removeEventListener('mousedown', handleReservationPopoverOutsideClick, true);
  document.removeEventListener('keydown', handleReservationPopoverEscape, true);
}

function handleReservationPopoverOutsideClick(event) {
  const popover = document.querySelector('#reservation-detail-popover-host .reservation-detail-popover');
  if (!popover) return;
  if (popover.contains(event.target) || event.target.closest('[data-admin-action="open-batch-detail"]')) return;
  closeReservationDetailPopover();
}

function handleReservationPopoverEscape(event) {
  if (event.key === 'Escape') closeReservationDetailPopover();
}

function reservationPopoverPosition(anchorEl) {
  const rect = anchorEl?.getBoundingClientRect?.() || currentReservationDetailDialog?.anchorRect || { left: window.innerWidth * 0.34, top: 120, bottom: 160 };
  const width = Math.min(920, Math.max(560, Math.round(window.innerWidth * 0.52)));
  const height = Math.min(680, Math.max(360, Math.round(window.innerHeight * 0.58)));
  const gap = 12;
  let left = rect.left;
  if (left + width > window.innerWidth - gap) left = window.innerWidth - width - gap;
  left = Math.max(gap, left);
  let top = rect.bottom + gap;
  if (top + height > window.innerHeight - gap) top = Math.max(gap, rect.top - height - gap);
  return { left, top, width, height, anchorRect: { left: rect.left, top: rect.top, bottom: rect.bottom } };
}

function openReservationDetailPopover({ title = '预约设备明细', subtitle = '', content = '', anchorEl = null } = {}) {
  const host = ensureReservationDetailPopoverHost();
  const position = reservationPopoverPosition(anchorEl);
  if (currentReservationDetailDialog) currentReservationDetailDialog.anchorRect = position.anchorRect;
  host.innerHTML = `
    <section class="reservation-detail-popover" role="dialog" aria-label="${escapeHtml(title)}" style="left:${position.left}px; top:${position.top}px; width:${position.width}px; max-height:${position.height}px;">
      <header class="reservation-detail-popover-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${subtitle ? `<p class="muted">${escapeHtml(subtitle)}</p>` : ''}
        </div>
        <button type="button" class="secondary reservation-detail-popover-close" aria-label="关闭">关闭</button>
      </header>
      <div class="reservation-detail-popover-body">${content}</div>
    </section>
  `;
  host.querySelector('.reservation-detail-popover-close')?.addEventListener('click', closeReservationDetailPopover);
  document.removeEventListener('mousedown', handleReservationPopoverOutsideClick, true);
  document.removeEventListener('keydown', handleReservationPopoverEscape, true);
  setTimeout(() => document.addEventListener('mousedown', handleReservationPopoverOutsideClick, true), 0);
  document.addEventListener('keydown', handleReservationPopoverEscape, true);
}

function setReservationDetailPopoverContent(content = '') {
  const body = document.querySelector('#reservation-detail-popover-host .reservation-detail-popover-body');
  if (body) body.innerHTML = content;
}

function renderBatchDetailContent(result = {}, batchId = '', detailScope = 'current') {
  const items = result.items || result.reservations || [];
  const isHistory = detailScope === 'history';
  return items.length ? `
      <div class="reservation-item-grid">
      ${items.map((item) => `<article class="reservation-item-card">
        <div><strong>${escapeHtml(item.device_name || '-')}</strong><br><span class="muted mono">${escapeHtml(item.device_code || '-')}</span></div>
        <div class="muted">${escapeHtml(fmtTime(item.start_time))}<br>${escapeHtml(fmtTime(item.end_time))}</div>
        <div>${statusBadge(item.status)}<br><span class="muted">${escapeHtml(item.admin_note || '-')}</span></div>
        <div class="actions">${!isHistory && item.status === 'pending' ? `<button data-admin-action="approve-reservation-item" data-reservation-id="${escapeHtml(item.id)}" data-batch-id="${escapeHtml(batchId)}" data-approve="true">通过</button><button class="danger" data-admin-action="approve-reservation-item" data-reservation-id="${escapeHtml(item.id)}" data-batch-id="${escapeHtml(batchId)}" data-approve="false">拒绝</button>` : '<span class="muted">无需操作</span>'}${adminChatLink(item.user_id, '沟通', { back: 'admin.html#reservations', context_type: 'reservation_item', reservation_id: item.id, batch_id: batchId, device_code: item.device_code, user_name: item.user_name, user_phone: item.user_phone, start_time: item.start_time, end_time: item.end_time, status: item.status })}</div>
      </article>`).join('')}</div>` : '<div class="empty-state">该批次暂无明细。</div>';
}

async function openBatchDetailDialog(batchId, scope = 'current', title = '预约', anchorEl = null) {
  if (!batchId) return;
  const detailScope = scope || 'current';
  const row = document.getElementById(`batch_detail_${batchId}`);
  const box = document.getElementById(`batch_detail_box_${batchId}`);
  if (!row || !box) return;

  const card = row.closest('.reservation-batch-card');
  const isOpening = row.classList.contains('hidden');
  row.classList.toggle('hidden', !isOpening);
  card?.classList.toggle('is-expanded', isOpening);
  const expandKey = reservationBatchExpandKey(batchId, detailScope);
  if (isOpening) expandedReservationBatchKeys.add(expandKey);
  else expandedReservationBatchKeys.delete(expandKey);
  if (!isOpening) return;

  currentReservationDetailDialog = { batchId, scope: detailScope, title: title || '预约', anchorRect: anchorEl?.getBoundingClientRect?.() || currentReservationDetailDialog?.anchorRect || null };
  if (box.dataset.loaded === '1') return;
  setLoading(box, '正在加载预约设备明细...');
  try {
    const result = await callRestApi(`/admin/reservation-batches/${encodeURIComponent(batchId)}?scope=${encodeURIComponent(detailScope)}`, { admin: true });
    const content = renderBatchDetailContent(result, batchId, detailScope);
    box.dataset.loaded = '1';
    box.innerHTML = content;
  } catch (error) {
    showPageMessage(box, 'danger', error.message || '加载预约明细失败');
  }
}

function restoreExpandedReservationDetails(container = document) {
  const cssEscape = window.CSS && typeof window.CSS.escape === 'function'
    ? window.CSS.escape.bind(window.CSS)
    : (value) => String(value || '').replace(/"/g, '\\"');
  expandedReservationBatchKeys.forEach((key) => {
    const [scope, batchId] = key.split('::');
    if (!batchId) return;
    const card = container.querySelector(`.reservation-batch-card[data-batch-id="${cssEscape(batchId)}"][data-batch-scope="${cssEscape(scope)}"]`);
    if (!card) return;
    openBatchDetailDialog(batchId, scope, card.dataset.batchTitle || '预约', card).catch(() => {});
  });
}

function approvalNote(approve, scope = 'batch') {
  if (approve) {
    return prompt(scope === 'batch' ? '审批备注（通过，可留空）' : '明细审批备注（通过，可留空）') || '';
  }
  const templates = '设备维护中 / 时间冲突 / 预约信息不完整 / 不符合预约规则 / 其他';
  return prompt(`${scope === 'batch' ? '整批拒绝原因' : '明细拒绝原因'}（建议填写）\n可选模板：${templates}`) || '';
}

async function approveReservationBatch(id, approve) {
  const admin_note = approvalNote(approve, 'batch');
  try {
    await callRestApi(`/admin/reservation-batches/${encodeURIComponent(id)}/approval`, { method: 'PATCH', admin: true, body: { approved: approve, admin_note } });
    showToast('success', approve ? '预约批次已通过' : '预约批次已拒绝');
    refreshAdminSummary().catch(() => {});
    loadReservations();
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function approveReservationItem(id, approve, batchId = '') {
  const admin_note = approvalNote(approve, 'item');
  try {
    await callRestApi(`/admin/reservation-items/${encodeURIComponent(id)}/approval`, { method: 'PATCH', admin: true, body: { approve, admin_note } });
    showToast('success', approve ? '预约明细已通过' : '预约明细已拒绝');
    if (batchId && currentReservationDetailDialog?.batchId === batchId) {
      const row = document.getElementById(`batch_detail_${batchId}`);
      const box = document.getElementById(`batch_detail_box_${batchId}`);
      if (box) box.dataset.loaded = '0';
      if (row && !row.classList.contains('hidden')) {
        row.classList.add('hidden');
        expandedReservationBatchKeys.delete(reservationBatchExpandKey(batchId, currentReservationDetailDialog.scope || 'current'));
        await openBatchDetailDialog(batchId, currentReservationDetailDialog.scope || 'current', currentReservationDetailDialog.title || '预约');
      }
    }
    refreshAdminSummary().catch(() => {});
    loadReservations();
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function approveReservation(id, approve) {
  try {
    await callRestApi(`/admin/bookings/${encodeURIComponent(id)}/approval`, {
      method: 'PATCH',
      admin: true,
      body: { approve }
    });
    showToast('success', approve ? '预约已通过' : '预约已拒绝');
    refreshAdminSummary().catch(() => {});
    loadReservations();
  } catch (error) {
    showToast('danger', error.message);
  }
}

function boolDataset(value) {
  return String(value || '').toLowerCase() === 'true';
}

function jumpReservationSection(targetId = '') {
  const target = document.getElementById(targetId);
  if (!target) return showToast('warning', '暂无对应预约分区');
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.classList.add('reservation-section-highlight');
  window.setTimeout(() => target.classList.remove('reservation-section-highlight'), 1400);
}

function filterReservationBoard(filter = 'all', scope = 'current') {
  const normalized = ['all', 'pending', 'approved', 'rejected', 'history'].includes(filter) ? filter : 'all';
  if (scope === 'history') {
    if (normalized !== 'history' && typeof showToast === 'function') showToast('info', '历史页仅显示已完成预约记录。');
    return;
  }
  activeReservationBoardFilter = activeReservationBoardFilter === normalized && normalized !== 'all' ? 'all' : normalized;
  if (typeof invalidateAdminTab === 'function') invalidateAdminTab('reservations');
  loadReservations();
}

function toggleHistoryReservationGroup(groupId = '') {
  const row = document.getElementById(`history_group_detail_${groupId}`);
  if (!row) return;
  row.classList.toggle('hidden');
}

function openAdminTabFromBusiness(tab = '') {
  if (!tab) return;
  if (typeof switchTab === 'function') switchTab(tab);
  if (window.IdbsNavigation && typeof window.IdbsNavigation.replaceCurrentUrl === 'function') {
    window.IdbsNavigation.replaceCurrentUrl(`admin.html#${tab}`);
  } else {
    window.history.replaceState(null, '', `admin.html#${tab}`);
  }
}

async function handleAdminBusinessAction(event) {
  const button = event.target.closest('[data-admin-action]');
  if (!button) return;
  const action = button.dataset.adminAction;
  if (!action) return;
  if (action === 'open-batch-detail' && event.target.closest('.reservation-detail-panel')) return;
  event.preventDefault();

  const previousDisabled = button.disabled;
  const shouldShowBusy = ['BUTTON', 'A'].includes(button.tagName);
  const loadingTextMap = {
    'set-user-status': '处理中...',
    'toggle-user-ban': '处理中...',
    'delete-user': '删除中...',
    'unbind-wechat': '解绑中...',
    'set-device-available': '恢复中...',
    'set-device-status': '保存中...',
    'toggle-device-history': '加载中...',
    'toggle-user-detail': '加载中...',
    'open-batch-detail': '加载中...',
    'approve-reservation-batch': '审批中...',
    'approve-reservation-item': '审批中...',
    'approve-reservation': '审批中...'
  };
  if (shouldShowBusy && typeof setButtonBusy === 'function') setButtonBusy(button, true, loadingTextMap[action] || '处理中...');
  else if (shouldShowBusy) button.disabled = true;
  try {
    if (action === 'set-user-status') {
      await setUserStatus(button.dataset.userId, button.dataset.status || 'active');
      return;
    }
    if (action === 'toggle-user-ban') {
      await toggleBan(button.dataset.userId, boolDataset(button.dataset.banned));
      return;
    }
    if (action === 'delete-user') {
      await deleteUser(button.dataset.userId);
      return;
    }
    if (action === 'unbind-wechat') {
      await unbindWechat(button.dataset.userId);
      return;
    }
    if (action === 'set-device-available') {
      await setAvailable(button.dataset.deviceId);
      return;
    }
    if (action === 'set-device-status') {
      await setDeviceStatus(button.dataset.deviceId, button.dataset.status);
      return;
    }
    if (action === 'edit-device') {
      editDeviceFromList(button.dataset.deviceId);
      return;
    }
    if (action === 'toggle-device-history') {
      await toggleDeviceHistory(button.dataset.deviceId);
      return;
    }
    if (action === 'toggle-user-detail') {
      await toggleUserDetail(button.dataset.userId);
      return;
    }
    if (action === 'open-batch-detail') {
      const previewAnchor = button.closest('.reservation-batch-card')?.querySelector('.reservation-batch-preview');
      await openBatchDetailDialog(button.dataset.batchId, button.dataset.batchScope || 'current', button.dataset.batchTitle || '预约', previewAnchor || button);
      return;
    }
    if (action === 'toggle-history-group') {
      toggleHistoryReservationGroup(button.dataset.groupId || '');
      return;
    }
    if (action === 'jump-reservation-section') {
      jumpReservationSection(button.dataset.target || '');
      return;
    }
    if (action === 'filter-reservation-board') {
      filterReservationBoard(button.dataset.reservationFilter || 'all', button.dataset.reservationScope || 'current');
      return;
    }
    if (action === 'apply-history-filter') {
      reservationHistoryFilters = {
        start: document.getElementById('reservation_history_start')?.value || '',
        end: document.getElementById('reservation_history_end')?.value || '',
        person: document.getElementById('reservation_history_person')?.value || '',
        device: document.getElementById('reservation_history_device')?.value || ''
      };
      loadReservations();
      return;
    }
    if (action === 'reset-history-filter') {
      reservationHistoryFilters = { start: '', end: '', person: '', device: '' };
      loadReservations();
      return;
    }
    if (action === 'open-admin-tab') {
      openAdminTabFromBusiness(button.dataset.tab || 'overview');
      return;
    }
    if (action === 'approve-reservation-batch') {
      await approveReservationBatch(button.dataset.batchId, boolDataset(button.dataset.approve));
      return;
    }
    if (action === 'approve-reservation-item') {
      await approveReservationItem(button.dataset.reservationId, boolDataset(button.dataset.approve), button.dataset.batchId || '');
      return;
    }
    if (action === 'approve-reservation') {
      await approveReservation(button.dataset.reservationId, boolDataset(button.dataset.approve));
    }
  } finally {
    if (button.isConnected && shouldShowBusy) {
      if (typeof setButtonBusy === 'function') setButtonBusy(button, false);
      button.disabled = previousDisabled;
    }
  }
}

document.addEventListener('click', handleAdminBusinessAction);
document.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const target = event.target.closest('.reservation-batch-card[data-admin-action="open-batch-detail"]');
  if (!target || event.target.closest('a, button, input, select, textarea, .reservation-detail-panel')) return;
  event.preventDefault();
  target.click();
});
