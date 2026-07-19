import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OpsPageHeader } from '@/components/ops/design-system';
import { useAnalyticsOverview, useAdminIntelligence } from '@/features/platform/operations-api';
import { useCapability } from '@/features/auth/permissions';
import { toFriendlyError } from '@/lib/friendly-error';

const RANGES = [
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' }
] as const;

const WEEKDAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const SLOT_LABEL: Record<string, string> = { morning: '上午', afternoon: '下午', evening: '晚上', night: '夜间' };

function metric(value: number | undefined, suffix = '') {
  return `${Number(value || 0).toLocaleString('zh-CN')}${suffix}`;
}

function compactText(value: unknown, max = 56) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function analyticsDayLabel(value: unknown) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return String(value || '—').slice(0, 10);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric'
  }).format(date);
}

function toneClass(tone: 'normal' | 'warning' | 'danger' | 'success') {
  return {
    normal: 'ops-task-card--normal',
    warning: 'ops-task-card--warning',
    danger: 'ops-task-card--danger',
    success: 'ops-task-card--success'
  }[tone];
}

function TaskCard({ title, count, description, to, enabled, tone = 'normal' }: {
  title: string;
  count: number | undefined;
  description?: string;
  to: string;
  enabled: boolean;
  tone?: 'normal' | 'warning' | 'danger' | 'success';
}) {
  return (
    <div className={`analytics-task-item ${toneClass(tone)}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="analytics-task-dot" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          {description ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <strong className="ml-auto text-xl font-semibold tabular-nums text-foreground">{metric(count)}</strong>
      {enabled ? <Link to={to as any} className="shrink-0 text-xs font-semibold text-primary hover:underline">处理</Link> : null}
    </div>
  );
}

function ResourceItem({ name, meta, to, enabled, emphasis = false }: {
  name: string;
  meta: string;
  to: string;
  enabled: boolean;
  emphasis?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border/70 py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-foreground">{name}</p>
        <p className={`mt-1 text-xs ${emphasis ? 'ops-resource-meta--warning' : 'text-muted-foreground'}`}>{meta}</p>
      </div>
      {enabled && <Link className="shrink-0 text-xs font-bold text-primary hover:underline" to={to as any}>查看</Link>}
    </li>
  );
}

export function AdminStatsPage() {
  const capability = useCapability();
  const initialRange = new URLSearchParams(window.location.search).get('range');
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>(initialRange === '7d' ? '7d' : '30d');
  const overview = useAnalyticsOverview(range);
  const intelligence = useAdminIntelligence(range, capability.canViewStats);

  const trend = (overview.data?.trend ?? []).map((item) => ({ ...item, day: analyticsDayLabel(item.day) }));
  const reservations = trend.reduce((total, item) => total + Number(item.reservation_count || 0), 0);
  const borrows = trend.reduce((total, item) => total + Number(item.borrow_count || 0), 0);
  const returns = trend.reduce((total, item) => total + Number(item.return_count || 0), 0);
  const data = intelligence.data;
  const workload = data?.workload;
  const topExceptionReason = data?.top_exception_reason;
  const exceptionRecordPath = topExceptionReason?.type === 'no_show' ? '/admin/reservations?scope=history' : '/admin/faults';
  const canViewExceptionRecords = topExceptionReason?.type === 'no_show' ? capability.canViewReservations : capability.canViewFaults;
  const riskDevices = [...(data?.device_risks ?? [])]
    .filter((item) => Number(item.risk_score) >= 45)
    .sort((a, b) => Number(b.risk_score) - Number(a.risk_score))
    .slice(0, 2);
  const lowUtilization = (data?.low_utilization_devices ?? []).slice(0, 2);
  const peak = [...(data?.demand_forecast ?? [])].sort((a, b) => Number(b.count) - Number(a.count))[0];
  const overdueOrAbnormal = data?.summary.overdue_or_abnormal ?? 0;
  const hasTasks = Number(workload?.pending_reservations || 0) + Number(workload?.pending_faults || 0) + Number(workload?.overdue_borrows || 0) + Number(data?.summary.risk_devices || 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      <OpsPageHeader title="运营分析" className="ops-page-header--compact">
        <div className="flex flex-wrap items-center gap-2">
          <div className="ops-segment-group">
            {RANGES.map((item) => (
              <Button key={item.key} size="sm" variant={range === item.key ? 'default' : 'outline'} onClick={() => setRange(item.key)}>{item.label}</Button>
            ))}
          </div>
          {capability.canExportStats ? <Link className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground hover:border-primary/35 hover:text-primary" to={'/admin/export' as any}>导出</Link> : null}
        </div>
      </OpsPageHeader>

      {overview.error && <Card><CardContent className="py-4 text-sm text-destructive">运营数据加载失败：{toFriendlyError(overview.error)}</CardContent></Card>}
      {intelligence.error && <Card><CardContent className="py-4 text-sm text-destructive">待办数据加载失败：{toFriendlyError(intelligence.error)}</CardContent></Card>}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 p-4">
          <CardTitle className="text-sm">待处理事项</CardTitle>
          {!intelligence.isLoading && <span className="text-xs text-muted-foreground">{hasTasks ? '需要处理' : '当前正常'}</span>}
        </CardHeader>
        <CardContent className="p-0">
          <div className="analytics-task-grid grid md:grid-cols-2 xl:grid-cols-4">
          <TaskCard title="待审批预约" count={workload?.pending_reservations} to="/admin/reservations?status=pending" enabled={capability.canViewReservations} tone="warning" />
          <TaskCard title="逾期借用" count={workload?.overdue_borrows} to="/admin/reservations" enabled={capability.canViewReservations} tone={Number(workload?.overdue_borrows) ? 'danger' : 'normal'} />
          <TaskCard title="待处理故障" count={workload?.pending_faults} to="/admin/faults" enabled={capability.canViewFaults} tone={Number(workload?.pending_faults) ? 'danger' : 'normal'} />
          <TaskCard title="风险设备" count={data?.summary.risk_devices} to="/admin/devices" enabled={capability.canViewDevices} tone={Number(data?.summary.risk_devices) ? 'warning' : 'success'} />
          </div>
        </CardContent>
      </Card>

      <section className="analytics-summary-strip grid sm:grid-cols-3">
        <div><span>预约</span><strong>{overview.isLoading ? '—' : metric(reservations, ' 次')}</strong></div>
        <div><span>开始使用</span><strong>{overview.isLoading ? '—' : metric(borrows, ' 次')}</strong></div>
        <div><span>完成归还</span><strong>{overview.isLoading ? '—' : metric(returns, ' 次')}</strong>{Number(overdueOrAbnormal) > 0 ? <small className="mt-1 block text-xs text-destructive">{metric(overdueOrAbnormal)} 条异常待复核</small> : null}</div>
      </section>

      <Card className="ops-chart-panel">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">预约与履约</CardTitle>
          <span className="text-xs text-muted-foreground">{RANGES.find((item) => item.key === range)?.label}</span>
        </CardHeader>
        <CardContent>
          {overview.isLoading ? <p className="py-20 text-center text-sm text-muted-foreground">数据加载中…</p> : trend.length === 0 ? <p className="py-20 text-center text-sm text-muted-foreground">当前周期暂无记录</p> : (
            <div className="h-[300px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}><defs><linearGradient id="reservationArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#118798" stopOpacity={0.18} /><stop offset="100%" stopColor="#118798" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 12 }} /><Tooltip contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))' }} /><Legend /><Area type="monotone" dataKey="reservation_count" name="预约" stroke="#118798" fill="url(#reservationArea)" strokeWidth={2.2} /><Area type="monotone" dataKey="borrow_count" name="借用" stroke="#3973c6" fill="transparent" strokeWidth={2.2} /><Area type="monotone" dataKey="return_count" name="归还" stroke="#b36c25" fill="transparent" strokeWidth={2.2} /></AreaChart></ResponsiveContainer></div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 p-4">
          <CardTitle className="text-sm">运行结论</CardTitle>
          <span className="text-xs text-muted-foreground">仅保留可执行信息</span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="analytics-insight-grid grid md:grid-cols-2 xl:grid-cols-4">
            <section>
              <p className="text-xs font-semibold text-muted-foreground">主要异常</p>
              {intelligence.isLoading ? <p className="mt-3 text-sm text-muted-foreground">加载中…</p> : topExceptionReason ? <>
                <p className="mt-2 text-sm font-semibold">{topExceptionReason.label} · {metric(topExceptionReason.count)} 条</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{compactText(topExceptionReason.advice)}</p>
                {canViewExceptionRecords ? <Link className="mt-2 inline-flex text-xs font-semibold text-primary hover:underline" to={exceptionRecordPath as any}>查看记录</Link> : null}
              </> : <p className="mt-3 text-sm text-muted-foreground">暂无异常</p>}
            </section>

            <section>
              <p className="text-xs font-semibold text-muted-foreground">预约高峰</p>
              {intelligence.isLoading ? <p className="mt-3 text-sm text-muted-foreground">加载中…</p> : peak && Number(peak.count) > 0 ? <>
                <p className="mt-2 text-sm font-semibold">{WEEKDAYS[Number(peak.weekday)] || '未知日期'} {SLOT_LABEL[peak.slot_key] || peak.slot_key}</p>
                <p className="mt-1 text-xs text-muted-foreground">{metric(peak.count)} 单 · 建议加强值守</p>
                <Link className="mt-2 inline-flex text-xs font-semibold text-primary hover:underline" to={'/admin/reservations' as any}>查看安排</Link>
              </> : <p className="mt-3 text-sm text-muted-foreground">无明显高峰</p>}
            </section>

            <section>
              <p className="text-xs font-semibold text-muted-foreground">优先巡检</p>
              {intelligence.isLoading ? <p className="mt-3 text-sm text-muted-foreground">加载中…</p> : riskDevices.length ? <ul>{riskDevices.map((item) => <ResourceItem key={item.device_code} name={`${item.device_code} · ${item.device_name || '未命名设备'}`} meta={`风险 ${metric(item.risk_score)}${item.suggestion ? ` · ${compactText(item.suggestion, 22)}` : ''}`} to="/admin/faults" enabled={capability.canViewFaults} emphasis />)}</ul> : <p className="mt-3 text-sm text-muted-foreground">暂无风险设备</p>}
            </section>

            <section>
              <p className="text-xs font-semibold text-muted-foreground">低利用设备</p>
              {intelligence.isLoading ? <p className="mt-3 text-sm text-muted-foreground">加载中…</p> : lowUtilization.length ? <ul>{lowUtilization.map((item) => <ResourceItem key={item.device_code} name={`${item.device_code} · ${item.device_name || '未命名设备'}`} meta={`借用 ${metric(item.usage_count)} · 预约 ${metric(item.reservation_count)}`} to="/admin/devices" enabled={capability.canViewDevices} />)}</ul> : <p className="mt-3 text-sm text-muted-foreground">暂无需调整设备</p>}
            </section>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

