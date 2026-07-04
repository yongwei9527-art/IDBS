// Admin operations modules: faults and usage statistics.
// Loaded before admin.js so tab routing, toolbar buttons and delegated actions can call these functions.

let latestFaultReports = [];
let latestUserRequests = [];

function adminOpsChatLink(userId = '', label = '沟通', params = {}) {
  return typeof adminChatLink === 'function' ? adminChatLink(userId, label, params) : '';
}

function adminOpsStatusQuery(inputId) {
  const status = String(document.getElementById(inputId)?.value || '').trim();
  return status ? `?status=${encodeURIComponent(status)}` : '';
}

async function loadOptions() {
  try {
    const result = await callRestApi('/admin/options', { admin: true });
    stat_user.innerHTML = '<option value="">全部用户</option>' + (result.users || []).map((user) => `<option value="${user.id}">${escapeHtml(user.name)} ${escapeHtml(user.phone)}</option>`).join('');
    stat_device.innerHTML = '<option value="">全部设备</option>' + (result.devices || []).map((device) => `<option value="${device.id}">${escapeHtml(device.device_code)} ${escapeHtml(device.name)}</option>`).join('');
  } catch (error) {
    showPageMessage(document.getElementById('statsBox'), 'danger', error.message);
  }
}

async function loadFaultReports() {
  const box = document.getElementById('faultReportList');
  setLoading(box, '正在加载故障报备...');
  try {
    const result = await callRestApi(`/admin/fault-reports${adminOpsStatusQuery('fault_status_filter')}`, { admin: true });
    const reports = result.reports || [];
    latestFaultReports = reports;
    box.innerHTML = reports.length ? `
      <div class="table-wrap">
        <table>
          <tr><th>设备</th><th>上报人</th><th>问题</th><th>状态</th><th>时间</th><th>处理</th></tr>
          ${reports.map((report) => `
            <tr>
              <td>${escapeHtml(report.device_code)}<br><span class="muted">${escapeHtml(report.device_name || '-')} ${escapeHtml(report.device_location || '')}</span></td>
              <td>${escapeHtml(report.user_name || '-')}<br><span class="muted">${escapeHtml(report.user_phone || '-')}</span></td>
              <td><strong>${escapeHtml(report.issue_type || 'fault')}</strong><br>${escapeHtml(report.description || '-')}</td>
              <td>${statusBadge(report.status)}</td>
              <td>${escapeHtml(fmtTime(report.created_at))}</td>
              <td class="actions">
                <button class="secondary" data-admin-ops-action="fault-detail" data-report-id="${escapeHtml(report.id)}">详情</button>
                <button data-admin-ops-action="mark-fault" data-report-id="${escapeHtml(report.id)}" data-status="processing" data-set-available="false">处理中</button>
                <button class="secondary" data-admin-ops-action="mark-fault" data-report-id="${escapeHtml(report.id)}" data-status="resolved" data-set-available="false" data-keep-maintenance="true">解决但保留维修</button>
                <button class="success" data-admin-ops-action="mark-fault" data-report-id="${escapeHtml(report.id)}" data-status="resolved" data-set-available="true">解决并恢复可预约</button>
                <button class="danger" data-admin-ops-action="mark-fault" data-report-id="${escapeHtml(report.id)}" data-status="closed" data-set-available="false" data-keep-maintenance="true">关闭</button>
                ${adminOpsChatLink(report.user_id, '沟通', { back: 'admin.html#faults', context_type: 'fault_report', fault_id: report.id, device_code: report.device_code, device_name: report.device_name, user_name: report.user_name, user_phone: report.user_phone, issue_type: report.issue_type, description: report.description, status: report.status })}
              </td>
            </tr>
          `).join('')}
        </table>
      </div>
    ` : '<div class="empty-state">当前筛选暂无故障报备。</div>';
  } catch (error) {
    handleAdminError(error, box);
  }
}

