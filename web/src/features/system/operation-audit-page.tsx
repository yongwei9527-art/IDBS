import { briefDateTime } from '@/lib/time-format';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ClipboardList, Download, Fingerprint, Search, ShieldCheck } from 'lucide-react';
import { useAdminOperationLogs, type OperationLog } from '@/features/platform/operations-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CompactId, formatCompactId } from '@/components/ui/compact-id';
import { useCapability } from '@/features/auth/permissions';
import { toFriendlyError } from '@/lib/friendly-error';

const RISK_ACTIONS = new Set(['update_security_config', 'grant_admin_role', 'upsert_admin_role', 'revoke_admin_role', 'delete_user', 'set_user_status', 'set_device_available']);

const ACTION_LABEL: Record<string, string> = {
  approve_reservation_batch: '批量通过预约',
  approve_reservation_item: '通过预约明细',
  approve_reservation: '通过预约申请',
  bulk_approve_reservations: '批量审批预约',
  reject_reservation_batch: '批量驳回预约',
  reject_reservation: '驳回预约申请',
  review_user_request: '处理用户诉求',
  submit_return: '提交设备归还',
  update_security_config: '修改系统配置',
  grant_admin_role: '授予管理员权限',
  upsert_admin_role: '更新管理员角色',
  revoke_admin_role: '撤销管理员角色',
  set_user_ban: '调整账号封禁状态',
  disable_user: '停用用户账号',
  set_user_status: '调整用户状态',
  delete_user: '删除用户',
  unbind_wechat: '解绑微信',
  create_chat_conversation: '创建沟通会话',
  send_chat_message: '发送沟通消息',
  dissolve_chat_conversation: '解散沟通会话',
  update_device: '更新设备信息',
  set_device_available: '设备恢复可用',
  resolve_device_fault: '处理设备故障',
  resolve_fault_processing: '故障转处理中',
  resolve_fault_resolved: '故障处理完成',
  export_faults: '导出故障记录'
};

const TARGET_TYPE_LABEL: Record<string, string> = {
  user: '用户',
  users: '用户',
  account: '账号',
  admin: '管理员',
  admin_role: '管理员角色',
  role: '角色',
  device: '设备',
  reservation: '预约',
  reservation_batch: '预约批次',
  reservation_item: '预约明细',
  fault: '故障',
  faults: '故障记录',
  request: '用户诉求',
  chat: '沟通会话',
  security: '安全配置',
  system: '系统'
};

const TARGET_ID_PREFIX: Record<string, string> = {
  user: 'USR', users: 'USR', account: 'USR', admin: 'ADM', admin_role: 'ROL', role: 'ROL',
  device: 'DEV', reservation: 'RSV', reservation_batch: 'RSV', reservation_item: 'RSV',
  fault: 'FLT', faults: 'FLT', request: 'REQ', chat: 'CHT', security: 'SEC', system: 'SYS'
};

const DETAIL_KEY_LABEL: Record<string, string> = {
  message: '说明',
  type: '类型',
  params: '筛选条件',
  job_id: '任务编号',
  row_count: '行数',
  file_path: '文件路径',
  start_date: '开始日期',
  end_date: '结束日期',
  return_archive: '归还归档',
  permissions: '权限',
  permission: '权限',
  role_key: '角色',
  device_code: '设备编号',
  device_id: '设备编号',
  record_id: '记录编号',
  user_id: '用户编号',
  status: '状态',
  action: '动作',
  reason: '原因',
  note: '备注',
  admin_note: '管理员备注',
  target_type: '目标类型',
  target_id: '目标编号',
  approved: '是否通过',
  rejected: '是否驳回'
};

const VALUE_LABEL: Record<string, string> = {
  super_admin: '最高权限管理员',
  admin: '管理员',
  duty_admin: '值班管理员',
  auditor: '审计管理员',
  'stats.export': '统计导出权限',
  'stats.view': '统计查看权限',
  'reservation.change_plan': '预约改期权限',
  'return.view': '归还查看权限',
  'return.confirm': '归还确认权限',
  'return.image_review': '归还图片复核权限',
  'return.export': '归还导出权限',
  create_export_job: '创建导出任务',
  finish_export_job: '完成导出任务',
  fail_export_job: '导出任务失败',
  returns: '归还归档',
  usage: '使用统计',
  reservations: '预约记录',
  user_activity: '用户行为',
  device_summary: '设备汇总',
  audit_logs: '操作审计',
  'device.view': '设备查看权限',
  'device.manage': '设备管理权限',
  'fault.manage': '故障处理权限',
  'reservation.view': '预约查看权限',
  'reservation.approve': '预约审批权限',
  'user.manage': '用户管理权限',
  super_admin_only: '仅最高权限管理员可操作',
  device_code: '设备编号',
  role_key: '角色',
  faults: '故障记录',
  login: '登录',
  password_login: '密码登录',
  available: '可用',
  in_use: '使用中',
  maintenance: '维护中',
  abnormal_pending: '异常待处理',
  disabled: '停用',
  pending: '待处理',
  approved: '已通过',
  rejected: '已驳回',
  completed: '已完成',
  cancelled: '已取消',
  confirmed: '已确认',
  active: '正常',
  normal: '普通',
  user: '用户',
  account: '账号',
  device: '设备',
  reservation: '预约',
  true: '是',
  false: '否'
};

