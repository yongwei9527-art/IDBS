const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createExportService } = require('../../src/services/domains/reports/export-service');

function context(overrides = {}) {
  const calls = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idbs-export-'));
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
      uploadDir: tempDir,
      uuid: (() => { let value = 0; return () => `lease-${++value}`; })(),
      withTransaction: async (work) => work(client),
      ...overrides
    })
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
  assert.ok(fixture.calls.some((call) => call.sql.includes("lease_token = $4")));
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