function renderFaultDetail(report = {}) {
  return `
    <div class="section-head compact-head">
      <div>
        <h3>${escapeHtml(report.device_name || report.device_code || '故障详情')}</h3>
        <p class="muted">${escapeHtml(report.device_code || '-')} · ${escapeHtml(report.device_location || '-')}</p>
      </div>
      ${statusBadge(report.status)}
    </div>
    <div class="soft-panel">
      <h4>问题描述</h4>
      <p><strong>${escapeHtml(report.issue_type || '故障')}</strong></p>
      <p>${escapeHtml(report.description || '暂无描述')}</p>
      <p class="muted">上报时间：${escapeHtml(fmtTime(report.created_at))}</p>
    </div>
    <div class="soft-panel">
      <h4>上报人</h4>
      <p>${escapeHtml(report.user_name || '-')} · ${escapeHtml(report.user_phone || '-')}</p>
      ${adminOpsChatLink(report.user_id, '联系用户', { back: 'admin.html#faults', context_type: 'fault_report', fault_id: report.id, device_code: report.device_code, device_name: report.device_name, user_name: report.user_name, user_phone: report.user_phone, issue_type: report.issue_type, description: report.description, status: report.status })}
    </div>
    <div class="soft-panel">
      <h4>处理记录</h4>
      <p>${escapeHtml(report.admin_note || '暂无处理备注')}</p>
      <p class="muted">完成时间：${escapeHtml(fmtTime(report.resolved_at))}</p>
    </div>`;
}

function openFaultDetail(reportId = '') {
  const report = latestFaultReports.find((item) => String(item.id) === String(reportId));
  if (!report) return showToast('warning', '未找到故障详情');
  if (typeof openDrawer === 'function') {
    openDrawer({ title: '故障详情', subtitle: '问题、上报人和处理记录', content: renderFaultDetail(report) });
    return;
  }
  showToast('info', report.description || '暂无故障描述');
}

