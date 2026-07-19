import { briefDateTime } from '@/lib/time-format';
import { useMemo, useState } from 'react';
import { Play, Plus, Wrench } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { OpsBadge, OpsEmptyState, OpsPageHeader } from '@/components/ops/design-system';
import { toFriendlyError } from '@/lib/friendly-error';

const PLAN_STATUS: Record<string, string> = { active: '活跃', paused: '已暂停', archived: '已归档' };
const ORDER_STATUS: Record<string, string> = { pending: '待处理', in_progress: '维护中', completed: '已完成', cancelled: '已取消' };
const SCHEDULER_STATUS: Record<string, string> = { success: '正常', running: '执行中', failed: '失败', never_run: '未运行' };
const RECOVERY_BLOCKER: Record<string, string> = {
  active_maintenance_window: '存在生效的维护窗口',
  open_fault_report: '存在待处理故障',
  open_maintenance_work_order: '存在未完成维护工单'
};
const TYPE_OPTIONS = [
  { value: 'inspection', label: '巡检' },
  { value: 'preventive', label: '预防性维护' },
  { value: 'repair', label: '维修' },
  { value: 'calibration', label: '校准' }
];

function typeLabel(value?: string | null) {
  return TYPE_OPTIONS.find((item) => item.value === value)?.label || value || '-';
}

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
  const [tab, setTab] = useState<'plans' | 'orders'>('orders');
  const [showCreate, setShowCreate] = useState(false);
  const [planForm, setPlanForm] = useState({ device_id: '', title: '', maintenance_type: 'inspection', interval_days: '90', next_due_at: '', notes: '' });
  const [orderForm, setOrderForm] = useState({
    device_id: '',
    plan_id: '',
    title: '',
    maintenance_type: 'inspection',
    assigned_to: '',
    description: '',
    window_start: inputDateTime(0),
    window_end: inputDateTime(1)
  });
  const [recoveryNotices, setRecoveryNotices] = useState<Record<string, string>>({});

  const metrics = useMemo(() => {
    const summary = (overview?.summary || {}) as Record<string, unknown>;
    return [
      ['活跃计划', Number(summary.active_plans || 0)],
      ['逾期计划', Number(summary.overdue_plans || 0)],
      ['待处理工单', Number(summary.pending_orders || 0)],
      ['处理中工单', Number(summary.processing_orders || 0)],
      ['生效窗口', Number(summary.active_windows || 0)],
      ['逾期工单', Number(summary.overdue_orders || 0)]
    ] as Array<[string, number]>;
  }, [overview]);

  const scheduler = overview?.scheduler;
  const relatedPlans = plans.filter((plan) => !orderForm.device_id || plan.device_id === orderForm.device_id);

  function reportError(error: unknown) {
    toast.error(`操作失败：${toFriendlyError(error)}`);
  }

  function submitPlan(event: React.FormEvent) {
    event.preventDefault();
    createPlan.mutate(
      {
        ...planForm,
        interval_days: Number(planForm.interval_days || 0),
        next_due_at: planForm.next_due_at ? new Date(planForm.next_due_at).toISOString() : undefined
      },
      {
        onSuccess: () => {
          toast.success('维护计划已创建');
          setPlanForm({ device_id: '', title: '', maintenance_type: 'inspection', interval_days: '90', next_due_at: '', notes: '' });
          setShowCreate(false);
          setTab('plans');
        },
        onError: reportError
      }
    );
  }

  function submitOrder(event: React.FormEvent) {
    event.preventDefault();
    createOrder.mutate(
      {
        ...orderForm,
        plan_id: orderForm.plan_id || undefined,
        assigned_to: orderForm.assigned_to || undefined,
        window_start: new Date(orderForm.window_start).toISOString(),
        window_end: new Date(orderForm.window_end).toISOString()
      },
      {
        onSuccess: () => {
          toast.success('维护工单已创建');
          setOrderForm({
            device_id: '',
            plan_id: '',
            title: '',
            maintenance_type: 'inspection',
            assigned_to: '',
            description: '',
            window_start: inputDateTime(0),
            window_end: inputDateTime(1)
          });
          setShowCreate(false);
          setTab('orders');
        },
        onError: reportError
      }
    );
  }

  function updateOrderStatus(order: MaintenanceWorkOrder, status: 'in_progress' | 'completed' | 'cancelled') {
    updateOrder.mutate(
      { id: order.id, status },
      {
        onSuccess: (result: any) => {
          toast.success('工单已更新');
          const blockers = result?.recovery?.blockers || result?.data?.recovery?.blockers || [];
          if (status === 'completed' && Array.isArray(blockers) && blockers.length) {
            setRecoveryNotices((current) => ({
              ...current,
              [order.id]: blockers.map((item: string) => RECOVERY_BLOCKER[item] || item).join('；')
            }));
          } else {
            setRecoveryNotices((current) => {
              const next = { ...current };
              delete next[order.id];
              return next;
            });
          }
        },
        onError: reportError
      }
    );
  }

  return (
    <div className="ops-page-stack maintenance-page">
      <OpsPageHeader
        title="设备维护"
        className="ops-page-header--compact"
        children={
          canManage ? (
            <Button size="sm" onClick={() => setShowCreate((value) => !value)}>
              <Plus className="h-4 w-4" />
              {showCreate ? '收起新建' : '新建'}
            </Button>
          ) : null
        }
      />

      <section className="maintenance-summary">
        {metrics.map(([label, value]) => (
          <div key={label} className="maintenance-summary-item">
            <span>{label}</span>
            <strong>{overviewLoading ? '—' : value}</strong>
          </div>
        ))}
        <div className="maintenance-summary-item maintenance-summary-item--wide">
          <span>调度器</span>
          <strong className="text-sm font-medium">
            {SCHEDULER_STATUS[scheduler?.status || ''] || scheduler?.status || '—'}
            {scheduler?.started_at ? ` · ${localDateTime(scheduler.started_at)}` : ''}
          </strong>
        </div>
      </section>

      {showCreate && canManage ? (
        <section className="maintenance-create-grid">
          <form className="maintenance-create-card" onSubmit={submitPlan}>
            <div className="maintenance-create-title">新建维护计划</div>
            <div className="maintenance-create-fields">
              <label>
                <span>设备</span>
                <select required value={planForm.device_id} onChange={(e) => setPlanForm({ ...planForm, device_id: e.target.value })}>
                  <option value="">选择设备</option>
                  {devices.map((device) => (
                    <option key={device.id || device.device_code} value={String(device.id || '')}>
                      {device.device_code} · {device.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>标题</span>
                <Input required value={planForm.title} onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })} />
              </label>
              <label>
                <span>类型</span>
                <select value={planForm.maintenance_type} onChange={(e) => setPlanForm({ ...planForm, maintenance_type: e.target.value })}>
                  {TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label>
                <span>周期（天）</span>
                <Input required type="number" min={1} value={planForm.interval_days} onChange={(e) => setPlanForm({ ...planForm, interval_days: e.target.value })} />
              </label>
              <label>
                <span>下次到期</span>
                <Input type="datetime-local" value={planForm.next_due_at} onChange={(e) => setPlanForm({ ...planForm, next_due_at: e.target.value })} />
              </label>
              <label className="maintenance-span-2">
                <span>备注</span>
                <Input value={planForm.notes} onChange={(e) => setPlanForm({ ...planForm, notes: e.target.value })} />
              </label>
            </div>
            <Button type="submit" size="sm" disabled={createPlan.isPending}>{createPlan.isPending ? '创建中…' : '创建计划'}</Button>
          </form>

          <form className="maintenance-create-card" onSubmit={submitOrder}>
            <div className="maintenance-create-title">新建维护工单</div>
            <div className="maintenance-create-fields">
              <label>
                <span>设备</span>
                <select required value={orderForm.device_id} onChange={(e) => setOrderForm({ ...orderForm, device_id: e.target.value, plan_id: '' })}>
                  <option value="">选择设备</option>
                  {devices.map((device) => (
                    <option key={device.id || device.device_code} value={String(device.id || '')}>
                      {device.device_code} · {device.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>关联计划</span>
                <select value={orderForm.plan_id} onChange={(e) => setOrderForm({ ...orderForm, plan_id: e.target.value })}>
                  <option value="">不关联</option>
                  {relatedPlans.map((plan) => (
                    <option key={plan.id} value={plan.id}>{plan.title}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>标题</span>
                <Input required value={orderForm.title} onChange={(e) => setOrderForm({ ...orderForm, title: e.target.value })} />
              </label>
              <label>
                <span>类型</span>
                <select value={orderForm.maintenance_type} onChange={(e) => setOrderForm({ ...orderForm, maintenance_type: e.target.value })}>
                  {TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label>
                <span>窗口开始</span>
                <Input required type="datetime-local" value={orderForm.window_start} onChange={(e) => setOrderForm({ ...orderForm, window_start: e.target.value })} />
              </label>
              <label>
                <span>窗口结束</span>
                <Input required type="datetime-local" value={orderForm.window_end} onChange={(e) => setOrderForm({ ...orderForm, window_end: e.target.value })} />
              </label>
              <label>
                <span>负责人编号</span>
                <Input value={orderForm.assigned_to} onChange={(e) => setOrderForm({ ...orderForm, assigned_to: e.target.value })} />
              </label>
              <label>
                <span>描述</span>
                <Input value={orderForm.description} onChange={(e) => setOrderForm({ ...orderForm, description: e.target.value })} />
              </label>
            </div>
            <Button type="submit" size="sm" disabled={createOrder.isPending}>{createOrder.isPending ? '创建中…' : '创建工单'}</Button>
          </form>
        </section>
      ) : null}

      <section className="maintenance-panel">
        <div className="maintenance-panel-toolbar">
          <div className="ops-segment-group flex gap-1">
            <Button size="sm" variant={tab === 'orders' ? 'default' : 'outline'} onClick={() => setTab('orders')}>
              维护工单 {orders.length}
            </Button>
            <Button size="sm" variant={tab === 'plans' ? 'default' : 'outline'} onClick={() => setTab('plans')}>
              维护计划 {plans.length}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">工单创建后，对应时段将阻断新预约</p>
        </div>

        {tab === 'orders' ? (
          <div className="maintenance-list">
            {ordersLoading ? <p className="p-6 text-center text-sm text-muted-foreground">工单加载中…</p> : null}
            {ordersError ? <p className="p-6 text-center text-sm text-destructive">加载失败：{toFriendlyError(ordersError)}</p> : null}
            {!ordersLoading && !ordersError && orders.length === 0 ? <OpsEmptyState title="暂无维护工单" description="可点击右上角新建。" /> : null}
            {orders.map((order) => (
              <article key={order.id} className="maintenance-row">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{order.title}</h3>
                    <OpsBadge tone={order.status === 'completed' ? 'success' : order.status === 'in_progress' ? 'info' : order.status === 'pending' ? 'warning' : 'muted'}>
                      {ORDER_STATUS[order.status] ?? order.status}
                    </OpsBadge>
                    <span className="badge-pill badge-muted">{typeLabel(order.maintenance_type)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {order.device_code} · {order.device_name} · {localDateTime(order.window_start)} – {localDateTime(order.window_end)}
                  </p>
                  {order.description ? <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{order.description}</p> : null}
                  {recoveryNotices[order.id] ? <p className="mt-1 text-xs text-amber-700">设备未恢复：{recoveryNotices[order.id]}</p> : null}
                </div>
                {canManage && (order.status === 'pending' || order.status === 'in_progress') ? (
                  <div className="maintenance-row-actions">
                    {order.status === 'pending' ? (
                      <Button size="sm" disabled={updateOrder.isPending} onClick={() => updateOrderStatus(order, 'in_progress')}>
                        <Play className="h-3.5 w-3.5" /> 开始
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" disabled={updateOrder.isPending} onClick={() => updateOrderStatus(order, 'completed')}>
                      <Wrench className="h-3.5 w-3.5" /> 完成
                    </Button>
                    <Button size="sm" variant="ghost" disabled={updateOrder.isPending} onClick={() => updateOrderStatus(order, 'cancelled')}>取消</Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="maintenance-list">
            {plansLoading ? <p className="p-6 text-center text-sm text-muted-foreground">计划加载中…</p> : null}
            {plansError ? <p className="p-6 text-center text-sm text-destructive">加载失败：{toFriendlyError(plansError)}</p> : null}
            {!plansLoading && !plansError && plans.length === 0 ? <OpsEmptyState title="暂无维护计划" description="可点击右上角新建。" /> : null}
            {plans.map((plan) => (
              <article key={plan.id} className="maintenance-row">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{plan.title}</h3>
                    <OpsBadge tone={plan.status === 'active' ? 'success' : 'muted'}>{PLAN_STATUS[plan.status] ?? plan.status}</OpsBadge>
                    <span className="badge-pill badge-muted">{typeLabel(plan.maintenance_type)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {plan.device_code} · {plan.device_name} · 周期 {plan.interval_days} 天 · 下次 {localDateTime(plan.next_due_at)}
                  </p>
                  {plan.notes ? <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{plan.notes}</p> : null}
                </div>
                {canManage && plan.status !== 'archived' ? (
                  <div className="maintenance-row-actions">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updatePlan.isPending}
                      onClick={() => updatePlan.mutate(
                        { id: plan.id, status: plan.status === 'active' ? 'paused' : 'active' },
                        { onSuccess: () => toast.success('计划已更新'), onError: reportError }
                      )}
                    >
                      {plan.status === 'active' ? '暂停' : '恢复'}
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
