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

const BUSINESS_STATUS = {
  pending: '待审核', approved: '已通过', rejected: '已驳回', cancelled: '已取消',
  in_use: '使用中', reserved: '已预约', completed: '已完成', returned: '已归还', overdue: '逾期',
  resolved: '已解决', processing: '处理中', closed: '已关闭', faulted: '异常结束',
  active: '正常', disabled: '停用', abnormal_pending: '异常待处理', available: '可用', maintenance: '维护中', normal: '正常'
};

const EXPORT_ACTION_LABEL = {
  login: '登录', password_login: '密码登录', register: '注册', wechat_bind: '微信绑定', wechat_scan: '微信扫码',
  approve_reservation_batch: '批量通过预约', approve_reservation_item: '通过预约明细', approve_reservation: '通过预约申请',
  bulk_approve_reservations: '批量审批预约', reject_reservation_batch: '批量驳回预约', reject_reservation: '驳回预约申请',
  review_user_request: '处理用户诉求', submit_return: '提交设备归还', create_export_job: '创建导出任务',
  finish_export_job: '完成导出任务', fail_export_job: '导出任务失败', update_security_config: '修改系统配置',
  grant_admin_role: '授予管理员权限', upsert_admin_role: '更新管理员角色', revoke_admin_role: '撤销管理员角色',
  set_user_ban: '调整账号封禁状态', disable_user: '停用用户账号', set_user_status: '调整用户状态', delete_user: '删除用户', unbind_wechat: '解绑微信',
  create_chat_conversation: '创建沟通会话', send_chat_message: '发送沟通消息', dissolve_chat_conversation: '解散沟通会话',
  update_device: '更新设备信息', set_device_available: '设备恢复可用', resolve_device_fault: '处理设备故障',
  resolve_fault_processing: '故障转处理中', resolve_fault_resolved: '故障处理完成', export_faults: '导出故障记录'
};

const EXPORT_TARGET_LABEL = {
  user: '用户', users: '用户', account: '账号', admin: '管理员', admin_role: '管理员角色', role: '角色',
  device: '设备', reservation: '预约', reservation_batch: '预约批次', reservation_item: '预约明细',
  fault: '故障', faults: '故障记录', request: '用户诉求', chat: '沟通会话', security: '安全配置', borrow_record: '借还记录', return_archive: '归还归档', system: '系统', export_job: '导出任务'
};

const PERMISSION_LABEL = {
  '*': '全部权限', 'stats.export': '统计导出权限', 'stats.view': '统计查看权限',
  'device.view': '设备查看权限', 'device.manage': '设备管理权限', 'fault.manage': '故障处理权限',
  'reservation.view': '预约查看权限', 'reservation.approve': '预约审批权限', 'reservation.change_plan': '预约改期权限', 'reservation.manage': '预约管理权限',
  'return.view': '归还查看权限', 'return.confirm': '归还确认权限', 'return.image_review': '归还图片复核权限', 'return.export': '归还导出权限',
  'user.manage': '用户管理权限', 'system.manage': '系统管理权限'
};

const DETAIL_KEY_LABEL = {
  message: '说明', type: '类型', params: '筛选条件', permissions: '权限', permission: '权限', role_key: '角色',
  device_code: '设备编号', device_id: '设备 ID', record_id: '记录 ID', job_id: '任务 ID', user_id: '用户 ID',
  row_count: '行数', file_path: '文件路径', error: '错误原因', status: '状态', action: '动作', reason: '原因', note: '备注',
  admin_note: '管理员备注', target_type: '目标类型', target_id: '目标 ID', approved: '是否通过', rejected: '是否驳回'
};

function formatExportTime(value) {
  if (!value) return '';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}

