let lastRows = [];
let selectedUserIds = new Set();
let reservationSlotPresets = window.ReservationSlots ? ReservationSlots.fallbackPresets : [];
const adminTabCache = new Map();
const ADMIN_TAB_CACHE_MS = 30_000;
const DEFAULT_PERMISSION_OPTIONS = [
  { key: 'user.approve', label: '同意用户注册', group: '审批' },
  { key: 'reservation.approve', label: '同意用户预约', group: '审批' },
  { key: 'reservation.view', label: '查看预约记录', group: '预约' },
  { key: 'stats.export', label: '导出指定时间段统计', group: '统计' },
  { key: 'stats.view', label: '查看统计数据', group: '统计' },
  { key: 'device.manage', label: '管理设备', group: '设备' },
  { key: 'device.view', label: '查看设备', group: '设备' },
  { key: 'fault.manage', label: '处理故障报备', group: '设备' },
  { key: 'user.manage', label: '管理用户资料', group: '用户' },
  { key: 'chat.announce', label: '聊天公告 / @全体成员', group: '聊天' },
  { key: 'chat.kick', label: '踢出群成员 / 暂停预约资格', group: '聊天' }
];
const DEFAULT_ROLE_PERMISSIONS = {
  admin: ['device.manage', 'device.view', 'reservation.approve', 'reservation.view', 'user.manage', 'stats.view', 'chat.announce', 'chat.kick'],
  ops: ['device.manage', 'device.view', 'reservation.approve', 'reservation.view', 'fault.manage'],
  auditor: ['device.view', 'reservation.view', 'stats.view', 'stats.export'],
  super_admin: ['*']
};
const ROLE_TEMPLATE_META = {
  admin: { label: '管理员', detail: '设备、预约、用户、统计', key: 'admin' },
  ops: { label: '运营维护', detail: '设备、预约、故障处理', key: 'ops' },
  auditor: { label: '审计查看', detail: '查看预约、设备和导出统计', key: 'auditor' },
  super_admin: { label: '超级管理员', detail: '全部权限', key: 'super_admin' }
};
let permissionOptions = [...DEFAULT_PERMISSION_OPTIONS];
let roleDefaultPermissions = { ...DEFAULT_ROLE_PERMISSIONS };

function fieldValue(id) {
  const element = document.getElementById(id);
  return element && typeof element.value === 'string' ? element.value.trim() : '';
}

function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function handleAdminError(error, target = null) {
  if (error.status === 401) {
    logoutAdmin();
    showLoginOnly();
    showPageMessage('login-message', 'danger', '后台登录已过期，请重新登录后再操作。');
    return;
  }
  if (target) showPageMessage(target, 'danger', error.message);
  else showToast('danger', error.message);
}

function mergeReservationSlotPresets(overrides = []) {
  const overrideMap = new Map((overrides || []).map((slot) => [slot.key, slot]));
  return reservationSlotPresets.map((preset) => ({ ...preset, ...(overrideMap.get(preset.key) || {}), key: preset.key }));
}

function renderDeviceSlotOptions(selectedKeys, presets = reservationSlotPresets) {
  const container = document.getElementById('device-slot-options');
  if (!container || !window.ReservationSlots) return;
  const sourcePresets = Array.isArray(presets) && presets.length ? presets : reservationSlotPresets;
  const checkedKeys = Array.isArray(selectedKeys) ? selectedKeys : sourcePresets.map((slot) => slot.key);
  ReservationSlots.renderEditableCheckboxes(container, sourcePresets, checkedKeys, { name: 'device_reservation_slot_keys' });
}

function getDeviceSlotKeys() {
  const container = document.getElementById('device-slot-options');
  if (!container || !window.ReservationSlots) return [];
  const selected = new Set(ReservationSlots.selectedKeys(container));
  const editablePresets = ReservationSlots.editablePresetsFrom(container, reservationSlotPresets).filter((slot) => selected.has(slot.key));
  if (!editablePresets.length) throw new Error('请至少选择一个允许预约时间段');
  return editablePresets;
}

async function loadReservationSlotPresets() {
  try {
    const result = await callRestApi('/reservation-slots');
    reservationSlotPresets = result.all_presets || result.presets || reservationSlotPresets;
    renderDeviceSlotOptions();
  } catch (_) {
    renderDeviceSlotOptions();
  }
}

