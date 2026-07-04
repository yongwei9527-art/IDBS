const fs = require('fs');
const path = require('path');

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportRowsToCsv(rows = []) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  if (!headers.length) return '';
  return [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((header) => csvCell(row?.[header])).join(','))].join('\n');
}

function createExportService(context = {}) {
  const {
    adminExportData,
    fail,
    log,
    nowIso,
    ok,
    query,
    queryOne,
    requireAdminRole,
    safeFilename,
    uploadDir,
    uuid,
    withTransaction
  } = context;

  async function adminCreateExportJob(payload = {}, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['stats.export']);
    const type = String(payload.type || 'usage').trim();
    const allowedTypes = new Set(['usage', 'reservations', 'faults', 'user_activity', 'device_summary']);
    if (!allowedTypes.has(type)) return fail('不支持的导出类型。', 400, 2001);
    const params = {
      user_id: payload.user_id || '',
      device_id: payload.device_id || '',
      start_date: payload.start_date || '',
      end_date: payload.end_date || ''
    };
    const job = await queryOne(`
      insert into export_jobs (id, type, params, status, created_by, created_at)
      values ($1, $2, $3::jsonb, 'pending', $4, $5)
      returning *
    `, [uuid(), type, JSON.stringify(params), admin.id, nowIso()]);
    await log('create_export_job', { type, params, job_id: job?.id }, admin, null, job?.id || null);
    return ok({ job });
  }

  async function adminRunNextExportJob(_, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['stats.export']);
    const job = await withTransaction(async (client) => {
      const row = await client.queryOne(`
        select * from export_jobs
        where status = 'pending'
        order by created_at asc
        for update skip locked
        limit 1
      `);
      if (!row) return null;
      await client.query('update export_jobs set status = $1, started_at = $2 where id = $3', ['running', nowIso(), row.id]);
      return row;
    });
    if (!job) return ok({ job: null, message: '暂无待处理导出任务' });

    try {
      const params = typeof job.params === 'string' ? JSON.parse(job.params || '{}') : (job.params || {});
      const result = await adminExportData({ ...params, type: job.type }, token);
      if (result.ok === false) throw new Error(result.message || '导出失败');
      const rows = result.rows || [];
      const dir = path.join(uploadDir, 'exports');
      await fs.promises.mkdir(dir, { recursive: true });
      const filename = safeFilename(`${job.type}_${job.id}.csv`);
      const fullPath = path.join(dir, filename);
      await fs.promises.writeFile(fullPath, `\ufeff${exportRowsToCsv(rows)}`, 'utf8');
      const filePath = `/uploads/exports/${filename}`;
      const updated = await queryOne(`
        update export_jobs
        set status = 'finished', row_count = $1, file_path = $2, error_message = null, finished_at = $3
        where id = $4
        returning *
      `, [rows.length, filePath, nowIso(), job.id]);
      await log('finish_export_job', { job_id: job.id, type: job.type, row_count: rows.length, file_path: filePath }, admin, null, job.id);
      return ok({ job: updated });
    } catch (error) {
      const updated = await queryOne(`
        update export_jobs
        set status = 'failed', error_message = $1, finished_at = $2
        where id = $3
        returning *
      `, [String(error.message || error).slice(0, 1000), nowIso(), job.id]);
      await log('fail_export_job', { job_id: job.id, type: job.type, error: updated?.error_message }, admin, null, job.id);
      return ok({ job: updated });
    }
  }

  async function adminListExportJobs(params = {}, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['stats.export']);
    const limit = Math.min(Number(params.limit) || 20, 100);
    const rows = await query(`
      select j.*, u.name as created_by_name
      from export_jobs j
      left join users u on u.id = j.created_by
      where ($1::text in ('super_admin','admin') or j.created_by = $2)
      order by j.created_at desc
      limit $3
    `, [admin.role, admin.id, limit]);
    return ok({ jobs: rows || [] });
  }

  return {
    adminCreateExportJob,
    adminListExportJobs,
    adminRunNextExportJob
  };
}

module.exports = {
  createExportService,
  csvCell,
  exportRowsToCsv
};
