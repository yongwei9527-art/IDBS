let lastRows = [];

function switchTab(name) {
  document.querySelectorAll('.tabs button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === name);
  });
  ['devices', 'users', 'reservations', 'security', 'stats'].forEach((tab) => {
    document.getElementById(`tab_${tab}`).classList.toggle('hidden', tab !== name);
  });

  if (name === 'devices') loadDevices();
  if (name === 'users') loadUsers();
  if (name === 'reservations') loadReservations();
  if (name === 'security') loadSecurity();
  if (name === 'stats') loadOptions();
}

function renderAdminSummary(meta = {}) {
  document.getElementById('admin-summary').innerHTML = `
    <div class="card"><div class="metric-label">设备总览</div><div class="value">${meta.deviceCount ?? '-'}</div></div>
    <div class="card"><div class="metric-label">待审用户</div><div class="value">${meta.pendingUsers ?? '-'}</div></div>
    <div class="card"><div class="metric-label">待审预约</div><div class="value">${meta.pendingReservations ?? '-'}</div></div>
    <div class="card"><div class="metric-label">异常设备</div><div class="value">${meta.abnormalDevices ?? '-'}</div></div>
  `;
}

async function refreshAdminSummary() {
  const [deviceResult, userResult, reservationResult] = await Promise.all([
    callRestApi('/admin/devices', { admin: true }),
    callRestApi('/admin/users', { admin: true }),
    callRestApi('/admin/bookings', { admin: true })
  ]);
  const devices = deviceResult.devices || deviceResult.list || [];
  const users = userResult.users || [];
  const reservations = reservationResult.reservations || [];
  renderAdminSummary({
    deviceCount: devices.length,
    pendingUsers: users.filter((item) => item.status === 'pending').length,
    pendingReservations: reservations.filter((item) => item.status === 'pending').length,
    abnormalDevices: devices.filter((item) => item.status === 'abnormal_pending').length
  });
}

function enterAdminConsole() {
  document.getElementById('login-box').classList.add('hidden');
  document.getElementById('admin-box').classList.remove('hidden');
  refreshAdminSummary().catch(() => {});
  switchTab('devices');
}

async function adminLogin() {
  try {
    const result = await callRestApi('/admin/auth/login', {
      method: 'POST',
      admin: true,
      body: { password: adminPwd.value }
    });
    setAdminToken(result.token || '');
    showToast('success', '管理员登录成功');
    enterAdminConsole();
  } catch (error) {
    showPageMessage('login-message', 'danger', error.message);
  }
}

