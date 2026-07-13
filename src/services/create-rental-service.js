const { AppError } = require('../lib/app-error');
const { verifyJwt } = require('../lib/auth');
const path = require('path');
const {
  fail,
  isSafeUrl,
  nowIso,
  ok,
  parseBoolean,
  safeFilename
} = require('./core/service-utils');
const {
  assertOptionalEmail,
  assertPassword,
  assertPhone,
  assertText
} = require('./core/validation');
const { createCryptoUtils } = require('./core/crypto-utils');
const {
  compactDateTimeRangeForTimezone,
  durationMinutes,
  formatDateForTimezone,
  formatDateTimeForTimezone
} = require('./core/date-time');
const { createDashboardService } = require('./domains/admin/dashboard-service');
const { createAnalyticsService } = require('./domains/analytics/analytics-service');
const { createChatService } = require('./domains/chat/chat-service');
const { createAdminSystemService } = require('./domains/admin/system-service');
const { createAuthService } = require('./domains/auth/auth-service');
const { createDeviceAdminService } = require('./domains/devices/device-admin-service');
const { createDeviceReadService } = require('./domains/devices/device-read-service');
const { createFaultRequestService } = require('./domains/faults/fault-request-service');
const { createMaintenanceService } = require('./domains/maintenance/maintenance-service');
const { createExportService } = require('./domains/reports/export-service');
const { createBorrowReturnService } = require('./domains/reservations/borrow-return-service');
const { createReservationActionService } = require('./domains/reservations/reservation-action-service');
const { createReservationReadService } = require('./domains/reservations/reservation-read-service');
const { createReservationReminderService } = require('./domains/reservations/reservation-reminder-service');
const { createUserService } = require('./domains/users/user-service');
const { createWechatService } = require('./domains/wechat/wechat-service');
const { createWechatPushService } = require('./domains/wechat/wechat-push-service');
const { PERMISSION_KEYS, PERMISSION_OPTIONS, ROLE_PERMISSIONS, permissionModules } = require('../modules/lab-modules');

