import { useNavigate } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAdminDashboard, useAdminIntelligence, useAdminReturnTasks, useReviewReturnTask } from '@/features/platform/operations-api';
import { parseAdminActionUrl } from '@/features/analytics/operations-action';
import { PERMISSIONS, useCapability } from '@/features/auth/permissions';
import { OpsBadge, OpsEmptyState, OpsPageHeader, OpsRiskBadge, OpsSectionHeader } from '@/components/ops/design-system';
import { briefDateTime } from '@/lib/time-format';
import { toFriendlyError } from '@/lib/friendly-error';
import { toast } from 'sonner';

const RETURN_CONDITION_LABEL: Record<string, string> = {
  normal: '正常',
  abnormal: '异常',
  minor_scratch: '轻微划痕',
  temperature_unstable: '温度不稳',
  missing_accessory: '配件缺失',
  appearance_damage: '外观损坏',
  operation_abnormal: '运行异常',
  other: '其他异常'
};

const STATUS_LABEL: Record<string, string> = {
  available: '可用',
  in_use: '使用中',
  reserved: '已预约',
  maintenance: '维护中',
  abnormal_pending: '异常待处理',
  disabled: '停用'
};

const STATUS_TONE: Record<string, string> = {
  available: 'ops-progress-fill--success',
  in_use: 'ops-progress-fill--info',
  reserved: 'ops-progress-fill--default',
  maintenance: 'ops-progress-fill--warning',
  abnormal_pending: 'ops-progress-fill--danger',
  disabled: 'ops-progress-fill--muted'
};

const STATUS_DOT: Record<string, string> = {
  available: 'dashboard-status-dot--success',
  in_use: 'dashboard-status-dot--info',
  reserved: 'dashboard-status-dot--primary',
  maintenance: 'dashboard-status-dot--warning',
  abnormal_pending: 'dashboard-status-dot--danger',
  disabled: 'dashboard-status-dot--muted'
};

const STATUS_ORDER = ['reserved', 'abnormal_pending', 'in_use', 'disabled', 'available', 'maintenance'];


function statusWidth(value: number, max: number) {
  if (value <= 0) return '0%';
  return `${Math.round((value / Math.max(1, max)) * 100)}%`;
}

function compactCopy(value: unknown, max = 64) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function friendlyReturnCondition(value?: string | null) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (RETURN_CONDITION_LABEL[key]) return RETURN_CONDITION_LABEL[key];
  // snake_case leftover -> chinese-ish fallback
  if (/^[a-z0-9_]+$/i.test(key)) {
    return key
      .split('_')
      .map((part) => RETURN_CONDITION_LABEL[part] || part)
      .join('');
  }
  return key;
}

function friendlyReturnNote(note?: string | null, condition?: string | null) {
  let text = String(note || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // Replace known English condition codes embedded in notes
  Object.entries(RETURN_CONDITION_LABEL).forEach(([code, label]) => {
    if (code === 'normal' || code === 'abnormal' || code === 'other') return;
    text = text.replace(new RegExp(code, 'gi'), label);
  });
  // Drop pure machine-code leftovers
  text = text.replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/gi, '').replace(/[，,]\s*[，,]/g, '，').replace(/^[，,\s]+|[，,\s]+$/g, '').trim();
  // If note is only "已转管理员复核" and we have condition, prefer condition label
  if (!text || text === '已转管理员复核' || text === '异常归还') {
    const cond = friendlyReturnCondition(condition);
    if (cond && cond !== '正常' && cond !== '异常') return cond;
    return text || cond;
  }
  // Avoid duplicating "归还说明：" noise
  text = text.replace(/^归还说明[:：]\s*/, '');
  return text;
}

function canOpenSmartTarget(capability: ReturnType<typeof useCapability>, url?: string, type?: string) {
  const actionUrl = String(url || '');
  const actionType = String(type || '');
  if (actionUrl.includes('/admin/system')) return capability.isSuperAdmin;
  if (actionUrl.includes('/admin/devices')) return capability.canAny([PERMISSIONS.DEVICE_VIEW, PERMISSIONS.DEVICE_MANAGE]);
  if (actionType.includes('fault') || actionUrl.includes('/admin/faults')) return capability.canViewFaults;
  if (actionType.includes('reservation') || actionType.includes('overdue') || actionUrl.includes('/admin/reservations')) return capability.canViewReservations;
  if (actionType.includes('user') || actionUrl.includes('/admin/users')) return capability.canApproveUsers;
  if (actionUrl.includes('/admin/export')) return capability.canExportStats;
  if (actionUrl.includes('/admin/audit')) return capability.canViewAudit;
  return capability.canViewStats;
}

