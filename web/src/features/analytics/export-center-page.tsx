import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText, Play, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { downloadExportJob, fetchAdminExportRows, useAdminExportJobs, useCreateExportJob, useRunNextExportJob, type ExportJob } from '@/features/platform/operations-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCompactId } from '@/components/ui/compact-id';
import { PERMISSIONS, PERMISSION_LABELS, useCapability } from '@/features/auth/permissions';
import { OpsDataToolbar, OpsEmptyState, OpsPermissionHint } from '@/components/ops/design-system';
import { briefDateTime } from '@/lib/time-format';

type ExportTypeKey = 'usage' | 'returns' | 'reservations' | 'faults' | 'user_activity' | 'device_summary' | 'audit_logs';

const TYPES: Array<{
  key: ExportTypeKey;
  label: string;
  short: string;
  perms: string[];
  anyPerms?: string[];
  hint: string;
  rows: string;
}> = [
  {
    key: 'usage',
    label: '借还流水',
    short: '借还',
    perms: [PERMISSIONS.STATS_EXPORT],
    hint: '借出、归还、逾期和图片线索。',
    rows: '借还记录 / 使用日志'
  },
  {
    key: 'returns',
    label: '归还归档',
    short: '归还',
    perms: [PERMISSIONS.STATS_EXPORT],
    anyPerms: [PERMISSIONS.RETURN_EXPORT, PERMISSIONS.RETURN_VIEW, PERMISSIONS.RETURN_CONFIRM, PERMISSIONS.RETURN_IMAGE_REVIEW],
    hint: '归还状态、归档文件夹和上传图片清单。',
    rows: '归还闭环 / 图片归档'
  },
  {
    key: 'reservations',
    label: '预约计划',
    short: '预约',
    perms: [PERMISSIONS.STATS_EXPORT],
    anyPerms: [PERMISSIONS.RESERVATION_VIEW, PERMISSIONS.RESERVATION_APPROVE, PERMISSIONS.RESERVATION_CHANGE_PLAN],
    hint: '预约明细、批次和审批备注。',
    rows: '预约批次 / 预约明细'
  },
  {
    key: 'faults',
    label: '故障与异常',
    short: '故障',
    perms: [PERMISSIONS.STATS_EXPORT],
    anyPerms: [PERMISSIONS.DEVICE_VIEW, PERMISSIONS.DEVICE_MANAGE, PERMISSIONS.FAULT_MANAGE],
    hint: '故障、异常归还和处理备注。',
    rows: '设备故障记录'
  },
  {
    key: 'user_activity',
    label: '用户活动',
    short: '用户',
    perms: [PERMISSIONS.STATS_EXPORT, PERMISSIONS.USER_MANAGE],
    hint: '注册、登录、绑定和审核。',
    rows: '用户活动日志'
  },
  {
    key: 'device_summary',
    label: '设备汇总',
    short: '设备',
    perms: [PERMISSIONS.STATS_EXPORT],
    anyPerms: [PERMISSIONS.DEVICE_VIEW, PERMISSIONS.DEVICE_MANAGE],
    hint: '设备排行、预约、借用和故障。',
    rows: '设备使用统计'
  },
  {
    key: 'audit_logs',
    label: '审计日志',
    short: '审计',
    perms: [PERMISSIONS.STATS_EXPORT, PERMISSIONS.AUDIT_VIEW],
    hint: '审批、授权和故障处理留痕。',
    rows: '操作审计日志'
  }
];

const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  running: '生成中',
  finished: '已完成',
  failed: '失败'
};

const BUSINESS_STATUS: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已取消',
  in_use: '使用中',
  reserved: '已预约',
  completed: '已完成',
  returned: '已归还',
  overdue: '逾期',
  resolved: '已解决',
  processing: '处理中',
  closed: '已关闭',
  faulted: '异常结束',
  active: '正常',
  disabled: '停用',
  abnormal_pending: '异常待处理',
  normal: '正常',
  available: '可用',
  maintenance: '维护中'
};

