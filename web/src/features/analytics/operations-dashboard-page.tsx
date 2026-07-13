import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarCheck,
  ClipboardList,
  DatabaseZap,
  FileDown,
  LockKeyhole,
  MessageSquareText,
  Settings,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wrench
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAdminDashboard, useAdminIntelligence, useAdminReturnTasks, useReviewReturnTask } from '@/features/platform/operations-api';
import { parseAdminActionUrl } from '@/features/analytics/operations-action';
import { PERMISSION_LABELS, PERMISSIONS, useCapability } from '@/features/auth/permissions';
import { OpsBadge, OpsDataToolbar, OpsEmptyState, OpsMetricCard, OpsPageHeader, OpsQuickCard, OpsRiskBadge, OpsSectionHeader } from '@/components/ops/design-system';
import { briefDateTime } from '@/lib/time-format';
import { toFriendlyError } from '@/lib/friendly-error';
import { toast } from 'sonner';

const STATUS_LABEL: Record<string, string> = {
  available: '可用',
  in_use: '使用中',
  reserved: '已预约',
  maintenance: '维护中',
  abnormal_pending: '异常待处理',
  disabled: '停用'
};

const STATUS_TONE: Record<string, string> = {
  available: 'from-emerald-500 to-teal-400',
  in_use: 'from-blue-500 to-cyan-400',
  maintenance: 'from-amber-500 to-orange-400',
  abnormal_pending: 'from-rose-500 to-red-400',
  disabled: 'from-slate-400 to-slate-500'
};