export function AdminDashboardPage() {
  const nav = useNavigate();
  const capability = useCapability();
  const smartEnabled = capability.canViewStats;
  const { data, isLoading, error } = useAdminDashboard();
  const { data: intelligence, isLoading: intelligenceLoading, error: intelligenceError } = useAdminIntelligence('7d', smartEnabled);
  const { data: returnTasksData, isLoading: returnTasksLoading, error: returnTasksError } = useAdminReturnTasks(capability.canViewReturns);
  const reviewReturn = useReviewReturnTask();
  const kpi = data?.kpi;
  const topRecommendations = intelligence?.recommendations?.slice(0, 6) ?? [];
  const deviceStatus = Object.entries(data?.device_status ?? {})
    .sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a[0]);
      const bi = STATUS_ORDER.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  const maxStatus = Math.max(1, ...deviceStatus.map(([, count]) => Number(count) || 0));


  const visibleRecommendations = smartEnabled ? topRecommendations.filter((item) => canOpenSmartTarget(capability, item.action_url, item.type)).slice(0, 3) : [];
  const overviewItems = [
    { label: '今日预约', value: kpi?.today_reservations, hint: '查看今日安排', to: '/admin/reservations', search: { scope: 'current' }, show: capability.canViewReservations, tone: 'normal' },
    { label: '使用中设备', value: kpi?.in_use_devices, hint: '查看当前使用', to: '/admin/devices', search: { status: 'in_use' }, show: capability.canViewDevices, tone: 'normal' },
    { label: '待审批预约', value: kpi?.pending_reservations, hint: '需要审批', to: '/admin/reservations', search: { status: 'pending' }, show: capability.canViewReservations, tone: Number(kpi?.pending_reservations || 0) > 0 ? 'warning' : 'normal' },
    { label: '异常设备', value: kpi?.abnormal_devices, hint: '故障或维护', to: '/admin/faults', search: {}, show: capability.canViewFaults, tone: Number(kpi?.abnormal_devices || 0) > 0 ? 'danger' : 'normal' }
  ].filter((item) => item.show);

  return (
    <div className="flex flex-col gap-4">
      <OpsPageHeader title="运营总览" className="ops-page-header--compact">
        {capability.canViewReservations ? <Button size="sm" onClick={() => nav({ to: '/admin/reservations', search: { status: 'pending' } } as any)}>审批预约</Button> : null}
        {capability.canViewFaults ? <Button variant="outline" size="sm" onClick={() => nav({ to: '/admin/faults' } as any)}>处理故障</Button> : null}
        {capability.canViewStats ? <Button variant="outline" size="sm" onClick={() => nav({ to: '/admin/stats' } as any)}>运营分析</Button> : null}
      </OpsPageHeader>

      {error && <Card><CardContent className="py-4 text-sm text-destructive">工作台加载失败：{toFriendlyError(error)}</CardContent></Card>}

      <section className="dashboard-status-strip grid sm:grid-cols-2 xl:grid-cols-4">
        {overviewItems.map((item) => (
          <button key={item.label} type="button" className={`dashboard-status-item dashboard-status-item--${item.tone}`} onClick={() => nav({ to: item.to, search: item.search } as any)}>
            <span>{item.label}</span>
            <strong>{isLoading ? '—' : Number(item.value || 0).toLocaleString('zh-CN')}</strong>
            <small>{item.hint}</small>
          </button>
        ))}
      </section>

{capability.canViewReturns && <Card className="ops-card">
        <CardHeader className="pb-3"><OpsSectionHeader title="归还与超期任务" /></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <OpsBadge tone="danger">逾期借用 {returnTasksData?.summary.overdue_borrows ?? 0}</OpsBadge>
            <OpsBadge tone="warning">待验收{returnTasksData?.summary.pending_acceptance ?? 0}</OpsBadge>
            <OpsBadge tone="danger">异常归还 {returnTasksData?.summary.abnormal_returns ?? 0}</OpsBadge>
          </div>
          {returnTasksError && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">任务加载失败：{toFriendlyError(returnTasksError)}</p>}
          {returnTasksLoading ? (
            <p className="text-sm text-muted-foreground">正在加载归还任务…</p>
          ) : !returnTasksData?.tasks.length ? (
            <OpsEmptyState title="暂无归还或超期任务" />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {returnTasksData.tasks.slice(0, 6).map((task) => (
                <div key={task.id} className="rounded-2xl border bg-background/80 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{task.device_code} · {task.device_name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">使用人：{task.user_name} · 应还：{briefDateTime(task.expected_return_time)}</p>
                    </div>
                    <OpsBadge tone={task.status === 'return_pending' ? 'warning' : 'danger'}>{task.status === 'in_use' ? '已逾期' : task.status === 'return_pending' ? '待验收' : '异常'}</OpsBadge>
                  </div>
                  {(() => {
                  const note = friendlyReturnNote(task.return_note, task.return_condition);
                  const cond = task.return_condition && task.return_condition !== 'normal'
                    ? friendlyReturnCondition(task.return_condition)
                    : '';
                  const text = note || cond;
                  if (!text) return null;
                  return <p className="mt-2 line-clamp-2 text-xs text-muted-foreground" title={text}>{text}</p>;
                })()}
                  {task.return_material_required ? (
                    <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200">等待用户补充 · 截止 {briefDateTime(task.return_material_deadline)}</p>
                  ) : task.return_supplemented_at ? (
                    <p className={`mt-2 rounded-lg px-2 py-1.5 text-xs ${task.return_material_late ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'}`}>用户已补充 · {briefDateTime(task.return_supplemented_at)}{task.return_material_late ? '（超时）' : ''}</p>
                  ) : null}
                  {task.return_supplement_note ? <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">补充说明：{task.return_supplement_note}</p> : null}
                  {task.return_supplement_photos?.length ? (
                    <div className="mt-2 flex gap-2 overflow-x-auto">
                      {task.return_supplement_photos.slice(0, 5).map((photo, index) => <a key={photo} href={photo} target="_blank" rel="noreferrer"><img src={photo} alt={`补充照片 ${index + 1}`} className="h-14 w-14 rounded-lg border object-cover" /></a>)}
                    </div>
                  ) : null}
                  {task.status !== 'in_use' && capability.canConfirmReturns ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" disabled={reviewReturn.isPending || Boolean(task.return_material_required && task.return_material_deadline && new Date(task.return_material_deadline).getTime() > Date.now())} onClick={() => reviewReturn.mutate({ id: task.id, approved: true }, { onSuccess: (result) => toast.success(result.message || '归还任务已处理'), onError: (error) => toast.error(toFriendlyError(error)) })}>{task.status === 'return_pending' ? '验收通过' : task.return_material_required && task.return_material_deadline && new Date(task.return_material_deadline).getTime() > Date.now() ? '等待用户补充' : '完成用户归还'}</Button>
                      {task.status === 'return_pending' ? <Button size="sm" variant="outline" disabled={reviewReturn.isPending} onClick={() => reviewReturn.mutate({ id: task.id, approved: false }, { onSuccess: (result) => toast.warning(result.message || '已标记异常'), onError: (error) => toast.error(toFriendlyError(error)) })}>标记异常并要求补充</Button> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>}
      <div className={`grid gap-4 ${smartEnabled ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : ''}`}>
        {smartEnabled ? <Card className="ops-card">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">运营提醒</CardTitle>
            <Button variant="outline" size="sm" onClick={() => nav({ to: '/admin/stats' } as any)}>查看全部</Button>
          </CardHeader>
          <CardContent className="p-0">
            {intelligenceError ? <p className="border-t p-4 text-xs text-destructive">提醒加载失败：{toFriendlyError(intelligenceError)}</p> : null}
            {visibleRecommendations.length ? visibleRecommendations.map((item) => (
              <button
                key={item.id}
                type="button"
                className="dashboard-recommendation group flex w-full items-center gap-3 border-t px-5 py-4 text-left"
                onClick={() => nav(parseAdminActionUrl(item.action_url) as any)}
                title={item.action_label || '查看'}
              >
                <OpsRiskBadge level={item.level === 'danger' ? 'high' : item.level === 'warning' ? 'medium' : 'low'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{compactCopy(item.description)}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">{item.action_label || '查看'}<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
              </button>
            )) : <p className="border-t px-5 py-8 text-center text-sm text-muted-foreground">{intelligenceLoading ? '提醒生成中…' : '暂无优先处理事项'}</p>}
          </CardContent>
        </Card> : null}

        <Card className="ops-card h-fit dashboard-device-status-card">
          <CardHeader className="dashboard-device-status-header">
            <CardTitle className="text-base">设备状态</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {deviceStatus.map(([status, count]) => {
              const value = Number(count) || 0;
              return (
                <div key={status} className="dashboard-device-status">
                  <div className="dashboard-device-status-row">
                    <span className={`dashboard-status-dot ${STATUS_DOT[status] ?? 'dashboard-status-dot--primary'}`} aria-hidden />
                    <span className="dashboard-device-status-label">{STATUS_LABEL[status] ?? status}</span>
                    <span className="dashboard-device-status-count">{value}</span>
                  </div>
                  <div className="ops-progress-track" aria-hidden>
                    <div
                      className={`ops-progress-fill ${STATUS_TONE[status] ?? 'ops-progress-fill--default'}`}
                      style={{ width: statusWidth(value, maxStatus) }}
                    />
                  </div>
                </div>
              );
            })}
            {!deviceStatus.length && <p className="dashboard-device-status-empty">暂无设备状态数据</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
