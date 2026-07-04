// Admin workbench modules: overview, analytics and operation logs.
// Loaded before admin.js so tab routing can call these functions from the global scope.

async function loadOverview() {
  const box = document.getElementById('overviewBox');
  setLoading(box, '正在加载后台总览...');
  try {
    const [dashboardResult, usersResult, batchesResult, faultsResult, logsResult] = await Promise.allSettled([
      callRestApi('/admin/dashboard', { admin: true }),
      callRestApi('/admin/users', { admin: true }),
      callRestApi('/admin/reservation-batches', { admin: true }),
      callRestApi('/admin/fault-reports', { admin: true }),
      callRestApi('/admin/operation-logs?limit=6', { admin: true })
    ]);
    if (dashboardResult.status === 'rejected') throw dashboardResult.reason;
    const result = dashboardResult.value || {};
    const users = usersResult.status === 'fulfilled' ? (usersResult.value.users || []) : [];
    const batches = batchesResult.status === 'fulfilled' ? (batchesResult.value.batches || []) : [];
    const faults = faultsResult.status === 'fulfilled' ? (faultsResult.value.reports || []) : [];
    const logs = logsResult.status === 'fulfilled' ? (logsResult.value.logs || []) : [];
    const kpi = result.kpi || {};
    const abnormal = Number(kpi.abnormal_devices) || 0;
    const pendingUsers = users.filter((user) => user.status === 'pending');
    const pendingBatches = batches.filter((batch) => batch.status === 'pending' || Number(batch.pending_count) > 0);
    const pendingFaults = faults.filter((fault) => ['pending', 'processing'].includes(fault.status));
    const todoItems = buildWorkbenchTodos({ kpi, pendingUsers, pendingBatches, pendingFaults });
    box.innerHTML = `
      <div class="kpi">
        ${overviewCard('设备总数', kpi.device_total, 'devices', 'info', '全量设备资产')}
        ${overviewCard('可预约设备', kpi.available_devices, 'devices', 'success', '当前可预约', 'device_status=available')}
        ${overviewCard('使用中设备', kpi.in_use_devices, 'devices', 'info', '当前使用中', 'device_status=in_use')}
        ${overviewCard('异常设备', kpi.abnormal_devices, 'faults', abnormal ? 'danger' : 'success', abnormal ? '需要处理' : '状态正常', 'fault_status=pending')}
        ${overviewCard('待审核用户', kpi.pending_users, 'users', Number(kpi.pending_users) ? 'warn' : 'success', '新用户准入', 'user_status=pending')}
        ${overviewCard('待审核预约', kpi.pending_reservations, 'reservations', Number(kpi.pending_reservations) ? 'warn' : 'success', '预约审批', 'reservation_filter=pending')}
        ${overviewLinkCard('未读聊天', kpi.unread_chat_messages, 'chat.html?admin=1&back=admin.html%23overview', Number(kpi.unread_chat_messages) ? 'warn' : 'success', Number(kpi.unread_chat_conversations) ? `${kpi.unread_chat_conversations} 个会话` : '沟通正常')}
        ${overviewCard('今日预约', kpi.today_reservations, 'reservations', 'info', '今日安排', 'reservation_filter=all')}
        ${overviewCard('本周使用次数', kpi.week_usage_count, 'stats', 'info', '近 7 天使用')}
      </div>
      <div class="workbench-main-grid section-gap">
        <div class="soft-panel workbench-todo-card">
          <div class="section-head compact-head">
            <div>
              <h3>待办队列</h3>
            </div>
          </div>
          ${renderWorkbenchTodos(todoItems)}
        </div>
        <div class="soft-panel workbench-quick-card">
          <div class="metric-label">快捷入口</div>
          ${renderQuickActions()}
        </div>
      </div>
      <div class="dashboard-grid section-gap">
        <div class="soft-panel">
          <div class="metric-label">设备状态分布</div>
          ${renderMiniBars(Object.entries(result.device_status || {}).map(([label, value]) => ({ label: statusText(label), value })))}
        </div>
      </div>
      <div class="dashboard-grid section-gap">
        <div class="soft-panel">
          <div class="section-head compact-head"><div><h3>风险提醒</h3></div></div>
          ${renderRiskPanel({ kpi, pendingFaults, pendingBatches })}
        </div>
        <div class="soft-panel">
          <div class="section-head compact-head"><div><h3>最近操作</h3></div></div>
          ${renderRecentLogs(logs)}
        </div>
      </div>
    `;
    box.querySelectorAll('[data-overview-tab]').forEach((item) => item.addEventListener('click', () => jumpWorkbenchTab(item.dataset.overviewTab, item.dataset.overviewFilter || '')));
  } catch (error) {
    handleAdminError(error, box);
  }
}

