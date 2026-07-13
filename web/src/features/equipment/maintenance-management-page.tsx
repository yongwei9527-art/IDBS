import { briefDateTime } from '@/lib/time-format';
import { useMemo, useState } from 'react';
import { ClipboardList, Play, Plus, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import {
  useAdminDevices,
  useCreateMaintenancePlan,
  useCreateMaintenanceWorkOrder,
  useMaintenanceOverview,
  useMaintenancePlans,
  useMaintenanceWorkOrders,
  useUpdateMaintenancePlan,
  useUpdateMaintenanceWorkOrder,
  type MaintenanceWorkOrder
} from '@/features/platform/operations-api';
import { useCapability } from '@/features/auth/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { OpsBadge, OpsEmptyState, OpsMetricCard, OpsPageHeader, OpsSectionHeader } from '@/components/ops/design-system';
import { toFriendlyError } from '@/lib/friendly-error';

const T = {
  title: '\u8bbe\u5907\u7ef4\u62a4', desc: '\u7edf\u4e00\u7f16\u6392\u7ef4\u62a4\u8ba1\u5212\u3001\u5de5\u5355\u4e0e\u9884\u7ea6\u963b\u65ad\u7a97\u53e3\uff0c\u964d\u4f4e\u8bbe\u5907\u505c\u6446\u4e0e\u4e34\u65f6\u51b2\u7a81\u98ce\u9669\u3002',
  activePlans: '\u6d3b\u8dc3\u8ba1\u5212', overduePlans: '\u903e\u671f\u8ba1\u5212', pendingOrders: '\u5f85\u5904\u7406\u5de5\u5355', processingOrders: '\u5904\u7406\u4e2d\u5de5\u5355', activeWindows: '\u751f\u6548\u7a97\u53e3', overdueWindows: '\u903e\u671f\u7a97\u53e3', overdueOrders: '\u903e\u671f\u5de5\u5355', scheduler: '\u7ef4\u62a4\u8c03\u5ea6\u5668',
  newPlan: '\u65b0\u5efa\u7ef4\u62a4\u8ba1\u5212', newOrder: '\u65b0\u5efa\u7ef4\u62a4\u5de5\u5355', plans: '\u7ef4\u62a4\u8ba1\u5212', orders: '\u7ef4\u62a4\u5de5\u5355',
  device: '\u8bbe\u5907', selectDevice: '\u9009\u62e9\u8bbe\u5907', titleLabel: '\u6807\u9898', type: '\u7ef4\u62a4\u7c7b\u578b', interval: '\u5468\u671f\uff08\u5929\uff09', nextDue: '\u4e0b\u6b21\u5230\u671f\u65f6\u95f4', notes: '\u5907\u6ce8', create: '\u521b\u5efa',
  plan: '\u5173\u8054\u8ba1\u5212\uff08\u53ef\u9009\uff09', start: '\u7a97\u53e3\u5f00\u59cb', end: '\u7a97\u53e3\u7ed3\u675f', assignee: '\u8d1f\u8d23\u4eba\u7f16\u53f7\uff08\u53ef\u9009\uff09', description: '\u5de5\u5355\u63cf\u8ff0',
  noPlans: '\u6682\u65e0\u7ef4\u62a4\u8ba1\u5212', noOrders: '\u6682\u65e0\u7ef4\u62a4\u5de5\u5355', startMaintenance: '\u5f00\u59cb\u7ef4\u62a4', completeRestore: '\u5b8c\u6210\u5e76\u5c1d\u8bd5\u6062\u590d\u8bbe\u5907', cancel: '\u53d6\u6d88', pause: '\u6682\u505c', resume: '\u6062\u590d',
  submitted: '\u5df2\u521b\u5efa', updated: '\u5df2\u66f4\u65b0', failed: '\u64cd\u4f5c\u5931\u8d25', conflictHint: '\u5de5\u5355\u521b\u5efa\u540e\uff0c\u5bf9\u5e94\u65f6\u95f4\u6bb5\u5c06\u963b\u65ad\u65b0\u9884\u7ea6\uff0c\u5df2\u91cd\u53e0\u7684\u9884\u7ea6\u4f1a\u6536\u5230\u901a\u77e5\u3002'
};

const PLAN_STATUS: Record<string, string> = { active: '\u6d3b\u8dc3', paused: '\u5df2\u6682\u505c', archived: '\u5df2\u5f52\u6863' };
const ORDER_STATUS: Record<string, string> = { pending: '\u5f85\u5904\u7406', in_progress: '\u7ef4\u62a4\u4e2d', completed: '\u5df2\u5b8c\u6210', cancelled: '\u5df2\u53d6\u6d88' };
const SCHEDULER_STATUS: Record<string, string> = { success: '\u6b63\u5e38', running: '\u6267\u884c\u4e2d', failed: '\u5931\u8d25', never_run: '\u672a\u8fd0\u884c' };
const RECOVERY_BLOCKER: Record<string, string> = { active_maintenance_window: '\u5b58\u5728\u751f\u6548\u7684\u7ef4\u62a4\u7a97\u53e3', open_fault_report: '\u5b58\u5728\u5f85\u5904\u7406\u6545\u969c', open_maintenance_work_order: '\u5b58\u5728\u672a\u5b8c\u6210\u7ef4\u62a4\u5de5\u5355' };

function localDateTime(value?: string | null) {
  if (!value) return '-';
  return briefDateTime(value);
}

function inputDateTime(hours = 1) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

export function AdminMaintenancePage() {
  const capability = useCapability();
  const canManage = capability.canAny(['device.manage', 'fault.manage']);
  const { data: overview, isLoading: overviewLoading } = useMaintenanceOverview();
  const { data: devicesData } = useAdminDevices();
  const { data: plansData, isLoading: plansLoading, error: plansError } = useMaintenancePlans();
  const { data: ordersData, isLoading: ordersLoading, error: ordersError } = useMaintenanceWorkOrders();
  const createPlan = useCreateMaintenancePlan();
  const updatePlan = useUpdateMaintenancePlan();
  const createOrder = useCreateMaintenanceWorkOrder();
  const updateOrder = useUpdateMaintenanceWorkOrder();
  const devices = devicesData?.list ?? [];
  const plans = plansData?.plans ?? [];
  const orders = ordersData?.work_orders ?? [];
  const [planForm, setPlanForm] = useState({ device_id: '', title: '', maintenance_type: 'inspection', interval_days: '90', next_due_at: '', notes: '' });
  const [orderForm, setOrderForm] = useState({ device_id: '', plan_id: '', title: '', maintenance_type: 'inspection', assigned_to: '', description: '', window_start: inputDateTime(), window_end: inputDateTime(2) });
  const [recoveryNotices, setRecoveryNotices] = useState<Record<string, string>>({});
  const summary = overview?.summary;
  const metrics = useMemo(() => [
    [T.activePlans, summary?.active_plans, 'default'], [T.overduePlans, summary?.overdue_plans, 'warning'], [T.pendingOrders, summary?.pending_work_orders, 'warning'], [T.processingOrders, summary?.in_progress_work_orders, 'info'], [T.activeWindows, summary?.active_windows, 'danger'], [T.overdueWindows, summary?.overdue_windows, 'danger'], [T.overdueOrders, summary?.overdue_work_orders, 'danger']
  ] as const, [summary]);

  function reportError(error: unknown) { toast.error(`${T.failed}: ${toFriendlyError(error)}`); }
  function submitPlan(event: React.FormEvent) {
    event.preventDefault();
    createPlan.mutate({ ...planForm, interval_days: Number(planForm.interval_days || 0), next_due_at: planForm.next_due_at ? new Date(planForm.next_due_at).toISOString() : null }, { onSuccess: () => { toast.success(T.submitted); setPlanForm({ device_id: '', title: '', maintenance_type: 'inspection', interval_days: '90', next_due_at: '', notes: '' }); }, onError: reportError });
  }
  function submitOrder(event: React.FormEvent) {
    event.preventDefault();
    const windowStart = new Date(orderForm.window_start);
    const windowEnd = new Date(orderForm.window_end);
    if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) {
      toast.error('\u8bf7\u586b\u5199\u6709\u6548\u7684\u7ef4\u62a4\u5f00\u59cb\u4e0e\u7ed3\u675f\u65f6\u95f4\u3002');
      return;
    }
    if (windowEnd <= windowStart) {
      toast.error('\u7ef4\u62a4\u7ed3\u675f\u65f6\u95f4\u5fc5\u987b\u665a\u4e8e\u5f00\u59cb\u65f6\u95f4\u3002');
      return;
    }
    createOrder.mutate({ ...orderForm, plan_id: orderForm.plan_id || null, assigned_to: orderForm.assigned_to || null, window_start: windowStart.toISOString(), window_end: windowEnd.toISOString() }, { onSuccess: (data) => { toast.success(data.affected_reservations ? `${T.submitted} (${data.affected_reservations})` : T.submitted); setOrderForm((current) => ({ ...current, title: '', description: '' })); }, onError: reportError });
  }
  function updateOrderStatus(order: MaintenanceWorkOrder, status: 'in_progress' | 'completed' | 'cancelled') {
    updateOrder.mutate({ id: order.id, status, restore_available: status === 'completed' }, {
      onSuccess: (data) => {
        const blockers = data.recovery?.blockers ?? [];
        if (data.recovery?.blocked) {
          const notice = blockers.map((item) => RECOVERY_BLOCKER[item] ?? item).join('、');
          setRecoveryNotices((current) => ({ ...current, [order.id]: notice }));
          toast.warning(`工单已更新，设备暂未恢复：${notice}`);
        } else {
          setRecoveryNotices((current) => { const { [order.id]: _removed, ...rest } = current; return rest; });
          toast.success(data.recovery?.recovered ? '工单已更新，设备已恢复可预约。' : T.updated);
        }
      },
      onError: reportError
    });
  }

  return <div className="flex flex-col gap-4">
    <OpsPageHeader title={T.title} description={T.desc} aside={<p className="text-sm leading-6 text-white/80">{T.conflictHint}</p>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{metrics.map(([label, value, tone]) => <OpsMetricCard key={label} label={label} value={value ?? 0} tone={tone} loading={overviewLoading} />)}</div>
    <Card className="ops-card">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div>
          <p className="font-semibold">{T.scheduler}</p>
          <p className="mt-1 text-xs text-muted-foreground">最近计划：{localDateTime(overview?.scheduler?.scheduled_for)} · 完成：{localDateTime(overview?.scheduler?.finished_at)}</p>
        </div>
        <OpsBadge tone={overview?.scheduler?.status === 'success' ? 'success' : overview?.scheduler?.status === 'failed' ? 'danger' : 'warning'}>
          {SCHEDULER_STATUS[overview?.scheduler?.status ?? 'never_run'] ?? overview?.scheduler?.status}
        </OpsBadge>
        {overview?.scheduler?.error_message && <p className="w-full rounded-lg border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">{overview.scheduler.error_message}</p>}
      </CardContent>
    </Card>    {canManage && <div className="grid gap-4 xl:grid-cols-2">
      <Card className="ops-card"><CardHeader><CardTitle>{T.newPlan}</CardTitle></CardHeader><CardContent><form className="grid gap-3 sm:grid-cols-2" onSubmit={submitPlan}>
        <label className="text-sm sm:col-span-2"><span>{T.device}</span><select required value={planForm.device_id} onChange={(e) => setPlanForm({ ...planForm, device_id: e.target.value })} className="mt-1 h-10 w-full rounded-md border bg-background px-3"><option value="">{T.selectDevice}</option>{devices.map((item) => <option key={item.id} value={item.id}>{item.device_code} · {item.name}</option>)}</select></label>
        <label className="text-sm"><span>{T.titleLabel}</span><Input required value={planForm.title} onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })} className="mt-1" /></label>
        <label className="text-sm"><span>{T.type}</span><Input value={planForm.maintenance_type} onChange={(e) => setPlanForm({ ...planForm, maintenance_type: e.target.value })} className="mt-1" /></label>
        <label className="text-sm"><span>{T.interval}</span><Input required min="0" max="3650" type="number" value={planForm.interval_days} onChange={(e) => setPlanForm({ ...planForm, interval_days: e.target.value })} className="mt-1" /></label>
        <label className="text-sm"><span>{T.nextDue}</span><Input type="datetime-local" value={planForm.next_due_at} onChange={(e) => setPlanForm({ ...planForm, next_due_at: e.target.value })} className="mt-1" /></label>
        <label className="text-sm sm:col-span-2"><span>{T.notes}</span><textarea value={planForm.notes} onChange={(e) => setPlanForm({ ...planForm, notes: e.target.value })} rows={2} className="mt-1 w-full rounded-md border bg-background px-3 py-2" /></label>
        <Button type="submit" disabled={createPlan.isPending} className="sm:col-span-2"><Plus className="mr-1 h-4 w-4" />{T.create}</Button>
      </form></CardContent></Card>
      <Card className="ops-card"><CardHeader><CardTitle>{T.newOrder}</CardTitle></CardHeader><CardContent><form className="grid gap-3 sm:grid-cols-2" onSubmit={submitOrder}>
        <label className="text-sm"><span>{T.device}</span><select required value={orderForm.device_id} onChange={(e) => setOrderForm({ ...orderForm, device_id: e.target.value })} className="mt-1 h-10 w-full rounded-md border bg-background px-3"><option value="">{T.selectDevice}</option>{devices.map((item) => <option key={item.id} value={item.id}>{item.device_code} · {item.name}</option>)}</select></label>
        <label className="text-sm"><span>{T.plan}</span><select value={orderForm.plan_id} onChange={(e) => setOrderForm({ ...orderForm, plan_id: e.target.value })} className="mt-1 h-10 w-full rounded-md border bg-background px-3"><option value="">-</option>{plans.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label className="text-sm"><span>{T.titleLabel}</span><Input required value={orderForm.title} onChange={(e) => setOrderForm({ ...orderForm, title: e.target.value })} className="mt-1" /></label>
        <label className="text-sm"><span>{T.type}</span><Input value={orderForm.maintenance_type} onChange={(e) => setOrderForm({ ...orderForm, maintenance_type: e.target.value })} className="mt-1" /></label>
        <label className="text-sm"><span>{T.start}</span><Input required type="datetime-local" value={orderForm.window_start} onChange={(e) => setOrderForm({ ...orderForm, window_start: e.target.value })} className="mt-1" /></label>
        <label className="text-sm"><span>{T.end}</span><Input required type="datetime-local" value={orderForm.window_end} onChange={(e) => setOrderForm({ ...orderForm, window_end: e.target.value })} className="mt-1" /></label>
        <label className="text-sm"><span>{T.assignee}</span><Input value={orderForm.assigned_to} onChange={(e) => setOrderForm({ ...orderForm, assigned_to: e.target.value })} className="mt-1" /></label>
        <label className="text-sm"><span>{T.description}</span><Input value={orderForm.description} onChange={(e) => setOrderForm({ ...orderForm, description: e.target.value })} className="mt-1" /></label>
        <Button type="submit" disabled={createOrder.isPending} className="sm:col-span-2"><ClipboardList className="mr-1 h-4 w-4" />{T.create}</Button>
      </form></CardContent></Card>
    </div>}
    <section className="grid gap-4 xl:grid-cols-2">
      <Card className="ops-card"><CardHeader><OpsSectionHeader title={T.plans} /></CardHeader><CardContent className="space-y-3">{plansLoading ? <p className="text-sm text-muted-foreground">{'\u7ef4\u62a4\u8ba1\u5212\u52a0\u8f7d\u4e2d\u2026'}</p> : plansError ? <p className="text-sm text-destructive">{'\u7ef4\u62a4\u8ba1\u5212\u52a0\u8f7d\u5931\u8d25\uff1a'}{toFriendlyError(plansError)}</p> : plans.length === 0 ? <OpsEmptyState title={T.noPlans} /> : plans.map((plan) => <div key={plan.id} className="rounded-2xl border p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{plan.title}</p><p className="mt-1 text-xs text-muted-foreground">{plan.device_code} · {plan.device_name} · {plan.maintenance_type}</p></div><OpsBadge tone={plan.status === 'active' ? 'success' : 'muted'}>{PLAN_STATUS[plan.status] ?? plan.status}</OpsBadge></div><p className="mt-2 text-xs text-muted-foreground">{T.nextDue}: {localDateTime(plan.next_due_at)} · {T.interval}: {plan.interval_days}</p>{canManage && plan.status !== 'archived' && <div className="mt-3"><Button size="sm" variant="outline" disabled={updatePlan.isPending} onClick={() => updatePlan.mutate({ id: plan.id, status: plan.status === 'active' ? 'paused' : 'active' }, { onSuccess: () => toast.success(T.updated), onError: reportError })}>{plan.status === 'active' ? T.pause : T.resume}</Button></div>}</div>)}</CardContent></Card>
      <Card className="ops-card"><CardHeader><OpsSectionHeader title={T.orders} /></CardHeader><CardContent className="space-y-3">{ordersLoading ? <p className="text-sm text-muted-foreground">{'\u7ef4\u62a4\u5de5\u5355\u52a0\u8f7d\u4e2d\u2026'}</p> : ordersError ? <p className="text-sm text-destructive">{'\u7ef4\u62a4\u5de5\u5355\u52a0\u8f7d\u5931\u8d25\uff1a'}{toFriendlyError(ordersError)}</p> : orders.length === 0 ? <OpsEmptyState title={T.noOrders} /> : orders.map((order) => <div key={order.id} className="rounded-2xl border p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{order.title}</p><p className="mt-1 text-xs text-muted-foreground">{order.device_code} · {order.device_name} · {localDateTime(order.window_start)} - {localDateTime(order.window_end)}</p></div><OpsBadge tone={order.status === 'completed' ? 'success' : order.status === 'in_progress' ? 'info' : order.status === 'pending' ? 'warning' : 'muted'}>{ORDER_STATUS[order.status] ?? order.status}</OpsBadge></div>{order.description && <p className="mt-2 text-sm text-muted-foreground">{order.description}</p>}{recoveryNotices[order.id] && <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-50 p-2 text-xs text-amber-900">设备未恢复：{recoveryNotices[order.id]}</p>}{canManage && (order.status === 'pending' || order.status === 'in_progress') && <div className="mt-3 flex flex-wrap gap-2">{order.status === 'pending' && <Button size="sm" onClick={() => updateOrderStatus(order, 'in_progress')} disabled={updateOrder.isPending}><Play className="mr-1 h-4 w-4" />{T.startMaintenance}</Button>}<Button size="sm" variant="outline" onClick={() => updateOrderStatus(order, 'completed')} disabled={updateOrder.isPending}><Wrench className="mr-1 h-4 w-4" />{T.completeRestore}</Button><Button size="sm" variant="ghost" onClick={() => updateOrderStatus(order, 'cancelled')} disabled={updateOrder.isPending}>{T.cancel}</Button></div>}</div>)}</CardContent></Card>
    </section>
  </div>;
}
