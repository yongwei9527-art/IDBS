const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createExportService, csvCell, hasExportPermission, isSupportedExportType } = require('../../src/services/domains/reports/export-service');

function context(overrides = {}) {
  const calls = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratory-management-system-export-'));
  const exportDir = path.join(tempDir, 'dedicated-exports');
  const job = { id: 'job-1', type: 'usage', params: {}, status: 'running', created_by: 'admin-1', attempt_count: 1, max_attempts: 3 };
  const client = {
    async queryOne(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('select * from export_jobs')) return job;
      if (String(sql).includes("set status = 'running'")) return job;
      return null;
    }
  };
  return {
    calls,
    tempDir,
    service: createExportService({
      adminExportData: async () => ({ ok: true, rows: [{ device_code: 'D-001' }] }),
      effectiveRolePermissions: () => ['*'],
      exportDir,
      exportRetentionDays: 30,
      fail: (message, status, code) => ({ ok: false, message, status, code }),
      log: async () => {},
      nowIso: () => '2026-07-12T10:00:00.000Z',
      ok: (data) => ({ ok: true, data }),
      query: async (sql, params = []) => { calls.push({ sql: String(sql), params }); return []; },
      queryOne: async (sql, params = []) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes("set status = 'finished'")) return { ...job, status: 'finished', file_path: '/uploads/exports/usage_job-1_lease-2.csv' };
        if (String(sql).includes('set status = case')) return { ...job, status: 'pending', attempt_count: 1 };
        if (String(sql).includes('select * from export_jobs')) return job;
        return null;
      },
      requireAdminRole: async () => ({ admin: { id: 'admin-1', role: 'super_admin' }, role: { role_key: 'super_admin', permissions: ['*'] } }),
      safeFilename: (value) => String(value).replace(/[^a-zA-Z0-9_.-]/g, '_'),
      uuid: (() => { let value = 0; return () => `lease-${++value}`; })(),
      withTransaction: async (work) => work(client),
      ...overrides
    }),
    exportDir
  };
}

test('export worker claims pending or expired jobs with a lease and publishes only its lease result', async () => {
  const fixture = context();
  const result = await fixture.service.adminRunNextExportJob({}, 'token');
  assert.equal(result.ok, true);
  assert.equal(result.data.job.status, 'finished');
  assert.equal(result.data.job.file_path, undefined);
  assert.match(result.data.job.download_url, /\/api\/v5\/admin\/export-jobs\/job-1\/download$/);
  assert.ok(fixture.calls.some((call) => call.sql.includes("status = 'running' and coalesce(lease_expires_at")));
  assert.ok(fixture.calls.some((call) => call.sql.includes("for update skip locked")));
  const claimCall = fixture.calls.find((call) => call.sql.includes('for update skip locked'));
  assert.match(claimCall.sql, /and \(\$1::text = 'super_admin' or created_by = \$2\)/);
  assert.deepEqual(claimCall.params, ['super_admin', 'admin-1']);
  assert.ok(fixture.calls.some((call) => call.sql.includes("lease_token = $4")));
  assert.equal(fs.readdirSync(fixture.exportDir).filter((name) => name.endsWith('.csv')).length, 1);
  const cleanupCall = fixture.calls.find((call) => call.sql.includes("finished_at < now() - ($1 * interval '1 day')"));
  assert.deepEqual(cleanupCall?.params, [30]);
  fs.rmSync(fixture.tempDir, { recursive: true, force: true });
});

test('failed export is returned to the queue with bounded retry backoff', async () => {
  const fixture = context({ adminExportData: async () => ({ ok: false, message: 'source unavailable' }) });
  const result = await fixture.service.adminRunNextExportJob({}, 'token');
  assert.equal(result.ok, true);
  assert.equal(result.data.job.status, 'pending');
  assert.equal(result.data.message, '导出失败，已安排重试');
  assert.ok(fixture.calls.some((call) => call.sql.includes('least(900, 30 * power(2')));
  fs.rmSync(fixture.tempDir, { recursive: true, force: true });
});

test('download resolution rejects paths outside the export directory', async () => {
  const fixture = context({
    queryOne: async (sql) => String(sql).includes('select * from export_jobs')
      ? { id: 'job-1', type: 'usage', status: 'finished', created_by: 'admin-1', file_path: '/uploads/exports/../secret.csv' }
      : null
  });
  const result = await fixture.service.adminGetExportJobDownload({ id: 'job-1' }, 'token');
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  fs.rmSync(fixture.tempDir, { recursive: true, force: true });
});

test('CSV cells neutralize spreadsheet formulas without changing numeric negatives', () => {
  const decodeCell = (cell) => {
    if (!cell.startsWith('"')) return cell;
    return cell.slice(1, -1).replace(/""/g, '"');
  };
  const formulas = [
    '=HYPERLINK("https://example.invalid")',
    '+SUM(1,2)',
    '-1+1',
    '@SUM(1,2)',
    '\t=1+1',
    '\r=1+1',
    '\n=1+1',
    '  =1+1'
  ];
  for (const formula of formulas) assert.equal(decodeCell(csvCell(formula)), "'" + formula);
  assert.equal(csvCell(-12), '-12');
  assert.equal(csvCell('ordinary text'), 'ordinary text');
});

