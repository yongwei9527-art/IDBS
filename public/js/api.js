let app;
let authReady;

const STATUS_LABELS = {
  available: '可预约',
  reserved: '已预约',
  in_use: '使用中',
  abnormal_pending: '异常待处理',
  maintenance: '维修中',
  disabled: '停用',
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消',
  completed: '已完成',
  no_show: '爽约',
  returned: '已归还',
  overdue: '逾期',
  active: '启用'
};

function normalizeBaseUrl(url) {
  return (url || '').replace(/\/$/, '');
}

function getApiBaseUrl() {
  return normalizeBaseUrl(window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) || window.location.origin;
}

function isCloudBaseMode() {
  return !!(window.APP_CONFIG && window.APP_CONFIG.useCloudBase);
}

function initCloudBase() {
  if (!app) {
    const cb = window.cloudbase && (window.cloudbase.default || window.cloudbase);
    if (!cb || !cb.init) throw new Error('CloudBase SDK 加载失败');
    app = cb.init({ env: window.APP_CONFIG.envId, region: window.APP_CONFIG.region });
    authReady = app.auth({ persistence: 'local' }).signInAnonymously().catch(() => null);
  }
  return app;
}

function getUserToken() { return localStorage.getItem('USER_TOKEN') || ''; }
function setUserToken(token) { localStorage.setItem('USER_TOKEN', token || ''); }
function clearUserToken() { localStorage.removeItem('USER_TOKEN'); }
function getAdminToken() { return localStorage.getItem('ADMIN_TOKEN') || ''; }
function setAdminToken(token) { localStorage.setItem('ADMIN_TOKEN', token || ''); }
function clearAdminToken() { localStorage.removeItem('ADMIN_TOKEN'); }

function getUserInfo() {
  try {
    return JSON.parse(localStorage.getItem('USER_INFO') || 'null');
  } catch (_) {
    return null;
  }
}

function setUserInfo(user) {
  localStorage.setItem('USER_INFO', JSON.stringify(user || null));
}

function clearUserInfo() {
  localStorage.removeItem('USER_INFO');
}

function getUserRole() {
  const user = getUserInfo();
  return user && user.role ? user.role : '';
}

function isRoleAdmin(role) {
  return role === 'admin' || role === 'super_admin';
}

function isCurrentUserAdmin() {
  return isRoleAdmin(getUserRole());
}

function logoutUser() {
  clearUserToken();
  clearUserInfo();
}

function logoutAdmin() {
  clearAdminToken();
}

function isLoggedIn() {
  return !!getUserToken();
}

function isAdminLoggedIn() {
  return !!getAdminToken() || isCurrentUserAdmin();
}

function getEffectiveAdminToken() {
  return getAdminToken() || (isCurrentUserAdmin() ? getUserToken() : '');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function formatBadgeClass(status) {
  if (['available', 'approved', 'returned', 'completed', 'active'].includes(status)) return 'success';
  if (['disabled', 'rejected', 'abnormal_pending'].includes(status)) return 'danger';
  if (['maintenance', 'pending', 'overdue'].includes(status)) return 'warn';
  return 'info';
}

function statusText(status) {
  return STATUS_LABELS[status] || status || '-';
}

function statusBadge(status) {
  return `<span class="badge ${formatBadgeClass(status)}">${escapeHtml(statusText(status))}</span>`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || `请求失败 (${response.status})`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

async function callApi(action, payload = {}, admin = false) {
  if (isCloudBaseMode()) {
    initCloudBase();
    await authReady;
    const response = await app.callFunction({
      name: window.APP_CONFIG.apiFunctionName,
      data: { action, payload, token: admin ? getEffectiveAdminToken() : getUserToken() }
    });
    const data = response.result || response;
    if (!data.ok) {
      const error = new Error(data.message || '操作失败');
      error.payload = data;
      throw error;
    }
    return data;
  }

  try {
    return await requestJson(`${getApiBaseUrl()}/api/${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(admin
          ? (getEffectiveAdminToken() ? { Authorization: `Bearer ${getEffectiveAdminToken()}` } : {})
          : (getUserToken() ? { Authorization: `Bearer ${getUserToken()}` } : {}))
      },
      body: JSON.stringify(payload || {})
    });
  } catch (error) {
    if (error.status === 401 && !admin) logoutUser();
    if (error.status === 401 && admin && getAdminToken()) logoutAdmin();
    throw error;
  }
}

async function callRestApi(path, options = {}) {
  const {
    method = 'GET',
    body,
    admin = false,
    headers = {}
  } = options;

  const requestHeaders = { ...headers };
  const token = admin ? getEffectiveAdminToken() : getUserToken();
  if (token) requestHeaders.Authorization = `Bearer ${token}`;

  let requestBody;
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const response = await requestJson(`${getApiBaseUrl()}/api${path}`, {
    method,
    headers: requestHeaders,
    body: requestBody
  });

  return response.data;
}

async function uploadPhoto(file, folder = 'return') {
  if (!file) return '';
  if (!isCloudBaseMode()) {
    const form = new FormData();
    form.append('file', file);
    const data = await requestJson(`${getApiBaseUrl()}/api/upload`, {
      method: 'POST',
      body: form
    });
    return data.url || (data.data && data.data.url) || '';
  }

  initCloudBase();
  await authReady;
  const ext = (file.name || 'jpg').split('.').pop();
  const cloudPath = `${folder}/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
  const response = await app.uploadFile({ cloudPath, filePath: file });
  return response.fileID;
}

async function tempUrl(fileID) {
  if (!fileID) return '';
  if (!isCloudBaseMode()) return fileID;
  initCloudBase();
  await authReady;
  const response = await app.getTempFileURL({ fileList: [fileID] });
  return response.fileList && response.fileList[0] ? response.fileList[0].tempFileURL : '';
}

async function renderImg(fileID, className = 'photo') {
  const url = await tempUrl(fileID);
  return url ? `<img class="${className}" src="${escapeHtml(url)}" alt="图片">` : '';
}

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function fmtTime(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

function formatDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function csvDownload(filename, rows) {
  if (!rows || !rows.length) {
    throw new Error('没有可导出的记录');
  }

  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')]
    .concat(rows.map((row) => headers.map((header) => `"${String(row[header] ?? '').replace(/"/g, '""')}"`).join(',')))
    .join('\n');

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}