function createRentalService(options) {
  const {
    db,
    crypto,
    adminPassword,
    tokenSecret,
    wechatToken = '',
    wechatAppId = '',
    wechatAppSecret = '',
    wechatAdminOpenids = '',
    realtimePublisher = async () => 0,
    uploadDir = path.join(process.cwd(), 'uploads'),
    activeReservationStatus = ['pending', 'approved', 'in_use']
  } = options;

  const {
    hashPassword,
    makeToken,
    needsPasswordRehash,
    sha256,
    verifyPassword,
    verifySecret
  } = createCryptoUtils({ crypto, tokenSecret });

  const DEFAULT_SECURITY_CONFIG = {
    captcha_expire_minutes: 3,
    captcha_hourly_limit: 3,
    openid_daily_register_limit: 1,
    enable_image_captcha: 0,
    require_return_photo: 1,
    block_ip_access_enabled: 0,
    public_show_reserver_name: 1,
    public_show_reserver_phone: 1,
    public_show_reserver_student_no: 0,
    site_domain: '',
    system_notice_enabled: 1,
    system_notice_title: '使用注意事项',
    system_notice_content: '请按预约时间使用设备，归还前确认设备状态并按要求提交归还信息。',
    system_notice_version: '1',
    staff_contacts: '[]'
  };

  const DEFAULT_REPORT_CONFIG = {
    admin_report_enabled: 0,
    admin_report_hour: 9,
    admin_report_minute: 0,
    admin_report_timezone: 'Asia/Shanghai'
  };
  const DEFAULT_WECHAT_CONFIG = {
    wechat_token: wechatToken,
    wechat_app_id: wechatAppId,
    wechat_app_secret: wechatAppSecret,
    wechat_admin_openids: wechatAdminOpenids
  };
  const STAFF_CONTACT_PRESETS = [
    { key: 'admin', label: '管理员（系统维护）', description: '系统登录、账号权限、平台异常与维护' },
    { key: 'reservation', label: '管理员（预约与取消）', description: '预约申请、取消调整、审核进度与排期协调' },
    { key: 'fault', label: '设备维修员', description: '设备故障、维修处理、异常恢复与现场检查' },
    { key: 'usage', label: '值班管理员（紧急联系）', description: '紧急情况、现场协助、无法归类的问题' }
  ];
  const RESERVATION_SLOT_PRESETS = [
    { key: 'morning', label: '上午 8:00-12:00', start: '08:00', end: '12:00', type: 'base' },
    { key: 'afternoon', label: '下午 12:00-17:00', start: '12:00', end: '17:00', type: 'base' },
    { key: 'evening', label: '傍晚 17:00-22:00', start: '17:00', end: '22:00', type: 'base' },
    { key: 'night', label: '夜间 22:00-次日 8:00', start: '22:00', end: '08:00', crosses_midnight: true, type: 'base' },
    { key: 'daytime', label: '白天 8:00-22:00（14小时）', start: '08:00', end: '22:00', type: 'shortcut' }
  ];
  const DEFAULT_RESERVATION_SLOT_KEYS = RESERVATION_SLOT_PRESETS.map((item) => item.key);
  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

  function authTokenFromReq(req) {
    const bearer = req.headers.authorization || '';
    if (bearer.startsWith('Bearer ')) return bearer.slice(7);
    return req.body?.token || req.query?.token || '';
  }

  function parseDates(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new AppError('时间格式不正确。', { status: 400, code: 2001 });
    }
    if (end <= start) {
      throw new AppError('结束时间必须晚于开始时间。', { status: 400, code: 2001 });
    }
    if (start < new Date(Date.now() - 5 * 60_000)) {
      throw new AppError('不能预约已过去的时间段。', { status: 400, code: 3001 });
    }
    return { start, end };
  }

  function normalizeSlotTimeText(value, fallback = '') {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
    if (!match) return fallback;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function normalizeReservationSlotOption(item) {
    const raw = typeof item === 'string' ? { key: item } : (item || {});
    const rawKey = raw.key || raw.slot_key;
    const preset = RESERVATION_SLOT_PRESETS.find((slot) => slot.key === rawKey) || {};
    const key = String(rawKey || preset.key || '').trim();
    if (!key || !RESERVATION_SLOT_PRESETS.some((slot) => slot.key === key)) return null;
    const start = normalizeSlotTimeText(raw.start || raw.start_time, preset.start);
    const end = normalizeSlotTimeText(raw.end || raw.end_time, preset.end);
    return {
      ...preset,
      key,
      label: String(raw.label || preset.label || key).trim().slice(0, 80),
      start,
      end,
      crosses_midnight: raw.crosses_midnight === true || raw.crosses_day === true || (start && end && end <= start),
      type: raw.type || preset.type || 'base'
    };
  }

  function normalizeReservationSlotOptions(value, fallback = RESERVATION_SLOT_PRESETS) {
    let raw = value;
    if (typeof value === 'string') {
      try {
        raw = JSON.parse(value);
      } catch (_) {
        raw = value.split(',');
      }
    }
    const list = Array.isArray(raw) ? raw : [];
    const unique = [];
    for (const item of list) {
      const option = normalizeReservationSlotOption(item);
      if (option && !unique.some((slot) => slot.key === option.key)) unique.push(option);
    }
    return unique.length ? unique : fallback.map(normalizeReservationSlotOption).filter(Boolean);
  }

  function getReservationSlotPreset(key, devices = []) {
    for (const device of devices || []) {
      const option = normalizeReservationSlotOptions(device.reservation_slot_keys, []).find((item) => item.key === key);
      if (option) return option;
    }
    return RESERVATION_SLOT_PRESETS.find((item) => item.key === key) || null;
  }

  function reservationSlotTimesMatch(first = {}, second = {}) {
    const left = normalizeReservationSlotOption(first);
    const right = normalizeReservationSlotOption(second);
    if (!left || !right) return false;
    return left.key === right.key
      && left.start === right.start
      && left.end === right.end
      && Boolean(left.crosses_midnight) === Boolean(right.crosses_midnight);
  }

  function normalizeReservationSlotKeys(value, fallback = DEFAULT_RESERVATION_SLOT_KEYS) {
    const valid = normalizeReservationSlotOptions(value, []).map((slot) => slot.key);
    return valid.length ? valid : [...fallback];
  }

  function withReservationSlotOptions(device = {}) {
    const reservationSlotOptions = normalizeReservationSlotOptions(device.reservation_slot_keys);
    const reservationSlotKeys = reservationSlotOptions.map((slot) => slot.key);
    return {
      ...device,
      reservation_slot_keys: reservationSlotKeys,
      reservation_slot_options: reservationSlotOptions
    };
  }

  function addDaysToDateText(dateText, days) {
    const [year, month, day] = dateText.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
  }

  function slotToDateRange(dateText, slot) {
    const endDate = slot.crosses_midnight ? addDaysToDateText(dateText, 1) : dateText;
    return {
      key: slot.key,
      label: slot.label,
      ...parseDates(`${dateText}T${slot.start}:00+08:00`, `${endDate}T${slot.end}:00+08:00`)
    };
  }

  function assertNoOverlappingSlots(slots) {
    const sorted = [...slots].sort((a, b) => a.start - b.start);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].start < sorted[index - 1].end) {
        throw new AppError('选择的时间段存在重叠，请重新选择。', { status: 400, code: 2001 });
      }
    }
  }

  function buildReservationSlotsFromKeys(payload, devices = []) {
    const dateTexts = parseReservationDates(payload.reservation_dates || payload.reservationDates || payload.reservation_date || payload.reservationDate);
    if (!dateTexts.length) {
      throw new AppError('请选择预约日期。', { status: 400, code: 2001 });
    }

    const slotKeys = normalizeReservationSlotKeys(payload.slot_keys || payload.slotKeys, []);
    if (!slotKeys.length) {
      throw new AppError('请选择预约时间段。', { status: 400, code: 2001 });
    }

    for (const device of devices || []) {
      const allowedKeys = normalizeReservationSlotKeys(device.reservation_slot_keys);
      const blockedKey = slotKeys.find((key) => !allowedKeys.includes(key));
      if (blockedKey) {
        throw new AppError(`设备 ${device.device_code || ''} 不支持所选时间段，请重新选择。`, { status: 409, code: 3001 });
      }
    }

    for (const key of slotKeys) {
      const configuredSlots = (devices || [])
        .map((device) => normalizeReservationSlotOptions(device.reservation_slot_keys, []).find((slot) => slot.key === key))
        .filter(Boolean);
      const firstSlot = configuredSlots[0];
      const incompatibleSlot = firstSlot && configuredSlots.find((slot) => !reservationSlotTimesMatch(firstSlot, slot));
      if (incompatibleSlot) {
        throw new AppError(`所选设备的 ${key} 时间段不一致，请分开预约。`, { status: 409, code: 3001 });
      }
    }

    const slots = [];
    for (const dateText of dateTexts) {
      slots.push(...slotKeys.map((key) => slotToDateRange(dateText, getReservationSlotPreset(key, devices))));
    }
    assertNoOverlappingSlots(slots);
    return slots;
  }

  function parseReservationDates(value) {
    const raw = Array.isArray(value)
      ? value
      : String(value || '').split(/[\s,，、]+/);
    const dates = raw.map((item) => String(item || '').trim()).filter(Boolean);
    const unique = [...new Set(dates)];
    for (const dateText of unique) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
        throw new AppError(`预约日期格式不正确：${dateText}`, { status: 400, code: 2001 });
      }
    }
    return unique;
  }

  function parseReservationGroups(payload = {}) {
    const groups = Array.isArray(payload.reservation_groups)
      ? payload.reservation_groups
      : Array.isArray(payload.reservationGroups)
        ? payload.reservationGroups
        : null;
    if (groups && groups.length) return groups;
    return [payload];
  }

  function detectSlotKey(start, end) {
    const startTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(start);
    const endTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(end);
    const preset = RESERVATION_SLOT_PRESETS.find((slot) => slot.start === startTime && slot.end === endTime);
    return preset?.key || 'custom';
  }

  function reservationDateText(start) {
    return formatDateForTimezone(start, 'Asia/Shanghai');
  }

  function minimumReservationDateText() {
    const now = new Date();
    now.setDate(now.getDate() + 1);
    return formatDateForTimezone(now, 'Asia/Shanghai');
  }

  function parseReservationTimeSlot(value) {
    const text = String(value || '').trim();
    if (!text) {
      throw new AppError('请选择预约时间段。', { status: 400, code: 2001 });
    }
    const normalized = text.replace(/[~～]/g, '-').replace(/\s+/g, ' ');
    const match = normalized.match(/^(.*?)(?:\s+-\s+)(.*)$/);
    if (!match) {
      throw new AppError('时间段格式不正确。', { status: 400, code: 2001 });
    }
    const startRaw = match[1].trim().replace(' ', 'T');
    const endRaw = match[2].trim().replace(' ', 'T');
    return parseDates(startRaw, endRaw);
  }

  function parseReservationDevices(payload) {
    const deviceCodes = Array.isArray(payload.device_codes)
      ? payload.device_codes
      : Array.isArray(payload.deviceCodes)
        ? payload.deviceCodes
        : payload.device_code || payload.deviceCode
          ? [payload.device_code || payload.deviceCode]
          : [];
    const list = deviceCodes.map((item) => String(item || '').trim()).filter(Boolean);
    if (!list.length) {
      throw new AppError('请选择预约设备。', { status: 400, code: 2001 });
    }
    return [...new Set(list)];
  }

  function parseReservationSlots(payload, devices = []) {
    if (payload.reservation_date || payload.reservationDate || payload.slot_keys || payload.slotKeys) {
      return buildReservationSlotsFromKeys(payload, devices);
    }
    const rawSlots = Array.isArray(payload.time_slots)
      ? payload.time_slots
      : Array.isArray(payload.timeSlots)
        ? payload.timeSlots
        : payload.start_time && payload.end_time
          ? [`${payload.start_time} - ${payload.end_time}`]
          : [];
    const slots = rawSlots.map(parseReservationTimeSlot);
    if (!slots.length) {
      throw new AppError('请选择预约时间段。', { status: 400, code: 2001 });
    }
    assertNoOverlappingSlots(slots);
    return slots;
  }

  function escapeXml(value) {
    return String(value ?? '').replace(/[<>&'\"]/g, (char) => ({
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '\'': '&apos;',
      '"': '&quot;'
    }[char]));
  }

  function includePastReservations(params = {}) {
    return parseBoolean(params.include_past || params.includePast || params.show_all || params.showAll || params.all);
  }

  function currentReservationDateCondition(alias = 'r') {
    return `${alias}.end_time >= now()`;
  }

  function historicalReservationTimeCondition(alias = 'r') {
    return `${alias}.status = 'completed' and ${alias}.end_time < now()`;
  }

  function normalizeStaffContacts(value) {
    let raw = value;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch (_) {
        raw = [];
      }
    }
    const rows = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object'
        ? Object.entries(raw).map(([key, item]) => ({ ...(item && typeof item === 'object' ? item : {}), key }))
        : []);
    const byKey = new Map();
    for (const row of rows || []) {
      if (!row || typeof row !== 'object') continue;
      const key = String(row.key || row.type || '').trim();
      if (key) byKey.set(key, row);
    }
    return STAFF_CONTACT_PRESETS.map((preset) => {
      const item = byKey.get(preset.key) || {};
      const qrcodeUrl = String(item.qrcode_url || item.qr_url || item.qrcode || item.wechat_qrcode || '').trim();
      return {
        key: preset.key,
        label: preset.label,
        description: String(item.description || preset.description || '').trim().slice(0, 200),
        name: String(item.name || item.staff_name || item.person || '').trim().slice(0, 80),
        phone: String(item.phone || item.mobile || item.tel || '').trim().slice(0, 30),
        qrcode_url: qrcodeUrl && isSafeUrl(qrcodeUrl) ? qrcodeUrl.slice(0, 500) : '',
        enabled: Object.prototype.hasOwnProperty.call(item, 'enabled') ? parseBoolean(item.enabled) : true
      };
    });
  }

  function normalizeHost(host = '') {
    const text = String(host || '').trim().toLowerCase();
    if (text.startsWith('[')) {
      const end = text.indexOf(']');
      return end > 0 ? text.slice(1, end) : text.slice(1);
    }
    const parts = text.split(':');
    return parts.length === 2 ? parts[0] : text;
  }

  function isIpHost(host = '') {
    const normalized = normalizeHost(host);
    if (!normalized || ['localhost', '127.0.0.1', '::1'].includes(normalized)) return false;
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || /^[0-9a-f:]+$/i.test(normalized);
  }

  async function shouldBlockIpAccess(context = {}) {
    const config = await getSecurityConfig();
    return Boolean(config.block_ip_access_enabled && isIpHost(context.host || context.hostname || ''));
  }

  function parsePermissions(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    if (!value) return [];
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }

  function effectiveRolePermissions(role = {}) {
    const roleKey = String(role.role_key || role.role || '').trim();
    const explicit = parsePermissions(role.permissions);
    if (roleKey === 'super_admin' || explicit.includes('*')) return ['*'];
    // 5.0 只认可管理员记录中的显式权限，角色模板仅用于授权时的初始选择。
    return Object.prototype.hasOwnProperty.call(role, 'permissions') ? [...new Set(explicit)] : [];
  }

  function hasAnyPermission(role, allowedPermissions = []) {
    if (!allowedPermissions.length) return false;
    const permissions = effectiveRolePermissions(role);
    return permissions.includes('*') || allowedPermissions.some((permission) => permissions.includes(permission));
  }

  async function adminPermissionContextForUser(user = {}) {
    if (!user?.id || !['admin', 'super_admin'].includes(user.role)) {
      return { role: null, permissions: [], canAnnounce: false, canKick: false };
    }
    if (user.role === 'super_admin') {
      return { role: { role_key: 'super_admin', permissions: ['*'] }, permissions: ['*'], canAnnounce: true, canKick: true };
    }
    const role = await getAdminRoleForUser(user.id) || { role_key: user.role };
    const permissions = effectiveRolePermissions(role);
    return {
      role,
      permissions,
      canAnnounce: permissions.includes('*') || permissions.includes('chat.announce'),
      canKick: permissions.includes('*') || permissions.includes('chat.kick')
    };
  }

  function getClientKey(context = {}) {
    return String(
      context.clientKey
      || context.ip
      || context.fingerprint
      || context.userAgent
      || 'anonymous'
    ).slice(0, 200);
  }

  function calendarColor(seed = '') {
    const colors = ['#5d7f73', '#c59157', '#7c8fb5', '#b86f68', '#6e8f9e', '#8d7ab8', '#719f80', '#b9895f'];
    const text = String(seed || '');
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return colors[hash % colors.length];
  }

  function calendarRange(params = {}) {
    const startText = String(params.start || params.date_from || params.from || '').slice(0, 10);
    const endText = String(params.end || params.date_to || params.to || '').slice(0, 10);
    const now = new Date();
    const start = /^\d{4}-\d{2}-\d{2}$/.test(startText)
      ? new Date(`${startText}T00:00:00+08:00`)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = /^\d{4}-\d{2}-\d{2}$/.test(endText)
      ? new Date(`${endText}T23:59:59+08:00`)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    if (end < start) {
      return { start: start.toISOString(), end: new Date(start.getTime() + 31 * 24 * 60 * 60 * 1000).toISOString() };
    }
    const maxRangeDays = 370;
    const maxEnd = new Date(start.getTime() + maxRangeDays * 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: (end > maxEnd ? maxEnd : end).toISOString() };
  }

  function maskOpenId(openid) {
    const text = String(openid || '');
    if (text.length <= 8) return text;
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
  }

  async function query(sql, params = []) {
    const result = await db.query(sql, params);
    return result.rows || [];
  }

  function transactionClient(client) {
    return {
      query: (sql, params = []) => client.query(sql, params),
      queryOne: async (sql, params = []) => {
        const result = await client.query(sql, params);
        const rows = Array.isArray(result) ? result : (result.rows || []);
        return rows[0] || null;
      }
    };
  }

  async function withTransaction(work) {
    if (typeof db.transaction === 'function') {
      return db.transaction((client) => work(transactionClient(client)));
    }
    if (typeof db.pool?.connect !== 'function') {
      return work({ query, queryOne });
    }
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      const result = await work(transactionClient(client));
      await client.query('commit');
      return result;
    } catch (error) {
      try { await client.query('rollback'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function queryOne(sql, params = []) {
    const rows = await query(sql, params);
    return rows[0] || null;
  }

  async function getById(table, id) {
    return queryOne(`select * from ${table} where id = $1 limit 1`, [id]);
  }

  async function resolveReservationId(id) {
    const text = assertText(id, 'reservation_id', 60);
    const direct = await getById('reservations', text);
    if (direct) return text;
    const item = await queryOne('select reservation_id from reservation_items where id = $1 limit 1', [text]);
    if (item?.reservation_id) return item.reservation_id;
    return text;
  }

  async function getReservationItemById(id) {
    const text = assertText(id, 'reservation_item_id', 60);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return null;
    return queryOne(`
      select ri.*, d.device_code, d.name as device_name, d.status as device_status, d.allow_reservation,
        d.return_mode, d.return_require_note,
        b.purpose as batch_purpose, b.status as batch_status
      from reservation_items ri
      join devices d on d.id = ri.device_id
      join reservation_batches b on b.id = ri.batch_id
      where ri.id = $1
      limit 1
    `, [text]);
  }

  async function getDeviceByCode(code) {
    return queryOne('select * from devices where device_code = $1 limit 1', [code]);
  }

  async function mapById(table) {
    const rows = await query(`select * from ${table}`);
    const mapped = {};
    for (const row of rows || []) mapped[row.id] = row;
    return mapped;
  }

  let operationLogColumnsCache = null;

  async function getOperationLogColumns(runQuery = query) {
    if (operationLogColumnsCache) return operationLogColumnsCache;
    try {
      const rows = await rowsFrom(runQuery, `
        select column_name
        from information_schema.columns
        where table_schema = 'public' and table_name = 'operation_logs'
      `);
      const names = new Set((rows || []).map((row) => row.column_name));
      operationLogColumnsCache = names.size ? names : new Set([
        'id', 'action', 'detail', 'device_id', 'record_id', 'operator_id', 'operator_name', 'created_at'
      ]);
    } catch (_) {
      operationLogColumnsCache = new Set([
        'id', 'action', 'detail', 'device_id', 'record_id', 'operator_id', 'operator_name', 'created_at'
      ]);
    }
    return operationLogColumnsCache;
  }

  async function log(action, detail, operator = {}, deviceId = null, recordId = null, runQuery = query) {
    const detailPayload = typeof detail === 'object' && detail !== null ? detail : { message: String(detail || '') };
    const operatorId = operator.user_id || operator.id || null;
    const operatorName = operator.name || operator.role || 'system';
    const availableColumns = await getOperationLogColumns(runQuery);
    const valuesByColumn = {
      id: uuid(),
      action,
      detail: JSON.stringify(detailPayload),
      device_id: deviceId,
      record_id: recordId,
      target_type: recordId ? 'record' : (deviceId ? 'device' : null),
      target_id: recordId || deviceId || null,
      operator_id: operatorId,
      operator_name: operatorName,
      created_at: nowIso()
    };
    const columns = Object.keys(valuesByColumn).filter((name) => availableColumns.has(name));
    if (!columns.length) return;
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
    await runQuery(`insert into operation_logs (${columns.join(', ')}) values (${placeholders})`, columns.map((name) => valuesByColumn[name]));
  }

  async function rowsFrom(runQuery, sql, params = []) {
    const result = await runQuery(sql, params);
    return Array.isArray(result) ? result : (result.rows || []);
  }

  async function userNotificationsReady() {
    return true;
  }

  async function createUserNotification(payload = {}, runQuery = query) {
    if (!payload.user_id) return false;
    try {
      await runQuery(`
        insert into user_notifications (id, user_id, type, title, content, related_type, related_id, device_id, reservation_id, is_read, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10)
      `, [
        uuid(),
        payload.user_id,
        String(payload.type || 'system').slice(0, 50),
        String(payload.title || '系统提醒').slice(0, 120),
        String(payload.content || '').slice(0, 1500),
        payload.related_type ? String(payload.related_type).slice(0, 50) : null,
        payload.related_id || null,
        payload.device_id || null,
        payload.reservation_id || null,
        nowIso()
      ]);
      return true;
    } catch (error) {
      console.warn('写入用户通知失败：', error.message || error);
      return false;
    }
  }

  async function notifyReservationUsersForDevice(device, payload = {}, runQuery = query) {
    const deviceId = typeof device === 'string' ? device : device?.id;
    if (!deviceId || !(await userNotificationsReady())) return 0;
    const rows = await rowsFrom(runQuery, `
      select ri.id as reservation_item_id, ri.reservation_id, ri.user_id, ri.start_time, ri.end_time,
        d.device_code, d.name as device_name
      from reservation_items ri
      join devices d on d.id = ri.device_id
      where ri.device_id = $1
        and ri.status = any($2)
        and ri.end_time >= $3
      order by ri.start_time asc
    `, [deviceId, ['pending', 'approved', 'in_use'], nowIso()]);
    let sent = 0;
    for (const row of rows || []) {
      const okWritten = await createUserNotification({
        user_id: row.user_id,
        type: payload.type || 'device_status',
        title: payload.title || '设备状态提醒',
        content: String(payload.content || '')
          .replace(/\{device_code\}/g, row.device_code || '')
          .replace(/\{device_name\}/g, row.device_name || '')
          .replace(/\{time_range\}/g, compactDateTimeRangeForTimezone(row.start_time, row.end_time))
          .replace(/\{start_time\}/g, formatDateTimeForTimezone(row.start_time))
          .replace(/\{end_time\}/g, formatDateTimeForTimezone(row.end_time)),
        related_type: payload.related_type || (row.reservation_id ? 'reservation' : 'reservation_item'),
        related_id: payload.related_id || row.reservation_id || row.reservation_item_id,
        device_id: deviceId,
        // reservation_id has a foreign key to reservations(id), never reservation_items(id).
        reservation_id: row.reservation_id || null
      }, runQuery);
      if (okWritten) sent += 1;
    }
    return sent;
  }

  async function createReservationStatusNotification(row = {}, status, adminNote = '', runQuery = query) {
    // Review operations are performed on reservation items. Keep the item as the
    // related record, while writing reservation_id only when a parent reservation exists.
    const reservationId = row.reservation_id || null;
    const relatedId = reservationId || row.id || row.reservation_item_id || null;
    if (!row.user_id || !relatedId) return false;
    const approved = status === 'approved';
    const title = approved ? '预约审核已通过' : '预约审核未通过';
    const statusLine = approved ? '管理员已同意你的设备预约。' : '管理员已拒绝你的设备预约。';
    const deviceLabel = `${row.device_code || ''} ${row.device_name || ''}`.trim() || '预约设备';
    return createUserNotification({
      user_id: row.user_id,
      type: 'reservation_review',
      title,
      content: `${statusLine}设备：${deviceLabel}；预约时间：${compactDateTimeRangeForTimezone(row.start_time, row.end_time)}。${adminNote ? ` 管理员备注：${adminNote}` : ''}`,
      related_type: reservationId ? 'reservation' : 'reservation_item',
      related_id: relatedId,
      device_id: row.device_id || null,
      reservation_id: reservationId
    }, runQuery);
  }

  async function markDeviceFaultReportsResolved(deviceId, adminNote = '', admin = {}, runQuery = query) {
    if (!deviceId) return 0;
    const values = [
      'resolved',
      adminNote || '设备已恢复可预约，关联故障报备已同步处理。',
      nowIso(),
      deviceId,
      ['pending', 'processing']
    ];
    const sets = [
      'status = $1',
      "admin_note = case when coalesce(admin_note, '') = '' then $2 else admin_note end",
      'updated_at = $3',
      'resolved_at = coalesce(resolved_at, $3)'
    ];
    const adminId = admin?.user_id || admin?.id || null;
    if (adminId) {
      values.push(adminId);
      sets.push(`handled_by = coalesce(handled_by, $${values.length})`);
    }
    values.push(nowIso());
    sets.push(`handled_at = coalesce(handled_at, $${values.length})`);
    const result = await runQuery(
      `update device_fault_reports set ${sets.join(', ')} where device_id = $4 and status = any($5)`,
      values
    );
    return result.rowCount || 0;
  }

  async function recordUserEvent(payload = {}) {
    try {
      await query('insert into user_activity_logs (id, user_id, event_type, user_name, phone, wechat_openid, device_type, client_key, ip_address, remark, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [
        uuid(), payload.user_id || null, String(payload.event_type || 'unknown').slice(0, 50), String(payload.user_name || '').slice(0, 80), String(payload.phone || '').slice(0, 30), String(payload.wechat_openid || '').slice(0, 150), String(payload.device_type || '').slice(0, 40), String(payload.client_key || '').slice(0, 200), String(payload.ip_address || '').slice(0, 80), String(payload.remark || '').slice(0, 500), nowIso()
      ]);
    } catch (error) {
      console.warn('写入用户活动日志失败：', error.message || error);
    }
  }

  async function getSecurityConfig() {
    const rows = await query('select config_key, config_value from system_configs');
    const config = { ...DEFAULT_SECURITY_CONFIG };
    for (const row of rows || []) config[row.config_key] = row.config_value;
    return {
      captcha_expire_minutes: Number(config.captcha_expire_minutes) || DEFAULT_SECURITY_CONFIG.captcha_expire_minutes,
      captcha_hourly_limit: Number(config.captcha_hourly_limit) || DEFAULT_SECURITY_CONFIG.captcha_hourly_limit,
      openid_daily_register_limit: Number(config.openid_daily_register_limit) || DEFAULT_SECURITY_CONFIG.openid_daily_register_limit,
      enable_image_captcha: parseBoolean(config.enable_image_captcha),
      require_return_photo: parseBoolean(config.require_return_photo),
      block_ip_access_enabled: parseBoolean(config.block_ip_access_enabled),
      public_show_reserver_name: parseBoolean(config.public_show_reserver_name),
      public_show_reserver_phone: parseBoolean(config.public_show_reserver_phone),
      public_show_reserver_student_no: parseBoolean(config.public_show_reserver_student_no),
      site_domain: String(config.site_domain || '').trim(),
      system_notice_enabled: parseBoolean(config.system_notice_enabled),
      system_notice_title: String(config.system_notice_title || DEFAULT_SECURITY_CONFIG.system_notice_title),
      system_notice_content: String(config.system_notice_content || DEFAULT_SECURITY_CONFIG.system_notice_content),
      system_notice_version: String(config.system_notice_version || DEFAULT_SECURITY_CONFIG.system_notice_version),
      staff_contacts: normalizeStaffContacts(config.staff_contacts)
    };
  }

  async function getReportConfig() {
    const rows = await query('select config_key, config_value from system_configs');
    const config = { ...DEFAULT_REPORT_CONFIG };
    for (const row of rows || []) config[row.config_key] = row.config_value;
    return {
      admin_report_enabled: parseBoolean(config.admin_report_enabled),
      admin_report_hour: Math.min(23, Math.max(0, Number(config.admin_report_hour) || DEFAULT_REPORT_CONFIG.admin_report_hour)),
      admin_report_minute: Math.min(59, Math.max(0, Number(config.admin_report_minute) || DEFAULT_REPORT_CONFIG.admin_report_minute)),
      admin_report_timezone: String(config.admin_report_timezone || DEFAULT_REPORT_CONFIG.admin_report_timezone)
    };
  }

  async function getWechatConfig() {
    const rows = await query('select config_key, config_value from system_configs');
    const config = { ...DEFAULT_WECHAT_CONFIG };
    for (const row of rows || []) config[row.config_key] = row.config_value;
    return {
      wechat_token: String(config.wechat_token || DEFAULT_WECHAT_CONFIG.wechat_token || ''),
      wechat_app_id: String(config.wechat_app_id || DEFAULT_WECHAT_CONFIG.wechat_app_id || ''),
      wechat_app_secret: String(config.wechat_app_secret || DEFAULT_WECHAT_CONFIG.wechat_app_secret || ''),
      wechat_admin_openids: String(config.wechat_admin_openids || DEFAULT_WECHAT_CONFIG.wechat_admin_openids || '')
    };
  }

  async function getAdminAuthConfig() {
    const rows = await query('select config_key, config_value from system_configs');
    const config = {};
    for (const row of rows || []) config[row.config_key] = row.config_value;
    return {
      admin_password_hash: String(config.admin_password_hash || ''),
      admin_password_salt: String(config.admin_password_salt || ''),
      has_custom_admin_password: Boolean(config.admin_password_hash && config.admin_password_salt)
    };
  }

  async function getSystemNotice() {
    const config = await getSecurityConfig();
    return ok({
      notice: {
        enabled: config.system_notice_enabled,
        title: config.system_notice_title,
        content: config.system_notice_content,
        version: config.system_notice_version
      }
    });
  }

  async function getStaffContacts() {
    const config = await getSecurityConfig();
    return ok({ contacts: config.staff_contacts, presets: STAFF_CONTACT_PRESETS });
  }

  async function saveSystemConfig(configKey, configValue, description = '') {
    await query('insert into system_configs (id, config_key, config_value, description, created_at, updated_at) values ($1,$2,$3,$4,$5,$6) on conflict (config_key) do update set config_value = excluded.config_value, description = excluded.description, updated_at = excluded.updated_at', [
      uuid(), configKey, String(configValue), String(description || '').slice(0, 200), nowIso(), nowIso()
    ]);
  }

  function resolveServiceAuth(auth) {
    if (auth && typeof auth === 'object' && typeof auth.sub === 'string') {
      const role = String(auth.role || 'user');
      return {
        scope: auth.scope || (role === 'user' ? 'user' : 'admin'),
        role,
        user_id: auth.sub,
        id: auth.sub,
        admin_role_key: role === 'super_admin' ? 'super_admin' : undefined,
        permissions: Array.isArray(auth.perms) ? auth.perms : [],
        name: auth.name || ''
      };
    }
    const v5Auth = typeof auth === 'string' ? verifyJwt(auth, { type: 'access' }) : null;
    return v5Auth ? resolveServiceAuth(v5Auth) : null;
  }

  async function requireAdmin(token) {
    const payload = resolveServiceAuth(token);
    if (!payload) throw new AppError('未登录或登录已过期。', { status: 401, code: 1001 });
    if (payload.scope !== 'admin') {
      throw new AppError('没有访问权限。', { status: 403, code: 1003 });
    }
    if (!['admin', 'super_admin'].includes(payload.role) && !payload.admin_role_key) {
      throw new AppError('没有访问权限。', { status: 403, code: 1003 });
    }
    return payload;
  }

  async function getAdminRoleForUser(userId) {
    if (!userId) return null;
    return queryOne('select * from admin_roles where user_id = $1 limit 1', [userId]);
  }

  async function requireAdminRole(token, allowedRoleKeys = [], allowedPermissions = []) {
    const admin = await requireAdmin(token);
    if (admin.role === 'super_admin' || admin.admin_role_key === 'super_admin') {
      return { admin, role: { role_key: 'super_admin', permissions: ['*'] } };
    }
    const role = (admin.user_id || admin.id)
      ? await getAdminRoleForUser(admin.user_id || admin.id)
      : { role_key: admin.admin_role_key || admin.role, permissions: admin.permissions || [] };
    if (!role) throw new AppError('没有访问权限。', { status: 403, code: 1003 });
    const permissionAllowed = hasAnyPermission(role, allowedPermissions);
    if ((allowedRoleKeys.length || allowedPermissions.length) && !permissionAllowed) {
      throw new AppError('没有访问权限。', { status: 403, code: 1003 });
    }
    return { admin, role };
  }

  function userAccessMessage(user) {
    if (!user) return '请先登录后再操作。';
    if (user.is_banned) return '账号已被封禁，请联系管理员处理。';
    if (user.status === 'pending') return '账号正在等待管理员审核，审核通过后才可以预约设备。';
    if (user.status === 'rejected') return `账号审核未通过${user.disabled_reason ? `：${user.disabled_reason}` : '，请联系管理员处理。'}`;
    if (user.status === 'disabled') return '账号已停用，请联系管理员处理。';
    if (user.status !== 'active') return `账号状态为 ${user.status}，暂时无法预约设备。`;
    return '';
  }

  async function requireUser(token) {
    const payload = resolveServiceAuth(token);
    if (!payload || !payload.user_id) {
      throw new AppError('未登录或登录已过期。', { status: 401, code: 1001 });
    }

    const user = await getById('users', payload.user_id);
    if (!user || user.status !== 'active' || user.is_banned) {
      throw new AppError(userAccessMessage(user), { status: 403, code: 1003 });
    }
    return user;
  }

  async function checkConflictWithQuery(runQuery, deviceId, startTime, endTime, excludeReservationId = null) {
    const params = [deviceId, startTime, endTime];
    let reservationSql = `select id, start_time, end_time, status, 'reservation' as conflict_type from reservation_items where device_id = $1 and status = any($4) and start_time < $3 and end_time > $2`;
    params.push(activeReservationStatus);
    if (excludeReservationId) {
      reservationSql += ' and id <> $5 and coalesce(reservation_id, id) <> $5';
      params.push(excludeReservationId);
    }
    const maintenanceSql = `select id, start_time, end_time, status, 'maintenance' as conflict_type from device_maintenance_windows where device_id = $1 and status in ('scheduled','active') and start_time < $3 and end_time > $2`;
    return rowsFrom(runQuery, reservationSql + ' union all ' + maintenanceSql, params);
  }

  async function checkConflict(deviceId, startTime, endTime, excludeReservationId = null) {
    return checkConflictWithQuery(query, deviceId, startTime, endTime, excludeReservationId);
  }

  async function lockDeviceSchedule(client, deviceId) {
    await client.query("select pg_advisory_xact_lock(hashtext('idbs-device-schedule'), hashtext($1))", [String(deviceId)]);
  }

  async function checkConflictInTransaction(client, deviceId, startTime, endTime, excludeReservationId = null) {
    return checkConflictWithQuery((sql, params) => client.query(sql, params), deviceId, startTime, endTime, excludeReservationId);
  }

  function safeUser(user) {
    const { password_hash, password_salt, ...rest } = user;
    return {
      ...rest,
      wechat_openid_masked: rest.wechat_openid ? maskOpenId(rest.wechat_openid) : '',
      wechat_bound: !!rest.wechat_openid
    };
  }

  async function addNamesToReservations(rows) {
    const users = await mapById('users');
    const devices = await mapById('devices');
    return rows.map((row) => ({
      ...row,
      user_name: users[row.user_id]?.name || '',
      user_phone: users[row.user_id]?.phone || '',
      user_student_no: users[row.user_id]?.student_no || '',
      device_code: devices[row.device_id]?.device_code || '',
      device_name: devices[row.device_id]?.name || '',
      device_status: devices[row.device_id]?.status || '',
      device_allow_reservation: devices[row.device_id]?.allow_reservation ?? null,
      device_unavailable: Boolean(devices[row.device_id] && (!devices[row.device_id].allow_reservation || ['abnormal_pending', 'maintenance', 'disabled'].includes(devices[row.device_id].status)))
    }));
  }

  async function addNamesToBorrowRows(rows) {
    const users = await mapById('users');
    const devices = await mapById('devices');
    const config = await getSecurityConfig();
    const labelMap = { confirm_only: '确认归还', image_optional: '图片选传', image_required: '图片必传' };
    return rows.map((row) => {
      const mode = devices[row.device_id]?.return_mode || (config.require_return_photo ? 'image_required' : 'image_optional');
      return {
        ...row,
        user_name: users[row.user_id]?.name || '',
        user_phone: users[row.user_id]?.phone || '',
        user_student_no: users[row.user_id]?.student_no || '',
        device_code: devices[row.device_id]?.device_code || '',
        device_name: devices[row.device_id]?.name || '',
        return_mode: mode,
        return_require_note: Boolean(devices[row.device_id]?.return_require_note),
        return_photo_required: mode === 'image_required' || Boolean(config.require_return_photo && mode !== 'confirm_only'),
        return_rule_label: labelMap[mode] || '图片选传'
      };
    });
  }

  async function getReservationVisibilityConfig() {
    const config = await getSecurityConfig();
    return {
      showName: config.public_show_reserver_name,
      showPhone: config.public_show_reserver_phone,
      showStudentNo: config.public_show_reserver_student_no
    };
  }

  function applyReservationVisibility(row, visibility, forceVisible = false) {
    if (!row) return null;
    const visible = forceVisible ? { showName: true, showPhone: true, showStudentNo: true } : visibility;
    return {
      ...row,
      user_name: visible.showName ? row.user_name : '',
      user_phone: visible.showPhone ? row.user_phone : '',
      user_student_no: visible.showStudentNo ? row.user_student_no : ''
    };
  }

  function canCancelReservation(row, timeZone = 'Asia/Shanghai') {
    if (!row || !['pending', 'approved'].includes(row.status)) return false;
    const today = formatDateForTimezone(new Date(), timeZone);
    const reservationDay = formatDateForTimezone(new Date(row.start_time), timeZone);
    return reservationDay > today;
  }

  async function addReservationSnapshotsToDevices(devices, options = {}) {
    const visibility = options.fullAccess
      ? { showName: true, showPhone: true, showStudentNo: true }
      : await getReservationVisibilityConfig();
    const rows = [];
    const currentStatuses = ['in_use', 'abnormal_pending', 'overdue'];
    const referenceTime = nowIso();
    for (const device of devices || []) {
      const currentRows = await query('select * from borrow_records where device_id = $1 and status = any($2) order by borrow_time desc limit 1', [device.id, currentStatuses]);
      const reservationRows = await query('select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id from reservation_items ri where ri.device_id = $1 and ri.status = any($2) and ri.end_time >= $3 order by ri.start_time asc limit 1', [device.id, activeReservationStatus, referenceTime]);
      const lastRows = await query('select * from borrow_records where device_id = $1 and return_time is not null order by return_time desc limit 1', [device.id]);
      const namedCurrent = await addNamesToBorrowRows(currentRows || []);
      const namedReservations = await addNamesToReservations(reservationRows || []);
      const namedLast = await addNamesToBorrowRows(lastRows || []);
      rows.push({
        ...withReservationSlotOptions(device),
        current_borrow: applyReservationVisibility(namedCurrent[0], visibility, options.fullAccess),
        next_reservation: applyReservationVisibility(namedReservations[0], visibility, options.fullAccess),
        last_record: applyReservationVisibility(namedLast[0], visibility, options.fullAccess)
      });
    }
    return rows;
  }

  async function appendUsageLog(action, record, user, device, extra = {}, runQuery = query) {
    try {
      await runQuery('insert into usage_log (id, record_id, reservation_id, reservation_item_id, device_id, user_id, action, device_code, device_name, user_name, user_phone, user_student_no, borrow_time, expected_return_time, return_time, duration_minutes, record_status, return_condition, return_note, operator_name, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)', [
        uuid(), record.id, record.reservation_id || null, record.reservation_item_id || null, device?.id || record.device_id || null, user?.id || record.user_id || null, String(action || '').slice(0, 20), String(device?.device_code || '').slice(0, 80), String(device?.name || '').slice(0, 120), String(user?.name || '').slice(0, 80), String(user?.phone || '').slice(0, 30), String(user?.student_no || '').slice(0, 50), record.borrow_time || null, record.expected_return_time || null, record.return_time || null, Number(record.duration_minutes) || null, String(record.status || '').slice(0, 40), String(record.return_condition || '').slice(0, 50), String(record.return_note || '').slice(0, 500), String(extra.operator_name || user?.name || '').slice(0, 80), nowIso()
      ]);
    } catch (error) {
      console.warn('写入使用日志失败：', error.message || error);
    }
  }

  async function finalizeUserLogin(user, context = {}) {
    await query('update users set last_login_at = $1, updated_at = $1 where id = $2', [nowIso(), user.id]);
    const adminRole = await getAdminRoleForUser(user.id);
    const adminRoleKey = adminRole ? String(adminRole.role_key || 'admin') : '';
    // The account role is the authority source. Do not flatten the unique super_admin into an ordinary admin during login.
    const tokenRole = user.role === 'super_admin' ? 'super_admin' : (adminRole ? 'admin' : user.role);
    const token = makeToken({
      scope: 'user',
      user_id: user.id,
      role: tokenRole,
      admin_role_key: adminRoleKey || undefined,
      permissions: adminRole ? effectiveRolePermissions(adminRole) : undefined,
      name: user.name
    }, 7);
    await recordUserEvent({
      user_id: user.id,
      user_name: user.name,
      phone: user.phone,
      wechat_openid: user.wechat_openid,
      event_type: 'login',
      device_type: context.deviceType || '',
      client_key: getClientKey(context),
      ip_address: context.ip || '',
      remark: context.remark || ''
    });
    return ok({
      token,
      role: tokenRole,
      admin_role_key: adminRoleKey,
      permissions: adminRole ? effectiveRolePermissions(adminRole) : [],
      device_type: context.deviceType || null,
      user: { ...safeUser({ ...user, role: tokenRole, last_login_at: nowIso() }), admin_role_key: adminRoleKey }
    });
  }

  async function myRecords(_, token) {
    const user = await requireUser(token);
    const reservations = await query(`
      select ri.*, ri.id as item_id, ri.reservation_id as id,
        b.purpose, b.device_codes, b.time_slots, b.status as batch_status, b.created_at as batch_created_at,
        d.device_code, d.name as device_name, d.category as device_category, d.location as device_location,
        u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from reservation_items ri
      join reservation_batches b on b.id = ri.batch_id
      join devices d on d.id = ri.device_id
      join users u on u.id = ri.user_id
      where ri.user_id = $1
      order by ri.start_time desc, ri.created_at desc
    `, [user.id]);
    const borrows = await query('select * from borrow_records where user_id = $1 order by borrow_time desc', [user.id]);
    const config = await getSecurityConfig();
    return ok({
      reservations: (reservations || []).map((row) => ({ ...row, can_cancel: canCancelReservation(row) })),
      borrows: await addNamesToBorrowRows(borrows || []),
      require_return_photo: config.require_return_photo
    });
  }

  async function adminGetActivitySummary(_, token) {
    await requireAdmin(token);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const rows = await query('select * from user_activity_logs where created_at >= $1 order by created_at desc', [dayStart.toISOString()]);
    return ok({ summary: { registered_today: rows.filter((item) => item.event_type === 'register').length, logged_in_today: rows.filter((item) => item.event_type === 'login').length, wechat_bind_today: rows.filter((item) => item.event_type === 'wechat_bind').length, wechat_scan_today: rows.filter((item) => item.event_type === 'wechat_scan').length }, rows: rows.slice(0, 50) });
  }

  const analyticsService = createAnalyticsService({ addNamesToBorrowRows, ok, query, requireAdminRole });
  const { adminAnalyticsDeviceUsage, adminAnalyticsFaults, adminAnalyticsIntelligence, adminAnalyticsOverview, adminAnalyticsTimeHeatmap, adminListIntelligenceActionLogs, adminUpdateIntelligenceAction, usageStats } = analyticsService;

  async function adminExportData(payload = {}, token) {
    const { admin, role } = await requireAdminRole(token, ['super_admin'], ['stats.export']);
    const type = String(payload.type || 'usage').trim();
    const exportPermissionRules = {
      usage: { all: ['stats.export'] },
      returns: { all: ['stats.export'], any: ['return.export', 'return.view', 'return.confirm', 'return.image_review'] },
      reservations: { all: ['stats.export'], any: ['reservation.view', 'reservation.approve', 'reservation.change_plan'] },
      faults: { all: ['stats.export'], any: ['device.view', 'fault.manage', 'return.view', 'return.confirm', 'return.image_review'] },
      user_activity: { all: ['stats.export', 'user.manage'] },
      device_summary: { all: ['stats.export'], any: ['device.view', 'device.manage'] },
      audit_logs: { all: ['stats.export', 'audit.view'] }
    };
    const exportRule = exportPermissionRules[type];
    if (!exportRule) return fail('不支持的导出类型。', 400, 2001);
    const permissions = effectiveRolePermissions(role || {});
    const hasExportAccess = admin.role === 'super_admin' || permissions.includes('*')
      || ((exportRule.all || []).every((permission) => permissions.includes(permission))
        && (!(exportRule.any || []).length || exportRule.any.some((permission) => permissions.includes(permission))));
    if (!hasExportAccess) return fail('当前账号没有该导出类型所需权限。', 403, 1003);
    const { user_id: userId, device_id: deviceId, start_date: startDate, end_date: endDate } = payload;
    const params = [];
    const clauses = [];
    const addRange = (column) => {
      if (startDate) { params.push(new Date(startDate).toISOString()); clauses.push(`${column} >= $${params.length}`); }
      if (endDate) { const end = new Date(endDate); end.setDate(end.getDate() + 1); params.push(end.toISOString()); clauses.push(`${column} < $${params.length}`); }
    };
    const whereSql = () => clauses.length ? ` where ${clauses.join(' and ')}` : '';

    if (type === 'usage') {
      const result = await usageStats(payload, token);
      return ok({ type, rows: result.rows || [], summary: result.summary || {} });
    }
    if (type === 'returns') {
      if (userId) { params.push(userId); clauses.push(`b.user_id = $${params.length}`); }
      if (deviceId) { params.push(deviceId); clauses.push(`b.device_id = $${params.length}`); }
      addRange('coalesce(b.return_time, b.actual_end_time, b.borrow_time, b.created_at)');
      const rows = await query(`
        select b.*, d.device_code, d.name as device_name,
          u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
        from borrow_records b
        left join devices d on d.id = b.device_id
        left join users u on u.id = b.user_id
        ${whereSql()}
        order by coalesce(b.return_time, b.actual_end_time, b.borrow_time, b.created_at) desc
        limit 5000
      `, params);
      return ok({ type, rows: rows || [] });
    }
    if (type === 'reservations') {
      if (userId) { params.push(userId); clauses.push(`ri.user_id = $${params.length}`); }
      if (deviceId) { params.push(deviceId); clauses.push(`ri.device_id = $${params.length}`); }
      addRange('ri.start_time');
      const rows = await query(`
        select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id,
          b.purpose, b.status as batch_status,
          d.device_code, d.name as device_name,
          u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
        from reservation_items ri
        join reservation_batches b on b.id = ri.batch_id
        join devices d on d.id = ri.device_id
        join users u on u.id = ri.user_id
        ${whereSql()}
        order by ri.start_time desc
        limit 5000
      `, params);
      return ok({ type, rows: rows || [] });
    }
    if (type === 'faults') {
      if (userId) { params.push(userId); clauses.push(`f.user_id = $${params.length}`); }
      if (deviceId) { params.push(deviceId); clauses.push(`f.device_id = $${params.length}`); }
      addRange('f.created_at');
      const rows = await query(`
        select f.*, d.device_code, d.name as device_name, u.name as user_name, u.phone as user_phone
        from device_fault_reports f
        left join devices d on d.id = f.device_id
        left join users u on u.id = f.user_id
        ${whereSql()}
        order by f.created_at desc
        limit 5000
      `, params);
      return ok({ type, rows: rows || [] });
    }
    if (type === 'user_activity') {
      if (userId) { params.push(userId); clauses.push(`user_id = $${params.length}`); }
      addRange('created_at');
      const rows = await query(`select * from user_activity_logs${whereSql()} order by created_at desc limit 5000`, params);
      return ok({ type, rows: rows || [] });
    }
    if (type === 'device_summary') {
      const rows = await adminAnalyticsDeviceUsage({ metric: 'borrow_count' }, token);
      return ok({ type, rows: rows.rows || [] });
    }
    if (type === 'audit_logs') {
      if (deviceId) { params.push(deviceId); clauses.push(`device_id = $${params.length}`); }
      addRange('created_at');
      const rows = await query(`
        select id, operator_id, operator_name, action, target_type, target_id, device_id, record_id,
          detail::text as detail, ip_address, created_at
        from operation_logs
        ${whereSql()}
        order by created_at desc
        limit 5000
      `, params);
      return ok({ type, rows: rows || [] });
    }
    return fail('不支持的导出类型。', 400, 2001);
  }

  const deviceReadService = createDeviceReadService({
    activeReservationStatus,
    addReservationSnapshotsToDevices,
    applyReservationVisibility,
    assertText,
    DEFAULT_RESERVATION_SLOT_KEYS,
    fail,
    getById,
    getDeviceByCode,
    getReservationVisibilityConfig,
    normalizeReservationSlotOptions,
    normalizeReservationSlotKeys,
    nowIso,
    ok,
    query,
    queryOne,
    requireAdminRole,
    RESERVATION_SLOT_PRESETS
  });
  const { adminListDevices, getDeviceDetail, getDeviceTimeSlots, getReservationSlotOptions, listDevices } = deviceReadService;

  const deviceAdminService = createDeviceAdminService({
    addNamesToBorrowRows,
    assertText,
    effectiveRolePermissions,
    fail,
    getById,
    isSafeUrl,
    log,
    markDeviceFaultReportsResolved,
    normalizeReservationSlotOptions,
    normalizeReservationSlotKeys,
    notifyReservationUsersForDevice,
    nowIso,
    ok,
    query,
    requireAdminRole,
    uuid,
    withReservationSlotOptions,
    withTransaction
  });
  const { adminCreateDevice, adminGetDeviceDetail, adminSetDeviceAvailable, adminUpdateDevice } = deviceAdminService;

  const exportService = createExportService({ adminExportData, effectiveRolePermissions, fail, log, nowIso, ok, query, queryOne, requireAdminRole, safeFilename, uploadDir, uuid, withTransaction });
  const { adminCreateExportJob, adminGetExportJobDownload, adminListExportJobs, adminRunNextExportJob } = exportService;

  const dashboardService = createDashboardService({ currentReservationDateCondition, ok, query, queryOne, requireAdminRole });
  const { adminDashboard } = dashboardService;

  const authService = createAuthService({ adminPassword, assertPassword, assertPhone, assertText, fail, finalizeUserLogin, getAdminAuthConfig, hashPassword, makeToken, needsPasswordRehash, ok, query, queryOne, verifyPassword, verifySecret, userAccessMessage });
  const { adminLogin, loginUser, registerUser } = authService;

  const adminSystemService = createAdminSystemService({
    assertText,
    crypto,
    DEFAULT_SECURITY_CONFIG,
    fail,
    getAdminAuthConfig,
    getAdminRoleForUser,
    getById,
    getReportConfig,
    getSecurityConfig,
    getWechatConfig,
    hashPassword,
    log,
    normalizeStaffContacts,
    nowIso,
    ok,
    parseBoolean,
    PERMISSION_KEYS,
    PERMISSION_OPTIONS,
    query,
    requireAdminRole,
    ROLE_PERMISSIONS,
    permissionModules,
    saveSystemConfig,
    uuid,
    withTransaction
  });
  const { adminGetSecurityConfig, adminListRoles, adminOperationLogs, adminOptions, adminPermissions, adminRevokeRole, adminUpdateSecurityConfig, adminUpsertRole, adminUserRoles } = adminSystemService;

  const chatService = createChatService({
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
    realtimePublisher,
    requireUser,
    rowsFrom,
    uuid,
    resolveServiceAuth,
    withTransaction
  });
  const { addChatParticipants, addUserToManagementGroup, bootstrapSystem, canSubscribeChatChannel, createChatConversation, dissolveChatConversation, leaveChatConversation, listChatConversations, listChatMessages, listChatUsers, markChatConversationRead, removeChatParticipant, removeUserFromManagementGroup, resolveRealtimePrincipal, sendChatMessage, streamChatEvents } = chatService;

  const wechatService = createWechatService({
    assertPhone,
    assertText,
    crypto,
    escapeXml,
    fail,
    finalizeUserLogin,
    getClientKey,
    getSecurityConfig,
    getWechatConfig,
    hashPassword,
    maskOpenId,
    nowIso,
    ok,
    query,
    queryOne,
    recordUserEvent,
    safeUser,
    sha256,
    shouldBlockIpAccess,
    userAccessMessage,
    uuid
  });
  const { bindWechatAccount, buildWechatReply, createLoginChallenge, getLoginChallengeStatus, handleWechatMessage, verifyWechatHandshake } = wechatService;

  const wechatPushService = createWechatPushService({
    assertText,
    fetch,
    formatDateForTimezone,
    formatDateTimeForTimezone,
    getReportConfig,
    getWechatConfig,
    maskOpenId,
    nowIso,
    ok,
    query,
    requireAdminRole,
    uuid
  });
  const { adminPreviewDailyUsageReport, adminSendDailyUsageReport, pushDailyUsageReport, sendWechatCustomMessage } = wechatPushService;

  const userService = createUserService({
    addNamesToBorrowRows,
    addUserToManagementGroup,
    assertText,
    createUserNotification,
    db,
    fail,
    getById,
    log,
    nowIso,
    ok,
    parseBoolean,
    query,
    queryOne,
    removeUserFromManagementGroup,
    requireAdminRole,
    requireUser,
    safeUser,
    withTransaction
  });
  const { adminDeleteUser, adminGetUserDetail, adminListUsers, adminSetUserBan, adminSetUserStatus, adminUnbindWechat, getProfile, listMyNotifications, markMyNotificationsRead } = userService;

  const faultRequestService = createFaultRequestService({
    assertText,
    createUserNotification,
    fail,
    getById,
    getDeviceByCode,
    lockDeviceSchedule,
    log,
    markDeviceFaultReportsResolved,
    notifyReservationUsersForDevice,
    nowIso,
    ok,
    parseBoolean,
    query,
    requireAdminRole,
    requireUser,
    uuid,
    withTransaction
  });
  const { adminListFaultReports, adminListUserRequests, adminResolveFaultReport, adminReviewUserRequest, cancelUserRequest, createUserRequest, listMyFaultReports, listMyUserRequests, reportDeviceFault, requestUserRequestChange, updateUserRequest } = faultRequestService;

  const maintenanceService = createMaintenanceService({
    assertText, checkConflictInTransaction, createUserNotification, fail, getById, lockDeviceSchedule, log, nowIso, ok, parseBoolean, query, requireAdminRole, uuid, withTransaction
  });
  const { adminCreateMaintenancePlan, adminCreateMaintenanceWorkOrder, adminListMaintenancePlans, adminListMaintenanceWorkOrders, adminMaintenanceOverview, adminUpdateMaintenancePlan, adminUpdateMaintenanceWorkOrder, runMaintenanceWindowLifecycle } = maintenanceService;

  const reservationReadService = createReservationReadService({
    activeReservationStatus,
    addNamesToReservations,
    applyReservationVisibility,
    assertText,
    calendarColor,
    calendarRange,
    currentReservationDateCondition,
    fail,
    getById,
    getReservationVisibilityConfig,
    historicalReservationTimeCondition,
    includePastReservations,
    nowIso,
    ok,
    query,
    queryOne,
    requireAdminRole,
    requireUser
  });
  const { adminGetReservationBatch, adminListReservationBatches, adminListReservations, getCalendarDay, getCalendarEvents, getReservationBatch, listReservationBatches } = reservationReadService;

  const reservationActionService = createReservationActionService({
    assertText,
    canCancelReservation,
    checkConflict,
    checkConflictInTransaction,
    createReservationStatusNotification,
    detectSlotKey,
    fail,
    getById,
    getDeviceByCode,
    getReservationItemById,
    lockDeviceSchedule,
    log,
    minimumReservationDateText,
    nowIso,
    ok,
    parseBoolean,
    parseReservationDevices,
    parseReservationGroups,
    parseReservationSlots,
    query,
    requireAdminRole,
    requireUser,
    reservationDateText,
    resolveReservationId,
    rowsFrom,
    uuid,
    withTransaction
  });
  const { adminApproveReservation, adminApproveReservationBatch, adminBulkApproveReservations, adminChangeReservationPlan, adminMarkReservationNoShow, adminReviewReservationCancellation, cancelReservation, cancelReservationItem, createReservation, precheckReservation } = reservationActionService;

  const borrowReturnService = createBorrowReturnService({
    appendUsageLog,
    assertText,
    durationMinutes,
    fail,
    getById,
    getReservationItemById,
    getSecurityConfig,
    log,
    notifyReservationUsersForDevice,
    nowIso,
    ok,
    query,
    requireAdminRole,
    requireUser,
    safeFilename,
    uploadDir,
    uuid,
    withTransaction
  });
  const { adminListReturnTasks, adminReviewReturn, extendBorrow, startUse, submitReturn } = borrowReturnService;

  const reservationReminderService = createReservationReminderService({ createUserNotification, nowIso, query, uuid });
  const { runReservationReminderLifecycle } = reservationReminderService;

  // v5 桥接：把 JWT payload 转 2.x makeToken，供 v5 路由复用 2.x service 方法。
  // auth: { sub, scope, role, perms, name }


  return { runReservationReminderLifecycle, adminAnalyticsDeviceUsage, adminListReturnTasks, adminReviewReturn, adminCreateMaintenancePlan, adminCreateMaintenanceWorkOrder, adminListMaintenancePlans, adminListMaintenanceWorkOrders, adminMaintenanceOverview, adminUpdateMaintenancePlan, adminUpdateMaintenanceWorkOrder, adminAnalyticsFaults, adminAnalyticsIntelligence, adminAnalyticsOverview, adminAnalyticsTimeHeatmap, adminListIntelligenceActionLogs, adminUpdateIntelligenceAction, adminApproveReservation, adminApproveReservationBatch, adminBulkApproveReservations, adminChangeReservationPlan, adminMarkReservationNoShow, adminReviewReservationCancellation, adminCreateDevice, adminCreateExportJob, adminGetExportJobDownload, adminDashboard, adminDeleteUser, adminExportData, adminGetActivitySummary, adminGetDeviceDetail, adminGetReservationBatch, adminGetSecurityConfig, adminGetUserDetail, adminListDevices, adminListExportJobs, adminListReservationBatches, adminListReservations, adminListRoles, adminListUsers, adminLogin, adminOperationLogs, adminOptions, adminPermissions, adminPreviewDailyUsageReport, adminRunNextExportJob, adminSendDailyUsageReport, adminRevokeRole, adminSetDeviceAvailable, adminSetUserBan, adminSetUserStatus, adminUnbindWechat, adminUpdateDevice, adminUpdateSecurityConfig, adminUpsertRole, adminUserRoles, adminListFaultReports, adminResolveFaultReport, adminListUserRequests, adminReviewUserRequest, addChatParticipants, authTokenFromReq, bindWechatAccount, bootstrapSystem, buildWechatReply, canSubscribeChatChannel, cancelReservation, cancelReservationItem, cancelUserRequest, createChatConversation, createLoginChallenge, createReservation, createUserRequest, dissolveChatConversation, leaveChatConversation, getCalendarDay, getCalendarEvents, getReportConfig, getDeviceDetail, getDeviceTimeSlots, getLoginChallengeStatus, getProfile, getReservationBatch, getReservationSlotOptions, getSystemNotice, getStaffContacts, handleWechatMessage, listChatConversations, listChatMessages, listChatUsers, listDevices, listMyNotifications, listMyFaultReports, listMyUserRequests, listReservationBatches, loginUser, markChatConversationRead, markMyNotificationsRead, myRecords, precheckReservation, registerUser, removeChatParticipant, reportDeviceFault, requestUserRequestChange, resolveRealtimePrincipal, safeFilename, sendChatMessage, sendWechatCustomMessage, shouldBlockIpAccess, extendBorrow, startUse, streamChatEvents, submitReturn, pushDailyUsageReport, runMaintenanceWindowLifecycle, updateUserRequest, usageStats, verifyWechatHandshake };
}

module.exports = { createRentalService };