async function createDevice() {
  try {
    let photo = '';
    if (cover_photo.files[0]) {
      photo = await uploadPhoto(cover_photo.files[0], 'device-photos');
    }
    await callRestApi('/admin/devices', {
      method: 'POST',
      admin: true,
      body: {
        device_code: device_code.value.trim(),
        name: device_name.value.trim(),
        category: category.value.trim(),
        location: location.value.trim(),
        manager: manager.value.trim(),
        status: status.value,
        description: description.value.trim(),
        usage_notice: usage_notice.value.trim(),
        cover_photo: photo
      }
    });
    showToast('success', '设备已创建');
    ['device_code', 'device_name', 'category', 'location', 'manager', 'description', 'usage_notice'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    cover_photo.value = '';
    refreshAdminSummary().catch(() => {});
    loadDevices();
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function loadDevices() {
  const container = document.getElementById('deviceList');
  setLoading(container, '正在加载设备...');
  try {
    const result = await callRestApi('/admin/devices', { admin: true });
    const devices = result.devices || result.list || [];
    container.innerHTML = devices.length ? `
      <div class="table-wrap">
        <table>
          <tr><th>编号</th><th>名称</th><th>位置</th><th>状态</th><th>当前使用</th><th>下个预约</th><th>操作</th></tr>
          ${devices.map((device) => `
            <tr>
              <td class="mono">${escapeHtml(device.device_code)}</td>
              <td>${escapeHtml(device.name)}</td>
              <td>${escapeHtml(device.location || '-')}</td>
              <td>${statusBadge(device.status)}</td>
              <td>${device.current_borrow ? `${escapeHtml(device.current_borrow.user_name || '-')}<br>${escapeHtml(device.current_borrow.user_phone || '-')}` : '<span class="muted">无</span>'}</td>
              <td>${device.next_reservation ? `${escapeHtml(device.next_reservation.user_name || '-')}<br>${escapeHtml(device.next_reservation.user_phone || '-')}<br>${escapeHtml(fmtTime(device.next_reservation.start_time))}` : '<span class="muted">无</span>'}</td>
              <td>${device.status === 'abnormal_pending' ? `<button onclick="setAvailable('${device.id}')">恢复可预约</button>` : '<span class="muted">-</span>'}</td>
            </tr>
          `).join('')}
        </table>
      </div>` : '<div class="empty-state">暂无设备。</div>';
  } catch (error) {
    showPageMessage(container, 'danger', error.message);
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

async function loadUsers() {
  const container = document.getElementById('userList');
  setLoading(container, '正在加载用户...');
  try {
    const result = await callRestApi('/admin/users', { admin: true });
    const users = result.users || [];
    container.innerHTML = users.length ? `
      <div class="table-wrap">
        <table>
          <tr><th>姓名</th><th>手机号</th><th>学号/工号</th><th>状态</th><th>微信绑定</th><th>封禁</th><th>操作</th></tr>
          ${users.map((user) => `
            <tr>
              <td>${escapeHtml(user.name)}</td>
              <td>${escapeHtml(user.phone)}</td>
              <td>${escapeHtml(user.student_no || '-')}</td>
              <td>${statusBadge(user.status)}</td>
              <td>${user.wechat_bound ? `<span class="badge info">${escapeHtml(user.wechat_openid_masked || '已绑定')}</span>` : '<span class="muted">未绑定</span>'}</td>
              <td>${user.is_banned ? '<span class="badge danger">已封禁</span>' : '<span class="badge success">正常</span>'}</td>
              <td class="actions">
                <button onclick="setUserStatus('${user.id}','active')">通过</button>
                <button class="secondary" onclick="toggleBan('${user.id}', ${user.is_banned ? 'false' : 'true'})">${user.is_banned ? '解除封禁' : '封禁'}</button>
                <button class="danger" onclick="setUserStatus('${user.id}','disabled')">停用</button>
                ${user.wechat_bound ? `<button class="warning" onclick="unbindWechat('${user.id}')">解绑微信</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </table>
      </div>` : '<div class="empty-state">暂无用户。</div>';
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

async function loadReservations() {
  const container = document.getElementById('reservationList');
  setLoading(container, '正在加载预约...');
  try {
    const result = await callRestApi('/admin/bookings', { admin: true });
    const reservations = result.reservations || [];
    container.innerHTML = reservations.length ? `
      <div class="table-wrap">
        <table>
          <tr><th>设备</th><th>预约人</th><th>联系方式</th><th>时段</th><th>状态</th><th>操作</th></tr>
          ${reservations.map((row) => `
            <tr>
              <td>${escapeHtml(row.device_name || '-')}<br><span class="muted mono">${escapeHtml(row.device_code || '-')}</span></td>
              <td>${escapeHtml(row.user_name || '-')}<br><span class="muted">${escapeHtml(row.user_student_no || '-')}</span></td>
              <td>${escapeHtml(row.user_phone || '-')}</td>
              <td>${escapeHtml(fmtTime(row.start_time))}<br>${escapeHtml(fmtTime(row.end_time))}</td>
              <td>${statusBadge(row.status)}</td>
              <td class="actions">
                ${row.status === 'pending' ? `<button onclick="approveReservation('${row.id}', true)">通过</button><button class="danger" onclick="approveReservation('${row.id}', false)">拒绝</button>` : '<span class="muted">-</span>'}
              </td>
            </tr>
          `).join('')}
        </table>
      </div>` : '<div class="empty-state">暂无预约。</div>';
  } catch (error) {
    showPageMessage(container, 'danger', error.message);
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

async function loadSecurity() {
  try {
    const [configResult, activityResult] = await Promise.all([
      callRestApi('/admin/security-config', { admin: true }),
      callRestApi('/admin/activity-summary', { admin: true })
    ]);
    const config = configResult.config || {};
    document.getElementById('captcha_expire_minutes').value = config.captcha_expire_minutes ?? 3;
    document.getElementById('captcha_hourly_limit').value = config.captcha_hourly_limit ?? 3;
    document.getElementById('openid_daily_register_limit').value = config.openid_daily_register_limit ?? 1;
    document.getElementById('enable_image_captcha').value = config.enable_image_captcha ? '1' : '0';
    document.getElementById('require_return_photo').value = config.require_return_photo ? '1' : '0';
    document.getElementById('admin_report_enabled').value = config.admin_report_enabled ? '1' : '0';
    document.getElementById('admin_report_hour').value = config.admin_report_hour ?? 9;
    document.getElementById('admin_report_minute').value = config.admin_report_minute ?? 0;
    document.getElementById('admin_report_timezone').value = config.admin_report_timezone || 'Asia/Shanghai';
    document.getElementById('new_admin_password').value = '';
    document.getElementById('confirm_admin_password').value = '';
    document.getElementById('wechat_token').value = config.wechat_token || '';
    document.getElementById('wechat_app_id').value = config.wechat_app_id || '';
    document.getElementById('wechat_app_secret').value = '';
    document.getElementById('wechat_app_secret').placeholder = config.has_wechat_app_secret ? '已保存，留空则不修改' : '尚未设置，请填写 AppSecret';
    document.getElementById('wechat_admin_openids').value = config.wechat_admin_openids || '';
    document.getElementById('public_show_reserver_name').value = config.public_show_reserver_name ? '1' : '0';
    document.getElementById('public_show_reserver_phone').value = config.public_show_reserver_phone ? '1' : '0';
    document.getElementById('public_show_reserver_student_no').value = config.public_show_reserver_student_no ? '1' : '0';
    document.getElementById('system_notice_enabled').value = config.system_notice_enabled ? '1' : '0';
    document.getElementById('system_notice_title').value = config.system_notice_title || '';
    document.getElementById('system_notice_content').value = config.system_notice_content || '';

    const summary = activityResult.summary || {};
    document.getElementById('activitySummaryInner').innerHTML = `
      <div class="card"><div class="metric-label">今日注册</div><div class="value">${summary.registered_today ?? 0}</div></div>
      <div class="card"><div class="metric-label">今日登录</div><div class="value">${summary.logged_in_today ?? 0}</div></div>
      <div class="card"><div class="metric-label">今日微信绑定</div><div class="value">${summary.wechat_bind_today ?? 0}</div></div>
      <div class="card"><div class="metric-label">今日微信验证</div><div class="value">${summary.wechat_scan_today ?? 0}</div></div>
    `;
    const activityRows = activityResult.rows || [];
    document.getElementById('activityList').innerHTML = activityRows.length
      ? `<div class="table-wrap"><table><tr><th>时间</th><th>事件</th><th>用户</th><th>手机</th><th>微信</th><th>备注</th></tr>${activityRows.map((row) => `<tr><td>${escapeHtml(fmtTime(row.created_at))}</td><td>${escapeHtml(row.event_type || '-')}</td><td>${escapeHtml(row.user_name || '-')}</td><td>${escapeHtml(row.phone || '-')}</td><td>${escapeHtml(row.wechat_openid ? `${row.wechat_openid.slice(0, 4)}...${row.wechat_openid.slice(-4)}` : '-')}</td><td>${escapeHtml(row.remark || '-')}</td></tr>`).join('')}</table></div>`
      : '<div class="empty-state">今天还没有新的运营记录。</div>';
  } catch (error) {
    showPageMessage(document.getElementById('activityList'), 'danger', error.message);
  }
}

async function saveSecurityConfig() {
  try {
    const newAdminPassword = document.getElementById('new_admin_password').value.trim();
    const confirmAdminPassword = document.getElementById('confirm_admin_password').value.trim();
    if (newAdminPassword || confirmAdminPassword) {
      if (newAdminPassword.length < 8) throw new Error('新管理员密码至少 8 位');
      if (newAdminPassword !== confirmAdminPassword) throw new Error('两次输入的新管理员密码不一致');
    }

    const wechatAppSecret = document.getElementById('wechat_app_secret').value.trim();
    await callRestApi('/admin/security-config', {
      method: 'PUT',
      admin: true,
      body: {
        captcha_expire_minutes: Number(document.getElementById('captcha_expire_minutes').value || 3),
        captcha_hourly_limit: Number(document.getElementById('captcha_hourly_limit').value || 3),
        openid_daily_register_limit: Number(document.getElementById('openid_daily_register_limit').value || 1),
        enable_image_captcha: document.getElementById('enable_image_captcha').value === '1',
        require_return_photo: document.getElementById('require_return_photo').value === '1',
        admin_report_enabled: document.getElementById('admin_report_enabled').value === '1',
        admin_report_hour: Number(document.getElementById('admin_report_hour').value || 9),
        admin_report_minute: Number(document.getElementById('admin_report_minute').value || 0),
        admin_report_timezone: document.getElementById('admin_report_timezone').value.trim() || 'Asia/Shanghai',
        new_admin_password: newAdminPassword,
        wechat_token: document.getElementById('wechat_token').value.trim(),
        wechat_app_id: document.getElementById('wechat_app_id').value.trim(),
        ...(wechatAppSecret ? { wechat_app_secret: wechatAppSecret } : {}),
        wechat_admin_openids: document.getElementById('wechat_admin_openids').value.trim(),
        public_show_reserver_name: document.getElementById('public_show_reserver_name').value === '1',
        public_show_reserver_phone: document.getElementById('public_show_reserver_phone').value === '1',
        public_show_reserver_student_no: document.getElementById('public_show_reserver_student_no').value === '1',
        system_notice_enabled: document.getElementById('system_notice_enabled').value === '1',
        system_notice_title: document.getElementById('system_notice_title').value.trim(),
        system_notice_content: document.getElementById('system_notice_content').value.trim()
      }
    });
    showToast('success', '安全设置已保存');
    loadSecurity();
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function previewDailyReport() {
  try {
    const result = await callRestApi('/admin/reports/daily-usage', { admin: true });
    document.getElementById('reportPreview').classList.remove('hidden');
    document.getElementById('reportPreviewText').textContent = result.message || '暂无内容';
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function sendDailyReportNow() {
  try {
    const result = await callRestApi('/admin/reports/daily-usage/send', {
      method: 'POST',
      admin: true,
      body: { timezone: document.getElementById('admin_report_timezone').value.trim() || 'Asia/Shanghai' }
    });
    showToast('success', `日报发送完成，成功 ${result.sent || 0} 条`);
    document.getElementById('reportPreview').classList.remove('hidden');
    document.getElementById('reportPreviewText').textContent = result.message || '暂无内容';
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function loadOptions() {
  try {
    const result = await callApi('adminOptions', {}, true);
    stat_user.innerHTML = '<option value="">全部用户</option>' + (result.users || []).map((user) => `<option value="${user.id}">${escapeHtml(user.name)} ${escapeHtml(user.phone)}</option>`).join('');
    stat_device.innerHTML = '<option value="">全部设备</option>' + (result.devices || []).map((device) => `<option value="${device.id}">${escapeHtml(device.device_code)} ${escapeHtml(device.name)}</option>`).join('');
  } catch (error) {
    showPageMessage(document.getElementById('statsBox'), 'danger', error.message);
  }
}

async function loadStats() {
  const box = document.getElementById('statsBox');
  setLoading(box, '正在统计使用记录...');
  try {
    const result = await callApi('usageStats', {
      user_id: stat_user.value,
      device_id: stat_device.value,
      start_date: stat_start.value,
      end_date: stat_end.value
    }, true);
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

function exportStats() {
  try {
    const rows = lastRows.map((item) => ({
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
    csvDownload(`设备使用记录_${stat_start.value || '开始'}_${stat_end.value || '结束'}.csv`, rows);
    showToast('success', 'CSV 已开始下载');
  } catch (error) {
    showToast('danger', error.message);
  }
}

document.getElementById('admin-login-btn').addEventListener('click', adminLogin);
document.getElementById('create-device-btn').addEventListener('click', createDevice);
document.getElementById('save-security-btn').addEventListener('click', saveSecurityConfig);
document.getElementById('preview-report-btn').addEventListener('click', previewDailyReport);
document.getElementById('send-report-btn').addEventListener('click', sendDailyReportNow);
document.getElementById('stats-btn').addEventListener('click', loadStats);
document.getElementById('export-btn').addEventListener('click', exportStats);
document.querySelectorAll('.tabs button').forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

if (requireAdminLogin()) {
  enterAdminConsole();
}