function formatTime(value?: string) {
  if (!value) return '—';
  return briefDateTime(value);
}

function tryParseJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function localizeRawText(value: string) {
  let text = value;
  const replacements: Array<[RegExp, string]> = [
    [/Unbanned user account/g, '已解除用户封禁'],
    [/Banned user account/g, '已封禁用户账号'],
    [/Disabled user with (\d+) linked records:/g, '已停用用户（关联记录 $1 条）：'],
    [/Deleted user/g, '已删除用户'],
    [/Changed user status to/g, '已调整用户状态为'],
    [/Rejected reservation/g, '已驳回预约'],
    [/Approved reservation/g, '已通过预约'],
    [/Revoked admin role from/g, '已撤销管理员角色：'],
    [/Granted admin role to/g, '已授予管理员角色：'],
    [/Updated admin role to admin/g, '已更新管理员角色为 管理员'],
    [/Updated admin role for/g, '已更新管理员角色：'],
    [/Updated reservation batch/g, '已更新预约批次'],
    [/Updated device/g, '已更新设备'],
    [/Set device/g, '设置设备'],
    [/super_admin_only/g, '仅最高权限管理员可操作'],
    [/super_admin/g, '最高权限管理员'],
    [/stats\.export/g, '统计导出权限'],
    [/device\.view/g, '设备查看权限'],
    [/device\.manage/g, '设备管理权限'],
    [/fault\.manage/g, '故障处理权限'],
    [/reservation\.approve/g, '预约审批权限'],
    [/reservation\.view/g, '预约查看权限'],
    [/user\.manage/g, '用户管理权限'],
    [/password_login/g, '密码登录'],
    [/job_id/g, '任务编号'],
    [/file_path/g, '文件路径'],
    [/row_count/g, '行数'],
    [/start_date/g, '开始日期'],
    [/end_date/g, '结束日期'],
    [/device_code/g, '设备编号'],
    [/role_key/g, '角色'],
    [/abnormal_pending/g, '异常待处理'],
    [/in_use/g, '使用中'],
    [/available/g, '可用'],
    [/maintenance/g, '维护中'],
    [/\bconfirmed\b/g, '已确认'],
    [/\bapproved\b/g, '已通过'],
    [/\brejected\b/g, '已驳回'],
    [/\bactive\b/g, '正常'],
    [/\bnormal\b/g, '普通']
  ];
  replacements.forEach(([pattern, label]) => { text = text.replace(pattern, label); });
  return VALUE_LABEL[text] || text;
}

function localizeDetailValue(key: string, value: unknown): string {
  const idPrefixes: Record<string, string> = { job_id: 'JOB', device_id: 'DEV', record_id: 'REC', user_id: 'USR', target_id: 'OBJ', reservation_id: 'RSV', batch_id: 'RSV', fault_id: 'FLT', request_id: 'REQ', borrow_record_id: 'BOR' };
  if (typeof value === 'string' && idPrefixes[key]) return formatCompactId(value, 8, 4, idPrefixes[key]);
  if (key === 'file_path' && typeof value === 'string') {
    const match = value.match(/\/uploads\/exports\/([a-z_]+)_([0-9a-f-]+)/i);
    if (match) {
      const typeLabel = VALUE_LABEL[match[1]] || '导出';
      return typeLabel + '文件（CSV，编号 ' + match[2].slice(0, 8) + '）';
    }
  }
  return localizeValue(value);
}

function localizeValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const parsed = tryParseJson(value);
    if (parsed !== value) return localizeValue(parsed);
    return localizeRawText(value);
  }
  if (Array.isArray(value)) return value.length ? value.map(localizeValue).join('、') : '无';
  if (typeof value === 'object') return detailText(value);
  return localizeRawText(String(value));
}

