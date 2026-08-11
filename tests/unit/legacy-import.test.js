const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const {
  FORMAT_NAME,
  createLegacyImportService,
  documentHash,
  normalizeLegacyTimestamp,
  parseLegacyDocument
} = require('../../src/services/domains/imports/legacy-import-service');

test('parses canonical migration JSON sections', () => {
  const parsed = parseLegacyDocument(Buffer.from(JSON.stringify({ format: FORMAT_NAME, users: [{ name: '张三', phone: '13800000000' }], devices: [{ device_code: 'D-1' }], reservations: [{ phone: '13800000000', device_code: 'D-1', start_time: '2026-08-01T01:00:00Z', end_time: '2026-08-01T02:00:00Z' }], usage_records: [{ phone: '13800000000', device_code: 'D-1', borrow_time: '2026-08-01T01:00:00Z' }] })), { filename: 'backup.json' });
  assert.equal(parsed.users[0].phone, '13800000000'); assert.equal(parsed.devices[0].device_code, 'D-1'); assert.equal(parsed.reservations.length, 1); assert.equal(parsed.usage_records.length, 1);
});

test('auto detects current reservation CSV headers', () => {
  const parsed = parseLegacyDocument(Buffer.from('\uFEFF设备编号,设备名称,预约人,手机号,开始时间,结束时间,状态\nD-2,显微镜,李四,13900000000,2026-08-01 09:00,2026-08-01 10:00,已完成'), { filename: 'reservations.csv' });
  assert.equal(parsed.reservations[0].device_code, 'D-2'); assert.equal(parsed.reservations[0].phone, '13900000000');
});

test('parses current HTML table .xls exports', () => {
  const html = '<table><tr><th>设备编号</th><th>使用人</th><th>手机号</th><th>借出时间</th><th>归还时间</th></tr><tr><td>D&amp;3</td><td>王五</td><td>13700000000</td><td>2026-08-01 09:00</td><td>2026-08-01 10:00</td></tr></table>';
  const parsed = parseLegacyDocument(Buffer.from(html), { filename: 'usage.xls' });
  assert.equal(parsed.source_format, 'html-xls'); assert.equal(parsed.usage_records[0].device_code, 'D&3'); assert.equal(parsed.usage_records[0].user_name, '王五');
});

test('supports explicit users dataset and aliases', () => {
  const parsed = parseLegacyDocument(Buffer.from('账号,姓名,密码,学院\n13800000001,赵六,old-password,化学学院'), { filename: 'accounts.csv', dataset: 'users' });
  assert.equal(parsed.users[0].phone, '13800000001'); assert.equal(parsed.users[0].name, '赵六'); assert.equal(parsed.users[0].password, 'old-password');
});

test('recognizes fault and user activity administrator exports', () => {
  const faults = parseLegacyDocument(Buffer.from('设备编号,故障类型,严重程度,状态,描述\nD-1,电源故障,高,已解决,无法启动'), { filename: 'faults.csv' });
  const activity = parseLegacyDocument(Buffer.from('事件,姓名,手机号,终端类型,时间\n登录,张三,13800000000,web,2026-08-01 09:00'), { filename: 'activity.csv' });
  assert.equal(faults.faults[0].issue_type, '电源故障');
  assert.equal(activity.user_activity[0].event_type, '登录');
});

test('rejects binary xlsx', () => assert.throws(() => parseLegacyDocument(Buffer.from([0x50, 0x4b, 3, 4]), { filename: 'data.xlsx' }), /xlsx/));

test('enforces maximum row count', () => {
  const users = Array.from({ length: 10001 }, (_, index) => ({ name: `U${index}`, phone: `138${String(index).padStart(8, '0')}` }));
  assert.throws(() => parseLegacyDocument(Buffer.from(JSON.stringify({ users })), { filename: 'large.json' }), /10000/);
});

test('limits password-bearing user imports to a bounded batch', () => {
  const users = Array.from({ length: 201 }, (_, index) => ({ name: `U${index}`, phone: `138${String(index).padStart(8, '0')}` }));
  assert.throws(() => parseLegacyDocument(Buffer.from(JSON.stringify({ users })), { filename: 'users.json' }), /200/);
});

