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
  active: '启用',
  processing: '处理中',
  resolved: '已解决',
  confirmed: '已确认',
  change_requested: '申请修改',
  closed: '已关闭'
};

function normalizeBaseUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';

  let normalized = raw;
  if (/^\/\//.test(normalized)) {
    normalized = `${window.location.protocol}${normalized}`;
  } else if (!/^https?:\/\//i.test(normalized)) {
    const hostPart = normalized.split('/')[0];
    const looksLikeHost = !normalized.startsWith('/') && !/\s/.test(hostPart) && (hostPart.includes('.') || hostPart.startsWith('localhost'));
    normalized = looksLikeHost
      ? `${window.location.protocol}//${normalized}`
      : `${window.location.origin}/${normalized.replace(/^\/+/, '')}`;
  }

  return normalized.replace(/\/+$/, '').replace(/\/api$/i, '');
}

function getApiBaseUrl() {
  return normalizeBaseUrl(window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) || window.location.origin;
}

function getUserToken() { return localStorage.getItem('USER_TOKEN') || ''; }
function setUserToken(token) { localStorage.setItem('USER_TOKEN', token || ''); }
function clearUserToken() { localStorage.removeItem('USER_TOKEN'); }
function getAdminToken() { return localStorage.getItem('ADMIN_TOKEN') || ''; }
function setAdminToken(token) { localStorage.setItem('ADMIN_TOKEN', token || ''); }
function clearAdminToken() { localStorage.removeItem('ADMIN_TOKEN'); }

function parseTokenPayload(token) {
  const body = String(token || '').split('.')[0];
  if (!body) return null;
  try {
    const base64 = body.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const json = decodeURIComponent([...binary].map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

function isAdminToken(token) {
  const payload = parseTokenPayload(token);
  return !!payload && payload.scope === 'admin' && isRoleAdmin(payload.role);
}

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
  return isAdminToken(getAdminToken());
}

function getEffectiveAdminToken() {
  const token = getAdminToken();
  return isAdminToken(token) ? token : '';
}

function getAuthTokenForContext(admin = false) {
  return admin ? getEffectiveAdminToken() : getUserToken();
}

function buildRestUrl(path, params = {}) {
  const url = new URL(`${getApiBaseUrl()}/api${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  return url.toString();
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
  if (status === 'available') return 'available';
  if (['in_use', 'reserved'].includes(status)) return 'busy';
  if (status === 'maintenance') return 'maintenance';
  if (status === 'disabled') return 'disabled';
  if (status === 'abnormal_pending') return 'danger';
  if (['approved', 'returned', 'completed', 'active'].includes(status)) return 'success';
  if (['rejected', 'overdue'].includes(status)) return 'danger';
  if (['pending'].includes(status)) return 'warn';
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
  const form = new FormData();
  form.append('file', file);
  const data = await requestJson(`${getApiBaseUrl()}/api/upload`, {
    method: 'POST',
    body: form
  });
  return data.url || (data.data && data.data.url) || '';
}

async function tempUrl(fileID) {
  if (!fileID) return '';
  return fileID;
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

function parseReservationApiPayload(payload = {}) {
  const deviceCodes = Array.isArray(payload.device_codes)
    ? payload.device_codes
    : payload.device_code
      ? [payload.device_code]
      : [];
  const timeSlots = Array.isArray(payload.time_slots)
    ? payload.time_slots
    : payload.start_time && payload.end_time
      ? [`${payload.start_time} - ${payload.end_time}`]
      : [];
  return {
    ...payload,
    device_codes: deviceCodes,
    time_slots: timeSlots
  };
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

function excelDownload(filename, rows) {
  if (!rows || !rows.length) {
    throw new Error('没有可导出的记录');
  }
  const headers = Object.keys(rows[0]);
  const cells = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const table = `
    <html><head><meta charset="utf-8"></head><body>
      <table border="1">
        <tr>${headers.map((header) => `<th>${cells(header)}</th>`).join('')}</tr>
        ${rows.map((row) => `<tr>${headers.map((header) => `<td>${cells(row[header])}</td>`).join('')}</tr>`).join('')}
      </table>
    </body></html>
  `;
  const blob = new Blob(['\ufeff' + table], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename.endsWith('.xls') ? filename : `${filename}.xls`;
  link.click();
}
