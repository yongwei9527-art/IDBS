const { AppError } = require('../lib/app-error');

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
    activeReservationStatus = ['pending', 'approved', 'in_use']
  } = options;

  const allowedDeviceUpdateFields = new Set([
    'device_code',
    'name',
    'category',
    'location',
    'manager',
    'status',
    'allow_reservation',
    'description',
    'usage_notice',
    'cover_photo',
    'instruction_photos',
    'last_return_photo',
    'last_return_user',
    'last_return_time',
    'last_condition'
  ]);

  const challengeStore = new Map();

  const DEFAULT_SECURITY_CONFIG = {
    captcha_expire_minutes: 3,
    captcha_hourly_limit: 3,
    openid_daily_register_limit: 1,
    enable_image_captcha: 0,
    require_return_photo: 1,
    public_show_reserver_name: 1,
    public_show_reserver_phone: 1,
    public_show_reserver_student_no: 0,
    system_notice_enabled: 1,
    system_notice_title: '使用注意事项',
    system_notice_content: '请按预约时间使用设备，归还前确认设备状态并按要求提交归还信息。',
    system_notice_version: '1'
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
  const MAX_REPORT_PUSH_ROWS = 25;
  const MAX_WECHAT_TEXT_LENGTH = 1800;

  function ok(data = {}) { return { ok: true, ...data }; }
  function fail(message, status = 400, code) { return { ok: false, status, code, message }; }
  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
  function nowIso() { return new Date().toISOString(); }
  function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
  function hashPassword(password, salt) { return sha256(`${salt}:${password}`); }
  function base64url(value) { return Buffer.from(value).toString('base64url'); }
  function sign(value) { return crypto.createHmac('sha256', tokenSecret).update(value).digest('base64url'); }

  function makeToken(payload, days = 7) {
    const full = { ...payload, exp: Date.now() + days * 86400_000 };
    const body = base64url(JSON.stringify(full));
    return `${body}.${sign(body)}`;
  }

  function verifyToken(token) {
    if (!token || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    if (sign(body) !== sig) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (!payload.exp || payload.exp < Date.now()) return null;
      return payload;
    } catch (_) {
      return null;
    }
  }

  function authTokenFromReq(req) {
    const bearer = req.headers.authorization || '';
    if (bearer.startsWith('Bearer ')) return bearer.slice(7);
    return req.body.token || req.query.token || '';
  }

  function assertText(value, label, max = 200) {
    const text = String(value || '').trim();
    if (!text) throw new AppError(`${label} is required`, { status: 400, code: 2001 });
    if (text.length > max) throw new AppError(`${label} is too long`, { status: 400, code: 2001 });
    return text;
  }

  function assertPhone(value) {
    const phone = assertText(value, 'phone', 20);
    if (!/^\+?[0-9-]{6,20}$/.test(phone)) {
      throw new AppError('Invalid phone format', { status: 400, code: 2001 });
    }
    return phone;
  }

  function assertOptionalEmail(value) {
    const email = String(value || '').trim();
    if (!email) return '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError('Invalid email format', { status: 400, code: 2001 });
    }
    return email.slice(0, 120);
  }

  function assertPassword(value) {
    const password = assertText(value, 'password', 100);
    if (password.length < 6) {
      throw new AppError('Password must be at least 6 characters', { status: 400, code: 2001 });
    }
    return password;
  }

  function safeFilename(name) {
    return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  function isSafeUrl(url) {
    const text = String(url || '').trim();
    return /^https?:\/\//i.test(text) || text.startsWith('/uploads/');
  }

  function parseDates(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new AppError('Invalid datetime format', { status: 400, code: 2001 });
    }
    if (end <= start) {
      throw new AppError('end_time must be later than start_time', { status: 400, code: 2001 });
    }
    if (start < new Date(Date.now() - 5 * 60_000)) {
      throw new AppError('Cannot reserve a past time range', { status: 400, code: 3001 });
    }
    return { start, end };
  }

  function durationMinutes(start, end) {
    return Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
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

  function parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
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

  function maskOpenId(openid) {
    const text = String(openid || '');
    if (text.length <= 8) return text;
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
  }

  function makeChallengeCode() {
    return String(Math.floor(10000 + Math.random() * 90000));
  }

  function cleanupExpiredChallenges() {
    const now = Date.now();
    for (const [code, item] of challengeStore.entries()) {
      if (!item || item.expire_at <= now || item.used_at) {
        challengeStore.delete(code);
      }
    }
  }

  async function query(sql, params = []) {
    const result = await db.query(sql, params);
    return result.rows || [];
  }

  async function queryOne(sql, params = []) {
    const rows = await query(sql, params);
    return rows[0] || null;
  }

  async function getById(table, id) {
    return queryOne(`select * from ${table} where id = $1 limit 1`, [id]);
  }

  async function getDeviceByCode(code) {
    return queryOne('select * from devices where device_code = $1 limit 1', [code]);
  }

  async function getUserByOpenId(openid) {
    return queryOne('select * from users where wechat_openid = $1 limit 1', [openid]);
  }

  async function mapById(table) {
    const rows = await query(`select * from ${table}`);
    const mapped = {};
    for (const row of rows || []) mapped[row.id] = row;
    return mapped;
  }

  async function log(action, detail, operator = {}, deviceId = null, recordId = null) {
    await query('insert into operation_logs (id, action, detail, device_id, record_id, operator_id, operator_name, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)', [
      uuid(), action, detail || '', deviceId, recordId, operator.user_id || operator.id || null, operator.name || operator.role || 'system', nowIso()
    ]);
  }

  async function recordUserEvent(payload = {}) {
    try {
      await query('insert into user_activity_logs (id, user_id, event_type, user_name, phone, wechat_openid, device_type, client_key, ip_address, remark, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [
        uuid(), payload.user_id || null, String(payload.event_type || 'unknown').slice(0, 50), String(payload.user_name || '').slice(0, 80), String(payload.phone || '').slice(0, 30), String(payload.wechat_openid || '').slice(0, 150), String(payload.device_type || '').slice(0, 40), String(payload.client_key || '').slice(0, 200), String(payload.ip_address || '').slice(0, 80), String(payload.remark || '').slice(0, 500), nowIso()
      ]);
    } catch (error) {
      console.warn('Failed to write user_activity_logs:', error.message || error);
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
      public_show_reserver_name: parseBoolean(config.public_show_reserver_name),
      public_show_reserver_phone: parseBoolean(config.public_show_reserver_phone),
      public_show_reserver_student_no: parseBoolean(config.public_show_reserver_student_no),
      system_notice_enabled: parseBoolean(config.system_notice_enabled),
      system_notice_title: String(config.system_notice_title || DEFAULT_SECURITY_CONFIG.system_notice_title),
      system_notice_content: String(config.system_notice_content || DEFAULT_SECURITY_CONFIG.system_notice_content),
      system_notice_version: String(config.system_notice_version || DEFAULT_SECURITY_CONFIG.system_notice_version)
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

  async function saveSystemConfig(configKey, configValue, description = '') {
    await query('insert into system_configs (id, config_key, config_value, description, created_at, updated_at) values ($1,$2,$3,$4,$5,$6) on conflict (config_key) do update set config_value = excluded.config_value, description = excluded.description, updated_at = excluded.updated_at', [
      uuid(), configKey, String(configValue), String(description || '').slice(0, 200), nowIso(), nowIso()
    ]);
  }

  async function requireAdmin(token) {
    const payload = verifyToken(token);
    if (!payload) throw new AppError('Authentication required', { status: 401, code: 1001 });
    if (!['admin', 'super_admin'].includes(payload.role)) {
      throw new AppError('Admin permission required', { status: 403, code: 1003 });
    }
    return payload;
  }

  async function requireUser(token) {
    const payload = verifyToken(token);
    if (!payload || !payload.user_id) {
      throw new AppError('Authentication required', { status: 401, code: 1001 });
    }

    const user = await getById('users', payload.user_id);
    if (!user || user.status !== 'active' || user.is_banned) {
      throw new AppError('User is disabled or not approved', { status: 403, code: 1003 });
    }
    return user;
  }

  async function checkConflict(deviceId, startTime, endTime, excludeReservationId = null) {
    const params = [deviceId, startTime, endTime];
    let sql = 'select * from reservations where device_id = $1 and status = any($4) and start_time < $3 and end_time > $2';
    params.push(activeReservationStatus);
    if (excludeReservationId) {
      sql += ' and id <> $5';
      params.push(excludeReservationId);
    }
    return query(sql, params);
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
      device_name: devices[row.device_id]?.name || ''
    }));
  }

  async function addNamesToBorrowRows(rows) {
    const users = await mapById('users');
    const devices = await mapById('devices');
    return rows.map((row) => ({
      ...row,
      user_name: users[row.user_id]?.name || '',
      user_phone: users[row.user_id]?.phone || '',
      user_student_no: users[row.user_id]?.student_no || '',
      device_code: devices[row.device_id]?.device_code || '',
      device_name: devices[row.device_id]?.name || ''
    }));
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
      const reservationRows = await query('select * from reservations where device_id = $1 and status = any($2) and end_time >= $3 order by start_time asc limit 1', [device.id, activeReservationStatus, referenceTime]);
      const lastRows = await query('select * from borrow_records where device_id = $1 and return_time is not null order by return_time desc limit 1', [device.id]);
      const namedCurrent = await addNamesToBorrowRows(currentRows || []);
      const namedReservations = await addNamesToReservations(reservationRows || []);
      const namedLast = await addNamesToBorrowRows(lastRows || []);
      rows.push({
        ...device,
        current_borrow: applyReservationVisibility(namedCurrent[0], visibility, options.fullAccess),
        next_reservation: applyReservationVisibility(namedReservations[0], visibility, options.fullAccess),
        last_record: applyReservationVisibility(namedLast[0], visibility, options.fullAccess)
      });
    }
    return rows;
  }

  function formatDateForTimezone(date, timeZone = 'Asia/Shanghai') {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(date);
  }

  function formatDateTimeForTimezone(value, timeZone = 'Asia/Shanghai') {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date).replace(/\//g, '-');
  }

  async function appendUsageLog(action, record, user, device, extra = {}) {
    try {
      await query('insert into usage_log (id, record_id, reservation_id, device_id, user_id, action, device_code, device_name, user_name, user_phone, user_student_no, borrow_time, expected_return_time, return_time, duration_minutes, record_status, return_condition, return_note, operator_name, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)', [
        uuid(), record.id, record.reservation_id || null, device?.id || record.device_id || null, user?.id || record.user_id || null, String(action || '').slice(0, 20), String(device?.device_code || '').slice(0, 80), String(device?.name || '').slice(0, 120), String(user?.name || '').slice(0, 80), String(user?.phone || '').slice(0, 30), String(user?.student_no || '').slice(0, 50), record.borrow_time || null, record.expected_return_time || null, record.return_time || null, Number(record.duration_minutes) || null, String(record.status || '').slice(0, 40), String(record.return_condition || '').slice(0, 50), String(record.return_note || '').slice(0, 500), String(extra.operator_name || user?.name || '').slice(0, 80), nowIso()
      ]);
    } catch (error) {
      console.warn('Failed to write usage_log:', error.message || error);
    }
  }

  async function getUsageLogRowsByDate(dateText, timeZone = 'Asia/Shanghai') {
    const targetDate = String(dateText || '').trim();
    const rows = await query('select * from usage_log order by borrow_time asc nulls last, created_at asc');
    return rows.filter((row) => formatDateForTimezone(new Date(row.created_at), timeZone) === targetDate);
  }

  async function logWechatPush(payload = {}) {
    try {
      await query('insert into wechat_push_logs (id, push_date, recipient_openid, message_type, message_preview, status, response_body, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)', [
        uuid(), String(payload.push_date || '').slice(0, 20), String(payload.recipient_openid || '').slice(0, 150), String(payload.message_type || 'daily_usage_report').slice(0, 50), String(payload.message_preview || '').slice(0, 1000), String(payload.status || 'unknown').slice(0, 30), String(payload.response_body || '').slice(0, 2000), nowIso()
      ]);
    } catch (error) {
      console.warn('Failed to write wechat_push_logs:', error.message || error);
    }
  }

  async function finalizeUserLogin(user, context = {}) {
    await query('update users set last_login_at = $1, updated_at = $1 where id = $2', [nowIso(), user.id]);
    const token = makeToken({ user_id: user.id, role: user.role, name: user.name }, 7);
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
      role: user.role,
      device_type: context.deviceType || null,
      user: safeUser({ ...user, last_login_at: nowIso() })
    });
  }

  async function adminLogin(payload) {
    const password = assertText(payload.password, 'password', 100);
    const adminAuth = await getAdminAuthConfig();
    if (adminAuth.has_custom_admin_password) {
      if (hashPassword(password, adminAuth.admin_password_salt) !== adminAuth.admin_password_hash) {
        return fail('Invalid admin password', 401, 1001);
      }
    } else {
      if (!adminPassword) return fail('ADMIN_PASSWORD is not configured', 500, 5000);
      if (password !== adminPassword) return fail('Invalid admin password', 401, 1001);
    }
    const token = makeToken({ role: 'admin', name: 'admin' }, 7);
    return ok({ token });
  }

  async function registerUser(payload, context = {}) {
    return fail('普通账号密码注册已关闭，请通过公众号验证码完成首次注册/绑定。', 403, 1003);
  }

  async function loginUser(payload, context = {}) {
    const phone = assertPhone(payload.phone);
    const password = assertPassword(payload.password);
    const user = await queryOne('select * from users where phone = $1 limit 1', [phone]);
    if (!user || user.password_hash !== hashPassword(password, user.password_salt)) {
      return fail('Invalid phone or password', 401, 1001);
    }
    if (user.is_banned) {
      return fail('Your account has been banned', 403, 1003);
    }
    if (user.status !== 'active') {
      return fail(`User status is ${user.status}`, 403, 1003);
    }
    return finalizeUserLogin(user, { ...context, remark: 'password_login' });
  }

  async function createLoginChallenge(_, context = {}) {
    cleanupExpiredChallenges();
    const config = await getSecurityConfig();
    const clientKey = getClientKey(context);
    const now = Date.now();
    const recent = [...challengeStore.values()].filter((item) => item.client_key === clientKey && (now - item.created_at) < 60 * 60 * 1000);
    if (recent.length >= config.captcha_hourly_limit) return fail('Too many challenge requests, please retry in one hour', 429, 2001);
    let code = makeChallengeCode();
    while (challengeStore.has(code)) code = makeChallengeCode();
    challengeStore.set(code, { code, client_key: clientKey, created_at: now, expire_at: now + config.captcha_expire_minutes * 60 * 1000, ip: context.ip || '', user_agent: context.userAgent || '', openid: null, nickname: '', used_at: null });
    return ok({ code, expire_minutes: config.captcha_expire_minutes, hourly_limit: config.captcha_hourly_limit, tips: 'Send this code to the official account within the valid time.' });
  }

  async function getLoginChallengeStatus(query = {}, context = {}) {
    cleanupExpiredChallenges();
    const code = assertText(query.code || query.tempCode, 'code', 20);
    const challenge = challengeStore.get(code);
    if (!challenge) return fail('Challenge code expired or invalid', 404, 3004);
    if (challenge.expire_at <= Date.now()) {
      challengeStore.delete(code);
      return fail('Challenge code expired or invalid', 404, 3004);
    }
    if (!challenge.openid) {
      return ok({ logged_in: false, need_bind: false, status: 'pending', expire_at: new Date(challenge.expire_at).toISOString() });
    }
    const user = await getUserByOpenId(challenge.openid);
    if (user) {
      if (user.is_banned) return fail('Your account has been banned', 403, 1003);
      if (user.status !== 'active') return fail(`User status is ${user.status}`, 403, 1003);
      challenge.used_at = Date.now();
      challengeStore.delete(code);
      return finalizeUserLogin(user, { ...context, remark: 'wechat_login', deviceType: context.deviceType || 'wechat' });
    }
    return ok({ logged_in: false, need_bind: true, status: 'need_bind', temp_code: code, openid_masked: maskOpenId(challenge.openid), nickname: challenge.nickname || '', expire_at: new Date(challenge.expire_at).toISOString() });
  }

  async function bindWechatAccount(payload, context = {}) {
    cleanupExpiredChallenges();
    const tempCode = assertText(payload.temp_code || payload.tempCode, 'temp_code', 20);
    const name = assertText(payload.name, 'name', 50);
    const studentNo = assertText(payload.student_no || payload.studentNo, 'student_no', 50);
    const phone = assertPhone(payload.phone);
    const challenge = challengeStore.get(tempCode);
    if (!challenge || !challenge.openid || challenge.expire_at <= Date.now()) {
      if (challenge && challenge.expire_at <= Date.now()) challengeStore.delete(tempCode);
      return fail('Challenge code expired or invalid', 400, 2001);
    }
    const config = await getSecurityConfig();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const bindEvents = await query('select * from user_activity_logs where wechat_openid = $1 and event_type = $2 and created_at >= $3', [challenge.openid, 'wechat_bind', dayStart.toISOString()]);
    if ((bindEvents || []).length >= config.openid_daily_register_limit) {
      return fail('This WeChat account has reached the daily binding limit', 429, 3001);
    }
    const existingByOpenId = await getUserByOpenId(challenge.openid);
    if (existingByOpenId) {
      return fail('This WeChat account is already bound to another user', 409, 3001);
    }
    let user = await queryOne('select * from users where name = $1 and student_no = $2 limit 1', [name, studentNo]);
    if (!user) {
      const phoneExists = await queryOne('select id from users where phone = $1 limit 1', [phone]);
      if (phoneExists) return fail('Phone number already registered', 409, 3001);
      const salt = crypto.randomBytes(8).toString('hex');
      user = {
        id: uuid(),
        name,
        phone,
        student_no: studentNo,
        group_name: '',
        email: '',
        password_hash: hashPassword(crypto.randomBytes(16).toString('hex'), salt),
        password_salt: salt,
        role: 'user',
        status: 'pending',
        is_banned: false,
        wechat_openid: challenge.openid,
        wechat_nickname: challenge.nickname || '',
        created_at: nowIso(),
        updated_at: nowIso()
      };
      await query('insert into users (id, name, phone, student_no, group_name, email, password_hash, password_salt, role, status, is_banned, wechat_openid, wechat_nickname, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [
        user.id, user.name, user.phone, user.student_no, user.group_name, user.email, user.password_hash, user.password_salt, user.role, user.status, user.is_banned, user.wechat_openid, user.wechat_nickname, user.created_at, user.updated_at
      ]);
      challenge.used_at = Date.now();
      challengeStore.delete(tempCode);
      await recordUserEvent({ user_id: user.id, user_name: user.name, phone: user.phone, wechat_openid: challenge.openid, event_type: 'register', device_type: context.deviceType || 'wechat', client_key: getClientKey(context), ip_address: context.ip || '', remark: `Registered and bound through challenge ${tempCode}` });
      return ok({ message: 'Registered and bound successfully, waiting for administrator approval', need_review: true, user: safeUser(user) });
    }
    if (user.is_banned) return fail('This account has been banned', 403, 1003);
    if (user.wechat_openid && user.wechat_openid !== challenge.openid) {
      return fail('This account is already bound to another WeChat account', 409, 3001);
    }
    await query('update users set wechat_openid = $1, wechat_nickname = $2, updated_at = $3 where id = $4', [challenge.openid, challenge.nickname || user.wechat_nickname || '', nowIso(), user.id]);
    challenge.used_at = Date.now();
    challengeStore.delete(tempCode);
    const boundUser = { ...user, wechat_openid: challenge.openid, wechat_nickname: challenge.nickname || user.wechat_nickname || '' };
    await recordUserEvent({ user_id: user.id, user_name: user.name, phone: user.phone, wechat_openid: challenge.openid, event_type: 'wechat_bind', device_type: context.deviceType || 'wechat', client_key: getClientKey(context), ip_address: context.ip || '', remark: `Bound through challenge ${tempCode}` });
    if (boundUser.status !== 'active') {
      return ok({ message: 'WeChat bound successfully, waiting for administrator approval', need_review: true, user: safeUser(boundUser) });
    }
    return finalizeUserLogin(boundUser, { ...context, remark: 'wechat_bind_and_login', deviceType: context.deviceType || 'wechat' });
  }

  async function processWechatCodeLogin(payload = {}) {
    const openid = assertText(payload.openid, 'openid', 150);
    const code = assertText(payload.code, 'code', 20);
    const nickname = String(payload.nickname || '').trim().slice(0, 80);
    cleanupExpiredChallenges();
    const challenge = challengeStore.get(code);
    if (!challenge) {
      return { success: false, message: '验证码已过期或无效，请重新获取。' };
    }
    if (challenge.expire_at <= Date.now()) {
      challengeStore.delete(code);
      return { success: false, message: '验证码已过期，请重新获取。' };
    }
    if (challenge.openid && challenge.openid !== openid) {
      return { success: false, message: '该验证码已被其他微信使用，请重新获取。' };
    }
    challenge.openid = openid;
    challenge.nickname = nickname;
    const user = await getUserByOpenId(openid);
    if (user) {
      if (user.is_banned) {
        return { success: false, message: '您的账号已被限制，请联系管理员。' };
      }
      if (user.status !== 'active') {
        return { success: false, message: `您的账号状态为 ${user.status}，请联系管理员。` };
      }
      await recordUserEvent({ user_id: user.id, user_name: user.name, phone: user.phone, wechat_openid: openid, event_type: 'wechat_scan', device_type: 'wechat', client_key: challenge.client_key, ip_address: challenge.ip, remark: `Challenge ${code} matched an existing user` });
      return { success: true, message: `您好，${user.name}，验证成功，请返回系统页面完成登录。` };
    }
    await recordUserEvent({ event_type: 'wechat_scan', user_name: nickname || '', wechat_openid: openid, device_type: 'wechat', client_key: challenge.client_key, ip_address: challenge.ip, remark: `Challenge ${code} requires first-time binding` });
    return { success: true, message: '验证成功，请返回系统页面继续绑定姓名和学号。' };
  }

  async function getProfile(token) {
    const user = await requireUser(token);
    return ok({ user: safeUser(user) });
  }

  async function listDevices(filters = {}) {
    let sql = 'select * from devices';
    const params = [];
    const clauses = [];
    if (filters.status) { params.push(String(filters.status)); clauses.push(`status = $${params.length}`); }
    if (filters.category) { params.push(String(filters.category)); clauses.push(`category = $${params.length}`); }
    if (clauses.length) sql += ` where ${clauses.join(' and ')}`;
    sql += ' order by created_at desc';
    let rows = await query(sql, params);
    if (filters.keyword) {
      const keyword = String(filters.keyword).trim().toLowerCase();
      rows = rows.filter((row) => [row.device_code, row.name, row.location, row.manager, row.category].filter(Boolean).some((value) => String(value).toLowerCase().includes(keyword)));
    }
    const list = await addReservationSnapshotsToDevices(rows, { fullAccess: false });
    return ok({ list, total: list.length });
  }

  async function adminListDevices(filters = {}, token) {
    await requireAdmin(token);
    const result = await listDevices(filters);
    const list = await addReservationSnapshotsToDevices(result.list || [], { fullAccess: true });
    return ok({ list, devices: list, total: list.length });
  }

  async function getDeviceDetail(params = {}) {
    const code = assertText(params.device_code || params.deviceCode, 'device_code', 50);
    const device = await getDeviceByCode(code);
    if (!device) return fail('Device not found', 404, 3004);
    const reservations = await query('select * from reservations where device_id = $1 and status = any($2) and end_time >= $3 order by start_time asc', [device.id, activeReservationStatus, nowIso()]);
    const visibility = await getReservationVisibilityConfig();
    const deviceList = await addReservationSnapshotsToDevices([device], { fullAccess: false });
    const namedReservations = await addNamesToReservations(reservations || []);
    return ok({
      device: deviceList[0] || device,
      reservations: namedReservations.map((row) => applyReservationVisibility(row, visibility)),
      current_borrow: deviceList[0]?.current_borrow || null,
      next_reservation: deviceList[0]?.next_reservation || null,
      last_record: deviceList[0]?.last_record || null
    });
  }

  async function createReservation(payload, token) {
    const user = await requireUser(token);
    const deviceCode = assertText(payload.device_code, 'device_code', 50);
    const startTime = assertText(payload.start_time, 'start_time', 50);
    const endTime = assertText(payload.end_time, 'end_time', 50);
    const purpose = String(payload.purpose || '').trim().slice(0, 200);
    const { start, end } = parseDates(startTime, endTime);
    const device = await getDeviceByCode(deviceCode);
    if (!device) return fail('Device not found', 404, 3004);
    if (!device.allow_reservation || ['maintenance', 'disabled', 'abnormal_pending'].includes(device.status)) {
      return fail('Device is not reservable', 409, 3001);
    }
    const unfinishedRecord = await queryOne('select id from borrow_records where user_id = $1 and status = any($2) limit 1', [user.id, ['in_use', 'abnormal_pending', 'overdue']]);
    if (unfinishedRecord) {
      return fail('Please finish the current device usage before creating another reservation', 409, 3001);
    }
    const conflicts = await checkConflict(device.id, start.toISOString(), end.toISOString());
    if (conflicts.length) return fail('Selected time slot is already occupied', 409, 3001);
    const row = { id: uuid(), device_id: device.id, user_id: user.id, start_time: start.toISOString(), end_time: end.toISOString(), purpose, status: 'pending', created_at: nowIso(), updated_at: nowIso() };
    await query('insert into reservations (id, device_id, user_id, start_time, end_time, purpose, status, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', Object.values(row));
    await log('create_reservation', `Created reservation ${device.device_code} ${startTime} - ${endTime}`, user, device.id, row.id);
    return ok({ message: 'Reservation submitted', reservation: row });
  }

  async function myRecords(_, token) {
    const user = await requireUser(token);
    const reservations = await query('select * from reservations where user_id = $1 order by created_at desc', [user.id]);
    const borrows = await query('select * from borrow_records where user_id = $1 order by borrow_time desc', [user.id]);
    const config = await getSecurityConfig();
    const namedReservations = await addNamesToReservations(reservations || []);
    return ok({
      reservations: namedReservations.map((row) => ({ ...row, can_cancel: canCancelReservation(row) })),
      borrows: await addNamesToBorrowRows(borrows || []),
      require_return_photo: config.require_return_photo
    });
  }

  async function cancelReservation(payload, token) {
    const user = await requireUser(token);
    const reservationId = assertText(payload.reservation_id, 'reservation_id', 60);
    const reservation = await getById('reservations', reservationId);
    if (!reservation) return fail('Reservation not found', 404, 3004);
    if (reservation.user_id !== user.id) return fail('Cannot cancel another user reservation', 403, 1003);
    if (!canCancelReservation(reservation)) {
      return fail('Reservations can only be cancelled before the reservation day', 409, 3001);
    }
    await query('update reservations set status = $1, updated_at = $2 where id = $3', ['cancelled', nowIso(), reservation.id]);
    await log('cancel_reservation', 'Cancelled reservation before reservation day', user, reservation.device_id, reservation.id);
    return ok({ message: 'Reservation cancelled' });
  }

  async function startUse(payload, token) {
    const user = await requireUser(token);
    const reservationId = assertText(payload.reservation_id, 'reservation_id', 60);
    const reservation = await getById('reservations', reservationId);
    if (!reservation) return fail('Reservation not found', 404, 3004);
    if (reservation.user_id !== user.id) return fail('Cannot start another user reservation', 403, 1003);
    if (reservation.status !== 'approved') return fail('Reservation is not approved', 409, 3001);
    const now = new Date();
    const startAllowed = new Date(new Date(reservation.start_time).getTime() - 15 * 60_000);
    if (now < startAllowed) return fail('Start time is not available yet', 409, 3001);
    if (now > new Date(reservation.end_time)) return fail('Reservation time already ended', 409, 3001);
    const device = await getById('devices', reservation.device_id);
    if (!device || ['in_use', 'maintenance', 'disabled', 'abnormal_pending'].includes(device.status)) {
      return fail('Device is not available now', 409, 3001);
    }
    const record = { id: uuid(), reservation_id: reservation.id, device_id: reservation.device_id, user_id: user.id, borrow_time: nowIso(), expected_return_time: reservation.end_time, status: 'in_use', created_at: nowIso(), updated_at: nowIso() };
    await query('insert into borrow_records (id, reservation_id, device_id, user_id, borrow_time, expected_return_time, status, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', Object.values(record));
    await query('update reservations set status = $1, updated_at = $2 where id = $3', ['in_use', nowIso(), reservation.id]);
    await query('update devices set status = $1, updated_at = $2 where id = $3', ['in_use', nowIso(), reservation.device_id]);
    await appendUsageLog('BORROW', record, user, device, { operator_name: user.name });
    await log('start_use', 'Started device usage', user, reservation.device_id, record.id);
    return ok({ message: 'Usage started', record });
  }

  async function submitReturn(payload, token) {
    const user = await requireUser(token);
    const recordId = assertText(payload.record_id, 'record_id', 60);
    const returnCondition = String(payload.return_condition || 'normal').trim().slice(0, 50);
    const returnNote = String(payload.return_note || '').trim().slice(0, 500);
    const returnPhotos = Array.isArray(payload.return_photos) ? payload.return_photos.slice(0, 5).map((value) => String(value).slice(0, 500)) : [];
    const config = await getSecurityConfig();
    if (config.require_return_photo && !returnPhotos.length) {
      return fail('Return photo is required before ending device usage', 400, 2001);
    }
    const record = await getById('borrow_records', recordId);
    if (!record) return fail('Borrow record not found', 404, 3004);
    if (record.user_id !== user.id) return fail('Cannot return another user record', 403, 1003);
    if (record.status !== 'in_use') return fail('Borrow record is not in use', 409, 3001);
    const returnTime = nowIso();
    const duration = durationMinutes(record.borrow_time, returnTime);
    const isOverdue = record.expected_return_time ? new Date(returnTime) > new Date(record.expected_return_time) : false;
    const abnormal = returnCondition && returnCondition !== 'normal';
    const nextDeviceStatus = abnormal ? 'abnormal_pending' : 'available';
    const nextRecordStatus = abnormal ? 'abnormal_pending' : 'returned';
    await query('update borrow_records set return_time = $1, duration_minutes = $2, return_condition = $3, return_note = $4, return_photos = $5, status = $6, is_overdue = $7, updated_at = $8 where id = $9', [returnTime, duration, returnCondition, returnNote, JSON.stringify(returnPhotos), nextRecordStatus, isOverdue, nowIso(), record.id]);
    await query('update devices set status = $1, last_return_photo = $2, last_return_user = $3, last_return_time = $4, last_condition = $5, updated_at = $6 where id = $7', [nextDeviceStatus, returnPhotos[0] || null, user.name, returnTime, returnCondition, nowIso(), record.device_id]);
    if (record.reservation_id) {
      await query('update reservations set status = $1, updated_at = $2 where id = $3', ['completed', nowIso(), record.reservation_id]);
    }
    await appendUsageLog('RETURN', { ...record, return_time: returnTime, duration_minutes: duration, return_condition: returnCondition, return_note: returnNote, status: nextRecordStatus }, user, await getById('devices', record.device_id), { operator_name: user.name });
    await log('submit_return', `Submitted return: ${returnCondition || 'normal'}`, user, record.device_id, record.id);
    return ok({ message: abnormal ? 'Abnormal return submitted' : 'Returned successfully' });
  }

  async function adminListUsers(_, token) {
    await requireAdmin(token);
    const data = await query('select * from users order by created_at desc');
    return ok({ users: (data || []).map(safeUser) });
  }

  async function adminSetUserStatus(payload, token) {
    const admin = await requireAdmin(token);
    const userId = assertText(payload.user_id, 'user_id', 60);
    const status = assertText(payload.status, 'status', 20);
    if (!['active', 'disabled', 'pending'].includes(status)) return fail('Invalid status', 400, 2001);
    await query('update users set status = $1, updated_at = $2 where id = $3', [status, nowIso(), userId]);
    await log('set_user_status', `Changed user status to ${status}`, admin, null, userId);
    return ok({ message: 'User status updated' });
  }

  async function adminSetUserBan(payload, token) {
    const admin = await requireAdmin(token);
    const userId = assertText(payload.user_id, 'user_id', 60);
    const banned = parseBoolean(payload.is_banned ?? payload.banned);
    await query('update users set is_banned = $1, updated_at = $2 where id = $3', [banned, nowIso(), userId]);
    await log('set_user_ban', banned ? 'Banned user account' : 'Unbanned user account', admin, null, userId);
    return ok({ message: banned ? 'User banned' : 'User unbanned' });
  }

  async function adminUnbindWechat(payload, token) {
    const admin = await requireAdmin(token);
    const userId = assertText(payload.user_id, 'user_id', 60);
    await query('update users set wechat_openid = null, wechat_nickname = null, updated_at = $1 where id = $2', [nowIso(), userId]);
    await log('unbind_wechat', 'Removed WeChat binding', admin, null, userId);
    return ok({ message: 'WeChat binding removed' });
  }

  async function adminGetSecurityConfig(_, token) {
    await requireAdmin(token);
    const wechatConfig = await getWechatConfig();
    const adminAuth = await getAdminAuthConfig();
    return ok({
      config: {
        ...(await getSecurityConfig()),
        ...(await getReportConfig()),
        wechat_token: wechatConfig.wechat_token,
        wechat_app_id: wechatConfig.wechat_app_id,
        wechat_admin_openids: wechatConfig.wechat_admin_openids,
        has_wechat_app_secret: Boolean(wechatConfig.wechat_app_secret),
        has_custom_admin_password: adminAuth.has_custom_admin_password
      }
    });
  }

  async function adminUpdateSecurityConfig(payload, token) {
    const admin = await requireAdmin(token);
    const updates = [
      ['captcha_expire_minutes', 'captcha_expire_minutes', 'Challenge code validity in minutes'],
      ['captcha_hourly_limit', 'captcha_hourly_limit', 'Maximum challenge requests per hour'],
      ['openid_daily_register_limit', 'openid_daily_register_limit', 'Daily bind limit for the same OpenID'],
      ['enable_image_captcha', 'enable_image_captcha', 'Whether image captcha is enabled before challenge issuance', true],
      ['require_return_photo', 'require_return_photo', 'Whether return photos are required before ending usage', true],
      ['public_show_reserver_name', 'public_show_reserver_name', 'Whether public users can see reserver name', true],
      ['public_show_reserver_phone', 'public_show_reserver_phone', 'Whether public users can see reserver phone', true],
      ['public_show_reserver_student_no', 'public_show_reserver_student_no', 'Whether public users can see reserver student number', true],
      ['system_notice_enabled', 'system_notice_enabled', 'Whether login notice popup is enabled', true],
      ['admin_report_enabled', 'admin_report_enabled', 'Whether daily usage report push is enabled', true],
      ['admin_report_hour', 'admin_report_hour', 'Daily report push hour'],
      ['admin_report_minute', 'admin_report_minute', 'Daily report push minute'],
      ['admin_report_timezone', 'admin_report_timezone', 'Daily report push timezone'],
      ['wechat_token', 'wechat_token', 'WeChat official account callback token'],
      ['wechat_app_id', 'wechat_app_id', 'WeChat official account AppID'],
      ['wechat_admin_openids', 'wechat_admin_openids', 'Comma-separated admin OpenIDs']
    ];
    for (const [key, payloadKey, description, booleanValue] of updates) {
      if (!Object.prototype.hasOwnProperty.call(payload, payloadKey)) continue;
      const value = booleanValue ? (parseBoolean(payload[payloadKey]) ? '1' : '0') : payload[payloadKey];
      await saveSystemConfig(key, value, description);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'wechat_app_secret') && String(payload.wechat_app_secret || '').trim()) {
      await saveSystemConfig('wechat_app_secret', String(payload.wechat_app_secret).trim(), 'WeChat official account AppSecret');
    }
    let noticeChanged = false;
    if (Object.prototype.hasOwnProperty.call(payload, 'system_notice_title')) {
      noticeChanged = true;
      await saveSystemConfig('system_notice_title', String(payload.system_notice_title || '').trim().slice(0, 120) || DEFAULT_SECURITY_CONFIG.system_notice_title, 'Login notice popup title');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'system_notice_content')) {
      noticeChanged = true;
      await saveSystemConfig('system_notice_content', String(payload.system_notice_content || '').trim().slice(0, 3000) || DEFAULT_SECURITY_CONFIG.system_notice_content, 'Login notice popup content');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'system_notice_enabled')) {
      noticeChanged = true;
    }
    if (noticeChanged) {
      await saveSystemConfig('system_notice_version', String(Date.now()), 'Login notice popup version');
    }
    if (String(payload.new_admin_password || '').trim()) {
      const password = assertText(payload.new_admin_password, 'new_admin_password', 100);
      if (password.length < 8) {
        throw new AppError('new_admin_password must be at least 8 characters', { status: 400, code: 2001 });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      await saveSystemConfig('admin_password_salt', salt, 'Admin password salt');
      await saveSystemConfig('admin_password_hash', hashPassword(password, salt), 'Admin password hash');
    }
    await log('update_security_config', 'Updated security settings', admin);
    const refreshed = await adminGetSecurityConfig({}, token);
    return ok({ message: 'Security config updated', config: refreshed.config });
  }

  async function adminGetActivitySummary(_, token) {
    await requireAdmin(token);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const rows = await query('select * from user_activity_logs where created_at >= $1 order by created_at desc', [dayStart.toISOString()]);
    return ok({ summary: { registered_today: rows.filter((item) => item.event_type === 'register').length, logged_in_today: rows.filter((item) => item.event_type === 'login').length, wechat_bind_today: rows.filter((item) => item.event_type === 'wechat_bind').length, wechat_scan_today: rows.filter((item) => item.event_type === 'wechat_scan').length }, rows: rows.slice(0, 50) });
  }

  async function buildDailyUsageReport(payload = {}) {
    const reportConfig = await getReportConfig();
    const timeZone = String(payload.timezone || reportConfig.admin_report_timezone || 'Asia/Shanghai');
    const inputDate = String(payload.date || '').trim();
    const baseDate = inputDate ? new Date(`${inputDate}T00:00:00+08:00`) : new Date();
    const targetDate = inputDate || formatDateForTimezone(new Date(baseDate.getTime() - 24 * 60 * 60 * 1000), timeZone);
    const rows = await getUsageLogRowsByDate(targetDate, timeZone);
    if (!rows.length) {
      return { date: targetDate, count: 0, timeZone, message: `【${targetDate}】设备使用记录日报\n\n当天没有新增使用记录。\n\n统计时区：${timeZone}\n生成时间：${formatDateTimeForTimezone(new Date(), timeZone)}` };
    }
    const lines = [`【${targetDate}】设备使用记录日报`, '─────────────────', `新增记录：${rows.length} 条`, '─────────────────', ''];
    rows.slice(0, MAX_REPORT_PUSH_ROWS).forEach((row, index) => {
      const duration = row.duration_minutes ? `${row.duration_minutes} 分钟` : '进行中';
      lines.push(`${index + 1}. ${row.device_name || row.device_code || '设备'}`);
      lines.push(`   操作：${row.action || '-'}`);
      lines.push(`   用户：${row.user_name || '-'} ${row.user_student_no ? `(${row.user_student_no})` : ''}`.trim());
      lines.push(`   借出：${formatDateTimeForTimezone(row.borrow_time, timeZone)}`);
      lines.push(`   归还：${row.return_time ? formatDateTimeForTimezone(row.return_time, timeZone) : '未归还'}`);
      lines.push(`   时长：${duration}`);
      lines.push(`   状态：${row.record_status || '-'}`);
      if (row.return_condition && row.return_condition !== 'normal') {
        lines.push(`   异常：${row.return_condition}`);
      }
      lines.push('');
    });
    if (rows.length > MAX_REPORT_PUSH_ROWS) {
      lines.push(`还有 ${rows.length - MAX_REPORT_PUSH_ROWS} 条记录未在微信消息中展开，请进入后台查看完整总表。`);
      lines.push('');
    }
    lines.push('─────────────────');
    lines.push(`说明：本日报用于覆盖昨日关注焦点，旧消息不会被微信撤回。`);
    lines.push(`统计时区：${timeZone}`);
    lines.push(`生成时间：${formatDateTimeForTimezone(new Date(), timeZone)}`);
    return { date: targetDate, count: rows.length, timeZone, rows, message: lines.join('\n').slice(0, MAX_WECHAT_TEXT_LENGTH) };
  }

  async function getWechatAccessToken(payload = {}) {
    const wechatConfig = await getWechatConfig();
    const appId = String(payload.appId || wechatConfig.wechat_app_id || '').trim();
    const appSecret = String(payload.appSecret || wechatConfig.wechat_app_secret || '').trim();
    if (!appId || !appSecret) {
      throw new AppError('WECHAT_APP_ID or WECHAT_APP_SECRET is missing', { status: 500, code: 5000 });
    }
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || !data.access_token) {
      throw new AppError(`Failed to get WeChat access token: ${data.errmsg || response.statusText}`, { status: 500, code: 5000 });
    }
    return data.access_token;
  }

  async function sendWechatCustomMessage(payload = {}) {
    const recipientOpenId = assertText(payload.openid, 'openid', 150);
    const content = assertText(payload.content, 'content', MAX_WECHAT_TEXT_LENGTH);
    const accessToken = await getWechatAccessToken(payload);
    const response = await fetch(`https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(accessToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ touser: recipientOpenId, msgtype: 'text', text: { content } }) });
    const data = await response.json();
    if (!response.ok || data.errcode) {
      throw new AppError(`Failed to send WeChat message: ${data.errmsg || response.statusText}`, { status: 500, code: 5000 });
    }
    return data;
  }

  async function pushDailyUsageReport(payload = {}) {
    const wechatConfig = await getWechatConfig();
    const openids = Array.isArray(payload.openids) ? payload.openids : String(payload.openids || wechatConfig.wechat_admin_openids || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (!openids.length) {
      return ok({ sent: 0, skipped: true, reason: 'No admin openids configured' });
    }
    const report = await buildDailyUsageReport(payload);
    const results = [];
    for (const openid of openids) {
      try {
        const response = await sendWechatCustomMessage({ openid, content: report.message, appId: payload.appId, appSecret: payload.appSecret });
        await logWechatPush({ push_date: report.date, recipient_openid: openid, message_preview: report.message.slice(0, 1000), status: 'success', response_body: JSON.stringify(response) });
        results.push({ openid: maskOpenId(openid), success: true });
      } catch (error) {
        await logWechatPush({ push_date: report.date, recipient_openid: openid, message_preview: report.message.slice(0, 1000), status: 'failed', response_body: error.message || String(error) });
        results.push({ openid: maskOpenId(openid), success: false, message: error.message });
      }
    }
    return ok({ report_date: report.date, message: report.message, sent: results.filter((item) => item.success).length, failed: results.filter((item) => !item.success).length, results });
  }

  async function adminPreviewDailyUsageReport(payload, token) {
    await requireAdmin(token);
    return ok(await buildDailyUsageReport(payload || {}));
  }

  async function adminSendDailyUsageReport(payload, token) {
    await requireAdmin(token);
    return pushDailyUsageReport(payload || {});
  }

  async function adminCreateDevice(payload, token) {
    const admin = await requireAdmin(token);
    const deviceCode = assertText(payload.device_code, 'device_code', 50);
    const name = assertText(payload.name, 'name', 100);
    const row = {
      id: uuid(),
      device_code: deviceCode,
      name,
      category: String(payload.category || '').trim().slice(0, 50),
      location: String(payload.location || '').trim().slice(0, 100),
      manager: String(payload.manager || '').trim().slice(0, 50),
      status: ['available', 'reserved', 'in_use', 'maintenance', 'disabled', 'abnormal_pending'].includes(payload.status) ? payload.status : 'available',
      allow_reservation: payload.allow_reservation !== false,
      description: String(payload.description || '').trim().slice(0, 1000),
      usage_notice: String(payload.usage_notice || '').trim().slice(0, 1000),
      cover_photo: isSafeUrl(payload.cover_photo) ? String(payload.cover_photo).trim().slice(0, 500) : '',
      instruction_photos: Array.isArray(payload.instruction_photos) ? payload.instruction_photos.slice(0, 10).map((value) => (isSafeUrl(value) ? String(value).slice(0, 500) : '')).filter(Boolean) : [],
      created_at: nowIso(),
      updated_at: nowIso()
    };
    await query('insert into devices (id, device_code, name, category, location, manager, status, allow_reservation, description, usage_notice, cover_photo, instruction_photos, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [row.id, row.device_code, row.name, row.category, row.location, row.manager, row.status, row.allow_reservation, row.description, row.usage_notice, row.cover_photo, JSON.stringify(row.instruction_photos), row.created_at, row.updated_at]);
    await log('create_device', `Created device ${deviceCode} ${name}`, admin, row.id);
    return ok({ message: 'Device created', device: row });
  }

  async function adminUpdateDevice(payload, token) {
    const admin = await requireAdmin(token);
    const id = assertText(payload.id, 'id', 60);
    const values = { updated_at: nowIso() };
    for (const [key, value] of Object.entries(payload || {})) {
      if (key !== 'id' && allowedDeviceUpdateFields.has(key)) values[key] = value;
    }
    if (typeof values.instruction_photos === 'string') values.instruction_photos = [];
    if ('cover_photo' in values && !isSafeUrl(values.cover_photo)) values.cover_photo = '';
    if (Array.isArray(values.instruction_photos)) values.instruction_photos = values.instruction_photos.filter(isSafeUrl).slice(0, 10);
    if ('device_code' in values) values.device_code = assertText(values.device_code, 'device_code', 50);
    if ('name' in values) values.name = assertText(values.name, 'name', 100);
    if ('category' in values) values.category = String(values.category || '').trim().slice(0, 50);
    if ('location' in values) values.location = String(values.location || '').trim().slice(0, 100);
    if ('manager' in values) values.manager = String(values.manager || '').trim().slice(0, 50);
    if ('description' in values) values.description = String(values.description || '').trim().slice(0, 1000);
    if ('usage_notice' in values) values.usage_notice = String(values.usage_notice || '').trim().slice(0, 1000);
    if ('status' in values && !['available', 'reserved', 'in_use', 'maintenance', 'disabled', 'abnormal_pending'].includes(values.status)) {
      return fail('Invalid device status', 400, 2001);
    }
    const keys = Object.keys(values);
    const sets = keys.map((key, index) => `${key} = $${index + 1}`);
    await query(`update devices set ${sets.join(', ')} where id = $${keys.length + 1}`, [...keys.map((key) => key === 'instruction_photos' ? JSON.stringify(values[key]) : values[key]), id]);
    await log('update_device', `Updated device ${id}`, admin, id);
    return ok({ message: 'Device updated' });
  }

  async function adminListReservations(_, token) {
    await requireAdmin(token);
    const data = await query('select * from reservations order by created_at desc');
    return ok({ reservations: await addNamesToReservations(data || []) });
  }

  async function adminApproveReservation(payload, token) {
    const admin = await requireAdmin(token);
    const reservationId = assertText(payload.reservation_id, 'reservation_id', 60);
    const approve = !!payload.approve;
    const adminNote = String(payload.admin_note || '').trim().slice(0, 500);
    const reservation = await getById('reservations', reservationId);
    if (!reservation) return fail('Reservation not found', 404, 3004);
    if (approve) {
      const conflicts = await checkConflict(reservation.device_id, reservation.start_time, reservation.end_time, reservation.id);
      if (conflicts.length) return fail('Time slot has been occupied', 409, 3001);
      await query('update reservations set status = $1, admin_note = $2, approved_at = $3, updated_at = $4 where id = $5', ['approved', adminNote, nowIso(), nowIso(), reservation.id]);
      await query('update devices set updated_at = $1 where id = $2', [nowIso(), reservation.device_id]);
      await log('approve_reservation', 'Approved reservation', admin, reservation.device_id, reservation.id);
      return ok({ message: 'Reservation approved' });
    }
    await query('update reservations set status = $1, admin_note = $2, updated_at = $3 where id = $4', ['rejected', adminNote, nowIso(), reservation.id]);
    await log('reject_reservation', 'Rejected reservation', admin, reservation.device_id, reservation.id);
    return ok({ message: 'Reservation rejected' });
  }

  async function adminSetDeviceAvailable(payload, token) {
    const admin = await requireAdmin(token);
    const deviceId = assertText(payload.device_id, 'device_id', 60);
    await query('update devices set status = $1, updated_at = $2 where id = $3', ['available', nowIso(), deviceId]);
    await log('set_device_available', 'Set device available', admin, deviceId);
    return ok({ message: 'Device is available again' });
  }

  async function usageStats(payload, token) {
    await requireAdmin(token);
    const { user_id: userId, device_id: deviceId, start_date: startDate, end_date: endDate } = payload;
    let sql = 'select * from borrow_records where return_time is not null';
    const params = [];
    const clauses = [];
    if (userId) { params.push(userId); clauses.push(`user_id = $${params.length}`); }
    if (deviceId) { params.push(deviceId); clauses.push(`device_id = $${params.length}`); }
    if (startDate) { params.push(new Date(startDate).toISOString()); clauses.push(`borrow_time >= $${params.length}`); }
    if (endDate) { const end = new Date(endDate); end.setDate(end.getDate() + 1); params.push(end.toISOString()); clauses.push(`borrow_time < $${params.length}`); }
    if (clauses.length) sql += ` and ${clauses.join(' and ')}`;
    sql += ' order by borrow_time desc';
    const rows = await query(sql, params);
    const hydrated = await addNamesToBorrowRows(rows || []);
    const totalMinutes = hydrated.reduce((sum, row) => sum + (Number(row.duration_minutes) || 0), 0);
    const abnormalCount = hydrated.filter((row) => row.return_condition && row.return_condition !== 'normal').length;
    const overdueCount = hydrated.filter((row) => row.is_overdue).length;
    return ok({ summary: { count: hydrated.length, total_minutes: totalMinutes, total_hours: Math.round((totalMinutes / 60) * 100) / 100, avg_minutes: hydrated.length ? Math.round(totalMinutes / hydrated.length) : 0, abnormal_count: abnormalCount, overdue_count: overdueCount }, rows: hydrated });
  }

  async function adminOptions(_, token) {
    await requireAdmin(token);
    const users = await query('select id, name, phone, status from users order by created_at desc');
    const devices = await query('select id, device_code, name from devices order by created_at desc');
    return ok({ users: users || [], devices: devices || [] });
  }

  async function verifyWechatSignature({ signature, timestamp, nonce }) {
    const wechatConfig = await getWechatConfig();
    if (!wechatConfig.wechat_token) return true;
    const raw = [wechatConfig.wechat_token, timestamp, nonce].sort().join('');
    return sha256(raw) === signature || crypto.createHash('sha1').update(raw).digest('hex') === signature;
  }

  async function verifyWechatHandshake(query = {}) {
    const { signature, timestamp, nonce, echostr } = query;
    if (!signature || !timestamp || !nonce || !(await verifyWechatSignature({ signature, timestamp, nonce }))) {
      throw new AppError('Invalid WeChat signature', { status: 403, code: 1003 });
    }
    return String(echostr || '');
  }

  async function handleWechatMessage(payload = {}) {
    const content = String(payload.content || '').trim();
    const openid = String(payload.openid || '').trim();
    const nickname = String(payload.nickname || '').trim();
    if (!content || !openid) {
      return '消息格式不正确，请发送登录验证码。';
    }
    const result = await processWechatCodeLogin({ code: content, openid, nickname });
    return result.message;
  }

  function buildWechatReply(toUser, fromUser, content) {
    const timestamp = Math.floor(Date.now() / 1000);
    return `<xml>\n<ToUserName><![CDATA[${escapeXml(toUser)}]]></ToUserName>\n<FromUserName><![CDATA[${escapeXml(fromUser)}]]></FromUserName>\n<CreateTime>${timestamp}</CreateTime>\n<MsgType><![CDATA[text]]></MsgType>\n<Content><![CDATA[${escapeXml(content)}]]></Content>\n</xml>`;
  }

  const legacyRoutes = { adminLogin, registerUser, loginUser, listDevices, getDeviceDetail, createReservation, cancelReservation, myRecords, startUse, submitReturn, adminListUsers, adminSetUserStatus, adminSetUserBan, adminUnbindWechat, adminCreateDevice, adminListDevices, adminUpdateDevice, adminListReservations, adminApproveReservation, adminSetDeviceAvailable, adminGetSecurityConfig, adminUpdateSecurityConfig, adminGetActivitySummary, usageStats, adminOptions, adminPreviewDailyUsageReport, adminSendDailyUsageReport, createLoginChallenge, getLoginChallengeStatus, bindWechatAccount, getSystemNotice };

  return { adminApproveReservation, adminCreateDevice, adminGetActivitySummary, adminGetSecurityConfig, adminListDevices, adminListReservations, adminListUsers, adminLogin, adminOptions, adminPreviewDailyUsageReport, adminSendDailyUsageReport, adminSetDeviceAvailable, adminSetUserBan, adminSetUserStatus, adminUnbindWechat, adminUpdateDevice, adminUpdateSecurityConfig, authTokenFromReq, bindWechatAccount, buildWechatReply, cancelReservation, createLoginChallenge, createReservation, getReportConfig, getDeviceDetail, getLoginChallengeStatus, getProfile, getSystemNotice, handleWechatMessage, legacyRoutes, listDevices, loginUser, myRecords, registerUser, safeFilename, sendWechatCustomMessage, startUse, submitReturn, pushDailyUsageReport, usageStats, verifyWechatHandshake };
}

module.exports = { createRentalService };