async function markFaultReport(id, status, setAvailable, keepMaintenance = false) {
  const note = prompt('处理备注（可留空）') || '';
  try {
    await callRestApi(`/admin/fault-reports/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      admin: true,
      body: { status, set_available: setAvailable, keep_maintenance: keepMaintenance, admin_note: note }
    });
    showToast('success', '故障报备已更新');
    refreshAdminSummary().catch(() => {});
    loadFaultReports();
  } catch (error) {
    handleAdminError(error);
  }
}

async function loadUserRequests() {
  const box = document.getElementById('userRequestList');
  setLoading(box, '正在加载需求上报...');
  try {
    const result = await callRestApi(`/admin/user-requests${adminOpsStatusQuery('request_status_filter')}`, { admin: true });
    const requests = result.requests || [];
    latestUserRequests = requests;
    box.innerHTML = requests.length ? `
      <div class="table-wrap">
        <table>
          <tr><th>需求</th><th>用户</th><th>关联设备</th><th>状态</th><th>提交时间</th><th>处理</th></tr>
          ${requests.map((request) => `
            <tr>
              <td><strong>${escapeHtml(request.title || '-')}</strong><br><span class="muted">${escapeHtml(request.description || '-')}</span>${request.change_request_note ? `<br><span class="badge warn">修改申请：${escapeHtml(request.change_request_note)}</span>` : ''}</td>
              <td>${escapeHtml(request.user_name || '-')}<br><span class="muted">${escapeHtml(request.user_phone || '-')}</span><br><span class="muted">微信：${escapeHtml(request.user_wechat_nickname || '-')}</span></td>
              <td>${escapeHtml(request.device_code || '-')}<br><span class="muted">${escapeHtml(request.device_name || '')}</span></td>
              <td>${statusBadge(request.status)}</td>
              <td>${escapeHtml(fmtTime(request.created_at))}</td>
              <td class="actions">
                <button class="secondary" data-admin-ops-action="request-detail" data-request-id="${escapeHtml(request.id)}">详情</button>
                <button data-admin-ops-action="review-request" data-request-id="${escapeHtml(request.id)}" data-status="confirmed">确认并锁定</button>
                <button class="secondary" data-admin-ops-action="review-request" data-request-id="${escapeHtml(request.id)}" data-status="pending">允许修改</button>
                <button class="danger" data-admin-ops-action="review-request" data-request-id="${escapeHtml(request.id)}" data-status="rejected">驳回</button>
                <button class="secondary" data-admin-ops-action="review-request" data-request-id="${escapeHtml(request.id)}" data-status="closed">关闭</button>
                ${adminOpsChatLink(request.user_id, '沟通', { back: 'admin.html#requests', context_type: 'user_request', request_id: request.id, device_code: request.device_code, device_name: request.device_name, user_name: request.user_name, user_phone: request.user_phone, context_title: request.title, description: request.description, status: request.status })}
              </td>
            </tr>
          `).join('')}
        </table>
      </div>
    ` : '<div class="empty-state">当前筛选暂无需求上报。</div>';
  } catch (error) {
    handleAdminError(error, box);
  }
}

function renderRequestDetail(request = {}) {
  return `
    <div class="section-head compact-head">
      <div>
        <h3>${escapeHtml(request.title || '需求详情')}</h3>
        <p class="muted">${escapeHtml(request.user_name || '-')} · ${escapeHtml(request.user_phone || '-')}</p>
      </div>
      ${statusBadge(request.status)}
    </div>
    <div class="soft-panel">
      <h4>需求内容</h4>
      <p>${escapeHtml(request.description || '暂无描述')}</p>
      ${request.change_request_note ? `<p><span class="badge warn">修改申请</span> ${escapeHtml(request.change_request_note)}</p>` : ''}
      <p class="muted">提交时间：${escapeHtml(fmtTime(request.created_at))}</p>
    </div>
    <div class="soft-panel">
      <h4>关联设备</h4>
      <p>${escapeHtml(request.device_code || '-')} · ${escapeHtml(request.device_name || '-')}</p>
    </div>
    <div class="soft-panel">
      <h4>处理记录</h4>
      <p>${escapeHtml(request.admin_note || '暂无处理备注')}</p>
      ${adminOpsChatLink(request.user_id, '联系用户', { back: 'admin.html#requests', context_type: 'user_request', request_id: request.id, device_code: request.device_code, device_name: request.device_name, user_name: request.user_name, user_phone: request.user_phone, context_title: request.title, description: request.description, status: request.status })}
    </div>`;
}

function openRequestDetail(requestId = '') {
  const request = latestUserRequests.find((item) => String(item.id) === String(requestId));
  if (!request) return showToast('warning', '未找到需求详情');
  if (typeof openDrawer === 'function') {
    openDrawer({ title: '需求详情', subtitle: '内容、设备和处理记录', content: renderRequestDetail(request) });
    return;
  }
  showToast('info', request.description || '暂无需求描述');
}

async function reviewUserRequest(id, status) {
  const note = prompt(status === 'confirmed' ? '确认备注（可留空）' : '处理备注（建议填写）') || '';
  try {
    await callRestApi(`/admin/user-requests/${encodeURIComponent(id)}/review`, {
      method: 'PATCH',
      admin: true,
      body: { status, admin_note: note }
    });
    showToast('success', '需求状态已更新');
    loadUserRequests();
  } catch (error) {
    handleAdminError(error);
  }
}

function boolOpsDataset(value) {
  return String(value || '').toLowerCase() === 'true';
}

async function handleAdminOpsAction(event) {
  const button = event.target.closest('[data-admin-ops-action]');
  if (!button) return;
  const action = button.dataset.adminOpsAction;
  if (!action) return;
  event.preventDefault();
  const previousDisabled = button.disabled;
  const loadingText = action === 'mark-fault' ? '处理中...' : (action.includes('detail') ? '加载中...' : '保存中...');
  button.disabled = true;
  if (typeof setButtonBusy === 'function') setButtonBusy(button, true, loadingText);
  try {
    if (action === 'mark-fault') {
      await markFaultReport(button.dataset.reportId, button.dataset.status, boolOpsDataset(button.dataset.setAvailable), boolOpsDataset(button.dataset.keepMaintenance));
    }
    if (action === 'fault-detail') {
      openFaultDetail(button.dataset.reportId);
    }
    if (action === 'review-request') {
      await reviewUserRequest(button.dataset.requestId, button.dataset.status);
    }
    if (action === 'request-detail') {
      openRequestDetail(button.dataset.requestId);
    }
  } finally {
    if (button.isConnected) {
      if (typeof setButtonBusy === 'function') setButtonBusy(button, false);
      button.disabled = previousDisabled;
    }
  }
}

document.addEventListener('click', handleAdminOpsAction);

async function loadStats() {
  const box = document.getElementById('statsBox');
  setLoading(box, '正在统计使用记录...');
  try {
    const query = new URLSearchParams();
    if (stat_user.value) query.set('user_id', stat_user.value);
    if (stat_device.value) query.set('device_id', stat_device.value);
    if (stat_start.value) query.set('start_date', stat_start.value);
    if (stat_end.value) query.set('end_date', stat_end.value);
    const result = await callRestApi(`/admin/statistics/usage${query.toString() ? `?${query}` : ''}`, { admin: true });
    lastRows = result.rows || [];
    box.innerHTML = `
      <div class="kpi">
        <div class="card"><div class="metric-label">使用次数</div><div class="value">${result.summary.count}</div></div>
        <div class="card"><div class="metric-label">累计小时</div><div class="value">${result.summary.total_hours}</div></div>
        <div class="card"><div class="metric-label">异常归还</div><div class="value">${result.summary.abnormal_count}</div></div>
        <div class="card"><div class="metric-label">逾期次数</div><div class="value">${result.summary.overdue_count}</div></div>
      </div>
      ${lastRows.length ? `<div class="table-wrap"><table><tr><th>设备</th><th>用户</th><th>借出时间</th><th>归还时间</th><th>分钟</th><th>状态</th><th>说明</th></tr>${lastRows.map((row) => `<tr><td>${escapeHtml(row.device_name || '-')}</td><td>${escapeHtml(row.user_name || '-')}</td><td>${escapeHtml(fmtTime(row.borrow_time))}</td><td>${escapeHtml(fmtTime(row.return_time))}</td><td>${escapeHtml(row.duration_minutes || 0)}</td><td>${escapeHtml(row.return_condition || '-')}</td><td>${escapeHtml(row.return_note || '-')}</td></tr>`).join('')}</table></div>` : '<div class="empty-state">暂无统计记录。</div>'}
    `;
  } catch (error) {
    showPageMessage(box, 'danger', error.message);
  }
}

function exportTypeLabel(type) {
  return {
    usage: '使用记录',
    reservations: '预约记录',
    faults: '故障记录',
    user_activity: '用户活跃记录',
    device_summary: '设备使用汇总'
  }[type] || '统计导出';
}

function normalizeExportRows(type, rows = []) {
  if (type === 'usage') {
    return rows.map((item) => ({
      设备编号: item.device_code,
      设备名称: item.device_name,
      使用人: item.user_name,
      手机号: item.user_phone,
      借出时间: fmtTime(item.borrow_time),
      归还时间: fmtTime(item.return_time),
      使用分钟: item.duration_minutes || 0,
      是否逾期: item.is_overdue ? '是' : '否',
      归还状态: item.return_condition || '',
      归还说明: item.return_note || ''
    }));
  }
  if (type === 'reservations') {
    return rows.map((item) => ({
      设备编号: item.device_code,
      设备名称: item.device_name,
      预约人: item.user_name,
      手机号: item.user_phone,
      开始时间: fmtTime(item.start_time),
      结束时间: fmtTime(item.end_time),
      状态: statusText(item.status),
      用途: item.purpose || '',
      审批备注: item.admin_note || ''
    }));
  }
  if (type === 'faults') {
    return rows.map((item) => ({
      设备编号: item.device_code,
      设备名称: item.device_name,
      上报人: item.user_name,
      手机号: item.user_phone,
      类型: item.issue_type || '',
      等级: item.severity || '',
      状态: statusText(item.status),
      描述: item.description || '',
      处理备注: item.admin_note || '',
      上报时间: fmtTime(item.created_at),
      完成时间: fmtTime(item.resolved_at)
    }));
  }
  if (type === 'user_activity') {
    return rows.map((item) => ({
      用户: item.user_name || '',
      手机号: item.phone || '',
      事件: item.event_type || '',
      设备类型: item.device_type || '',
      IP: item.ip_address || '',
      备注: item.remark || '',
      时间: fmtTime(item.created_at)
    }));
  }
  if (type === 'device_summary') {
    return rows.map((item) => ({
      设备编号: item.device_code,
      设备名称: item.device_name,
      预约次数: item.reservation_count || 0,
      使用次数: item.borrow_count || 0,
      使用分钟: item.total_minutes || 0,
      故障次数: item.fault_count || 0
    }));
  }
  return rows;
}

async function loadExportRows() {
  const type = document.getElementById('export_type')?.value || 'usage';
  if (type === 'usage' && lastRows.length) return { type, rows: lastRows };
  const query = new URLSearchParams({
    user_id: stat_user.value || '',
    device_id: stat_device.value || '',
    start_date: stat_start.value || '',
    end_date: stat_end.value || ''
  });
  [...query.keys()].forEach((key) => { if (!query.get(key)) query.delete(key); });
  const result = await callRestApi(`/admin/exports/${encodeURIComponent(type)}?${query.toString()}`, { admin: true });
  return { type, rows: result.rows || [] };
}

async function exportStats(format = 'csv') {
  try {
    const { type, rows } = await loadExportRows();
    const data = normalizeExportRows(type, rows);
    const filename = `${exportTypeLabel(type)}_${stat_start.value || '开始'}_${stat_end.value || '结束'}`;
    if (format === 'excel') {
      excelDownload(`${filename}.xls`, data);
      showToast('success', 'Excel 已开始下载');
    } else {
      csvDownload(`${filename}.csv`, data);
      showToast('success', 'CSV 已开始下载');
    }
  } catch (error) {
    showToast('danger', error.message);
  }
}

function renderExportJobs(jobs = []) {
  const box = document.getElementById('exportJobList');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = jobs.length ? `
    <div class="section-head compact-head">
      <div><h4>导出队列</h4></div>
    </div>
    <div class="table-wrap compact">
      <table>
        <tr><th>类型</th><th>状态</th><th>行数</th><th>创建人</th><th>时间</th><th>文件</th></tr>
        ${jobs.map((job) => `<tr>
          <td>${escapeHtml(exportTypeLabel(job.type))}</td>
          <td>${statusBadge(job.status)}</td>
          <td>${escapeHtml(job.row_count || 0)}</td>
          <td>${escapeHtml(job.created_by_name || '-')}</td>
          <td>${escapeHtml(fmtTime(job.created_at))}</td>
          <td>${job.file_path ? `<a href="${escapeHtml(job.file_path)}" target="_blank" rel="noopener">下载</a>` : '<span class="muted">-</span>'}</td>
        </tr>`).join('')}
      </table>
    </div>` : '<div class="empty-state">暂无导出任务。</div>';
}

async function loadExportJobs() {
  const result = await callRestApi('/admin/export-jobs', { admin: true });
  renderExportJobs(result.jobs || []);
}

async function createExportJob() {
  const button = document.getElementById('export-job-btn');
  if (button && typeof setButtonBusy === 'function') setButtonBusy(button, true, '加入中...');
  try {
    const body = {
      type: document.getElementById('export_type')?.value || 'usage',
      user_id: stat_user.value || '',
      device_id: stat_device.value || '',
      start_date: stat_start.value || '',
      end_date: stat_end.value || ''
    };
    await callRestApi('/admin/export-jobs', { method: 'POST', admin: true, body });
    showToast('success', '已加入导出队列');
    await loadExportJobs();
  } catch (error) {
    showToast('danger', error.message);
  } finally {
    if (button && typeof setButtonBusy === 'function') setButtonBusy(button, false);
  }
}

async function runNextExportJob() {
  const button = document.getElementById('run-export-job-btn');
  if (button && typeof setButtonBusy === 'function') setButtonBusy(button, true, '处理中...');
  try {
    const result = await callRestApi('/admin/export-jobs/run-next', { method: 'POST', admin: true, body: {} });
    if (result.job) showToast(result.job.status === 'failed' ? 'warning' : 'success', result.job.status === 'failed' ? '导出任务失败' : '导出任务已完成');
    else showToast('info', result.message || '暂无待处理导出任务');
    await loadExportJobs();
  } catch (error) {
    showToast('danger', error.message);
  } finally {
    if (button && typeof setButtonBusy === 'function') setButtonBusy(button, false);
  }
}