test('normalizes timezone-less legacy timestamps as Asia/Shanghai', () => {
  assert.equal(normalizeLegacyTimestamp('2026-08-01 09:00'), '2026-08-01T01:00:00.000Z');
  assert.equal(normalizeLegacyTimestamp('2026-08-01T09:00:00+08:00'), '2026-08-01T01:00:00.000Z');
  assert.equal(normalizeLegacyTimestamp('not-a-time'), null);
});

test('canonical document hash ignores JSON object key order', () => {
  const left = parseLegacyDocument(Buffer.from(JSON.stringify({ users: [{ name: '张三', phone: '13800000000' }] })), { filename: 'left.json' });
  const right = parseLegacyDocument(Buffer.from(JSON.stringify({ users: [{ phone: '13800000000 ', name: ' 张三' }] })), { filename: 'right.json' });
  assert.equal(documentHash(left), documentHash(right));
});

function createImportHarness(options = {}) {
  const users = options.users || [];
  const devices = options.devices || [];
  const outerCalls = [];
  const transactionCalls = [];
  const committed = [];
  const failedRuns = [];
  const hashCalls = [];
  let rolledBack = false;
  let sequence = 0;

  const query = async (sql, params = []) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
    outerCalls.push({ sql: normalized, params });
    if (/select id, phone, role, deleted_at from users/.test(normalized)) return users;
    if (/select id, device_code, deleted_at from devices/.test(normalized)) return devices;
    if (/select phone from users/.test(normalized)) return users.map(({ phone }) => ({ phone }));
    if (/select status from legacy_import_runs/.test(normalized)) return [];
    if (/insert into legacy_import_runs/.test(normalized) && normalized.includes("'failed'")) {
      failedRuns.push({ sql: normalized, params });
      return [];
    }
    return [];
  };

  const service = createLegacyImportService({
    crypto: nodeCrypto,
    fail: (message, status = 400, code) => ({ ok: false, message, status, code }),
    hashPassword: async (password, salt) => {
      hashCalls.push({ password, salt });
      return 'a'.repeat(128);
    },
    log: async () => {},
    nowIso: () => '2026-08-01T00:00:00.000Z',
    ok: (data = {}) => ({ ok: true, ...data }),
    query,
    requireAdminRole: async () => ({ admin: { id: 'admin-1', role: 'super_admin', name: 'Root' } }),
    uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    withTransaction: async (work) => {
      const staged = [];
      const client = {
        async query(sql, params = []) {
          const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
          transactionCalls.push({ sql: normalized, params });
          if (/pg_advisory_xact_lock/.test(normalized)) return { rows: [], rowCount: 1 };
          if (/select id from legacy_import_runs/.test(normalized)) return { rows: options.duplicateRun ? [{ id: 'existing' }] : [], rowCount: options.duplicateRun ? 1 : 0 };
          if (/select \* from users/.test(normalized)) return { rows: users, rowCount: users.length };
          if (/select \* from devices/.test(normalized)) return { rows: devices, rowCount: devices.length };
          if (/from reservation_items/.test(normalized) && /tstzrange/.test(normalized)) {
            return { rows: options.reservationConflict ? [{ id: 'conflict' }] : [], rowCount: options.reservationConflict ? 1 : 0 };
          }
          if (options.failCompletedStatus && /update legacy_import_runs set status=\$1/.test(normalized) && params[0] === 'completed') {
            throw new Error('simulated completed-state failure');
          }
          if (/^(insert|update)/.test(normalized)) staged.push({ sql: normalized, params });
          return { rows: [], rowCount: 1 };
        }
      };
      try {
        const result = await work(client);
        committed.push(...staged);
        return result;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    }
  });

  return { service, outerCalls, transactionCalls, committed, failedRuns, hashCalls, get rolledBack() { return rolledBack; } };
}

function importFile(document, name = 'legacy.json') {
  return { originalname: name, buffer: Buffer.from(JSON.stringify(document)) };
}