const EXPORT_ACTION_LABEL: Record<string, string> = {
  login: '登录',
  password_login: '密码登录',
  approve_reservation_batch: '批量通过预约',
  reject_reservation_batch: '批量驳回预约',
  approve_reservation: '通过预约申请',
  reject_reservation: '驳回预约申请',
  grant_admin_role: '授予管理员权限',
  revoke_admin_role: '撤销管理员权限',
  upsert_admin_role: '更新管理员角色',
  update_security_config: '修改系统配置',
  set_user_status: '调整用户状态',
  disable_user: '停用用户账号',
  delete_user: '删除用户',
  set_device_available: '设备恢复可用',
  update_device: '更新设备信息',
  resolve_device_fault: '处理设备故障',
  export_faults: '导出故障记录'
};

const EXPORT_TARGET_LABEL: Record<string, string> = {
  user: '用户',
  account: '账号',
  admin: '管理员',
  device: '设备',
  reservation: '预约',
  reservation_batch: '预约批次',
  fault: '故障',
  faults: '故障记录',
  borrow_record: '借还记录',
  return_archive: '归还归档',
  system: '系统'
};

function exportText(value: unknown) {
  if (value === undefined || value === null || value === '') return '';
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  Object.entries({ ...PERMISSION_LABELS, ...BUSINESS_STATUS, ...EXPORT_ACTION_LABEL, ...EXPORT_TARGET_LABEL }).forEach(([key, label]) => {
    if (key === '*') return;
    text = text.split(key).join(label);
  });
  text = text
    .replace(/Unbanned user account/g, '已解除用户封禁')
    .replace(/Banned user account/g, '已封禁用户账号')
    .replace(/Disabled user with (\d+) linked records:/g, '已停用用户（关联记录 $1 条）：')
    .replace(/Deleted user/g, '已删除用户')
    .replace(/Changed user status to/g, '已调整用户状态为')
    .replace(/Updated reservation batch/g, '已更新预约批次')
    .replace(/Updated device/g, '已更新设备')
    .replace(/Approved reservation/g, '已通过预约')
    .replace(/Rejected reservation/g, '已驳回预约')
    .replace(/role_key/g, '角色')
    .replace(/device_code/g, '设备编号')
    .replace(/message/g, '说明')
    .replace(/[{}"\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function formatTime(value: unknown) {
  return value ? briefDateTime(String(value)) : '';
}

function statusText(value: unknown) {
  const key = String(value ?? '');
  return BUSINESS_STATUS[key] || exportText(key);
}

function photoListText(value: unknown) {
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
  return exportText(value);
}

function photoCount(value: unknown) {
  const text = photoListText(value);
  if (!text) return 0;
  return text.split(/[；,，]/).map((item) => item.trim()).filter(Boolean).length;
}

function toAdminError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const cleaned = exportText(raw.replace(/^Error:\s*/i, ''));
  if (!cleaned) return '操作失败，请检查网络、权限或筛选条件。';
  if (/failed to fetch|network|fetch failed/i.test(raw)) return '网络请求失败，请确认服务已启动且网络连接正常。';
  if (/unauthorized|401/i.test(raw)) return '登录状态已失效，请重新登录后再试。';
  if (/forbidden|403/i.test(raw)) return '当前账号没有执行该操作的权限。';
  if (/not found|404/i.test(raw)) return '请求的数据或接口不存在，请刷新页面后重试。';
  if (/timeout|timed out/i.test(raw)) return '请求超时，请稍后重试。';
  if (/eperm|eacces|operation not permitted|permission denied|access is denied/i.test(raw)) return '文件目录没有写入权限，请检查上传目录配置。';
  if (/enoent|no such file or directory/i.test(raw)) return '文件目录不存在，请检查上传目录配置。';
  return cleaned;
}

function exportTypeLabel(type: string) {
  return TYPES.find((item) => item.key === type)?.label || '统计导出';
}

function normalizeExportRows(type: string, rows: Array<Record<string, unknown>>) {
  if (type === 'usage') {
    return rows.map((item) => ({
      设备编号: item.device_code,
      设备名称: item.device_name,
      使用人: item.user_name,
      手机号: item.user_phone,
      借出时间: formatTime(item.borrow_time),
      预计归还: formatTime(item.expected_return_time),
      归还时间: formatTime(item.return_time),
      使用分钟: item.duration_minutes || 0,
      是否逾期: item.is_overdue ? '是' : '否',
      归还状态: statusText(item.return_condition || item.record_status || item.status),
      归还说明: item.return_note || ''
    }));
  }
  if (type === 'returns') {
    return rows.map((item) => {
      const archivePhotos = item.return_archive_photos || item.return_photos;
      return {
        设备编号: item.device_code,
        设备名称: item.device_name,
        使用人: item.user_name,
        手机号: item.user_phone,
        学工号: item.user_student_no || '',
        借出时间: formatTime(item.borrow_time || item.actual_start_time),
        应归还时间: formatTime(item.expected_return_time),
        实际归还时间: formatTime(item.return_time || item.actual_end_time),
        使用分钟: item.duration_minutes || 0,
        是否逾期: item.is_overdue ? '是' : '否',
        归还状态: statusText(item.return_condition || item.status),
        归还说明: item.return_note || '',
        归档文件夹: item.return_archive_folder || '',
        图片数量: photoCount(archivePhotos),
        图片路径: photoListText(archivePhotos)
      };
    });
  }
  if (type === 'reservations') {
    return rows.map((item) => ({
      设备编号: item.device_code,
      设备名称: item.device_name,
      预约人: item.user_name,
      手机号: item.user_phone,
      开始时间: formatTime(item.start_time),
      结束时间: formatTime(item.end_time),
      状态: statusText(item.status),
      用途: item.purpose || '',
      审批备注: item.admin_note || ''
    }));
  }
  if (type === 'faults') {
    return rows.map((item) => ({
      设备编号: item.device_code,
      设备名称: item.device_name,
      上报人: item.user_name,
      手机号: item.user_phone,
      类型: item.issue_type || '',
      等级: item.severity || '',
      状态: statusText(item.status),
      描述: item.description || '',
      处理备注: item.admin_note || '',
      上报时间: formatTime(item.created_at),
      完成时间: formatTime(item.resolved_at)
    }));
  }
  if (type === 'user_activity') {
    return rows.map((item) => ({
      用户: item.user_name || '',
      手机号: item.phone || '',
      事件: exportText(item.event_type),
      设备类型: item.device_type || '',
      IP: item.ip_address || '',
      备注: exportText(item.remark),
      时间: formatTime(item.created_at)
    }));
  }
  if (type === 'device_summary') {
    return rows.map((item) => ({
      设备编号: item.device_code,
      设备名称: item.device_name || item.name,
      预约次数: item.reservation_count || 0,
      使用次数: item.borrow_count || 0,
      使用分钟: item.total_minutes || 0,
      故障次数: item.fault_count || 0
    }));
  }
  if (type === 'audit_logs') {
    return rows.map((item) => ({
      日志ID: item.id,
      时间: formatTime(item.created_at),
      操作人: item.operator_name || '',
      动作: exportText(item.action),
      目标类型: exportText(item.target_type),
      目标ID: item.target_id || item.record_id || item.device_id || '',
      IP: item.ip_address || '',
      详情: exportText(item.detail)
    }));
  }
  return rows;
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function htmlCell(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadRows(filename: string, rows: Array<Record<string, unknown>>, format: 'csv' | 'excel') {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  if (!headers.length) throw new Error('暂无可导出的数据');
  if (format === 'excel') {
    const table = `<table><thead><tr>${headers.map((h) => `<th>${htmlCell(h)}</th>`).join('')}</tr></thead><tbody>${rows
      .map((row) => `<tr>${headers.map((h) => `<td>${htmlCell(row[h])}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`;
    downloadBlob(filename, new Blob([`\ufeff${table}`], { type: 'application/vnd.ms-excel;charset=utf-8;' }));
    return;
  }
  const csv = [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(','))].join('\n');
  downloadBlob(filename, new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' }));
}

function statusTone(status: string) {
  if (status === 'finished') return 'badge-success';
  if (status === 'running') return 'badge-info';
  if (status === 'failed') return 'badge-danger';
  return 'badge-warn';
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function humanParams(params: unknown) {
  const value = typeof params === 'string' ? safeJson(params) : params;
  if (!value || typeof value !== 'object') return '未设置筛选条件';
  const obj = value as Record<string, unknown>;
  const parts = [
    obj.user_id ? `用户 ${formatCompactId(String(obj.user_id), 8, 4, 'USR')}` : '',
    obj.device_id ? `设备 ${formatCompactId(String(obj.device_id), 8, 4, 'DEV')}` : '',
    obj.start_date ? `从 ${obj.start_date}` : '',
    obj.end_date ? `至 ${obj.end_date}` : ''
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : '全部数据';
}

function ExportJobRow({ job }: { job: ExportJob }) {
  return (
    <div className="grid gap-3 rounded-2xl border bg-background/75 p-4 text-sm shadow-sm lg:grid-cols-[1.1fr_1fr_120px_150px_120px] lg:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-black">{exportTypeLabel(job.type)}</span>
          <span className={`badge-pill ${statusTone(job.status)}`}>{STATUS_LABEL[job.status] ?? job.status}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{humanParams(job.params)}</p>
      </div>
      <div className="text-xs text-muted-foreground">
        <p>创建人：{job.created_by_name ?? '—'}</p>
        <p>创建时间：{job.created_at ? new Date(job.created_at).toLocaleString('zh-CN', { hour12: false }) : '—'}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">行数</p>
        <p className="text-xl font-black tabular-nums">{job.row_count ?? '—'}</p>
      </div>
      <div className="text-xs text-muted-foreground">
        {job.finished_at
          ? `完成：${briefDateTime(job.finished_at)}`
          : job.started_at
            ? `开始：${briefDateTime(job.started_at)}`
            : '等待执行'}
      </div>
      <div>
        {job.download_url ? (
          <button type="button" onClick={() => downloadExportJob(job.id, `${job.type}_${job.id}.csv`).catch((error) => toast.error(error instanceof Error ? error.message : '下载失败，请稍后重试。'))} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:brightness-95">
            <Download className="h-3.5 w-3.5" /> 下载
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">暂无文件</span>
        )}
      </div>
      {job.status === 'failed' && job.error_message && (
        <p className="rounded-xl border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive lg:col-span-5">{toAdminError(job.error_message)}</p>
      )}
    </div>
  );
}

export function AdminExportPage() {
  const capability = useCapability();
  const { data, isLoading, error, refetch } = useAdminExportJobs();
  const isTypeEnabled = (item: (typeof TYPES)[number]) => capability.canAll(item.perms) && (!item.anyPerms?.length || capability.canAny(item.anyPerms));
  const visibleTypes = useMemo(() => TYPES.filter(isTypeEnabled), [capability.permissions, capability.role]);
  const [type, setType] = useState<ExportTypeKey>(() => {
    const initialType = new URLSearchParams(window.location.search).get('type') as ExportTypeKey | null;
    return visibleTypes.some((item) => item.key === initialType) ? initialType! : (visibleTypes[0]?.key ?? 'usage');
  });
  const [fields, setFields] = useState({ user_id: '', device_id: '', start_date: '', end_date: '' });
  const create = useCreateExportJob();
  const run = useRunNextExportJob();
  const jobs = data?.jobs ?? [];

  const selectedType = TYPES.find((item) => item.key === type) ?? visibleTypes[0] ?? TYPES[0];
  const pendingJobs = jobs.filter((job) => job.status === 'pending' || job.status === 'running').length;
  const finishedJobs = jobs.filter((job) => job.status === 'finished').length;
  const failedJobs = jobs.filter((job) => job.status === 'failed').length;

  useEffect(() => {
    if (!visibleTypes.length) return;
    if (!visibleTypes.some((item) => item.key === type)) setType(visibleTypes[0].key);
  }, [type, visibleTypes]);

  const syncExport = useMutation({
    mutationFn: async (format: 'csv' | 'excel') => {
      const result = await fetchAdminExportRows({ type, ...fields });
      const rows = normalizeExportRows(type, result.rows ?? []);
      const filename = `${exportTypeLabel(type)}_${fields.start_date || '开始'}_${fields.end_date || '结束'}.${format === 'excel' ? 'xls' : 'csv'}`;
      downloadRows(filename, rows, format);
      return rows.length;
    },
    onSuccess: (count, format) => toast.success(`${format === 'excel' ? 'Excel' : 'CSV'} 已开始下载（${count} 行）`),
    onError: (e) => toast.error(`下载失败：${toAdminError(e)}`)
  });

  function handleCreate() {
    create.mutate(
      { type, ...fields },
      {
        onSuccess: (r) => toast.success(`已创建导出任务：${exportTypeLabel(r.job?.type ?? type)}`),
        onError: (e) => toast.error(`创建失败：${toAdminError(e)}`)
      }
    );
  }

  function handleRun() {
    run.mutate(undefined, {
      onSuccess: (r) => {
        if (r.job) toast.success(`已生成 ${r.job.row_count ?? 0} 行`);
        else toast.info(r.message || '暂无待处理任务');
        refetch();
      },
      onError: (e) => toast.error(`执行失败：${toAdminError(e)}`)
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="ops-hero p-6 md:p-8">
        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-white/60">IDBS 5.0 · 文档中枢</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white md:text-4xl">导出中心</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/70">
              按权限导出、按任务排队、按审计留痕，避免未授权数据出现在管理员页面。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['进行中', pendingJobs],
              ['已完成', finishedJobs],
              ['失败', failedJobs]
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-xs text-white/55">{label}</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="ops-card">
          <CardHeader>
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="text-base">创建导出</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">选择数据范围后可立即下载，也可创建异步任务进入队列。</p>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                当前可导出 {visibleTypes.length} 类
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {visibleTypes.map((item) => {
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setType(item.key)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      type === item.key
                        ? 'border-primary bg-primary/10 shadow-sm'
                        : 'bg-background/80 hover:-translate-y-px hover:border-primary/40 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black">{item.label}</span>
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.hint}</p>
                  </button>
                );
              })}
            </div>

            {!visibleTypes.length && (
              <OpsPermissionHint className="mt-4" title="暂无导出权限">当前账号未匹配任何导出类型，相关模板、队列操作和下载入口已隐藏。</OpsPermissionHint>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm">
                <span className="text-muted-foreground">用户编号</span>
                <Input value={fields.user_id} onChange={(e) => setFields({ ...fields, user_id: e.target.value })} placeholder="可选" />
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground">设备编号</span>
                <Input value={fields.device_id} onChange={(e) => setFields({ ...fields, device_id: e.target.value })} placeholder="可选" />
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground">开始日期</span>
                <Input type="date" value={fields.start_date} onChange={(e) => setFields({ ...fields, start_date: e.target.value })} />
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground">结束日期</span>
                <Input type="date" value={fields.end_date} onChange={(e) => setFields({ ...fields, end_date: e.target.value })} />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="secondary" disabled={!visibleTypes.length || syncExport.isPending} onClick={() => syncExport.mutate('csv')}>
                <FileText className="h-4 w-4" /> 立即下载 CSV
              </Button>
              <Button variant="secondary" disabled={!visibleTypes.length || syncExport.isPending} onClick={() => syncExport.mutate('excel')}>
                <FileSpreadsheet className="h-4 w-4" /> 立即下载 Excel
              </Button>
              <Button disabled={!visibleTypes.length || create.isPending} onClick={handleCreate}>
                创建异步任务
              </Button>
              <Button variant="outline" disabled={!visibleTypes.length || run.isPending} onClick={handleRun}>
                <Play className="h-4 w-4" /> 执行下一任务
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="ops-card h-fit xl:sticky xl:top-6">
          <CardHeader>
            <CardTitle className="text-base">权限匹配</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <OpsPermissionHint title="当前选择" permissions={selectedType.label}>
              不具备权限的数据类型不会出现在列表中，后端接口也会继续执行权限校验。
            </OpsPermissionHint>
            <div className="rounded-2xl border bg-muted/30 p-4">
              <p className="text-xs font-bold text-muted-foreground">数据来源</p>
              <p className="mt-1 font-semibold">{selectedType.rows}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{selectedType.hint}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
              <p className="text-xs font-black uppercase tracking-wider">权限状态</p>
              <p className="mt-1 font-semibold">当前账号已匹配该导出类型</p>
              <p className="mt-2 text-xs leading-5 text-emerald-700">不可用的导出类型已自动隐藏，队列和模板只展示可执行内容。</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="ops-card">
        <CardContent className="space-y-3 p-4">
          <OpsDataToolbar
            title="导出任务队列"
            description="查看任务生成、下载和失败原因；失败信息会转换为中文说明。"
            meta={<>共 {jobs.length} 个任务</>}
            actions={<Button variant="outline" size="sm" onClick={() => refetch()}>刷新</Button>}
          />
          {isLoading && <p className="py-8 text-center text-muted-foreground">加载中…</p>}
          {error && <p className="py-8 text-center text-destructive">加载失败：{toAdminError(error)}</p>}
          {!isLoading && jobs.length === 0 && <OpsEmptyState title="暂无导出任务" description="可先选择导出类型和日期范围，创建任务后会显示在这里。" />}
          {jobs.map((job) => <ExportJobRow key={job.id} job={job} />)}
        </CardContent>
      </Card>
    </div>
  );
}