function parseJsonMaybe(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

function localizeExportText(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return String(value);
  const parsed = typeof value === 'string' ? parseJsonMaybe(value) : value;
  if (parsed !== value) return localizeExportText(parsed);
  if (Array.isArray(parsed)) return parsed.map(localizeExportText).filter(Boolean).join('、');
  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed).map(([key, item]) => (DETAIL_KEY_LABEL[key] || localizeExportText(key)) + '：' + localizeExportText(item)).join('；');
  }
  let output = String(parsed)
    .replace(/Unbanned user account/g, '已解除用户封禁')
    .replace(/Banned user account/g, '已封禁用户账号')
    .replace(/Disabled user with (\d+) linked records:/g, '已停用用户（关联记录 $1 条）：')
    .replace(/Deleted user/g, '已删除用户')
    .replace(/Changed user status to/g, '已调整用户状态为')
    .replace(/Rejected reservation/g, '已驳回预约')
    .replace(/Approved reservation/g, '已通过预约')
    .replace(/Revoked admin role from/g, '已撤销管理员角色：')
    .replace(/Granted admin role to/g, '已授予管理员角色：')
    .replace(/Updated admin role to admin/g, '已更新管理员角色为 管理员')
    .replace(/Updated admin role for/g, '已更新管理员角色：')
    .replace(/Updated reservation batch/g, '已更新预约批次')
    .replace(/Updated device/g, '已更新设备')
    .replace(/Set device/g, '设置设备');
  [PERMISSION_LABEL, BUSINESS_STATUS, EXPORT_ACTION_LABEL, EXPORT_TARGET_LABEL, DETAIL_KEY_LABEL].forEach((dict) => {
    Object.entries(dict)
      .sort(([a], [b]) => b.length - a.length)
      .forEach(([key, label]) => { if (key && key !== '*') output = output.split(key).join(label); });
  });
  return output
    .replace(/[{}"\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function statusText(value) {
  const key = String(value ?? '');
  return BUSINESS_STATUS[key] || localizeExportText(key);
}

function photoListText(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join('；');
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.filter(Boolean).join('；');
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  return localizeExportText(value);
}

function photoCount(value) {
  const text = photoListText(value);
  if (!text) return 0;
  return text.split(/[；,，]/).map((item) => item.trim()).filter(Boolean).length;
}

function friendlyExportError(error) {
  const raw = String(error?.message || error || '').trim();
  if (!raw) return '导出任务执行失败，请稍后重试。';
  if (/eperm|eacces|operation not permitted|permission denied|access is denied/i.test(raw)) {
    return '导出文件目录没有写入权限，请检查 UPLOAD_DIR 配置或改用项目内 uploads 目录。';
  }
  if (/enoent|no such file or directory/i.test(raw)) return '导出文件目录不存在，请检查上传目录配置。';
  if (/enospc|no space left/i.test(raw)) return '磁盘空间不足，导出文件写入失败。';
  if (/database|postgres|sql|connection/i.test(raw)) return '数据库暂时无法完成导出，请稍后重试。';
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw.slice(0, 1000);
  return '导出任务执行失败，请检查目录权限、数据库连接或筛选条件。';
}

function normalizeExportRows(type, rows = []) {
  if (type === 'usage') return rows.map((item) => ({ 设备编号: item.device_code, 设备名称: item.device_name, 使用人: item.user_name, 手机号: item.user_phone, 借出时间: formatExportTime(item.borrow_time), 预计归还: formatExportTime(item.expected_return_time), 归还时间: formatExportTime(item.return_time), 使用分钟: item.duration_minutes || 0, 是否逾期: item.is_overdue ? '是' : '否', 归还状态: statusText(item.return_condition || item.record_status || item.status), 归还说明: item.return_note || '' }));
  if (type === 'returns') return rows.map((item) => {
    const archivePhotos = item.return_archive_photos || item.return_photos;
    return { 设备编号: item.device_code, 设备名称: item.device_name, 使用人: item.user_name, 手机号: item.user_phone, 学工号: item.user_student_no || '', 借出时间: formatExportTime(item.borrow_time || item.actual_start_time), 应归还时间: formatExportTime(item.expected_return_time), 实际归还时间: formatExportTime(item.return_time || item.actual_end_time), 使用分钟: item.duration_minutes || 0, 是否逾期: item.is_overdue ? '是' : '否', 归还状态: statusText(item.return_condition || item.status), 归还说明: item.return_note || '', 归档文件夹: item.return_archive_folder || '', 图片数量: photoCount(archivePhotos), 图片路径: photoListText(archivePhotos) };
  });
  if (type === 'reservations') return rows.map((item) => ({ 设备编号: item.device_code, 设备名称: item.device_name, 预约人: item.user_name, 手机号: item.user_phone, 开始时间: formatExportTime(item.start_time), 结束时间: formatExportTime(item.end_time), 状态: statusText(item.status), 用途: item.purpose || '', 审批备注: item.admin_note || '' }));
  if (type === 'faults') return rows.map((item) => ({ 设备编号: item.device_code, 设备名称: item.device_name, 上报人: item.user_name, 手机号: item.user_phone, 类型: localizeExportText(item.issue_type), 等级: localizeExportText(item.severity), 状态: statusText(item.status), 描述: item.description || '', 处理备注: item.admin_note || '', 上报时间: formatExportTime(item.created_at), 完成时间: formatExportTime(item.resolved_at) }));
  if (type === 'user_activity') return rows.map((item) => ({ 用户: item.user_name || '', 手机号: item.phone || '', 事件: localizeExportText(item.event_type), 设备类型: localizeExportText(item.device_type), IP: item.ip_address || '', 备注: localizeExportText(item.remark), 时间: formatExportTime(item.created_at) }));
  if (type === 'device_summary') return rows.map((item) => ({ 设备编号: item.device_code, 设备名称: item.device_name || item.name, 预约次数: item.reservation_count || 0, 使用次数: item.borrow_count || 0, 使用分钟: item.total_minutes || 0, 故障次数: item.fault_count || 0 }));
  if (type === 'audit_logs') return rows.map((item) => ({ 日志ID: item.id, 时间: formatExportTime(item.created_at), 操作人: item.operator_name || '', 动作: localizeExportText(item.action), 目标类型: localizeExportText(item.target_type), 目标ID: item.target_id || item.record_id || item.device_id || '', IP: item.ip_address || '', 详情: localizeExportText(item.detail) }));
  return rows.map((item) => Object.fromEntries(Object.entries(item || {}).map(([key, itemValue]) => [DETAIL_KEY_LABEL[key] || localizeExportText(key), localizeExportText(itemValue)])));
}

function createExportService(context = {}) {
  const {
    adminExportData,
    fail,
    effectiveRolePermissions,
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

  const EXPORT_PERMISSION_RULES = {
    usage: { all: ['stats.export'] },
    returns: { all: ['stats.export'], any: ['return.export', 'return.view', 'return.confirm', 'return.image_review'] },
    reservations: { all: ['stats.export'], any: ['reservation.view', 'reservation.approve', 'reservation.change_plan'] },
    faults: { all: ['stats.export'], any: ['device.view', 'device.manage', 'fault.manage'] },
    user_activity: { all: ['stats.export', 'user.manage'] },
    device_summary: { all: ['stats.export'], any: ['device.view', 'device.manage'] },
    audit_logs: { all: ['stats.export', 'audit.view'] }
  };
  const EXPORT_JOB_LEASE_SECONDS = 15 * 60;

  function hasAllExportPermissions(admin = {}, role = {}, type = 'usage') {
    if (admin.role === 'super_admin' || role.role_key === 'super_admin') return true;
    const permissions = typeof effectiveRolePermissions === 'function'
      ? effectiveRolePermissions(role)
      : (Array.isArray(role.permissions) ? role.permissions : []);
    if (permissions.includes('*')) return true;
    const rule = EXPORT_PERMISSION_RULES[type] || { all: ['stats.export'] };
    return (rule.all || []).every((permission) => permissions.includes(permission))
      && (!(rule.any || []).length || rule.any.some((permission) => permissions.includes(permission)));
  }

  function assertExportTypeAndPermission(type, admin, role) {
    if (!Object.prototype.hasOwnProperty.call(EXPORT_PERMISSION_RULES, type)) return fail('不支持的导出类型。', 400, 2001);
    if (!hasAllExportPermissions(admin, role, type)) return fail('当前账号没有该导出类型所需权限。', 403, 1003);
    return null;
  }

  function exportDownloadUrl(jobId) {
    return `/api/v5/admin/export-jobs/${encodeURIComponent(String(jobId || ''))}/download`;
  }

  function serializeExportJob(job) {
    if (!job) return job;
    const { file_path: _filePath, ...safeJob } = job;
    return { ...safeJob, download_url: job.status === 'finished' && job.file_path ? exportDownloadUrl(job.id) : null };
  }

  function exportFileLocation(filePath) {
    const prefix = '/uploads/exports/';
    const raw = String(filePath || '');
    if (!raw.startsWith(prefix)) return null;
    const filename = path.basename(raw.slice(prefix.length));
    if (!filename || filename !== raw.slice(prefix.length) || !/\.csv$/i.test(filename)) return null;
    const dir = path.resolve(uploadDir, 'exports');
    const absolutePath = path.resolve(dir, filename);
    return absolutePath.startsWith(dir + path.sep) ? { absolutePath, filename } : null;
  }

  async function cleanupExpiredExportFiles() {
    const expired = await query(`
      select id, file_path from export_jobs
      where status = 'finished' and file_path is not null and finished_at < now() - interval '7 days'
      order by finished_at asc limit 50
    `);
    let removed = 0;
    for (const job of expired || []) {
      const location = exportFileLocation(job.file_path);
      if (location) await fs.promises.unlink(location.absolutePath).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
      const released = await queryOne(`
        update export_jobs set file_path = null
        where id = $1 and status = 'finished' and file_path = $2 returning id
      `, [job.id, job.file_path]);
      if (released) removed += 1;
    }
    return removed;
  }

  async function adminCreateExportJob(payload = {}, token) {
    const { admin, role } = await requireAdminRole(token, ['super_admin'], ['stats.export']);
    const type = String(payload.type || 'usage').trim();
    const denied = assertExportTypeAndPermission(type, admin, role);
    if (denied) return denied;
    const params = { user_id: payload.user_id || '', device_id: payload.device_id || '', start_date: payload.start_date || '', end_date: payload.end_date || '' };
    const job = await queryOne(`
      insert into export_jobs (id, type, params, status, created_by, created_at, available_at)
      values ($1, $2, $3::jsonb, 'pending', $4, $5, $5) returning *
    `, [uuid(), type, JSON.stringify(params), admin.id, nowIso()]);
    await log('create_export_job', { type, params, job_id: job?.id }, admin, null, job?.id || null);
    return ok({ job: serializeExportJob(job) });
  }

  async function adminRunNextExportJob(_, token) {
    const { admin, role } = await requireAdminRole(token, ['super_admin'], ['stats.export']);
    const workerId = `export-worker-${uuid()}`;
    const leaseToken = uuid();
    const job = await withTransaction(async (client) => {
      const row = await client.queryOne(`
        select * from export_jobs
        where (status = 'pending' and coalesce(available_at, created_at) <= now())
           or (status = 'running' and coalesce(lease_expires_at, started_at + interval '15 minutes') <= now())
        order by created_at asc for update skip locked limit 1
      `);
      if (!row) return null;
      return client.queryOne(`
        update export_jobs set status = 'running', started_at = now(), finished_at = null, error_message = null,
          attempt_count = coalesce(attempt_count, 0) + 1, worker_id = $1, lease_token = $2,
          lease_expires_at = now() + ($3 * interval '1 second')
        where id = $4 returning *
      `, [workerId, leaseToken, EXPORT_JOB_LEASE_SECONDS, row.id]);
    });
    if (!job) return ok({ job: null, message: '暂无待处理导出任务' });

    let fullPath = '';
    try {
      const params = typeof job.params === 'string' ? JSON.parse(job.params || '{}') : (job.params || {});
      const denied = assertExportTypeAndPermission(job.type, admin, role);
      if (denied) throw new Error(denied.message || '没有导出权限');
      const result = await adminExportData({ ...params, type: job.type }, token);
      if (result.ok === false) throw new Error(result.message || '导出失败');
      const rows = normalizeExportRows(job.type, result.rows || []);
      const dir = path.join(uploadDir, 'exports');
      await fs.promises.mkdir(dir, { recursive: true });
      const filename = safeFilename(`${job.type}_${job.id}_${leaseToken}.csv`);
      fullPath = path.join(dir, filename);
      await fs.promises.writeFile(fullPath, `\ufeff${exportRowsToCsv(rows)}`, 'utf8');
      const filePath = `/uploads/exports/${filename}`;
      const updated = await queryOne(`
        update export_jobs set status = 'finished', row_count = $1, file_path = $2, error_message = null,
          finished_at = now(), available_at = null, worker_id = null, lease_token = null, lease_expires_at = null
        where id = $3 and status = 'running' and lease_token = $4 returning *
      `, [rows.length, filePath, job.id, leaseToken]);
      if (!updated) throw new Error('导出任务执行租约已失效，结果未发布');
      await cleanupExpiredExportFiles().catch(() => {});
      await log('finish_export_job', { job_id: job.id, type: job.type, row_count: rows.length }, admin, null, job.id);
      return ok({ job: serializeExportJob(updated) });
    } catch (error) {
      if (fullPath) await fs.promises.unlink(fullPath).catch(() => {});
      const errorMessage = friendlyExportError(error);
      const updated = await queryOne(`
        update export_jobs
        set status = case when coalesce(attempt_count, 0) >= coalesce(max_attempts, 3) then 'failed' else 'pending' end,
          error_message = $1,
          available_at = case when coalesce(attempt_count, 0) >= coalesce(max_attempts, 3) then null
            else now() + (least(900, 30 * power(2, greatest(coalesce(attempt_count, 1) - 1, 0))) * interval '1 second') end,
          finished_at = case when coalesce(attempt_count, 0) >= coalesce(max_attempts, 3) then now() else null end,
          worker_id = null, lease_token = null, lease_expires_at = null
        where id = $2 and status = 'running' and lease_token = $3 returning *
      `, [errorMessage, job.id, leaseToken]);
      if (updated) await log(updated.status === 'failed' ? 'fail_export_job' : 'retry_export_job', { job_id: job.id, type: job.type, error: updated.error_message, attempt_count: updated.attempt_count }, admin, null, job.id);
      return ok({ job: serializeExportJob(updated), message: updated?.status === 'pending' ? '导出失败，已安排重试' : undefined });
    }
  }

  async function adminGetExportJobDownload(payload = {}, token) {
    const { admin, role } = await requireAdminRole(token, ['super_admin'], ['stats.export']);
    const job = await queryOne(`
      select * from export_jobs where id = $1 and ($2::text = 'super_admin' or created_by = $3) limit 1
    `, [String(payload.id || ''), admin.role, admin.id]);
    if (!job || job.status !== 'finished' || !job.file_path) return fail('导出文件不存在、已过期或无权访问。', 404, 2004);
    const denied = assertExportTypeAndPermission(job.type, admin, role);
    if (denied) return denied;
    const location = exportFileLocation(job.file_path);
    if (!location) return fail('导出文件路径无效。', 404, 2004);
    try {
      if (!(await fs.promises.stat(location.absolutePath)).isFile()) throw new Error('not a file');
    } catch (_) {
      return fail('导出文件不存在或已过期。', 404, 2004);
    }
    return ok({ ...location, download_name: safeFilename(`${job.type}_${job.id}.csv`) });
  }

  async function adminListExportJobs(params = {}, token) {
    const { admin } = await requireAdminRole(token, ['super_admin'], ['stats.export']);
    const limit = Math.min(Number(params.limit) || 20, 100);
    const rows = await query(`
      select j.*, u.name as created_by_name from export_jobs j left join users u on u.id = j.created_by
      where ($1::text = 'super_admin' or j.created_by = $2) order by j.created_at desc limit $3
    `, [admin.role, admin.id, limit]);
    return ok({ jobs: (rows || []).map(serializeExportJob) });
  }

  return { adminCreateExportJob, adminGetExportJobDownload, adminListExportJobs, adminRunNextExportJob };
}

module.exports = { createExportService, csvCell, exportRowsToCsv, normalizeExportRows, localizeExportText };