function overviewCard(label, value, tab, type = 'info', hint = '点击查看', filter = '') {
  return `<button class="card summary-action workbench-kpi-card" data-overview-tab="${escapeHtml(tab)}" data-overview-filter="${escapeHtml(filter)}"><div class="metric-label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value ?? 0)}</div><span class="badge ${type}">${escapeHtml(hint)}</span></button>`;
}

function overviewLinkCard(label, value, href, type = 'info', hint = '点击查看') {
  return `<a class="card summary-action workbench-kpi-card" href="${escapeHtml(href)}"><div class="metric-label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value ?? 0)}</div><span class="badge ${type}">${escapeHtml(hint)}</span></a>`;
}

function applyWorkbenchFilter(filter = '') {
  const params = new URLSearchParams(filter || '');
  const deviceStatus = params.get('device_status');
  if (deviceStatus && document.getElementById('device_status')) document.getElementById('device_status').value = deviceStatus;
  const faultStatus = params.get('fault_status');
  if (faultStatus && document.getElementById('fault_status_filter')) document.getElementById('fault_status_filter').value = faultStatus;
  const requestStatus = params.get('request_status');
  if (requestStatus && document.getElementById('request_status_filter')) document.getElementById('request_status_filter').value = requestStatus;
  const reservationFilter = params.get('reservation_filter');
  if (reservationFilter && typeof filterReservationBoard === 'function') filterReservationBoard(reservationFilter, 'current');
}

function jumpWorkbenchTab(tab, filter = '') {
  if (typeof switchTab === 'function') switchTab(tab);
  setTimeout(() => applyWorkbenchFilter(filter), 0);
}

function buildWorkbenchTodos({ kpi = {}, pendingUsers = [], pendingBatches = [], pendingFaults = [] }) {
  const items = [];
  if (Number(kpi.unread_chat_messages) > 0) {
    items.push({ title: '聊天待沟通', count: Number(kpi.unread_chat_messages) || 0, href: 'chat.html?admin=1&back=admin.html%23overview', level: 'warn', detail: '用户咨询、预约沟通或故障处理消息需要回复。' });
  }
  if (pendingBatches.length || Number(kpi.pending_reservations) > 0) {
    items.push({ title: '预约待审批', count: pendingBatches.length || Number(kpi.pending_reservations) || 0, tab: 'reservations', level: 'warn', detail: '建议优先处理，避免用户错过使用窗口。' });
  }
  if (pendingFaults.length || Number(kpi.abnormal_devices) > 0) {
    items.push({ title: '故障/异常设备', count: pendingFaults.length || Number(kpi.abnormal_devices) || 0, tab: 'faults', level: 'danger', detail: '请确认是否需要停用设备或恢复可预约。' });
  }
  if (pendingUsers.length || Number(kpi.pending_users) > 0) {
    items.push({ title: '新用户待审核', count: pendingUsers.length || Number(kpi.pending_users) || 0, tab: 'users', level: 'info', detail: '审核通过后用户才能完整使用预约流程。' });
  }
  if (Number(kpi.in_use_devices) > 0) {
    items.push({ title: '设备使用中', count: Number(kpi.in_use_devices) || 0, tab: 'devices', level: 'success', detail: '关注归还状态和异常归还报备。' });
  }
  return items;
}

