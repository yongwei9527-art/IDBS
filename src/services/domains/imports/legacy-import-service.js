const nodeCrypto = require('crypto');

const FORMAT_NAME = 'laboratory-management-system-legacy-import';
const MAX_ROWS = 10000;
const MAX_USER_ROWS = 200;
const MAX_ISSUES = 200;

function legacyImportError(message, status = 400, code = 5001) {
  const error = new Error(message);
  error.isLegacyImportError = true;
  error.status = status;
  error.code = code;
  return error;
}

const trim = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const headerKey = (value) => trim(value, 200).toLowerCase().replace(/[\s_\-./\\:：()（）\[\]【】]+/g, '');

function parseCsv(source) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  const input = String(source || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((value) => trim(value))) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => trim(value))) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows.shift().map((value) => trim(value, 200));
  return rows.map((cells) => Object.fromEntries(headers.map((key, index) => [key, cells[index] ?? ''])));
}

function decodeHtml(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, key) => {
      if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
      return named[key.toLowerCase()] || '';
    }).trim();
}

function parseHtmlTables(source) {
  const output = [];
  for (const table of String(source || '').match(/<table\b[\s\S]*?<\/table>/gi) || []) {
    const rows = (table.match(/<tr\b[\s\S]*?<\/tr>/gi) || []).map((raw) =>
      (raw.match(/<t[hd]\b[\s\S]*?<\/t[hd]>/gi) || []).map(decodeHtml));
    if (rows.length < 2) continue;
    const headers = rows.shift();
    output.push(...rows.filter((row) => row.some(Boolean)).map((row) => Object.fromEntries(headers.map((key, index) => [key, row[index] ?? '']))));
  }
  return output;
}

const ALIASES = {
  name: ['name', '姓名', '用户姓名', '用户'], phone: ['phone', '手机号', '手机号码', '电话', '账号', '用户账号'],
  student_no: ['studentno', '学号', '学工号'], group_name: ['groupname', '课题组', '组别'],
  department: ['department', '部门', '学院'], major: ['major', '专业'], mentor_name: ['mentorname', '导师', '导师姓名'], email: ['email', '邮箱'],
  password: ['password', '密码', '登录密码'], password_hash: ['passwordhash', '密码哈希'], password_salt: ['passwordsalt', '密码盐'],
  role: ['role', '角色'], status: ['status', '状态', '账号状态', '预约状态', '归还状态'],
  device_code: ['devicecode', '设备编号', '仪器编号'], device_name: ['devicename', '设备名称', '仪器名称'],
  category: ['category', '类别', '设备类别'], location: ['location', '位置', '地点'], manager: ['manager', '负责人', '管理员'],
  description: ['description', '描述', '设备描述'], allow_reservation: ['allowreservation', '允许预约'],
  user_name: ['username', '使用人', '预约人'], start_time: ['starttime', '开始时间', '预约开始'], end_time: ['endtime', '结束时间', '预约结束'],
  purpose: ['purpose', '用途', '预约用途'], admin_note: ['adminnote', '管理员备注', '审核备注'],
  borrow_time: ['borrowtime', '借出时间', '开始使用时间'], expected_return_time: ['expectedreturntime', '预计归还', '预计归还时间'],
  return_time: ['returntime', '归还时间', '实际归还时间'], duration_minutes: ['durationminutes', '使用分钟', '使用时长分钟'],
  return_condition: ['returncondition', '归还情况', '设备情况'], return_note: ['returnnote', '归还说明', '归还备注'], record_id: ['recordid', '记录编号']
  , issue_type: ['issuetype', '故障类型', '问题类型'], severity: ['severity', '严重程度', '级别'], handled_at: ['handledat', '处理时间'],
  event_type: ['eventtype', '事件', '事件类型'], device_type: ['devicetype', '终端类型', '设备类型'], ip_address: ['ipaddress', 'IP', 'IP地址'],
  remark: ['remark', '备注'], created_at: ['createdat', '时间', '上报时间', '创建时间']
};
const LOOKUP = new Map();
Object.entries(ALIASES).forEach(([field, aliases]) => aliases.forEach((alias) => LOOKUP.set(headerKey(alias), field)));
function canonicalRow(row) {
  const output = {};
  Object.entries(row || {}).forEach(([key, value]) => { output[LOOKUP.get(headerKey(key)) || key] = value; });
  return output;
}
function detectDataset(rows) {
  const keys = new Set(rows.flatMap((row) => Object.keys(canonicalRow(row))));
  if (keys.has('issue_type')) return 'faults';
  if (keys.has('event_type')) return 'user_activity';
  if (keys.has('borrow_time') || keys.has('return_time') || keys.has('record_id')) return 'usage_records';
  if (keys.has('start_time') && keys.has('end_time')) return 'reservations';
  if (keys.has('password') || keys.has('password_hash') || keys.has('student_no') || (keys.has('phone') && keys.has('name'))) return 'users';
  if (keys.has('device_code')) return 'devices';
  return '';
}
function normalizeDocument(raw, selected = 'auto') {
  const document = { users: [], devices: [], reservations: [], usage_records: [], faults: [], user_activity: [] };
  if (Array.isArray(raw)) {
    const target = selected === 'usage' ? 'usage_records' : (selected === 'auto' ? detectDataset(raw) : selected);
    if (!Object.hasOwn(document, target)) throw legacyImportError('无法识别文档类型，请手动选择数据类型。');
    document[target] = raw.map(canonicalRow);
  } else if (raw && typeof raw === 'object') {
    const keyMap = { usage: 'usage_records', usageRecords: 'usage_records', borrow_records: 'usage_records' };
    Object.entries(raw).forEach(([key, rows]) => {
      const target = keyMap[key] || key;
      if (Object.hasOwn(document, target) && Array.isArray(rows)) document[target] = rows.map(canonicalRow);
    });
  }
  if (!Object.values(document).some((rows) => rows.length)) throw legacyImportError('文档中没有可导入的数据。');
  if (Object.values(document).reduce((sum, rows) => sum + rows.length, 0) > MAX_ROWS) throw legacyImportError(`单次最多导入 ${MAX_ROWS} 行数据。`);
  if (document.users.length > MAX_USER_ROWS) throw legacyImportError(`单次最多导入 ${MAX_USER_ROWS} 个用户账号，请拆分文档后分批导入。`);
  return document;
}