function statusWidth(value: number, max: number) {
  if (value <= 0) return '0%';
  return `${Math.round((value / Math.max(1, max)) * 100)}%`;
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
  const smartSummary = intelligence?.summary;
  const health = intelligence?.health_summary;
  const topRecommendations = intelligence?.recommendations?.slice(0, 6) ?? [];
  const deviceStatus = Object.entries(data?.device_status ?? {});
  const maxStatus = Math.max(1, ...deviceStatus.map(([, count]) => Number(count) || 0));


  const kpiCards = useMemo(
    () => [
      { label: '设备总数', value: kpi?.device_total, hint: '资产台账', to: '/admin/devices', search: {}, show: capability.canViewDevices, tone: 'info', icon: <DatabaseZap className="h-5 w-5" /> },
      { label: '可预约', value: kpi?.available_devices, hint: '可直接预约', to: '/admin/devices', search: { status: 'available' }, show: capability.canViewDevices, tone: 'success', icon: <ShieldCheck className="h-5 w-5" /> },
      { label: '使用中', value: kpi?.in_use_devices, hint: '借用/实验中', to: '/admin/devices', search: { status: 'in_use' }, show: capability.canViewDevices, tone: 'info', icon: <Wrench className="h-5 w-5" /> },
      { label: '异常设备', value: kpi?.abnormal_devices, hint: '故障/维护', to: '/admin/faults', search: {}, show: capability.canViewFaults, tone: 'danger', icon: <AlertTriangle className="h-5 w-5" /> },
      { label: '待审预约', value: kpi?.pending_reservations, hint: '需处理', to: '/admin/reservations', search: { status: 'pending' }, show: capability.canViewReservations, tone: 'warning', icon: <CalendarCheck className="h-5 w-5" /> },
      { label: '待审用户', value: kpi?.pending_users, hint: '注册审核', to: '/admin/users', search: { status: 'pending' }, show: capability.canApproveUsers, tone: 'warning', icon: <UsersRound className="h-5 w-5" /> },
      { label: '今日预约', value: kpi?.today_reservations, hint: '今日计划', to: '/admin/reservations', search: { scope: 'current' }, show: capability.canViewReservations, tone: 'success', icon: <ClipboardList className="h-5 w-5" /> },
      { label: '本周借用', value: kpi?.week_usage_count, hint: '近 7 天', to: '/admin/stats', search: {}, show: capability.canViewStats, tone: 'info', icon: <Sparkles className="h-5 w-5" /> }
    ].filter((item) => item.show),
    [capability, kpi]
  );

  const moduleCards = [
    { title: '设备资产台账', desc: '状态、时间段、预约能力、借用和故障历史。', to: '/admin/devices', enabled: capability.canViewDevices, need: [PERMISSIONS.DEVICE_VIEW], icon: <DatabaseZap className="h-5 w-5" /> },
    { title: '预约审批中枢', desc: '批次审批、单设备审批、风险提示与改期边界。', to: '/admin/reservations', enabled: capability.canAny([PERMISSIONS.RESERVATION_VIEW, PERMISSIONS.RESERVATION_APPROVE, PERMISSIONS.RESERVATION_CHANGE_PLAN]), need: [PERMISSIONS.RESERVATION_VIEW], icon: <CalendarCheck className="h-5 w-5" /> },
    { title: '故障与异常归还', desc: '故障处理、异常归还复核、设备恢复闭环。', to: '/admin/faults', enabled: capability.canViewFaults, need: [PERMISSIONS.FAULT_MANAGE, PERMISSIONS.DEVICE_VIEW], icon: <Wrench className="h-5 w-5" /> },
    { title: '用户与授权', desc: '用户审核、封禁、微信解绑；高危授权仅超管。', to: '/admin/users', enabled: capability.canApproveUsers, need: [PERMISSIONS.USER_APPROVE, PERMISSIONS.USER_MANAGE], icon: <UsersRound className="h-5 w-5" /> },
    { title: '诉求协同', desc: '用户诉求、预约相关请求和处理记录。', to: '/admin/requests', enabled: capability.canAny([PERMISSIONS.USER_MANAGE, PERMISSIONS.RESERVATION_VIEW]), need: [PERMISSIONS.USER_MANAGE, PERMISSIONS.RESERVATION_VIEW], icon: <MessageSquareText className="h-5 w-5" /> },
    { title: '运营分析', desc: '风险设备、高峰时段、待办负载与角色建议。', to: '/admin/stats', enabled: capability.canViewStats, need: [PERMISSIONS.STATS_VIEW], icon: <BarChart3 className="h-5 w-5" /> },
    { title: '文档导出中心', desc: '按业务权限导出预约、借还、故障、用户活动。', to: '/admin/export', enabled: capability.canExportStats, need: [PERMISSIONS.STATS_EXPORT], icon: <FileDown className="h-5 w-5" /> },
    { title: '操作审计', desc: '查看关键操作留痕、风险动作和账号活动。', to: '/admin/audit', enabled: capability.canViewAudit, need: [PERMISSIONS.AUDIT_VIEW], icon: <Activity className="h-5 w-5" /> },
    { title: '系统配置', desc: '安全、角色、时间段、通知等高危设置。', to: '/admin/system', enabled: capability.isSuperAdmin, need: ['super_admin'], icon: <Settings className="h-5 w-5" /> }
  ];
  const visibleModuleCards = moduleCards.filter((module) => module.enabled);
  const visibleRecommendations = smartEnabled ? topRecommendations.filter((item) => canOpenSmartTarget(capability, item.action_url, item.type)).slice(0, 3) : [];
  const permissionChips = capability.isSuperAdmin
    ? ['最高权限', '全站配置', '角色授权', '安全治理']
    : capability.permissions.map((permission) => PERMISSION_LABELS[permission] ?? permission).slice(0, 6);
  const commandFilters = [
    capability.canViewReservations ? '预约' : '',
    capability.canViewFaults ? '异常' : '',
    capability.canViewDevices ? '设备' : '',
    capability.canManageUsers ? '用户' : '',
    capability.canExportStats ? '导出' : ''
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <OpsPageHeader
        eyebrow="运营工作台"
        title="服务运营总览"
        description="以权限边界、预约风险、设备状态和待办闭环为主线，统一呈现管理员当前可处理的运营工作台"
        aside={(
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-white/60">当前身份</p>
                <p className="mt-2 text-2xl font-black text-white">{capability.isSuperAdmin ? '最高权限管理员' : capability.isAdminLike ? '分权管理员' : '普通用户'}</p>
              </div>
              <span className="rounded-2xl bg-white/12 p-2 text-white"><LockKeyhole className="h-5 w-5" /></span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(permissionChips.length ? permissionChips : ['仅用户端']).map((label) => (
                <span key={label} className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/76">{label}</span>
              ))}
            </div>
          </>
        )}
      >
        {visibleModuleCards.slice(0, 5).map((module) => (
          <button
            key={module.title}
            type="button"
            onClick={() => nav({ to: module.to } as any)}
            className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/82 backdrop-blur transition hover:bg-white/18"
          >
            {module.title}
          </button>
        ))}
        {!visibleModuleCards.length && <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/82">暂无后台模块</span>}
      </OpsPageHeader>

      {error && <Card><CardContent className="py-4 text-sm text-destructive">工作台加载失败：{toFriendlyError(error)}</CardContent></Card>}

      <OpsDataToolbar
        title="运营指挥台"
        description="只显示当前账号有权处理的入口，避免越权操作。"
        filters={(
          <>
            {(commandFilters.length ? commandFilters : ['用户端']).map((label) => <OpsBadge key={label} tone="muted">{label}</OpsBadge>)}
            {Number(kpi?.pending_reservations || 0) > 0 ? <OpsRiskBadge level="medium">待审 {kpi?.pending_reservations}</OpsRiskBadge> : null}
            {Number(kpi?.abnormal_devices || 0) > 0 ? <OpsRiskBadge level="high">异常 {kpi?.abnormal_devices}</OpsRiskBadge> : null}
          </>
        )}
        actions={(
          <>
            {capability.canViewReservations ? <Button variant="outline" size="sm" onClick={() => nav({ to: '/admin/reservations', search: { status: 'pending' } } as any)}>处理预约</Button> : null}
            {capability.canViewFaults ? <Button variant="outline" size="sm" onClick={() => nav({ to: '/admin/faults' } as any)}>处理异常</Button> : null}
            {capability.canViewStats ? <Button size="sm" onClick={() => nav({ to: '/admin/stats' } as any)}>查看运营分析</Button> : null}
          </>
        )}
        meta={capability.isSuperAdmin ? '最高权限视图' : capability.isAdminLike ? '分权视图' : '用户视图'}
      />

      <div className="grid auto-rows-min gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((item) => (
          <OpsMetricCard
            key={item.label}
            label={item.label}
            value={item.value}
            hint={item.hint}
            icon={item.icon}
            tone={item.tone as any}
            loading={isLoading}
            onClick={() => nav({ to: item.to, search: item.search } as any)}
          />
        ))}
      </div>