function renderWorkbenchTodos(items = []) {
  if (!items.length) return '<div class="empty-state">暂无待办事项，当前系统状态良好。</div>';
  return `<div class="workbench-todo-list">${items.map((item) => `
    ${item.href ? `<a class="workbench-todo-item" href="${escapeHtml(item.href)}">` : `<button class="workbench-todo-item" data-overview-tab="${escapeHtml(item.tab)}">`}
      <span class="badge ${escapeHtml(item.level)}">${escapeHtml(item.count)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(item.detail)}</small>
    ${item.href ? '</a>' : '</button>'}
  `).join('')}</div>`;
}

function renderQuickActions() {
  const actions = [
    ['reservations', '处理预约', '审批批次和明细'],
    ['faults', '处理故障', '恢复或停用设备'],
    ['chat', '处理聊天', '回复用户沟通'],
    ['devices', '设备管理', '查看状态和可预约时段'],
    ['users', '用户审核', '处理注册与封禁'],
    ['analytics', '数据分析', '查看趋势和排行'],
    ['logs', '操作日志', '审计最近动作']
  ];
  return `<div class="quick-action-grid">${actions.map(([tab, title, detail]) => `
    ${tab === 'chat' ? `<a href="chat.html?admin=1&back=admin.html%23overview"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></a>` : `<button data-overview-tab="${escapeHtml(tab)}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></button>`}
  `).join('')}</div>`;
}

function renderRiskPanel({ kpi = {}, pendingFaults = [], pendingBatches = [] }) {
  const risks = [];
  const faultPreview = pendingFaults.slice(0, 2).map((fault) => `${fault.device_code || fault.device_name || '设备'}（${statusText(fault.status)}）`).join('；');
  const batchPreview = pendingBatches.slice(0, 2).map((batch) => `${batch.user_name || '用户'} · ${batch.item_count || batch.pending_count || 0} 条`).join('；');
  if (Number(kpi.abnormal_devices) > 0) risks.push(['danger', '异常设备偏多', faultPreview || `${kpi.abnormal_devices} 台设备处于异常/维护/待处理状态。`, 'faults']);
  if (pendingFaults.some((fault) => fault.status === 'pending')) risks.push(['warn', '故障未接单', faultPreview || '存在待处理故障，请尽快标记处理中。', 'faults']);
  if (pendingBatches.length > 0) risks.push(['warn', '预约审批积压', batchPreview || `${pendingBatches.length} 个预约批次仍需处理。`, 'reservations']);
  if (Number(kpi.available_devices) === 0 && Number(kpi.device_total) > 0) risks.push(['danger', '无可预约设备', '当前没有可预约设备，用户侧可能无法提交预约。', 'devices']);
  if (!risks.length) risks.push(['success', '暂无明显风险', '当前没有检测到高优先级风险。', 'overview']);
  return `<div class="risk-list">${risks.map(([level, title, detail, tab]) => `<button class="risk-item" data-overview-tab="${escapeHtml(tab)}" type="button"><span class="badge ${level}">${escapeHtml(title)}</span><p>${escapeHtml(detail)}</p><small>${tab === 'overview' ? '当前无需处理' : '点击查看具体信息'}</small></button>`).join('')}</div>`;
}

function renderRecentLogs(logs = []) {
  if (!logs.length) return '<div class="empty-state">暂无可展示的操作日志，或当前角色无日志权限。</div>';
  return `<div class="compact-log-list">${logs.slice(0, 6).map((row) => `<button class="compact-log-item" data-overview-tab="logs" type="button"><strong>${escapeHtml(actionLabel(row.action || '-'))}</strong><span>${escapeHtml(fmtTime(row.created_at))}</span><small>${escapeHtml(row.operator_name || '-')} · 点击查看详情</small></button>`).join('')}</div>`;
}

function renderMiniBars(rows = []) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  return `<div class="mini-bars">${rows.map((row) => {
    const value = Number(row.value) || 0;
    return `<div class="mini-bar-row"><span>${escapeHtml(row.label || '-')}</span><div class="mini-bar"><i style="width:${Math.round((value / max) * 100)}%"></i></div><b>${value}</b></div>`;
  }).join('')}</div>`;
}