function detailText(detail: unknown) {
  if (!detail) return '—';
  const parsed = typeof detail === 'string' ? tryParseJson(detail) : detail;
  if (typeof parsed === 'string') return localizeRawText(parsed);
  if (Array.isArray(parsed)) return parsed.map((item, index) => (index + 1) + '. ' + localizeValue(item)).join('\n');
  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed as Record<string, unknown>)
      .map(([key, value]) => (DETAIL_KEY_LABEL[key] || localizeRawText(key)) + '：' + localizeDetailValue(key, value))
      .join('\n');
  }
  return localizeValue(parsed);
}

function actionLabel(action: string) {
  return ACTION_LABEL[action] || '系统操作';
}

function riskLevel(log: OperationLog) {
  if (RISK_ACTIONS.has(log.action)) return { key: 'high', label: '高风险', tone: 'badge-danger', icon: AlertTriangle };
  if (/approve|fault|reservation|export/.test(log.action)) return { key: 'business', label: '业务关键', tone: 'badge-warn', icon: ClipboardList };
  return { key: 'normal', label: '普通留痕', tone: 'badge-info', icon: Fingerprint };
}

function operatorName(name?: string | null) {
  return localizeRawText(name || '') || '—';
}

function TargetSummary({ log }: { log: OperationLog }) {
  const items = [
    log.target_type ? { value: TARGET_TYPE_LABEL[log.target_type] || localizeRawText(log.target_type), isId: false } : null,
    log.target_id ? { value: log.target_id, isId: true, prefix: TARGET_ID_PREFIX[log.target_type || ''] || 'OBJ' } : null,
    log.device_id ? { value: log.device_id, isId: true, prefix: 'DEV' } : null,
    log.record_id ? { value: log.record_id, isId: true, prefix: 'REC' } : null
  ].filter((item): item is { value: string; isId: boolean; prefix?: string } => item !== null);

  if (!items.length) return <>—</>;

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {items.map((item, index) => (
        <span key={`${item.value}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 ? <span aria-hidden="true">｜</span> : null}
          {item.isId ? <CompactId value={item.value} prefix={item.prefix} /> : <span>{item.value}</span>}
        </span>
      ))}
    </span>
  );
}

function DetailPreview({ detail }: { detail: unknown }) {
  const [open, setOpen] = useState(false);
  const text = detailText(detail);
  const isLong = text.length > 140 || text.includes('\n');
  return (
    <div className="mt-2 rounded-xl bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
      <pre className={`${open ? 'max-h-72 overflow-auto' : 'line-clamp-2'} whitespace-pre-wrap break-words font-mono`} title={text}>
        {text}
      </pre>
      {isLong && (
        <button type="button" className="mt-2 font-bold text-primary hover:underline" onClick={() => setOpen((value) => !value)}>
          {open ? '收起详情' : '展开详情'}
        </button>
      )}
    </div>
  );
}

export function AdminAuditPage() {
  const capability = useCapability();
  const [draft, setDraft] = useState({ operator: '', action: '', keyword: '', start_date: '', end_date: '', risk: '' });
  const [filters, setFilters] = useState({ ...draft, limit: 100, offset: 0 });
  const [riskLevelFilter, setRiskLevelFilter] = useState('all');
  const { data, isLoading, error, refetch } = useAdminOperationLogs(filters);
  const logs = data?.logs ?? [];
  const displayedLogs = useMemo(
    () => logs.filter((log) => riskLevelFilter === 'all' || riskLevel(log).key === riskLevelFilter),
    [logs, riskLevelFilter]
  );

  const stats = useMemo(() => {
    const risk = displayedLogs.filter((log) => RISK_ACTIONS.has(log.action)).length;
    const actors = new Set(displayedLogs.map((log) => log.operator_name).filter(Boolean)).size;
    const actions = new Set(displayedLogs.map((log) => log.action).filter(Boolean)).size;
    return { total: riskLevelFilter === 'all' ? (data?.total ?? displayedLogs.length) : displayedLogs.length, risk, actors, actions };
  }, [displayedLogs, data?.total, riskLevelFilter]);

  function field<K extends keyof typeof draft>(key: K, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setFilters({ ...draft, risk: riskLevelFilter === 'high' ? '1' : '', limit: 100, offset: 0 });
    setTimeout(() => refetch(), 0);
  }

  function quickRisk() {
    const nextLevel = riskLevelFilter === 'high' ? 'all' : 'high';
    setRiskLevelFilter(nextLevel);
    const next = { ...draft, risk: nextLevel === 'high' ? '1' : '' };
    setDraft(next);
    setFilters({ ...next, limit: 100, offset: 0 });
  }

  function chooseRiskLevel(value: string) {
    setRiskLevelFilter(value);
    const next = { ...draft, risk: value === 'high' ? '1' : '' };
    setDraft(next);
    setFilters({ ...next, limit: 100, offset: 0 });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="ops-hero p-6 md:p-8">
        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-white/60">IDBS 5.0 · 审计追踪</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white md:text-4xl">操作审计与风险追踪</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/70">
              筛风险、看详情、导出日志。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['命中日志', stats.total],
              ['高风险', stats.risk],
              ['操作人', stats.actors],
              ['动作类型', stats.actions]
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-xs text-white/55">{label}</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Card className="ops-card">
        <CardHeader>
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="text-base">审计筛选</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">支持按操作人、动作、目标/详情关键词和日期范围定位问题。</p>
            </div>
            <Button variant={draft.risk === '1' ? 'default' : 'outline'} size="sm" onClick={quickRisk}>
              <ShieldCheck className="h-4 w-4" /> 只看高风险
            </Button>
            {capability.canExportStats && capability.canViewAudit && (
              <Link
                className="inline-flex h-9 items-center justify-center gap-2 rounded-[14px] border border-input bg-card/80 px-3 text-sm font-semibold shadow-[var(--shadow-soft)] transition-all hover:-translate-y-px hover:bg-secondary"
                to={'/admin/export' as any}
                search={{ type: 'audit_logs' } as any}
              >
                <Download className="h-4 w-4" /> 导出审计日志
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr_160px_160px_150px_auto]" onSubmit={submit}>
            <label className="text-sm">
              <span className="text-muted-foreground">操作人</span>
              <Input value={draft.operator} onChange={(e) => field('operator', e.target.value)} placeholder="姓名/手机号模糊匹配" />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">动作</span>
              <Input value={draft.action} onChange={(e) => field('action', e.target.value)} placeholder="审批、角色、故障" />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">关键词</span>
              <Input value={draft.keyword} onChange={(e) => field('keyword', e.target.value)} placeholder="目标编号、设备、备注、IP" />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">开始日期</span>
              <Input type="date" value={draft.start_date} onChange={(e) => field('start_date', e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">结束日期</span>
              <Input type="date" value={draft.end_date} onChange={(e) => field('end_date', e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">风险级别</span>
              <select
                value={riskLevelFilter}
                onChange={(e) => chooseRiskLevel(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">全部</option>
                <option value="high">高风险</option>
                <option value="business">业务关键</option>
                <option value="normal">普通留痕</option>
              </select>
            </label>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                <Search className="h-4 w-4" /> 查询
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="ops-card">
        <CardHeader>
          <CardTitle className="text-base">审计时间线</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {displayedLogs.map((log) => {
              const risk = riskLevel(log);
              const Icon = risk.icon;
              return (
                <article key={log.id} className="grid gap-3 rounded-2xl border bg-background/75 p-4 shadow-sm xl:grid-cols-[190px_minmax(0,1fr)_220px] xl:items-start">
                  <div>
                    <p className="text-xs text-muted-foreground">发生时间</p>
                    <p className="mt-1 font-semibold tabular-nums">{formatTime(log.created_at)}</p>
                    <span className={`mt-2 inline-flex badge-pill ${risk.tone}`}>
                      <Icon className="mr-1 h-3.5 w-3.5" /> {risk.label}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-black">{actionLabel(log.action)}</h2>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">已本地化</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground"><TargetSummary log={log} /></p>
                    <DetailPreview detail={log.detail} />
                  </div>
                  <div className="rounded-2xl bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                    <p>操作人：<span className="font-semibold text-foreground">{operatorName(log.operator_name)}</span></p>
                    <p>IP：<span className="tabular-nums">{log.ip_address || '—'}</span></p>
                    <p><CompactId value={log.id} prefix="LOG" /></p>
                  </div>
                </article>
              );
            })}
          </div>
          {isLoading && <p className="py-8 text-center text-muted-foreground">加载审计日志中…</p>}
          {error && <p className="py-8 text-center text-destructive">加载失败：{toFriendlyError(error)}</p>}
          {!isLoading && displayedLogs.length === 0 && <p className="rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground">暂无匹配审计记录</p>}
        </CardContent>
      </Card>
    </div>
  );
}