{capability.canViewReturns && <Card className="ops-card">
        <CardHeader className="pb-3"><OpsSectionHeader eyebrow="交接验收" title="归还与超期任务" description="用户归还后须由有权限的运营人员验收；验收前设备保持不可预约。" /></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <OpsBadge tone="danger">逾期借用 {returnTasksData?.summary.overdue_borrows ?? 0}</OpsBadge>
            <OpsBadge tone="warning">待验收{returnTasksData?.summary.pending_acceptance ?? 0}</OpsBadge>
            <OpsBadge tone="danger">异常归还 {returnTasksData?.summary.abnormal_returns ?? 0}</OpsBadge>
          </div>
          {returnTasksError && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">任务加载失败：{toFriendlyError(returnTasksError)}</p>}
          {returnTasksLoading ? <p className="text-sm text-muted-foreground">正在加载归还任务…</p> : !returnTasksData?.tasks.length ? <OpsEmptyState title="暂无归还或超期任务" description="所有设备交接状态正常。" /> : <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{returnTasksData.tasks.slice(0, 6).map((task) => <div key={task.id} className="rounded-2xl border bg-background/80 p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{task.device_code} · {task.device_name}</p><p className="mt-1 text-xs text-muted-foreground">使用人：{task.user_name} · 应还：{briefDateTime(task.expected_return_time)}</p></div><OpsBadge tone={task.status === 'return_pending' ? 'warning' : 'danger'}>{task.status === 'in_use' ? '已逾期' : task.status === 'return_pending' ? '待验收' : '异常'}</OpsBadge></div>{task.return_note && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">归还说明：{task.return_note}</p>}{task.status !== 'in_use' && capability.canConfirmReturns && <div className="mt-3 flex gap-2"><Button size="sm" disabled={reviewReturn.isPending} onClick={() => reviewReturn.mutate({ id: task.id, approved: task.status === 'return_pending' }, { onSuccess: (result) => toast.success(result.message || '归还任务已处理'), onError: (error) => toast.error(toFriendlyError(error)) })}>{task.status === 'return_pending' ? '验收通过' : '确认异常'}</Button>{task.status === 'return_pending' && <Button size="sm" variant="outline" disabled={reviewReturn.isPending} onClick={() => reviewReturn.mutate({ id: task.id, approved: false }, { onSuccess: (result) => toast.warning(result.message || '已标记异常'), onError: (error) => toast.error(toFriendlyError(error)) })}>标记异常</Button>}</div>}</div>)}</div>}
        </CardContent>
      </Card>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="ops-card">
          <CardHeader>
            <OpsSectionHeader
              eyebrow="运营分析闭环"
              title="今日运营闭环"
              description="把审批、异常、设备健康和角色权限集中到一个处理面板。"
              action={smartEnabled ? (
                <Button variant="outline" size="sm" onClick={() => nav({ to: '/admin/stats' } as any)}>
                  运营分析
                </Button>
              ) : null}
            />
          </CardHeader>
          <CardContent className="space-y-4">
            {!smartEnabled ? (
              <div className="rounded-3xl border border-dashed bg-muted/20 p-5 text-sm leading-6 text-muted-foreground">
                当前账号未授予统计智能权限，已自动隐藏风险评分、运营预测和审计入口，仅显示已授权模块。              </div>
            ) : (
              <>
                {intelligenceError && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">运营分析摘要加载失败：{toFriendlyError(intelligenceError)}</div>}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {[
                    ['健康分', health?.score ?? smartSummary?.health_score ?? 0, health?.label || '综合评分'],
                    ['风险设备', smartSummary?.risk_devices ?? 0, '需优先巡检'],
                    ['高峰时段', smartSummary?.high_demand_slots ?? 0, '预约集中'],
                    ['逾期/异常', smartSummary?.overdue_or_abnormal ?? 0, '需复核'],
                    ['待办负载', smartSummary?.pending_workload ?? 0, '审批/故障/用户']
                  ].map(([label, value, hint]) => (
                    <div key={String(label)} className="rounded-2xl border bg-background/80 p-4 shadow-sm">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="mt-1 text-2xl font-black tabular-nums text-primary">{intelligenceLoading ? '—' : value}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 lg:grid-cols-3">
                  {visibleRecommendations.length ? visibleRecommendations.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="group rounded-2xl border bg-card p-4 text-left transition hover:-translate-y-px hover:border-primary/40 hover:shadow-md"
                      onClick={() => nav(parseAdminActionUrl(item.action_url) as any)}
                      title={item.action_label || '查看'}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold">{item.title}</span>
                        <span className="inline-flex items-center gap-2"><OpsRiskBadge level={item.level === 'danger' ? 'high' : item.level === 'warning' ? 'medium' : 'low'} /> <span className="badge-pill badge-info gap-1">{item.action_label || '查看'}<ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" /></span></span>
                      </div>
                      <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{item.description}</p>
                    </button>
                  )) : (
                    <OpsEmptyState
                      className="lg:col-span-3"
                      title={intelligenceLoading ? '建议生成中…' : '暂无优先建议'}
                      description={intelligenceLoading ? '系统正在汇总设备、预约和待办数据。' : '当前没有需要优先处理的运营分析建议。'}
                    />
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="ops-card h-fit">
          <CardHeader>
            <CardTitle className="text-base">设备状态分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {deviceStatus.map(([status, count]) => (
              <div key={status} className="rounded-2xl border bg-background/80 p-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-semibold">{STATUS_LABEL[status] ?? status}</span>
                  <span className="font-black tabular-nums">{count}</span>
                </div>
                <div className="ops-progress-track">
                  <div className={`ops-progress-fill bg-gradient-to-r ${STATUS_TONE[status] ?? 'from-primary to-cyan-400'}`} style={{ width: statusWidth(Number(count) || 0, maxStatus) }} />
                </div>
              </div>
            ))}
            {!deviceStatus.length && <p className="py-8 text-center text-sm text-muted-foreground">暂无设备状态数据</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="ops-card">
        <CardHeader>
          <CardTitle className="text-base">已授权后台模块</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleModuleCards.map((module) => (
            <OpsQuickCard
              key={module.title}
              title={module.title}
              description={(
                <>
                  {module.desc}
                  <span className="mt-3 block text-[11px] text-muted-foreground">
                    权限：{module.need.map((permission) => PERMISSION_LABELS[permission] ?? permission).join(' / ')}
                  </span>
                </>
              )}
              icon={module.icon}
              badge={<OpsBadge tone="success">可访问</OpsBadge>}
              onClick={() => nav({ to: module.to } as any)}
            />
          ))}
          {!visibleModuleCards.length && <div className="rounded-2xl border bg-muted/20 p-5 text-sm text-muted-foreground md:col-span-2 xl:col-span-3">当前账号没有后台权限，系统会自动回到用户端。</div>}
        </CardContent>
      </Card>
    </div>
  );
}