test('preview reports soft-deleted account conflicts before execution', async () => {
  const harness = createImportHarness({ users: [{ id: 'deleted-1', phone: '13800000000', role: 'user', deleted_at: '2026-01-01T00:00:00Z' }] });
  const result = await harness.service.adminPreviewLegacyImport({ file: importFile({ users: [{ name: '张三', phone: '13800000000' }] }) }, {});
  assert.equal(result.ok, true);
  assert.equal(result.summary.users.invalid, 1);
  assert.match(result.issues[0].message, /已删除用户冲突/);
});

test('legacy hashes and plaintext never overwrite an existing password', async () => {
  const harness = createImportHarness({ users: [{ id: 'user-1', phone: '13800000000', role: 'user', deleted_at: null, name: '旧姓名' }] });
  const file = importFile({ format: FORMAT_NAME, version: 1, users: [{ name: '新姓名', phone: '13800000000', password: 'attacker-controlled', password_hash: 'f'.repeat(128), password_salt: 'unsafe-salt' }] });
  const result = await harness.service.adminExecuteLegacyImport({ file, conflict_policy: 'update', confirmation: 'IMPORT' }, {});
  assert.equal(result.ok, true);
  const update = harness.committed.find(({ sql }) => /^update users set name=/.test(sql));
  assert.ok(update);
  assert.equal(update.params[8], null);
  assert.equal(update.params[9], null);
  assert.equal(harness.hashCalls.length, 0);
  assert.equal(harness.committed.some(({ sql }) => /update refresh_token_sessions/.test(sql)), false);
});

test('new users without passwords receive a seven-day temporary password', async () => {
  const harness = createImportHarness();
  const result = await harness.service.adminExecuteLegacyImport({ file: importFile({ users: [{ name: '张三', phone: '13800000000' }] }), confirmation: 'IMPORT' }, {});
  assert.equal(result.ok, true);
  assert.equal(result.one_time_credentials.length, 1);
  assert.match(result.one_time_credentials[0].temporary_password, /^Tmp-/);
  assert.equal(result.one_time_credentials[0].temporary_password_expires_at, '2026-08-08T00:00:00.000Z');
  assert.equal(harness.hashCalls.length, 1);
});

test('execution confirmation is enforced by the service, not only the browser', async () => {
  const harness = createImportHarness();
  const result = await harness.service.adminExecuteLegacyImport({ file: importFile({ devices: [{ device_code: 'D-1' }] }) }, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.message, /IMPORT/);
  assert.equal(harness.transactionCalls.length, 0);
});

test('completed task status failure rolls back business writes and records a failed run', async () => {
  const harness = createImportHarness({ failCompletedStatus: true });
  const result = await harness.service.adminExecuteLegacyImport({ file: importFile({ devices: [{ device_code: 'D-1', device_name: '显微镜' }] }), confirmation: 'IMPORT' }, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(harness.rolledBack, true);
  assert.equal(harness.committed.length, 0);
  assert.equal(harness.failedRuns.length, 1);
});

test('runtime reservation conflicts roll back when partial import is disabled', async () => {
  const harness = createImportHarness({
    users: [{ id: 'user-1', phone: '13800000000', role: 'user', deleted_at: null, name: '张三' }],
    devices: [{ id: 'device-1', device_code: 'D-1', deleted_at: null, name: '显微镜' }],
    reservationConflict: true
  });
  const file = importFile({ reservations: [{ phone: '13800000000', device_code: 'D-1', start_time: '2026-08-01 09:00', end_time: '2026-08-01 10:00' }] });
  const result = await harness.service.adminExecuteLegacyImport({ file, confirmation: 'IMPORT', allow_partial: 'false' }, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(harness.rolledBack, true);
  assert.equal(harness.committed.length, 0);
});

test('legacy import routes and role handling stay restricted', () => {
  const route = fs.readFileSync(path.resolve(__dirname, '../../src/routes/v5/admin.js'), 'utf8');
  const service = fs.readFileSync(path.resolve(__dirname, '../../src/services/domains/imports/legacy-import-service.js'), 'utf8');
  assert.match(route, /legacy-import\/preview', requireRole\('super_admin'\)/);
  assert.match(route, /legacy-import\/execute', requireRole\('super_admin'\)/);
  assert.match(service, /\['admin', 'super_admin'\]\.includes\(current\.role\)/);
  assert.match(service, /password_reset_required/);
  assert.doesNotMatch(service, /temporary_password[^\n]+log\(/);
});