function parseLegacyDocument(content, options = {}) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''), 'utf8');
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) throw legacyImportError('暂不支持二进制 .xlsx，请另存为 CSV 或旧版 Excel（.xls）后导入。');
  const source = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!source) throw legacyImportError('文档内容为空。');
  const filename = trim(options.filename || '', 200).toLowerCase();
  let raw; let sourceFormat;
  if (filename.endsWith('.json') || /^[{[]/.test(source)) {
    try { raw = JSON.parse(source); } catch { throw legacyImportError('JSON 文档格式不正确。'); }
    sourceFormat = 'json';
  } else if (/<(?:html|table)\b/i.test(source) || /\.html?$|\.xls$/i.test(filename)) {
    raw = parseHtmlTables(source); sourceFormat = 'html-xls';
  } else { raw = parseCsv(source); sourceFormat = 'csv'; }
  // 上传文件没有服务器签名，format/version 只能用于识别结构，绝不能作为密码哈希可信证明。
  return { format: FORMAT_NAME, version: 1, source_format: sourceFormat, trusted_credentials: false, ...normalizeDocument(raw, options.dataset || 'auto') };
}

const rowsOf = (result) => Array.isArray(result) ? result : (result?.rows || []);
const bool = (value, fallback = false) => value === undefined || value === '' ? fallback : ['1', 'true', 'yes', '是'].includes(trim(value).toLowerCase());
const iso = (value) => {
  let source = trim(value, 100);
  if (!source) return null;
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/.test(source)) {
    source = source.includes(' ') ? source.replace(' ', 'T') : source;
    if (/^\d{4}-\d{2}-\d{2}$/.test(source)) source += 'T00:00:00';
    source += '+08:00';
  }
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const hash = (buffer) => nodeCrypto.createHash('sha256').update(buffer).digest('hex');
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};
function documentHash(document) {
  const sections = {};
  for (const key of ['users', 'devices', 'reservations', 'usage_records', 'faults', 'user_activity']) {
    sections[key] = (document[key] || []).map((row) => JSON.stringify(canonicalize(row))).sort();
  }
  return hash(Buffer.from(JSON.stringify(sections), 'utf8'));
}
const makeSummary = () => Object.fromEntries(['users', 'devices', 'reservations', 'usage_records', 'faults', 'user_activity'].map((key) => [key, { total: 0, create: 0, update: 0, skip: 0, invalid: 0 }]));
const STATUS = { 正常: 'active', 启用: 'active', 待审核: 'pending', 已通过: 'approved', 已拒绝: 'rejected', 已驳回: 'rejected', 已取消: 'cancelled', 使用中: 'in_use', 已完成: 'completed', 已归还: 'returned', 逾期: 'overdue', 处理中: 'processing', 已解决: 'resolved', 已关闭: 'closed' };
const safeStatus = (value, allowed, fallback) => { const status = STATUS[trim(value)] || trim(value).toLowerCase(); return allowed.includes(status) ? status : fallback; };

