// Admin system modules: security config, notice, reports and roles.
// Loaded before admin.js so tab routing and toolbar buttons can call these functions.

const STAFF_CONTACT_PRESETS = [
  { key: 'admin', label: '管理员（系统维护）', description: '系统登录、账号权限、平台异常与维护' },
  { key: 'reservation', label: '管理员（预约与取消）', description: '预约申请、取消调整、审核进度与排期协调' },
  { key: 'fault', label: '设备维修员', description: '设备故障、维修处理、异常恢复与现场检查' },
  { key: 'usage', label: '值班管理员（紧急联系）', description: '紧急情况、现场协助、无法归类的问题' }
];

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
    document.getElementById('block_ip_access_enabled').value = config.block_ip_access_enabled ? '1' : '0';
    document.getElementById('admin_report_enabled').value = config.admin_report_enabled ? '1' : '0';
    document.getElementById('admin_report_hour').value = config.admin_report_hour ?? 9;
    document.getElementById('admin_report_minute').value = config.admin_report_minute ?? 0;
    document.getElementById('admin_report_timezone').value = config.admin_report_timezone || 'Asia/Shanghai';
    document.getElementById('site_domain').value = config.site_domain || '';
    document.getElementById('new_admin_password').value = '';
    document.getElementById('confirm_admin_password').value = '';
    document.getElementById('wechat_token').value = config.wechat_token || '';
    document.getElementById('wechat_app_id').value = config.wechat_app_id || '';
    document.getElementById('wechat_app_secret').value = '';
    document.getElementById('wechat_app_secret').placeholder = config.has_wechat_app_secret ? '已保存，留空则不修改' : '尚未设置，请填写 AppSecret';
    document.getElementById('wechat_admin_openids').value = config.wechat_admin_openids || '';
    if (document.getElementById('admin_default_password_seed')) {
      document.getElementById('admin_default_password_seed').value = config.admin_default_password_seed || 'IDBS123456';
    }
    document.getElementById('public_show_reserver_name').value = config.public_show_reserver_name ? '1' : '0';
    document.getElementById('public_show_reserver_phone').value = config.public_show_reserver_phone ? '1' : '0';
    document.getElementById('public_show_reserver_student_no').value = config.public_show_reserver_student_no ? '1' : '0';
    document.getElementById('system_notice_enabled').value = config.system_notice_enabled ? '1' : '0';
    document.getElementById('system_notice_title').value = config.system_notice_title || '';
    document.getElementById('system_notice_content').value = config.system_notice_content || '';
    renderStaffContactEditor(config.staff_contacts || []);

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

function staffContactFieldValue(id) {
  const element = document.getElementById(id);
  return element && typeof element.value === 'string' ? element.value.trim() : '';
}

function normalizeStaffContactsForAdmin(contacts = []) {
  const byKey = new Map((contacts || []).filter(Boolean).map((item) => [item.key, item]));
  return STAFF_CONTACT_PRESETS.map((preset) => ({
    ...preset,
    ...(byKey.get(preset.key) || {}),
    enabled: byKey.has(preset.key) ? byKey.get(preset.key).enabled !== false : true
  }));
}