async function loadAnalytics() {
  const box = document.getElementById('analyticsBox');
  setLoading(box, '正在加载数据分析...');
  const range = document.getElementById('analytics_range')?.value || '30d';
  try {
    const results = await Promise.allSettled([
      callRestApi(`/admin/analytics/overview?range=${encodeURIComponent(range)}`, { admin: true }),
      callRestApi('/admin/analytics/device-usage?metric=borrow_count', { admin: true }),
      callRestApi(`/admin/analytics/time-heatmap?range=${encodeURIComponent(range)}`, { admin: true }),
      callRestApi(`/admin/analytics/faults?range=${encodeURIComponent(range)}`, { admin: true })
    ]);
    const [overview, usage, heatmap, faults] = results.map((item) => item.status === 'fulfilled' ? item.value : {});
    const failures = results.filter((item) => item.status === 'rejected').map((item) => item.reason?.message || '分析接口请求失败');
    const trend = overview.trend || [];
    const totals = trend.reduce((acc, row) => {
      acc.reservations += Number(row.reservation_count) || 0;
      acc.borrow += Number(row.borrow_count) || 0;
      acc.returns += Number(row.return_count) || 0;
      acc.faults += Number(row.fault_count) || 0;
      return acc;
    }, { reservations: 0, borrow: 0, returns: 0, faults: 0 });
    box.innerHTML = `
      ${failures.length ? `<div class="alert warn">部分分析接口暂不可用：${escapeHtml(failures.join('；'))}</div>` : ''}
      <div class="kpi analytics-summary">
        ${analyticsMetric('预约提交', totals.reservations, '审批入口')}
        ${analyticsMetric('设备借用', totals.borrow, '使用活跃度')}
        ${analyticsMetric('归还记录', totals.returns, '闭环情况')}
        ${analyticsMetric('故障上报', totals.faults, totals.faults ? '需关注' : '稳定')}
      </div>
      <div class="analytics-grid">
        <div class="soft-panel analytics-wide"><div class="metric-label">设备使用趋势</div>${renderTrendChart(trend)}${renderTrendTable(trend)}</div>
        <div class="soft-panel"><div class="metric-label">设备使用排行</div>${renderMiniBars((usage.rows || []).map((row) => ({ label: `${row.device_code || ''} ${row.device_name || ''}`.trim(), value: row.borrow_count || 0 })))}</div>
        <div class="soft-panel"><div class="metric-label">设备状态分布</div>${renderMiniBars((overview.device_status || []).map((row) => ({ label: statusText(row.status), value: row.count })))}</div>
        <div class="soft-panel"><div class="metric-label">时间段热力</div>${renderHeatmap(heatmap.rows || [])}</div>
        <div class="soft-panel"><div class="metric-label">预约审批分析</div>${renderMiniBars((overview.approvals || []).map((row) => ({ label: statusText(row.status), value: row.count })))}</div>
        <div class="soft-panel"><div class="metric-label">故障趋势与排行</div>${renderMiniBars((faults.devices || []).map((row) => ({ label: `${row.device_code || ''} ${row.device_name || ''}`.trim(), value: row.count })))}${renderTrendTable((faults.trend || []).map((row) => ({ day: row.day, fault_count: row.count })))}</div>
      </div>
    `;
  } catch (error) {
    handleAdminError(error, box);
  }
}

function analyticsMetric(label, value, hint) {
  return `<div class="card analytics-metric"><div class="metric-label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value ?? 0)}</div><span class="muted">${escapeHtml(hint)}</span></div>`;
}