function slotLabels(options = []) {
  return (options || []).map((slot) => {
    const label = slot.label || slot.key;
    const start = String(slot.start || slot.start_time || '').slice(0, 5);
    const end = String(slot.end || slot.end_time || '').slice(0, 5);
    if (!label) return '';
    if (!start || !end) return label;
    return `${label} ${start}-${slot.crosses_midnight || slot.crosses_day ? '次日 ' : ''}${end}`;
  }).filter(Boolean).join('、') || '-';
}

function mergePermissionOptions(options = []) {
  const merged = new Map(DEFAULT_PERMISSION_OPTIONS.map((item) => [item.key, item]));
  (options || []).forEach((item) => {
    const key = item && (item.key || item.permission_key);
    if (!key) return;
    merged.set(key, {
      ...merged.get(key),
      ...item,
      key,
      label: item.label || item.name || item.description || key,
      group: item.group || item.group_name || '权限'
    });
  });
  return [...merged.values()];
}

function permissionLabel(key) {
  if (key === '*') return '全部权限';
  const option = permissionOptions.find((item) => item.key === key) || DEFAULT_PERMISSION_OPTIONS.find((item) => item.key === key);
  return option ? `${option.label}（${key}）` : key;
}

function roleTemplateLabel(key) {
  const meta = ROLE_TEMPLATE_META[key];
  return meta ? `${meta.label}（${meta.key}）` : (key || '-');
}

function updateRoleTemplateUi(roleKey) {
  const input = document.getElementById('role_key');
  if (input) input.value = roleKey;
  document.querySelectorAll('.role-template-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.roleKey === roleKey);
  });
  const help = document.getElementById('role_template_help');
  const meta = ROLE_TEMPLATE_META[roleKey];
  if (help && meta) {
    help.textContent = `当前模板：${meta.label}（${meta.key}）。${meta.detail}。模板只用于快速勾选权限，最终授权以下方勾选项为准。`;
  }
}

function selectRoleTemplate(roleKey, applyDefaults = true) {
  updateRoleTemplateUi(roleKey);
  if (applyDefaults) applyRoleDefaults();
}

function parseRolePermissions(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {
    // Fall back to comma-separated legacy values.
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function renderPermissionPicker(selected = []) {
  const box = document.getElementById('role_permissions_picker');
  if (!box) return;
  const options = permissionOptions.length ? permissionOptions : DEFAULT_PERMISSION_OPTIONS;
  const selectedSet = new Set(selected.includes('*') ? permissionOptions.map((item) => item.key) : selected);
  box.innerHTML = options.map((item) => `
    <label class="permission-card ${selectedSet.has(item.key) ? 'selected' : ''}">
      <input type="checkbox" value="${escapeHtml(item.key)}" ${selectedSet.has(item.key) ? 'checked' : ''}>
      <span>${escapeHtml(item.label)}<small>${escapeHtml(item.group || '权限')} · ${escapeHtml(item.key)}</small></span>
    </label>
  `).join('');
  box.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', () => {
      input.closest('.permission-card').classList.toggle('selected', input.checked);
    });
  });
}

function selectedPermissions() {
  return [...document.querySelectorAll('#role_permissions_picker input:checked')].map((input) => input.value);
}

function setPermissionSelection(keys = []) {
  renderPermissionPicker(keys);
}

function applyRoleDefaults() {
  const roleKey = document.getElementById('role_key').value;
  updateRoleTemplateUi(roleKey);
  setPermissionSelection(roleDefaultPermissions[roleKey] || []);
}

function showLoginOnly() {
  const accessDeniedBox = document.getElementById('admin-access-denied');
  if (accessDeniedBox) accessDeniedBox.classList.add('hidden');
  document.getElementById('login-box').classList.remove('hidden');
  document.getElementById('admin-box').classList.add('hidden');
  ['overview', 'analytics', 'devices', 'users', 'reservations', 'security', 'stats', 'roles', 'faults', 'requests', 'user-info', 'contacts', 'logs'].forEach((tab) => {
    const panel = document.getElementById(`tab_${tab}`);
    if (panel) panel.classList.add('hidden');
  });
  document.querySelectorAll('.tabs button').forEach((button) => {
    button.classList.remove('active');
  });
}

