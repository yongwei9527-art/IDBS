import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OpsDataToolbar, OpsPermissionHint } from '@/components/ops/design-system';
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

function toneClass(tone: 'normal' | 'warning' | 'danger' | 'success') {
  return {
    normal: 'border-primary/15 bg-primary/[0.035]',
    warning: 'border-amber-300/28 bg-amber-400/[0.09]',
    danger: 'border-red-300/28 bg-red-400/[0.09]',
    success: 'border-emerald-300/28 bg-emerald-400/[0.09]'
  }[tone];
}

function TaskCard({ title, count, description, to, enabled, tone = 'normal' }: {
  title: string;
  count: number | undefined;
  description: string;
  to: string;
  enabled: boolean;
  tone?: 'normal' | 'warning' | 'danger' | 'success';
}) {
  return (
    <div className={`rounded-2xl border p-4 ${toneClass(tone)}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-foreground">{title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <strong className="text-2xl font-black tabular-nums text-foreground">{metric(count)}</strong>
      </div>
      {enabled ? (
        <Link to={to as any} className="mt-3 inline-flex text-sm font-bold text-primary underline-offset-4 hover:underline">
          去处理
        </Link>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">当前账号无处理权限</p>
      )}
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
        <p className={`mt-1 text-xs ${emphasis ? 'text-amber-300' : 'text-muted-foreground'}`}>{meta}</p>
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

  const trend = (overview.data?.trend ?? []).map((item) => ({ ...item, day: String(item.day).slice(5) }));
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
    .slice(0, 3);
  const lowUtilization = (data?.low_utilization_devices ?? []).slice(0, 3);
  const peak = [...(data?.demand_forecast ?? [])].sort((a, b) => Number(b.count) - Number(a.count))[0];
  const overdueOrAbnormal = data?.summary.overdue_or_abnormal ?? 0;
  const hasTasks = Number(workload?.pending_reservations || 0) + Number(workload?.pending_faults || 0) + Number(workload?.overdue_borrows || 0) + Number(data?.summary.risk_devices || 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <section className="ops-page-header">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-black tracking-[0.16em] text-primary">实验室设备运行</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">运营看板</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">只保留影响预约履约、设备可用性和维护安排的事项，数据应当能直接带来下一步处理。</p>
          </div>
          <div className="flex gap-2">
            {RANGES.map((item) => (
              <Button key={item.key} size="sm" variant={range === item.key ? 'default' : 'outline'} onClick={() => setRange(item.key)}>{item.label}</Button>
            ))}
          </div>
        </div>
      </section>

      <OpsDataToolbar
        title="当前周期"
        description="先处理待办，再查看预约、借用和归还的变化。没有直接处理价值的统计不在此页展示。"
        meta={RANGES.find((item) => item.key === range)?.label}
        actions={capability.canExportStats ? <Link className="text-sm font-bold text-primary hover:underline" to={'/admin/export' as any}>导出报表</Link> : undefined}
      />

      <OpsPermissionHint title="统计权限" permissions="仅显示当前账号有权查看和处理的实验室运行数据。" />

      {overview.error && <Card><CardContent className="py-4 text-sm text-destructive">运营数据加载失败：{toFriendlyError(overview.error)}</CardContent></Card>}
      {intelligence.error && <Card><CardContent className="py-4 text-sm text-destructive">待办数据加载失败：{toFriendlyError(intelligence.error)}</CardContent></Card>}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div><h2 className="text-lg font-black">现在需要处理</h2><p className="mt-1 text-sm text-muted-foreground">按履约风险和设备可用性排序。</p></div>
          {!intelligence.isLoading && <span className="text-xs text-muted-foreground">{hasTasks ? '有待处理事项' : '当前没有待处理事项'}</span>}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <TaskCard title="待审批预约" count={workload?.pending_reservations} description="避免临近实验的预约滞留。" to="/admin/reservations?status=pending" enabled={capability.canViewReservations} tone="warning" />
          <TaskCard title="逾期借用" count={workload?.overdue_borrows} description="优先确认归还时间或安排续约。" to="/admin/reservations" enabled={capability.canViewReservations} tone={Number(workload?.overdue_borrows) ? 'danger' : 'normal'} />
          <TaskCard title="待处理故障" count={workload?.pending_faults} description="影响后续预约的设备应先完成处置。" to="/admin/faults" enabled={capability.canViewFaults} tone={Number(workload?.pending_faults) ? 'danger' : 'normal'} />
          <TaskCard title="风险设备" count={data?.summary.risk_devices} description="故障、异常归还或逾期记录较多。" to="/admin/devices" enabled={capability.canViewDevices} tone={Number(data?.summary.risk_devices) ? 'warning' : 'success'} />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-5"><p className="text-sm font-bold text-muted-foreground">周期预约</p><p className="mt-2 text-3xl font-black tabular-nums">{overview.isLoading ? '—' : metric(reservations, ' 次')}</p><p className="mt-2 text-xs text-muted-foreground">已提交的设备预约</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-sm font-bold text-muted-foreground">已开始借用</p><p className="mt-2 text-3xl font-black tabular-nums">{overview.isLoading ? '—' : metric(borrows, ' 次')}</p><p className="mt-2 text-xs text-muted-foreground">本周期实际借出</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-sm font-bold text-muted-foreground">完成归还</p><p className="mt-2 text-3xl font-black tabular-nums">{overview.isLoading ? '—' : metric(returns, ' 次')}</p><p className="mt-2 text-xs text-muted-foreground">{Number(overdueOrAbnormal) > 0 ? `${metric(overdueOrAbnormal)} 条异常记录待复核` : '暂无异常借还待复核'}</p></CardContent></Card>
      </section>

      <Card className="ops-chart-panel">
        <CardHeader>
          <CardTitle className="text-base">预约履约趋势</CardTitle>
          <p className="text-sm text-muted-foreground">只对比预约、借用和归还，用于判断实验室近期的实际使用节奏。</p>
        </CardHeader>
        <CardContent>
          {overview.isLoading ? <p className="py-20 text-center text-sm text-muted-foreground">趋势数据加载中…</p> : trend.length === 0 ? <p className="py-20 text-center text-sm text-muted-foreground">当前周期暂无预约和借还记录</p> : (
            <div className="h-[310px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}><defs><linearGradient id="reservationArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#0f766e" stopOpacity={0.24} /><stop offset="100%" stopColor="#0f766e" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 12 }} /><Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))' }} /><Legend /><Area type="monotone" dataKey="reservation_count" name="预约" stroke="#0f766e" fill="url(#reservationArea)" strokeWidth={2.5} /><Area type="monotone" dataKey="borrow_count" name="借用" stroke="#2563eb" fill="transparent" strokeWidth={2.5} /><Area type="monotone" dataKey="return_count" name="归还" stroke="#d97706" fill="transparent" strokeWidth={2.5} /></AreaChart></ResponsiveContainer></div>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/15 bg-primary/[0.025]">
        <CardHeader>
          <CardTitle className="text-base">智能运营建议</CardTitle>
          <p className="text-sm text-muted-foreground">结合当前数据，优先处理需要关注的异常。</p>
        </CardHeader>
        <CardContent>
          {intelligence.isLoading ? <p className="py-3 text-sm text-muted-foreground">正在生成建议…</p> : topExceptionReason ? (
            <div className="rounded-2xl border border-primary/15 bg-background/75 p-4">
              <p className="text-sm font-black">建议关注：{topExceptionReason.label}，共 {metric(topExceptionReason.count)} 条</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{topExceptionReason.advice}</p>
              {canViewExceptionRecords ? <Link className="mt-3 inline-flex text-sm font-bold text-primary hover:underline" to={exceptionRecordPath as any}>查看异常记录</Link> : null}
            </div>
          ) : <p className="py-3 text-sm text-muted-foreground">暂无需要优先处理的异常。</p>}
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1"><CardHeader><CardTitle className="text-base">预约安排提示</CardTitle><p className="text-sm text-muted-foreground">用于调整值守和开放时段。</p></CardHeader><CardContent>{intelligence.isLoading ? <p className="py-6 text-sm text-muted-foreground">数据加载中…</p> : peak && Number(peak.count) > 0 ? <div className="rounded-2xl border border-primary/15 bg-primary/[0.035] p-4"><p className="text-sm font-black">{WEEKDAYS[Number(peak.weekday)] || '未知日期'} {SLOT_LABEL[peak.slot_key] || peak.slot_key}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">该时段预约最多，共 {metric(peak.count)} 单。建议在此时段安排设备确认和现场支持。</p><Link className="mt-3 inline-flex text-sm font-bold text-primary hover:underline" to={'/admin/reservations' as any}>查看预约安排</Link></div> : <p className="py-6 text-sm text-muted-foreground">当前周期尚未形成明显的预约高峰。</p>}</CardContent></Card>
        <Card className="lg:col-span-1"><CardHeader><CardTitle className="text-base">优先巡检设备</CardTitle><p className="text-sm text-muted-foreground">仅展示会影响可用性的设备。</p></CardHeader><CardContent>{intelligence.isLoading ? <p className="py-6 text-sm text-muted-foreground">数据加载中…</p> : riskDevices.length ? <ul>{riskDevices.map((item) => <ResourceItem key={item.device_code} name={`${item.device_code} · ${item.device_name || '未命名设备'}`} meta={`风险分 ${metric(item.risk_score)}${item.suggestion ? ` · ${item.suggestion}` : ''}`} to="/admin/faults" enabled={capability.canViewFaults} emphasis />)}</ul> : <p className="py-6 text-sm text-muted-foreground">暂无需要优先巡检的设备。</p>}</CardContent></Card>
        <Card className="lg:col-span-1"><CardHeader><CardTitle className="text-base">低利用设备</CardTitle><p className="text-sm text-muted-foreground">用于决定是否调整开放安排或培训引导。</p></CardHeader><CardContent>{intelligence.isLoading ? <p className="py-6 text-sm text-muted-foreground">数据加载中…</p> : lowUtilization.length ? <ul>{lowUtilization.map((item) => <ResourceItem key={item.device_code} name={`${item.device_code} · ${item.device_name || '未命名设备'}`} meta={`本周期借用 ${metric(item.usage_count)} 次，预约 ${metric(item.reservation_count)} 次`} to="/admin/devices" enabled={capability.canViewDevices} />)}</ul> : <p className="py-6 text-sm text-muted-foreground">暂无需要调整安排的低利用设备。</p>}</CardContent></Card>
      </section>
    </div>
  );
}