function renderTrendChart(rows = []) {
  if (!rows.length) return '<div class="empty-state">暂无趋势图数据。</div>';
  const max = Math.max(1, ...rows.map((row) => (Number(row.reservation_count) || 0) + (Number(row.borrow_count) || 0) + (Number(row.return_count) || 0) + (Number(row.fault_count) || 0)));
  return `<div class="trend-chart">${rows.slice(-14).map((row) => {
    const total = (Number(row.reservation_count) || 0) + (Number(row.borrow_count) || 0) + (Number(row.return_count) || 0) + (Number(row.fault_count) || 0);
    const height = Math.max(8, Math.round((total / max) * 100));
    return `<span title="${escapeHtml(String(row.day || '').slice(0, 10))}: ${total}" style="height:${height}%"><em>${escapeHtml(String(row.day || '').slice(5, 10))}</em></span>`;
  }).join('')}</div>`;
}

function renderTrendTable(rows = []) {
  return rows.length ? `<div class="table-wrap compact"><table><tr><th>日期</th><th>预约</th><th>使用</th><th>归还</th><th>故障</th></tr>${rows.map((row) => `<tr><td>${escapeHtml(String(row.day || '').slice(0, 10))}</td><td>${escapeHtml(row.reservation_count ?? 0)}</td><td>${escapeHtml(row.borrow_count ?? 0)}</td><td>${escapeHtml(row.return_count ?? 0)}</td><td>${escapeHtml(row.fault_count ?? 0)}</td></tr>`).join('')}</table></div>` : '<div class="empty-state">暂无趋势数据。</div>';
}

function renderHeatmap(rows = []) {
  const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
  const slots = ['morning', 'afternoon', 'evening', 'night'];
  const labels = { morning: '上午', afternoon: '下午', evening: '晚上', night: '夜间' };
  const map = new Map(rows.map((row) => [`${row.weekday}:${row.slot_key}`, Number(row.count) || 0]));
  const max = Math.max(1, ...rows.map((row) => Number(row.count) || 0));
  return `<div class="heatmap"><div></div>${weekdays.map((day) => `<b>${day}</b>`).join('')}${slots.map((slot) => `<b>${labels[slot]}</b>${weekdays.map((_, index) => {
    const value = map.get(`${index + 1}:${slot}`) || 0;
    const alpha = 0.12 + (value / max) * 0.7;
    return `<span style="background:rgba(93,127,115,${alpha})" title="${labels[slot]} 周${weekdays[index]}：${value}">${value}</span>`;
  }).join('')}`).join('')}</div>`;
}

async function loadOperationLogs() {
  const box = document.getElementById('operationLogList');
  setLoading(box, '正在加载操作日志...');
  try {
    const query = new URLSearchParams({ limit: '100' });
    const operator = fieldValue('log_operator_filter');
    const startDate = fieldValue('log_start_filter');
    const endDate = fieldValue('log_end_filter');
    if (operator) query.set('operator', operator);
    if (startDate) query.set('start_date', startDate);
    if (endDate) query.set('end_date', endDate);
    const result = await callRestApi(`/admin/operation-logs?${query.toString()}`, { admin: true });
    const logs = result.logs || [];
    box.innerHTML = logs.length ? `<div class="log-timeline">${logs.map(renderOperationLogItem).join('')}</div>` : '<div class="empty-state">暂无操作日志。</div>';
  } catch (error) {
    handleAdminError(error, box);
  }
}

function renderOperationLogItem(row) {
  const detail = typeof row.detail === 'object' ? JSON.stringify(row.detail) : (row.detail || '-');
  const target = row.target_type || row.device_id || row.record_id || '-';
  return `<article class="log-item">
    <div class="log-dot"></div>
    <div>
      <div class="log-title"><strong>${escapeHtml(actionLabel(row.action || '-'))}</strong><span>${escapeHtml(fmtTime(row.created_at))}</span></div>
      <div class="muted">操作人：${escapeHtml(row.operator_name || '-')} · 对象：${escapeHtml(target)}</div>
      <p>${escapeHtml(detail)}</p>
    </div>
  </article>`;
}

function actionLabel(action) {
  const labels = {
    approve_reservation: '审批预约',
    approve_reservation_batch: '批量审批预约',
    set_device_available: '设备恢复可用',
    update_security_config: '更新系统配置',
    grant_admin_role: '授权管理员',
    resolve_fault_processing: '处理故障'
  };
  return labels[action] || action;
}