function showAccessDenied() {
  document.getElementById('login-box').classList.add('hidden');
  document.getElementById('admin-box').classList.add('hidden');
  let box = document.getElementById('admin-access-denied');
  if (!box) {
    box = document.createElement('section');
    box.id = 'admin-access-denied';
    box.className = 'card';
    box.innerHTML = `
      <div class="section-head">
        <div>
          <h3>无后台权限</h3>
          <p class="muted">当前登录的是普通用户账号，只能预约设备、查看记录和提交归还。如需进入后台，请先退出当前用户，再使用管理员账号或后台密码登录。</p>
        </div>
      </div>
      <div class="actions">
        <a href="index.html">返回设备列表</a>
        <a href="#" id="admin-access-logout">退出当前用户</a>
      </div>
    `;
    document.getElementById('login-box').after(box);
  }
  box.classList.remove('hidden');
  const logoutLink = document.getElementById('admin-access-logout');
  if (logoutLink) {
    logoutLink.addEventListener('click', (event) => {
      event.preventDefault();
      logoutUser();
      logoutAdmin();
      location.replace('login.html');
    }, { once: true });
  }
}

function bootAdminPage() {
  if (isAdminLoggedIn()) {
    enterAdminConsole();
    return;
  }
  showLoginOnly();
}

function switchTab(name) {
  document.querySelectorAll('.tabs button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === name);
  });
  ['overview', 'analytics', 'devices', 'users', 'reservations', 'security', 'stats', 'roles', 'faults', 'requests', 'user-info', 'contacts', 'logs'].forEach((tab) => {
    const panel = document.getElementById(`tab_${tab}`);
    if (panel) panel.classList.toggle('hidden', tab !== name);
  });

  if (name === 'overview') loadAdminTabOnce(name, loadOverview);
  if (name === 'analytics') loadAdminTabOnce(name, loadAnalytics);
  if (name === 'devices') loadAdminTabOnce(name, loadDevices);
  if (name === 'users') loadAdminTabOnce(name, loadUsers);
  if (name === 'reservations') loadAdminTabOnce(name, loadReservations);
  if (['security', 'user-info', 'contacts', 'stats'].includes(name)) loadAdminTabOnce('security', loadSecurity);
  if (name === 'stats') loadAdminTabOnce(name, async () => {
    await loadOptions();
    await loadExportJobs();
  });
  if (name === 'roles') {
    loadAdminTabOnce(name, async () => {
      await loadRoleUserOptions();
      await loadRoles();
    });
  }
  if (name === 'faults') loadAdminTabOnce(name, loadFaultReports);
  if (name === 'requests') loadAdminTabOnce(name, loadUserRequests);
  if (name === 'logs') loadAdminTabOnce(name, loadOperationLogs);
  updateAdminShellActive(name);
}

function loadAdminTabOnce(name, loader) {
  const cachedAt = adminTabCache.get(name) || 0;
  if (Date.now() - cachedAt < ADMIN_TAB_CACHE_MS) return;
  adminTabCache.set(name, Date.now());
  Promise.resolve(loader()).catch((error) => {
    adminTabCache.delete(name);
    handleAdminError(error);
  });
}

function invalidateAdminTab(name) {
  if (name) adminTabCache.delete(name);
}

function adminTabFromHash() {
  const name = (window.location.hash || '#overview').replace(/^#/, '');
  if (name === 'notice') return 'stats';
  const allowed = ['overview', 'analytics', 'devices', 'users', 'reservations', 'security', 'stats', 'roles', 'faults', 'requests', 'user-info', 'contacts', 'logs'];
  return allowed.includes(name) ? name : 'overview';
}

function updateAdminShellActive(name) {
  document.querySelectorAll('.main-nav a[href^="admin.html#"], .sidebar-nav a[href^="admin.html#"]').forEach((link) => {
    link.classList.toggle('active', link.getAttribute('href') === `admin.html#${name}`);
  });
}

function setupAdminTabs() {
  document.querySelectorAll('.tabs button').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab;
      switchTab(tab);
      if (window.IdbsNavigation && typeof window.IdbsNavigation.replaceCurrentUrl === 'function') {
        window.IdbsNavigation.replaceCurrentUrl(`admin.html#${tab}`);
      } else {
        window.history.replaceState(null, '', `admin.html#${tab}`);
      }
    });
  });
  window.addEventListener('hashchange', () => {
    if (isAdminLoggedIn()) switchTab(adminTabFromHash());
  });
}

function refreshAdminSummary() {
  invalidateAdminTab('overview');
  if (adminTabFromHash() === 'overview') loadAdminTabOnce('overview', loadOverview);
  return Promise.resolve();
}