function createLegacyImportService({ crypto, fail, hashPassword, log, nowIso, ok, query, requireAdminRole, uuid, withTransaction }) {
  const readOptions = (payload = {}) => ({
    dataset: trim(payload.dataset || 'auto', 30), conflictPolicy: payload.conflict_policy === 'update' ? 'update' : 'skip',
    allowPartial: bool(payload.allow_partial), createMissingDevices: bool(payload.create_missing_devices)
  });
  function readFile(payload) {
    if (!payload?.file?.buffer) throw legacyImportError('请选择需要导入的旧文档。');
    const buffer = Buffer.from(payload.file.buffer);
    if (buffer.length > 10 * 1024 * 1024) throw legacyImportError('旧文档不能超过 10 MB。', 413, 5001);
    if (buffer.includes(0)) throw legacyImportError('检测到不支持的二进制文档，请上传 UTF-8 JSON、CSV 或 HTML 表格格式的 .xls。');
    return { buffer, name: trim(payload.file.originalname || 'legacy.json', 200) };
  }

  async function buildPreview(document, options, runQuery = query) {
    const summary = makeSummary(); const issues = [];
    const addIssue = (section, row, code, message) => { if (issues.length < MAX_ISSUES) issues.push({ section, row, code, message }); };
    const users = rowsOf(await runQuery('select id, phone, role, deleted_at from users'));
    const devices = rowsOf(await runQuery('select id, device_code, deleted_at from devices'));
    const knownUsers = new Set(users.filter((row) => !row.deleted_at).map((row) => trim(row.phone))); const incomingUsers = new Set();
    const deletedUsers = new Set(users.filter((row) => row.deleted_at).map((row) => trim(row.phone)));
    const privileged = new Set(users.filter((row) => !row.deleted_at && ['admin', 'super_admin'].includes(row.role)).map((row) => trim(row.phone)));
    const knownDevices = new Set(devices.filter((row) => !row.deleted_at).map((row) => trim(row.device_code))); const incomingDevices = new Set();
    const deletedDevices = new Set(devices.filter((row) => row.deleted_at).map((row) => trim(row.device_code)));
    document.users.forEach((row, index) => {
      const counter = summary.users; counter.total += 1; const phone = trim(row.phone, 30); const name = trim(row.name || row.user_name, 100);
      let error = '';
      if (!/^\+?[0-9-]{6,20}$/.test(phone)) error = '手机号/账号格式不正确，应为 6 至 20 位数字或连字符。';
      else if (!name) error = '用户姓名不能为空。';
      else if (incomingUsers.has(phone)) error = '文档中存在重复手机号/账号。';
      else if (deletedUsers.has(phone)) error = '该手机号/账号与已删除用户冲突，请先在系统中处理该账号。';
      if (error) { counter.invalid += 1; addIssue('users', index + 2, 'invalid_user', error); return; }
      incomingUsers.add(phone);
      if (!knownUsers.has(phone)) counter.create += 1;
      else if (options.conflictPolicy === 'update' && !privileged.has(phone)) counter.update += 1;
      else counter.skip += 1;
    });
    document.devices.forEach((row, index) => {
      const counter = summary.devices; counter.total += 1; const code = trim(row.device_code, 50);
      if (!code || incomingDevices.has(code) || deletedDevices.has(code)) {
        counter.invalid += 1;
        addIssue('devices', index + 2, deletedDevices.has(code) ? 'soft_deleted_device' : 'invalid_device', deletedDevices.has(code) ? '该设备编号与已删除设备冲突，请先在系统中处理该设备。' : (code ? '文档中存在重复设备编号。' : '设备编号不能为空。'));
        return;
      }
      incomingDevices.add(code);
      if (!knownDevices.has(code)) counter.create += 1; else counter[options.conflictPolicy === 'update' ? 'update' : 'skip'] += 1;
    });
    incomingUsers.forEach((value) => knownUsers.add(value)); incomingDevices.forEach((value) => knownDevices.add(value));
    const checkRecord = (section, row, index, reservation) => {
      const counter = summary[section]; counter.total += 1; const phone = trim(row.phone || row.user_phone, 30); const code = trim(row.device_code, 50); let invalid = false;
      if (!knownUsers.has(phone)) { addIssue(section, index + 2, deletedUsers.has(phone) ? 'soft_deleted_user' : 'unknown_user', deletedUsers.has(phone) ? '对应用户已删除，不能导入关联记录。' : '找不到对应用户手机号/账号。'); invalid = true; }
      if (deletedDevices.has(code)) { addIssue(section, index + 2, 'soft_deleted_device', '对应设备已删除，不能导入关联记录。'); invalid = true; }
      else if (!knownDevices.has(code) && !options.createMissingDevices) { addIssue(section, index + 2, 'unknown_device', '找不到对应设备编号。'); invalid = true; }
      if (reservation) { const start = iso(row.start_time); const end = iso(row.end_time); if (!start || !end || end <= start) { addIssue(section, index + 2, 'invalid_time', '预约开始或结束时间不正确。'); invalid = true; } }
      else if (!iso(row.borrow_time || row.start_time)) { addIssue(section, index + 2, 'invalid_borrow_time', '使用开始时间不正确。'); invalid = true; }
      counter[invalid ? 'invalid' : 'create'] += 1;
    };
    document.reservations.forEach((row, index) => checkRecord('reservations', row, index, true));
    document.usage_records.forEach((row, index) => checkRecord('usage_records', row, index, false));
    document.faults.forEach((row, index) => {
      const counter = summary.faults; counter.total += 1; const code = trim(row.device_code, 50);
      if (deletedDevices.has(code)) { counter.invalid += 1; addIssue('faults', index + 2, 'soft_deleted_device', '故障记录对应设备已删除。'); }
      else if (!knownDevices.has(code) && !options.createMissingDevices) { counter.invalid += 1; addIssue('faults', index + 2, 'unknown_device', '找不到故障记录对应的设备编号。'); }
      else counter.create += 1;
    });
    document.user_activity.forEach(() => { summary.user_activity.total += 1; summary.user_activity.create += 1; });
    return { summary, issues, detected_sections: Object.entries(document).filter(([, value]) => Array.isArray(value) && value.length).map(([key]) => key) };
  }

  async function adminPreviewLegacyImport(payload = {}, token) {
    await requireAdminRole(token, ['super_admin']);
    try {
      const file = readFile(payload); const options = readOptions(payload); const document = parseLegacyDocument(file.buffer, { filename: file.name, dataset: options.dataset });
      return ok({ source_name: file.name, source_hash: documentHash(document), source_format: document.source_format, ...await buildPreview(document, options) });
    } catch (error) {
      if (error?.isLegacyImportError) return fail(error.message, error.status || 400, error.code || 5001);
      return fail('旧文档预检失败，请检查数据库状态后重试。', 500, 5004);
    }
  }

  async function adminExecuteLegacyImport(payload = {}, token) {
    const { admin } = await requireAdminRole(token, ['super_admin']);
    let runId; let runStarted = false; let runContext; let completedResult;
    try {
      if (trim(payload.confirmation, 20) !== 'IMPORT') throw legacyImportError('请输入 IMPORT 确认执行旧文档导入。');
      const file = readFile(payload); const options = readOptions(payload);
      const document = parseLegacyDocument(file.buffer, { filename: file.name, dataset: options.dataset }); const preview = await buildPreview(document, options);
      const sourceHash = documentHash(document);
      if (preview.issues.length && !options.allowPartial) return fail('预检仍有错误，请修正文档或启用“跳过错误行”。', 409, 5002);
      const existingPhones = new Set(rowsOf(await query('select phone from users')).map((row) => trim(row.phone, 30)));
      const preparedPasswords = new Map();
      for (const [index, row] of document.users.entries()) {
        const phone = trim(row.phone, 30); const plainPassword = trim(row.password, 300);
        if (existingPhones.has(phone)) continue;
        const password = plainPassword || `Tmp-${crypto.randomBytes(9).toString('base64url')}!`;
        const salt = crypto.randomBytes(16).toString('hex');
        preparedPasswords.set(index, {
          hash: await hashPassword(password, salt),
          salt,
          generated: !plainPassword,
          temporaryPassword: plainPassword ? '' : password
        });
      }
      runId = uuid();
      runContext = { file, options, sourceHash, sourceFormat: document.source_format, preview };
      const result = await withTransaction(async (client) => {
        const tx = (sql, params = []) => client.query(sql, params); const summary = makeSummary(); const credentials = [];
        await tx("select pg_advisory_xact_lock(hashtext('legacy-document-import'))");
        const staleBefore = new Date(Date.now() - 60 * 60_000).toISOString();
        await tx("update legacy_import_runs set status='failed',error_message=$1,finished_at=$2 where source_sha256=$3 and status='running' and created_at < $4", ['导入进程已中断，可重新执行。', nowIso(), sourceHash, staleBefore]);
        if (rowsOf(await tx("select id from legacy_import_runs where source_sha256=$1 and status in ('running','completed') limit 1", [sourceHash]))[0]) {
          throw legacyImportError('该文档正在导入或已经成功导入过。', 409, 5003);
        }
        await tx('insert into legacy_import_runs (id,source_name,source_sha256,source_format,status,options,summary,created_by,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [runId, file.name, sourceHash, document.source_format, 'running', JSON.stringify(options), JSON.stringify(preview.summary), admin.user_id || admin.id, nowIso()]);
        runStarted = true;
        const userMap = new Map(rowsOf(await tx('select * from users')).map((row) => [trim(row.phone), row]));
        const deviceMap = new Map(rowsOf(await tx('select * from devices')).map((row) => [trim(row.device_code), row]));
        const seenUsers = new Set(); const seenDevices = new Set();
        for (const [rowIndex, row] of document.users.entries()) {
          const counter = summary.users; counter.total += 1; const phone = trim(row.phone, 30); const name = trim(row.name || row.user_name, 100); const current = userMap.get(phone);
          if (!/^\+?[0-9-]{6,20}$/.test(phone) || !name || seenUsers.has(phone) || current?.deleted_at) { counter.invalid += 1; continue; }
          seenUsers.add(phone);
          if (current && (['admin', 'super_admin'].includes(current.role) || options.conflictPolicy === 'skip')) { counter.skip += 1; continue; }
          let prepared = preparedPasswords.get(rowIndex);
          if (current) prepared = null;
          if (!current && !prepared) {
            const password = `Tmp-${crypto.randomBytes(9).toString('base64url')}!`; const salt = crypto.randomBytes(16).toString('hex');
            prepared = { hash: await hashPassword(password, salt), salt, generated: true, temporaryPassword: password };
          }
          const passwordHash = prepared?.hash || ''; const passwordSalt = prepared?.salt || ''; const reset = Boolean(prepared);
          const status = safeStatus(row.status, ['pending', 'active', 'disabled', 'rejected'], 'active'); const timestamp = nowIso();
          if (current) {
            await tx('update users set name=$1,student_no=$2,group_name=$3,department=$4,major=$5,mentor_name=$6,email=$7,status=$8,password_hash=coalesce($9,password_hash),password_salt=coalesce($10,password_salt),password_reset_required=case when $9 is null then password_reset_required else $11 end,temporary_password_expires_at=case when $9 is null then temporary_password_expires_at else null end,updated_at=$12 where id=$13', [name, trim(row.student_no, 50) || null, trim(row.group_name, 100) || null, trim(row.department, 100) || null, trim(row.major, 100) || null, trim(row.mentor_name, 100) || null, trim(row.email, 200) || null, status, passwordHash || null, passwordSalt || null, reset, timestamp, current.id]);
            if (passwordHash) await tx('update refresh_token_sessions set revoked_at=$1 where subject=$2 and revoked_at is null', [timestamp, current.id]);
            userMap.set(phone, { ...current, name, status }); counter.update += 1;
          } else {
            const id = uuid(); await tx('insert into users (id,name,phone,student_no,group_name,department,major,mentor_name,email,password_hash,password_salt,password_reset_required,role,status,approved_by,approved_at,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$16)', [id, name, phone, trim(row.student_no, 50) || null, trim(row.group_name, 100) || null, trim(row.department, 100) || null, trim(row.major, 100) || null, trim(row.mentor_name, 100) || null, trim(row.email, 200) || null, passwordHash, passwordSalt, reset, 'user', status, admin.user_id || admin.id, timestamp]);
            if (prepared?.temporaryPassword) {
              const temporaryPasswordExpiresAt = new Date(new Date(timestamp).getTime() + 7 * 24 * 60 * 60_000).toISOString();
              await tx('update users set temporary_password_expires_at=$1 where id=$2', [temporaryPasswordExpiresAt, id]);
              credentials.push({ phone, name, temporary_password: prepared.temporaryPassword, temporary_password_expires_at: temporaryPasswordExpiresAt });
            }
            userMap.set(phone, { id, phone, name, status, role: 'user' }); counter.create += 1;
          }
        }
        for (const row of document.devices) {
          const counter = summary.devices; counter.total += 1; const code = trim(row.device_code, 50); const current = deviceMap.get(code);
          if (!code || seenDevices.has(code) || current?.deleted_at) { counter.invalid += 1; continue; } seenDevices.add(code);
          if (current && options.conflictPolicy === 'skip') { counter.skip += 1; continue; }
          const name = trim(row.device_name || row.name || code, 100); const status = safeStatus(row.status, ['available', 'reserved', 'in_use', 'abnormal_pending', 'maintenance', 'disabled'], 'available'); const timestamp = nowIso();
          if (current) { await tx('update devices set name=$1,category=$2,location=$3,manager=$4,description=$5,status=$6,allow_reservation=$7,updated_by=$8,updated_at=$9 where id=$10', [name, trim(row.category, 50) || null, trim(row.location, 100) || null, trim(row.manager, 50) || null, trim(row.description, 1000) || null, status, bool(row.allow_reservation, true), admin.user_id || admin.id, timestamp, current.id]); deviceMap.set(code, { ...current, name, status }); counter.update += 1; }
          else { const id = uuid(); await tx('insert into devices (id,device_code,name,category,location,manager,status,allow_reservation,description,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$11)', [id, code, name, trim(row.category, 50) || null, trim(row.location, 100) || null, trim(row.manager, 50) || null, status, bool(row.allow_reservation, true), trim(row.description, 1000) || null, admin.user_id || admin.id, timestamp]); deviceMap.set(code, { id, device_code: code, name }); counter.create += 1; }
        }
        async function references(row, counter) {
          const user = userMap.get(trim(row.phone || row.user_phone, 30)); const code = trim(row.device_code, 50); let device = deviceMap.get(code);
          if (!device && options.createMissingDevices && code) { const id = uuid(); const timestamp = nowIso(); const name = trim(row.device_name || code, 100); await tx('insert into devices (id,device_code,name,status,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$5,$6,$6)', [id, code, name, 'available', admin.user_id || admin.id, timestamp]); device = { id, device_code: code, name }; deviceMap.set(code, device); }
          if (!user || user.deleted_at || !device || device.deleted_at) { counter.invalid += 1; return null; } return { user, device };
        }
        for (const row of document.reservations) {
          const counter = summary.reservations; counter.total += 1; const ref = await references(row, counter); const start = iso(row.start_time); const end = iso(row.end_time);
          if (!ref || !start || !end || end <= start) { if (ref) counter.invalid += 1; continue; }
          const status = safeStatus(row.status, ['pending', 'approved', 'rejected', 'cancelled', 'in_use', 'completed', 'no_show'], 'pending');
          if (['pending', 'approved', 'in_use'].includes(status) && rowsOf(await tx("select id from reservation_items where device_id=$1 and deleted_at is null and status=any($2) and tstzrange(start_time,end_time,'[)') && tstzrange($3::timestamptz,$4::timestamptz,'[)') limit 1", [ref.device.id, ['pending', 'approved', 'in_use'], start, end]))[0]) { counter.invalid += 1; continue; }
          const batchId = uuid(); const reservationId = uuid(); const itemId = uuid(); const timestamp = nowIso();
          await tx('insert into reservation_batches (id,user_id,device_codes,time_slots,purpose,admin_note,status,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)', [batchId, ref.user.id, ref.device.device_code, `${start} - ${end}`, trim(row.purpose, 500) || null, trim(row.admin_note, 500) || null, status, admin.user_id || admin.id, timestamp]);
          await tx('insert into reservations (id,device_id,user_id,start_time,end_time,purpose,status,admin_note,batch_id,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)', [reservationId, ref.device.id, ref.user.id, start, end, trim(row.purpose, 500) || null, status, trim(row.admin_note, 500) || null, batchId, timestamp]);
          await tx('insert into reservation_items (id,batch_id,device_id,user_id,reservation_date,slot_key,start_time,end_time,status,admin_note,reservation_id,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$13)', [itemId, batchId, ref.device.id, ref.user.id, start.slice(0, 10), 'custom', start, end, status, trim(row.admin_note, 500) || null, reservationId, admin.user_id || admin.id, timestamp]); counter.create += 1;
        }
        for (const row of document.usage_records) {
          const counter = summary.usage_records; counter.total += 1; const ref = await references(row, counter); const borrowed = iso(row.borrow_time || row.start_time);
          if (!ref || !borrowed) { if (ref) counter.invalid += 1; continue; }
          const returned = iso(row.return_time); const expected = iso(row.expected_return_time); const status = safeStatus(row.status, ['in_use', 'return_pending', 'returned', 'abnormal_pending', 'overdue'], returned ? 'returned' : 'in_use'); const timestamp = nowIso(); const recordId = uuid();
          const duration = Number.isFinite(Number(row.duration_minutes)) ? Math.max(0, Math.floor(Number(row.duration_minutes))) : (returned ? Math.max(0, Math.floor((new Date(returned) - new Date(borrowed)) / 60000)) : null);
          await tx('insert into borrow_records (id,device_id,user_id,borrow_time,expected_return_time,return_time,duration_minutes,return_condition,return_note,status,is_overdue,actual_start_time,actual_end_time,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$4,$6,$12,$13,$13)', [recordId, ref.device.id, ref.user.id, borrowed, expected, returned, duration, trim(row.return_condition, 100) || null, trim(row.return_note, 1000) || null, status, status === 'overdue', admin.user_id || admin.id, timestamp]);
          await tx('insert into usage_log (id,record_id,device_id,user_id,action,device_code,device_name,user_name,user_phone,user_student_no,borrow_time,expected_return_time,return_time,duration_minutes,record_status,return_condition,return_note,operator_name,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)', [uuid(), recordId, ref.device.id, ref.user.id, returned ? 'RETURN' : 'BORROW', ref.device.device_code, ref.device.name, ref.user.name, ref.user.phone, ref.user.student_no || null, borrowed, expected, returned, duration, status, trim(row.return_condition, 100) || null, trim(row.return_note, 1000) || null, admin.name || 'super_admin', timestamp]); counter.create += 1;
        }
        for (const row of document.faults) {
          const counter = summary.faults; counter.total += 1; const code = trim(row.device_code, 50); let device = deviceMap.get(code);
          if (!device && options.createMissingDevices && code) { const id = uuid(); const timestamp = nowIso(); const name = trim(row.device_name || code, 100); await tx('insert into devices (id,device_code,name,status,created_by,updated_by,created_at,updated_at) values ($1,$2,$3,$4,$5,$5,$6,$6)', [id, code, name, 'available', admin.user_id || admin.id, timestamp]); device = { id, device_code: code, name }; deviceMap.set(code, device); }
          if (!device || device.deleted_at) { counter.invalid += 1; continue; }
          const user = userMap.get(trim(row.phone || row.user_phone, 30)); const timestamp = iso(row.created_at) || nowIso();
          const status = safeStatus(row.status, ['pending', 'processing', 'resolved', 'closed'], 'pending');
          const severityMap = { 紧急: 'urgent', 严重: 'high', 高: 'high', 中: 'medium', 低: 'low', 普通: 'normal' };
          const severity = severityMap[trim(row.severity)] || trim(row.severity).toLowerCase() || 'normal';
          await tx('insert into device_fault_reports (id,device_id,user_id,issue_type,severity,description,status,admin_note,handled_by,handled_at,updated_by,created_at,updated_at,resolved_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$11,$12,$13)', [uuid(), device.id, user?.id || null, trim(row.issue_type, 100) || 'fault', severity, trim(row.description, 2000) || null, status, trim(row.admin_note, 1000) || null, ['resolved', 'closed'].includes(status) ? (admin.user_id || admin.id) : null, iso(row.handled_at), timestamp, nowIso(), ['resolved', 'closed'].includes(status) ? (iso(row.handled_at) || timestamp) : null]); counter.create += 1;
        }
        for (const row of document.user_activity) {
          const counter = summary.user_activity; counter.total += 1; const phone = trim(row.phone || row.user_phone, 30); const user = userMap.get(phone);
          await tx('insert into user_activity_logs (id,user_id,event_type,user_name,phone,device_type,ip_address,remark,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [uuid(), user?.id || null, trim(row.event_type, 100) || 'legacy_import', trim(row.name || row.user_name, 100) || user?.name || null, phone || null, trim(row.device_type, 100) || null, trim(row.ip_address, 100) || null, trim(row.remark, 1000) || null, iso(row.created_at) || nowIso()]); counter.create += 1;
        }
        const invalidRows = Object.values(summary).reduce((total, section) => total + Number(section.invalid || 0), 0);
        if (!options.allowPartial && invalidRows > 0) {
          throw legacyImportError('导入期间发现数据冲突，未写入任何业务数据。请重新预检或启用“跳过错误行”。', 409, 5002);
        }
        await log('legacy_document_import', { source_hash: sourceHash, source_format: document.source_format, summary }, admin, null, runId, tx);
        await tx('update legacy_import_runs set status=$1,summary=$2,finished_at=$3 where id=$4', ['completed', JSON.stringify(summary), nowIso(), runId]);
        completedResult = { summary, credentials };
        return completedResult;
      });
      return ok({ message: '旧文档导入完成。', import_run_id: runId, source_hash: sourceHash, summary: result.summary, one_time_credentials: result.credentials });
    } catch (error) {
      const duplicate = error?.code === '23505';
      const exposed = error?.isLegacyImportError;
      const storedMessage = exposed ? trim(error.message, 1000) : (duplicate ? '相同文档正在导入或已经导入。' : '内部错误，业务数据已回滚。');
      if (runStarted && runId && runContext && completedResult) {
        try {
          const persisted = rowsOf(await query('select status from legacy_import_runs where id=$1 limit 1', [runId]))[0];
          if (persisted?.status === 'completed') {
            return ok({ message: '旧文档导入完成。', import_run_id: runId, source_hash: runContext.sourceHash, summary: completedResult.summary, one_time_credentials: completedResult.credentials });
          }
        } catch (_) {}
      }
      if (runStarted && runId && runContext) {
        try {
          await query(`
            insert into legacy_import_runs (
              id,source_name,source_sha256,source_format,status,options,summary,error_message,created_by,created_at,finished_at
            ) values ($1,$2,$3,$4,'failed',$5,$6,$7,$8,$9,$9)
            on conflict (id) do nothing
          `, [runId, runContext.file.name, runContext.sourceHash, runContext.sourceFormat, JSON.stringify(runContext.options), JSON.stringify(runContext.preview.summary), storedMessage, admin.user_id || admin.id, nowIso()]);
        } catch (_) {}
        try {
          await log('legacy_document_import_failed', {
            source_hash: runContext.sourceHash,
            source_format: runContext.sourceFormat,
            error_code: duplicate ? 5003 : (exposed ? (error.code || 5004) : 5004)
          }, admin, null, runId);
        } catch (_) {}
      }
      if (duplicate) return fail('该文档正在导入或已经成功导入过。', 409, 5003);
      if (exposed) return fail(error.message, error.status || 400, error.code || 5004);
      return fail('旧文档导入失败，数据库已回滚。', 500, 5004);
    }
  }

  const legacyImportTemplate = () => ({ format: FORMAT_NAME, version: 1, exported_at: nowIso(), instructions: '上传后先预检。明文 password 仅用于迁移，服务端立即加密且不写入日志。', users: [{ name: '示例用户', phone: '13800000000', password: '请替换', student_no: '20260001', department: '示例学院', major: '示例专业', mentor_name: '示例导师', role: 'user', status: 'active' }], devices: [{ device_code: 'DEVICE-001', device_name: '示例设备', category: '通用', location: '实验室 A', status: 'available' }], reservations: [{ phone: '13800000000', device_code: 'DEVICE-001', start_time: '2026-08-01T01:00:00.000Z', end_time: '2026-08-01T03:00:00.000Z', status: 'completed', purpose: '示例预约' }], usage_records: [{ phone: '13800000000', device_code: 'DEVICE-001', borrow_time: '2026-08-01T01:00:00.000Z', return_time: '2026-08-01T02:30:00.000Z', status: 'returned' }], faults: [{ phone: '13800000000', device_code: 'DEVICE-001', issue_type: 'fault', severity: 'normal', status: 'resolved', description: '示例故障' }], user_activity: [{ phone: '13800000000', name: '示例用户', event_type: 'login', device_type: 'web', created_at: '2026-08-01T01:00:00.000Z' }] });
  return { adminExecuteLegacyImport, adminPreviewLegacyImport, legacyImportTemplate };
}

module.exports = {
  FORMAT_NAME,
  createLegacyImportService,
  documentHash,
  normalizeLegacyTimestamp: iso,
  parseCsv,
  parseHtmlTables,
  parseLegacyDocument
};