test('sync and queued exports share the same permission matrix', () => {
  const admin = { id: 'admin-1', role: 'admin' };
  const permissions = (role) => role.permissions || [];
  assert.equal(isSupportedExportType('faults'), true);
  assert.equal(isSupportedExportType('unknown'), false);
  assert.equal(hasExportPermission('faults', admin, { permissions: ['stats.export', 'return.view'] }, permissions), false);
  assert.equal(hasExportPermission('faults', admin, { permissions: ['stats.export', 'device.view'] }, permissions), true);
  assert.equal(hasExportPermission('faults', admin, { permissions: ['stats.export', 'device.manage'] }, permissions), true);
  assert.equal(hasExportPermission('faults', admin, { permissions: ['stats.export', 'fault.manage'] }, permissions), true);
  assert.equal(hasExportPermission('unknown', admin, { permissions: ['*'] }, permissions), false);

  const rentalSource = fs.readFileSync(path.join(__dirname, '../../src/services/create-rental-service.js'), 'utf8');
  assert.doesNotMatch(rentalSource, /const exportPermissionRules =/);
  assert.match(rentalSource, /hasExportPermission\(type, admin, role, effectiveRolePermissions\)/);
});

test('ordinary administrators only claim their own export jobs', async () => {
  const fixture = context({
    effectiveRolePermissions: (role) => role.permissions || [],
    requireAdminRole: async () => ({
      admin: { id: 'admin-2', role: 'admin' },
      role: { role_key: 'admin', permissions: ['stats.export'] }
    })
  });
  await fixture.service.adminRunNextExportJob({}, 'token');
  const claimCall = fixture.calls.find((call) => call.sql.includes('for update skip locked'));
  assert.match(claimCall.sql, /and \(\$1::text = 'super_admin' or created_by = \$2\)/);
  assert.deepEqual(claimCall.params, ['admin', 'admin-2']);
  fs.rmSync(fixture.tempDir, { recursive: true, force: true });
});

test('export failures do not expose arbitrary internal error messages', async () => {
  const internalMessage = '内部租户编号、磁盘路径和数据库口令不得返回给用户';
  const fixture = context({ adminExportData: async () => { throw new Error(internalMessage); } });
  await fixture.service.adminRunNextExportJob({}, 'token');
  const failureCall = fixture.calls.find((call) => call.sql.includes('set status = case'));
  assert.ok(failureCall);
  assert.notEqual(failureCall.params[0], internalMessage);
  assert.equal(failureCall.params[0], '导出任务执行失败，请检查目录权限、数据库连接或筛选条件。');
  fs.rmSync(fixture.tempDir, { recursive: true, force: true });
});

test('download resolution returns an already-opened regular file handle', async () => {
  const fixture = context({
    queryOne: async (sql) => String(sql).includes('select * from export_jobs')
      ? { id: 'job-1', type: 'usage', status: 'finished', created_by: 'admin-1', file_path: '/uploads/exports/usage_job-1.csv' }
      : null
  });
  fs.mkdirSync(fixture.exportDir, { recursive: true });
  const filePath = path.join(fixture.exportDir, 'usage_job-1.csv');
  fs.writeFileSync(filePath, 'safe export', 'utf8');
  const result = await fixture.service.adminGetExportJobDownload({ id: 'job-1' }, 'token');
  assert.equal(result.ok, true);
  assert.equal(result.data.content_length, Buffer.byteLength('safe export'));
  assert.equal(result.data.download_name, 'usage_job-1.csv');
  assert.equal((await result.data.file_handle.stat()).isFile(), true);
  await result.data.file_handle.close();
  fs.rmSync(fixture.tempDir, { recursive: true, force: true });
});

test('download resolution rejects symbolic links', async (t) => {
  const fixture = context({
    queryOne: async (sql) => String(sql).includes('select * from export_jobs')
      ? { id: 'job-1', type: 'usage', status: 'finished', created_by: 'admin-1', file_path: '/uploads/exports/usage_job-1.csv' }
      : null
  });
  fs.mkdirSync(fixture.exportDir, { recursive: true });
  const outsidePath = path.join(fixture.tempDir, 'outside.csv');
  const linkPath = path.join(fixture.exportDir, 'usage_job-1.csv');
  fs.writeFileSync(outsidePath, 'secret', 'utf8');
  try {
    fs.symlinkSync(outsidePath, linkPath, 'file');
  } catch (error) {
    fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) return t.skip('Current platform does not permit symlink creation.');
    throw error;
  }
  const result = await fixture.service.adminGetExportJobDownload({ id: 'job-1' }, 'token');
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  fs.rmSync(fixture.tempDir, { recursive: true, force: true });
});