function enterAdminConsole() {
  document.getElementById('login-box').classList.add('hidden');
  document.getElementById('admin-box').classList.remove('hidden');
  const initialTab = adminTabFromHash();
  switchTab(initialTab);
  if (window.IdbsNavigation && typeof window.IdbsNavigation.replaceCurrentUrl === 'function') {
    window.IdbsNavigation.replaceCurrentUrl(`admin.html#${initialTab}`);
  } else if (window.location.hash !== `#${initialTab}`) {
    window.history.replaceState(null, '', `admin.html#${initialTab}`);
  }
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
    location.replace('admin.html#overview');
  } catch (error) {
    showPageMessage('login-message', 'danger', error.message);
  }
}

document.getElementById('admin-login-btn').addEventListener('click', adminLogin);
document.getElementById('adminPwd').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') adminLogin();
});
document.getElementById('create-device-btn').addEventListener('click', createDevice);
document.getElementById('cancel-device-edit-btn')?.addEventListener('click', resetDeviceForm);
document.getElementById('save-security-btn').addEventListener('click', saveSecurityConfig);
document.getElementById('save-user-info-btn').addEventListener('click', saveUserInfoConfig);
document.getElementById('save-contacts-btn')?.addEventListener('click', saveContactsConfig);
document.getElementById('save-notice-btn').addEventListener('click', saveNoticeConfig);
document.getElementById('preview-report-btn').addEventListener('click', previewDailyReport);
document.getElementById('send-report-btn').addEventListener('click', sendDailyReportNow);
document.getElementById('reload-overview-btn').addEventListener('click', loadOverview);
document.getElementById('reload-analytics-btn').addEventListener('click', loadAnalytics);
document.getElementById('analytics_range').addEventListener('change', loadAnalytics);
document.getElementById('reload-reservations-btn').addEventListener('click', loadReservations);
document.getElementById('stats-btn').addEventListener('click', loadStats);
document.getElementById('export-btn').addEventListener('click', () => exportStats('csv'));
document.getElementById('export-excel-btn')?.addEventListener('click', () => exportStats('excel'));
document.getElementById('export-job-btn')?.addEventListener('click', createExportJob);
document.getElementById('run-export-job-btn')?.addEventListener('click', runNextExportJob);
document.getElementById('save-role-btn').addEventListener('click', saveRole);
document.getElementById('revoke-role-btn').addEventListener('click', revokeRole);
document.getElementById('reload-role-btn').addEventListener('click', loadRoles);
document.getElementById('role_key').addEventListener('change', applyRoleDefaults);
document.querySelectorAll('.role-template-button').forEach((button) => {
  button.addEventListener('click', () => selectRoleTemplate(button.dataset.roleKey));
});
document.getElementById('select-role-defaults-btn')?.addEventListener('click', applyRoleDefaults);
document.getElementById('select-approve-perms-btn')?.addEventListener('click', () => {
  setPermissionSelection(['user.approve', 'reservation.approve', 'reservation.view']);
});
document.getElementById('select-export-perms-btn')?.addEventListener('click', () => {
  setPermissionSelection(['stats.export', 'stats.view']);
});
document.getElementById('select-ops-perms-btn')?.addEventListener('click', () => {
  setPermissionSelection(['device.manage', 'device.view', 'fault.manage']);
});
document.getElementById('clear-role-perms-btn')?.addEventListener('click', () => {
  setPermissionSelection([]);
});
document.getElementById('reload-faults-btn').addEventListener('click', loadFaultReports);
document.getElementById('reload-requests-btn').addEventListener('click', loadUserRequests);
document.getElementById('fault_status_filter')?.addEventListener('change', loadFaultReports);
document.getElementById('request_status_filter')?.addEventListener('change', loadUserRequests);
document.getElementById('reload-logs-btn').addEventListener('click', loadOperationLogs);
document.getElementById('log_operator_filter')?.addEventListener('input', debounce(() => loadOperationLogs(), 300));
document.getElementById('log_start_filter')?.addEventListener('change', loadOperationLogs);
document.getElementById('log_end_filter')?.addEventListener('change', loadOperationLogs);
document.getElementById('delete-selected-users-btn').addEventListener('click', deleteSelectedUsers);
document.getElementById('select-all-users-btn').addEventListener('click', () => {
  const selectAll = document.getElementById('user-select-all');
  if (selectAll) selectAll.click();
});
document.getElementById('select-device-slots-btn').addEventListener('click', () => {
  renderDeviceSlotOptions(ReservationSlots.baseKeys(reservationSlotPresets));
});
document.getElementById('clear-device-slots-btn').addEventListener('click', () => {
  renderDeviceSlotOptions([]);
});
setupAdminTabs();
loadReservationSlotPresets();

bootAdminPage();