function renderStaffContactEditor(contacts = []) {
  const box = document.getElementById('staffContactEditor');
  if (!box) return;
  const rows = normalizeStaffContactsForAdmin(contacts);
  box.innerHTML = rows.map((contact) => {
    const key = contact.key;
    const qrUrl = contact.qrcode_url || '';
    return `
      <article class="staff-contact-admin-card" data-contact-key="${escapeHtml(key)}">
        <div class="staff-contact-admin-head">
          <div>
            <strong>${escapeHtml(contact.label || key)}</strong>
            <span>${escapeHtml(contact.description || '')}</span>
          </div>
          <select id="staff_contact_${escapeHtml(key)}_enabled" aria-label="是否启用${escapeHtml(contact.label || key)}">
            <option value="1" ${contact.enabled !== false ? 'selected' : ''}>启用</option>
            <option value="0" ${contact.enabled === false ? 'selected' : ''}>隐藏</option>
          </select>
        </div>
        <div class="staff-contact-admin-layout">
          <div>
            <label for="staff_contact_${escapeHtml(key)}_file">微信二维码</label>
            <div class="staff-contact-admin-qr" id="staff_contact_${escapeHtml(key)}_preview">
              ${qrUrl ? `<img src="${escapeHtml(qrUrl)}" alt="${escapeHtml(contact.label || key)}二维码">` : '<span>未上传二维码</span>'}
            </div>
            <input id="staff_contact_${escapeHtml(key)}_file" type="file" accept="image/*">
            <input id="staff_contact_${escapeHtml(key)}_qrcode" value="${escapeHtml(qrUrl)}" placeholder="或粘贴微信二维码图片 URL">
          </div>
          <div class="form-grid compact-form-grid">
            <div>
              <label for="staff_contact_${escapeHtml(key)}_name">姓名</label>
              <input id="staff_contact_${escapeHtml(key)}_name" value="${escapeHtml(contact.name || '')}" maxlength="80" placeholder="例如：张老师">
            </div>
            <div>
              <label for="staff_contact_${escapeHtml(key)}_phone">手机号</label>
              <input id="staff_contact_${escapeHtml(key)}_phone" value="${escapeHtml(contact.phone || '')}" maxlength="30" placeholder="例如：13800000000">
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');
  rows.forEach((contact) => {
    const key = contact.key;
    const fileInput = document.getElementById(`staff_contact_${key}_file`);
    const preview = document.getElementById(`staff_contact_${key}_preview`);
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file || !preview) return;
      const url = URL.createObjectURL(file);
      preview.innerHTML = `<img src="${url}" alt="二维码预览">`;
    });
  });
}

async function collectStaffContactsFromForm() {
  const contacts = [];
  for (const preset of STAFF_CONTACT_PRESETS) {
    const key = preset.key;
    const fileInput = document.getElementById(`staff_contact_${key}_file`);
    let qrcodeUrl = staffContactFieldValue(`staff_contact_${key}_qrcode`);
    if (fileInput?.files?.[0]) {
      qrcodeUrl = await uploadPhoto(fileInput.files[0], 'staff-contacts');
    }
    contacts.push({
      key,
      label: preset.label,
      description: preset.description,
      enabled: document.getElementById(`staff_contact_${key}_enabled`)?.value !== '0',
      name: staffContactFieldValue(`staff_contact_${key}_name`),
      phone: staffContactFieldValue(`staff_contact_${key}_phone`),
      qrcode_url: qrcodeUrl
    });
  }
  return contacts;
}

async function saveContactsConfig() {
  try {
    const contacts = await collectStaffContactsFromForm();
    await callRestApi('/admin/security-config', {
      method: 'PUT',
      admin: true,
      body: { staff_contacts: contacts }
    });
    showToast('success', '工作人员联系方式已保存');
    invalidateAdminTab('security');
    loadSecurity();
  } catch (error) {
    showToast('danger', error.message);
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
        block_ip_access_enabled: document.getElementById('block_ip_access_enabled').value === '1',
        admin_report_enabled: document.getElementById('admin_report_enabled').value === '1',
        admin_report_hour: Number(document.getElementById('admin_report_hour').value || 9),
        admin_report_minute: Number(document.getElementById('admin_report_minute').value || 0),
        admin_report_timezone: document.getElementById('admin_report_timezone').value.trim() || 'Asia/Shanghai',
        site_domain: document.getElementById('site_domain').value.trim(),
        new_admin_password: newAdminPassword,
        wechat_token: document.getElementById('wechat_token').value.trim(),
        wechat_app_id: document.getElementById('wechat_app_id').value.trim(),
        ...(wechatAppSecret ? { wechat_app_secret: wechatAppSecret } : {}),
        wechat_admin_openids: document.getElementById('wechat_admin_openids').value.trim(),
        ...(document.getElementById('admin_default_password_seed') ? { admin_default_password_seed: document.getElementById('admin_default_password_seed').value.trim() } : {}),
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

async function saveUserInfoConfig() {
  try {
    await callRestApi('/admin/security-config', {
      method: 'PUT',
      admin: true,
      body: {
        public_show_reserver_name: document.getElementById('public_show_reserver_name').value === '1',
        public_show_reserver_phone: document.getElementById('public_show_reserver_phone').value === '1',
        public_show_reserver_student_no: document.getElementById('public_show_reserver_student_no').value === '1'
      }
    });
    showToast('success', '用户信息设置已保存');
    loadSecurity();
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function saveNoticeConfig() {
  try {
    await callRestApi('/admin/security-config', {
      method: 'PUT',
      admin: true,
      body: {
        system_notice_enabled: document.getElementById('system_notice_enabled').value === '1',
        system_notice_title: document.getElementById('system_notice_title').value.trim(),
        system_notice_content: document.getElementById('system_notice_content').value.trim()
      }
    });
    showToast('success', '注意事项已保存');
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

async function loadRoles() {
  const box = document.getElementById('roleList');
  setLoading(box, '正在加载管理员角色...');
  try {
    let permissionResult = {};
    try { permissionResult = await callRestApi('/admin/permissions', { admin: true }); } catch (_) {}
    const result = await callRestApi('/admin/roles', { admin: true });
    if (permissionResult.permissions) result.permissions = permissionResult.permissions;
    if (permissionResult.role_defaults) result.role_defaults = permissionResult.role_defaults;
    permissionOptions = mergePermissionOptions(result.permissions || []);
    roleDefaultPermissions = { ...DEFAULT_ROLE_PERMISSIONS, ...(result.role_defaults || {}) };
    renderPermissionPicker(selectedPermissions().length ? selectedPermissions() : (roleDefaultPermissions[document.getElementById('role_key').value] || []));
    const roles = result.roles || [];
    box.innerHTML = roles.length ? `<div class="table-wrap"><table><tr><th>用户</th><th>权限模板</th><th>已授权权限</th><th>备注</th></tr>${roles.map((row) => {
      const permissionsText = parseRolePermissions(row.permissions).map(permissionLabel).join('、') || '-';
      return `<tr><td>${escapeHtml(row.user_name || row.user_id || '-')}<br><span class="muted">${escapeHtml(row.user_phone || '-')}</span></td><td>${escapeHtml(roleTemplateLabel(row.role_key))}</td><td class="permission-list">${escapeHtml(permissionsText)}</td><td>${escapeHtml(row.note || '-')}</td></tr>`;
    }).join('')}</table></div>` : '<div class="empty-state">暂无管理员角色。</div>';
  } catch (error) {
    showPageMessage(box, 'danger', error.message);
  }
}

async function loadRoleUserOptions() {
  try {
    const result = await callRestApi('/admin/options', { admin: true });
    const users = result.users || [];
    const select = document.getElementById('role_user_id');
    select.innerHTML = '<option value="">请选择用户</option>' + users.map((user) => `<option value="${user.id}">${escapeHtml(user.name)} ${escapeHtml(user.phone || '')}</option>`).join('');
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function saveRole() {
  try {
    const userId = document.getElementById('role_user_id').value.trim();
    const permissions = selectedPermissions();
    if (!userId) throw new Error('请先选择要授权的用户');
    if (!permissions.length) throw new Error('请至少勾选一个管理员权限');
    await callRestApi('/admin/roles', {
      method: 'PUT',
      admin: true,
      body: {
        user_id: userId,
        role_key: document.getElementById('role_key').value.trim(),
        permissions,
        note: document.getElementById('role_note').value.trim()
      }
    });
    showToast('success', '管理员角色已保存');
    loadRoles();
    loadRoleUserOptions();
  } catch (error) {
    showToast('danger', error.message);
  }
}

async function revokeRole() {
  try {
    await callRestApi('/admin/roles', {
      method: 'DELETE',
      admin: true,
      body: { user_id: document.getElementById('role_user_id').value.trim() }
    });
    showToast('success', '管理员权限已撤销');
    loadRoles();
    loadRoleUserOptions();
  } catch (error) {
    showToast('danger', error.message);
  }
}
