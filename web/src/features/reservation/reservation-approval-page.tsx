import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  XCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { toFriendlyError } from '@/lib/friendly-error';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CompactId, formatCompactId } from '@/components/ui/compact-id';
import { useCapability } from '@/features/auth/permissions';
import { buildChatSearch } from '@/features/chat/chat-context';
import { compactTimeRange, fullDateTimeRange, shortDate, slotDisplayName, tinyTimeRange } from '@/lib/time-format';
import {
  OpsBadge,
  OpsDataToolbar,
  OpsDetailDrawer,
  OpsEmptyState,
  OpsMetricCard,
  OpsPageHeader,
  OpsPermissionHint,
  OpsRiskBadge,
  OpsSectionHeader,
  OpsTimeBlock
} from '@/components/ops/design-system';
import {
  useAdminReservationBatchDetail,
  useAdminReservationBatches,
  useApproveReservationBatch,
  useApproveReservationItem,
  useChangeReservationPlan,
  useMarkReservationNoShow,
  useReviewReservationCancellation,
  type AdminReservationBatch,
  type AdminReservationItem
} from '@/features/platform/operations-api';

const STATUS_LABEL: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消',
  in_use: '使用中',
  completed: '已完成',
  no_show: '缺席',
  faulted: '异常结束',
  available: '可预约',
  reserved: '已预约',
  maintenance: '维护中',
  abnormal_pending: '异常待处理',
  disabled: '已停用'
};

const STATUS_TONE: Record<string, string> = {
  pending: 'warn',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'muted',
  in_use: 'info',
  completed: 'muted',
  no_show: 'danger',
  faulted: 'danger',
  cancel_requested: 'warn',
  available: 'success',
  reserved: 'info',
  maintenance: 'warn',
  abnormal_pending: 'danger',
  disabled: 'muted'
};

const SCOPES = [
  { key: '', label: '全部' },
  { key: 'current', label: '当前' },
  { key: 'history', label: '历史' }
];

const STATUS_FILTERS = ['', 'pending', 'approved', 'rejected', 'in_use', 'completed'];


function itemId(item: AdminReservationItem) {
  return item.item_id || item.id;
}

function toDatetimeLocal(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function fromDatetimeLocal(value: string) {
  return value ? new Date(value).toISOString() : '';
}

function riskPanelTone(level?: string, safe?: boolean) {
  if (safe || level === 'safe') return 'border-emerald-200 bg-emerald-50/80 text-emerald-900';
  if (level === 'danger') return 'border-rose-200 bg-rose-50/90 text-rose-950';
  if (level === 'info') return 'border-sky-200 bg-sky-50/80 text-sky-900';
  return 'border-amber-200 bg-amber-50/80 text-amber-950';
}

function signalBadgeTone(level?: string) {
  if (level === 'danger') return 'badge-danger';
  if (level === 'warning') return 'badge-warn';
  if (level === 'info') return 'badge-info';
  return 'badge-success';
}

function signalLevelLabel(level?: string) {
  if (level === 'danger') return '高风险';
  if (level === 'warning') return '需复核';
  if (level === 'info') return '观察';
  if (level === 'safe') return '安全';
  return level || '信号';
}

const RISK_TYPE_LABEL: Record<string, string> = {
  user_unfinished_borrow: '申请人有未完成借用',
  user_history: '申请人历史记录',
  device_unavailable: '设备当前不可预约',
  device_status: '设备状态提醒',
  time_conflict: '预约时间冲突',
  repeated_booking: '重复预约提醒',
  overdue_history: '逾期历史提醒',
  no_show_history: '缺席历史提醒'
};

const RAW_TEXT_LABEL: Record<string, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
  night: '夜间',
  daytime: '白天',
  in_use: '使用中',
  available: '可预约',
  maintenance: '维护中',
  abnormal_pending: '异常待处理',
  user_unfinished_borrow: '申请人有未完成借用',
  user_history: '申请人历史记录'
};

function localizeReservationText(value?: unknown) {
  if (value === undefined || value === null) return '';
  let text = String(value);
  Object.entries(RAW_TEXT_LABEL).forEach(([key, label]) => {
    text = text.replace(new RegExp('\\b' + key + '\\b', 'g'), label);
  });
  return text;
}

function riskSignalText(signal: { message?: string; type?: string }) {
  const message = localizeReservationText(signal.message);
  if (message) return message;
  return RISK_TYPE_LABEL[signal.type || ''] || '审批信号';
}

function riskBadgeLevel(level?: string, safe?: boolean) {
  if (safe || level === 'safe') return 'low' as const;
  if (level === 'danger') return 'high' as const;
  if (level === 'warning') return 'medium' as const;
  if (level === 'critical') return 'critical' as const;
  return 'low' as const;
}

function approvalActionText(action?: string) {
  if (action === 'approve') return '建议通过';
  if (action === 'manual_review') return '建议人工复核';
  if (action === 'reject_or_hold') return '建议暂缓或拒绝';
  return '等待管理员判断';
}

function canAdjustItemStatus(status?: string) {
  return !['completed', 'in_use', 'cancelled', 'rejected', 'faulted', 'no_show'].includes(status || '');
}

function BatchCard({
  batch,
  active,
  onSelect
}: {
  batch: AdminReservationBatch;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-full rounded-2xl border p-3 text-left transition-all',
        active ? 'border-primary bg-primary/10 shadow-md ring-2 ring-primary/15' : 'border-input bg-card/80 hover:border-primary/40 hover:bg-card'
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge-pill badge-${STATUS_TONE[batch.status] ?? 'muted'}`}>{STATUS_LABEL[batch.status] ?? batch.status}</span>
            {batch.pending_count ? <span className="badge-pill badge-warn">待审 {batch.pending_count}</span> : null}
          </div>
          <h3 className="mt-1 truncate text-sm font-black">{localizeReservationText(batch.purpose) || '未填写用途'}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{batch.user_name || '未知用户'}{batch.user_phone ? ` / ${batch.user_phone}` : ''}</p>
        </div>
        <Eye className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
        <p className="truncate">设备：{batch.device_names || batch.device_codes || '—'}</p>
        <div className="flex items-center gap-1"><span>预约：</span><OpsTimeBlock compact label={`${shortDate(batch.first_start_time)} ${tinyTimeRange(batch.first_start_time, batch.last_end_time)}`} title={fullDateTimeRange(batch.first_start_time, batch.last_end_time)} /></div>
        <p>明细：{batch.item_count ?? 0} 项 · 通过 {batch.approved_count ?? 0} · 拒绝 {batch.rejected_count ?? 0}</p>
      </div>
    </button>
  );
}

function ApprovalDetail({
  batch,
  scope,
  note,
  setNote
}: {
  batch?: AdminReservationBatch;
  scope: string;
  note: string;
  setNote: (value: string) => void;
}) {
  const nav = useNavigate();
  const capability = useCapability();
  const detail = useAdminReservationBatchDetail(batch?.id, scope || undefined);
  const approveBatch = useApproveReservationBatch();
  const approveItem = useApproveReservationItem();
  const changePlan = useChangeReservationPlan();
  const markNoShow = useMarkReservationNoShow();
  const reviewCancellation = useReviewReservationCancellation();
  const canApprove = capability.canApproveReservations;
  const canChangePlan = capability.canChangeReservationPlan;
  const [editingPlanId, setEditingPlanId] = useState('');
  const [drawerItemId, setDrawerItemId] = useState('');
  const [noShowDraft, setNoShowDraft] = useState<{ id: string; category: 'forgot' | 'plan_changed' | 'schedule_conflict' | 'other'; note: string } | null>(null);
  const [planDrafts, setPlanDrafts] = useState<Record<string, { start_time: string; end_time: string; slot_key: string; admin_note: string }>>({});
  const items = detail.data?.items ?? [];
  const risk = detail.data?.approval_risk;
  const selectedDrawerItem = items.find((item) => itemId(item) === drawerItemId);
  const selectedDrawerSignals = selectedDrawerItem ? (risk?.items ?? []).filter((signal) => signal.item_id === itemId(selectedDrawerItem)) : [];

  if (!batch) {
    return (
      <Card className="ops-card">
        <CardContent className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center text-muted-foreground">
          <ClipboardCheck className="mb-3 h-10 w-10 opacity-60" />
          <p className="font-semibold text-foreground">请选择左侧预约批次</p>
          <p className="mt-2 max-w-sm text-sm">左侧选批次，右侧看详情。</p>
        </CardContent>
      </Card>
    );
  }
  const activeBatch = batch;

  function approveWhole(approved: boolean) {
    approveBatch.mutate(
      { id: activeBatch.id, approved, admin_note: note.trim() },
      {
        onSuccess: () => toast.success(approved ? '已通过本批预约' : '已拒绝本批预约'),
        onError: (e) => toast.error(`批次审批失败：${toFriendlyError(e)}`)
      }
    );
  }

  function reviewCancellationRequest(id: string, approved: boolean) {
    const note = window.prompt(approved ? '确认通过该取消申请？' : '确认驳回该取消申请？') ?? '';
    reviewCancellation.mutate({ id, approved, admin_note: note }, { onSuccess: (data) => toast.success(data.message || '已处理'), onError: (error) => toast.error(toFriendlyError(error)) });
  }

  function markNoShowItem(id: string) {
    setNoShowDraft({ id, category: 'plan_changed', note: note.trim() });
  }

  function submitNoShow() {
    if (!noShowDraft) return;
    if (noShowDraft.note.trim().length < 4) {
      toast.warning('请至少填写 4 个字符的原因说明。');
      return;
    }
    markNoShow.mutate(
      { id: noShowDraft.id, admin_note: noShowDraft.note.trim(), no_show_reason_category: noShowDraft.category },
      {
        onSuccess: (data) => {
          toast.success(data.message || '已标记爽约');
          setNoShowDraft(null);
          setDrawerItemId('');
        },
        onError: (e) => toast.error(`标记爽约失败：${toFriendlyError(e)}`)
      }
    );
  }

  function approveOne(id: string, approve: boolean) {
    approveItem.mutate(
      { id, approve, admin_note: note.trim() },
      {
        onSuccess: () => toast.success(approve ? '已通过该预约明细' : '已拒绝该预约明细'),
        onError: (e) => toast.error(`明细审批失败：${toFriendlyError(e)}`)
      }
    );
  }

  function openPlanEditor(item: AdminReservationItem) {
    const id = itemId(item);
    setEditingPlanId(id);
    setPlanDrafts((old) => ({
      ...old,
      [id]: old[id] ?? {
        start_time: toDatetimeLocal(item.start_time),
        end_time: toDatetimeLocal(item.end_time),
        slot_key: item.slot_key || 'custom',
        admin_note: item.admin_note || note.trim()
      }
    }));
  }

  function patchPlanDraft(id: string, patch: Partial<{ start_time: string; end_time: string; slot_key: string; admin_note: string }>) {
    setPlanDrafts((old) => ({ ...old, [id]: { ...(old[id] ?? { start_time: '', end_time: '', slot_key: 'custom', admin_note: '' }), ...patch } }));
  }

  function submitPlanChange(item: AdminReservationItem) {
    const id = itemId(item);
    const draft = planDrafts[id];
    if (!draft?.start_time || !draft?.end_time) {
      toast.warning('请填写调整后的开始和结束时间');
      return;
    }
    if (new Date(draft.end_time) <= new Date(draft.start_time)) {
      toast.warning('结束时间必须晚于开始时间');
      return;
    }
    changePlan.mutate(
      {
        id,
        start_time: fromDatetimeLocal(draft.start_time),
        end_time: fromDatetimeLocal(draft.end_time),
        slot_key: draft.slot_key || 'custom',
        admin_note: draft.admin_note || note.trim()
      },
      {
        onSuccess: () => {
          toast.success('预约时间已调整');
          setEditingPlanId('');
        },
        onError: (e) => toast.error(`调整失败：${toFriendlyError(e)}`)
      }
    );
  }

  return (
    <>
      <Card className="ops-card overflow-hidden">
      <CardContent className="grid gap-5 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-primary">审批详情 / 智能建议</p>
            <h2 className="mt-1 text-2xl font-black">{localizeReservationText(activeBatch.purpose) || '未填写用途'}</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="badge-pill badge-muted">{activeBatch.user_name || '未知用户'}{activeBatch.user_phone ? ` / ${activeBatch.user_phone}` : ''}</span>
              <span className={`badge-pill badge-${STATUS_TONE[activeBatch.status] ?? 'muted'}`}>{STATUS_LABEL[activeBatch.status] ?? activeBatch.status}</span>
              <span className="badge-pill badge-info">{activeBatch.item_count ?? 0} 条设备计划</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeBatch.user_id ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => nav({
                  to: '/chat',
                  search: buildChatSearch({
                    targetUserId: activeBatch.user_id,
                    type: 'reservation',
                    title: `预约审批沟通：${activeBatch.device_codes ?? formatCompactId(activeBatch.id, 8, 4, 'RSV')}`,
                    detail: localizeReservationText(activeBatch.purpose),
                    deviceCode: typeof activeBatch.device_codes === 'string' ? activeBatch.device_codes : '',
                    deviceName: typeof activeBatch.device_names === 'string' ? activeBatch.device_names : '',
                    userName: activeBatch.user_name,
                    userPhone: activeBatch.user_phone,
                    status: activeBatch.status,
                    batchId: activeBatch.id,
                    startTime: activeBatch.first_start_time ?? '',
                    endTime: activeBatch.last_end_time ?? ''
                  })
                } as any)}
              >
                <MessageSquare className="h-4 w-4" /> 联系申请人
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="ops-stat-card p-4">
            <p className="text-xs text-muted-foreground">待审明细</p>
            <strong className="mt-1 block text-3xl tabular-nums text-amber-600">{activeBatch.pending_count ?? 0}</strong>
          </div>
          <div className="ops-stat-card p-4">
            <p className="text-xs text-muted-foreground">设备范围</p>
            <strong className="mt-1 block truncate text-lg">{activeBatch.device_names || activeBatch.device_codes || '—'}</strong>
          </div>
          <div className="ops-stat-card p-4">
            <p className="text-xs text-muted-foreground">预约窗口</p>
            <div className="mt-2"><OpsTimeBlock label={`${shortDate(activeBatch.first_start_time)} ${tinyTimeRange(activeBatch.first_start_time, activeBatch.last_end_time)}`} title={fullDateTimeRange(activeBatch.first_start_time, activeBatch.last_end_time)} /></div>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="审批备注：通过/拒绝批次或单条时都会带上，可留空"
            clearable
          />
          <div className="flex flex-wrap gap-2">
            {canApprove ? (
              <>
                <Button size="sm" disabled={approveBatch.isPending || activeBatch.status !== 'pending'} onClick={() => approveWhole(true)}>
                  <CheckCircle2 className="h-4 w-4" /> 整批通过
                </Button>
                <Button size="sm" variant="outline" disabled={approveBatch.isPending || activeBatch.status !== 'pending'} onClick={() => approveWhole(false)}>
                  <XCircle className="h-4 w-4" /> 整批拒绝
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {risk ? (
          <div className={`rounded-3xl border p-4 text-sm ${riskPanelTone(risk.level, risk.safe)}`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-3">
                {risk.safe ? <ShieldCheck className="mt-0.5 h-5 w-5" /> : <AlertTriangle className="mt-0.5 h-5 w-5" />}
                <div>
                  <p className="font-black">{localizeReservationText(risk.summary) || '智能审批建议'}</p>
                  {risk.recommendation ? <p className="mt-1 text-xs leading-5 opacity-90">{localizeReservationText(risk.recommendation)}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-background/70 px-2 py-1 text-xs font-semibold">{localizeReservationText(risk.action_label) || approvalActionText(risk.action)}</span>
                    <span className="rounded-full bg-background/70 px-2 py-1 text-xs">风险分 {risk.risk_score ?? 0}</span>
                    <span className="rounded-full bg-background/70 px-2 py-1 text-xs">置信度 {risk.confidence ?? 0}%</span>
                    <span className="rounded-full bg-background/70 px-2 py-1 text-xs">
                      高风险 {risk.signal_counts?.danger ?? 0} / 复核 {risk.signal_counts?.warning ?? 0} / 观察 {risk.signal_counts?.info ?? 0}
                    </span>
                  </div>
                </div>
              </div>
              <Sparkles className="hidden h-8 w-8 opacity-60 md:block" />
            </div>
            {(risk.items ?? []).length ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {(risk.items ?? []).slice(0, 6).map((item, index) => (
                  <div key={`${item.item_id ?? index}-${item.type ?? 'risk'}`} className="rounded-2xl bg-background/75 p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`badge-pill ${signalBadgeTone(item.level)}`}>{signalLevelLabel(item.level)}</span>
                      <span className="font-semibold">{item.device_code || RISK_TYPE_LABEL[item.type || ''] || '审批信号'}</span>
                      {typeof item.score === 'number' ? <span className="text-muted-foreground">+{item.score}</span> : null}
                    </div>
                    <p className="mt-1 leading-5">{riskSignalText(item)}</p>
                    {Array.isArray(item.evidence) && item.evidence.length ? (
                      <p className="mt-1 text-muted-foreground">依据：{item.evidence.slice(0, 2).map(localizeReservationText).join('；')}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : detail.data ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5" />
              <div>
                <p className="font-black">风险预检暂未发现异常</p>
                <p className="mt-1 text-xs leading-5">没有返回阻断信号；审批前仍会按后端权限、设备状态和时间冲突进行最终校验。</p>
              </div>
            </div>
          </div>
        ) : null}

        {detail.isLoading ? <p className="rounded-2xl border bg-muted/30 p-4 text-center text-sm text-muted-foreground">明细加载中…</p> : null}
        {detail.error ? <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">明细加载失败：{toFriendlyError(detail.error)}</p> : null}

        <div className="grid gap-3">
          {items.map((item) => {
            const itemSignals = (risk?.items ?? []).filter((signal) => signal.item_id === itemId(item)).slice(0, 3);
            return (
              <div key={itemId(item)} className="rounded-3xl border border-input bg-card/80 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black">{item.device_name || item.device_code || <CompactId value={item.device_id} prefix="DEV" />}</p>
                      <span className={`badge-pill badge-${STATUS_TONE[item.status] ?? 'muted'}`}>{STATUS_LABEL[item.status] ?? item.status}</span>
                      {item.device_status ? <span className="badge-pill badge-muted">设备：{STATUS_LABEL[item.device_status] ?? item.device_status}</span> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <OpsTimeBlock compact label={`${shortDate(item.start_time)} ${tinyTimeRange(item.start_time, item.end_time)}`} title={fullDateTimeRange(item.start_time, item.end_time)} />
                      <span className="badge-pill badge-muted">{slotDisplayName(item.slot_key)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.user_name || activeBatch.user_name || '—'}{item.user_phone || activeBatch.user_phone ? ` / ${item.user_phone || activeBatch.user_phone}` : ''}</p>
                    {item.admin_note ? <p className="mt-1 text-xs text-muted-foreground">已有备注：{item.admin_note}</p> : null}
                    {itemSignals.map((signal, index) => (
                      <p key={`item-risk-${itemId(item)}-${signal.type ?? index}`} className="mt-1 text-xs text-amber-700">
                        {signalLevelLabel(signal.level)}：{riskSignalText(signal)}
                      </p>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setDrawerItemId(itemId(item))}>
                      <Eye className="h-4 w-4" /> 详情
                    </Button>
                    {canApprove ? (
                      <>
                        <Button size="sm" disabled={approveItem.isPending || item.status !== 'pending'} onClick={() => approveOne(itemId(item), true)}>
                          通过
                        </Button>
                        <Button size="sm" variant="outline" disabled={approveItem.isPending || item.status !== 'pending'} onClick={() => approveOne(itemId(item), false)}>
                          拒绝
                        </Button>
                      </>
                    ) : null}
                    {canChangePlan ? (
                      <Button size="sm" variant="outline" disabled={!canAdjustItemStatus(item.status)} onClick={() => openPlanEditor(item)}>
                        调整时间
                      </Button>
                    ) : null}
                  </div>
                </div>
                {editingPlanId === itemId(item) ? (
                  <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-3">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                        开始时间
                        <input className="h-10 rounded-xl border bg-card px-3 text-sm text-foreground" type="datetime-local" value={planDrafts[itemId(item)]?.start_time ?? ''} onChange={(e) => patchPlanDraft(itemId(item), { start_time: e.target.value })} />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                        结束时间
                        <input className="h-10 rounded-xl border bg-card px-3 text-sm text-foreground" type="datetime-local" value={planDrafts[itemId(item)]?.end_time ?? ''} onChange={(e) => patchPlanDraft(itemId(item), { end_time: e.target.value })} />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                        时段标识
                        <Input value={planDrafts[itemId(item)]?.slot_key ?? ''} onChange={(e) => patchPlanDraft(itemId(item), { slot_key: e.target.value })} placeholder="如：自定义时段 / 上午" />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                        调整备注
                        <Input value={planDrafts[itemId(item)]?.admin_note ?? ''} onChange={(e) => patchPlanDraft(itemId(item), { admin_note: e.target.value })} placeholder="给用户和审计看的原因" />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditingPlanId('')}>取消</Button>
                      <Button size="sm" disabled={changePlan.isPending} onClick={() => submitPlanChange(item)}>{changePlan.isPending ? '保存中…' : '保存调整'}</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {detail.data && items.length === 0 ? <p className="rounded-2xl border bg-muted/30 p-5 text-center text-sm text-muted-foreground">暂无明细</p> : null}
        </div>
      </CardContent>
    </Card>

      {noShowDraft ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !markNoShow.isPending) setNoShowDraft(null); }}>
          <div className="w-full max-w-lg rounded-[28px] border bg-card p-5 shadow-[0_28px_80px_rgba(15,23,42,0.24)]" role="dialog" aria-modal="true" aria-labelledby="no-show-dialog-title">
            <p className="text-xs font-black tracking-[0.16em] text-destructive">预约履约管理</p>
            <h2 id="no-show-dialog-title" className="mt-1 text-xl font-black">标记爽约</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">超过使用开始时间 90 分钟且无签到记录时，可记录为爽约。</p>
            <div className="mt-5 grid gap-4">
              <label className="grid gap-1.5 text-sm font-bold">
                爽约原因
                <select className="h-10 rounded-xl border bg-background px-3 text-sm font-normal" value={noShowDraft.category} onChange={(event) => setNoShowDraft((current) => current ? { ...current, category: event.target.value as typeof current.category } : current)}>
                  <option value="forgot">忘记使用</option>
                  <option value="plan_changed">计划变更</option>
                  <option value="schedule_conflict">时间冲突</option>
                  <option value="other">其他原因</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-bold">
                处理说明
                <textarea className="min-h-24 rounded-xl border bg-background px-3 py-2 text-sm font-normal leading-6" maxLength={500} value={noShowDraft.note} onChange={(event) => setNoShowDraft((current) => current ? { ...current, note: event.target.value } : current)} placeholder="请说明判定依据和处理备注" />
                <span className="text-xs font-normal text-muted-foreground">至少 4 个字符，便于后续核查</span>
              </label>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" disabled={markNoShow.isPending} onClick={() => setNoShowDraft(null)}>取消</Button>
              <Button variant="destructive" disabled={markNoShow.isPending || noShowDraft.note.trim().length < 4} onClick={submitNoShow}>{markNoShow.isPending ? '处理中' : '确认标记'}</Button>
            </div>
          </div>
        </div>
      ) : null}

      <OpsDetailDrawer
        open={Boolean(selectedDrawerItem)}
        title={selectedDrawerItem?.device_name || selectedDrawerItem?.device_code || '预约明细'}
        subtitle={selectedDrawerItem ? fullDateTimeRange(selectedDrawerItem.start_time, selectedDrawerItem.end_time) : undefined}
        onClose={() => setDrawerItemId('')}
        footer={selectedDrawerItem ? (
          <div className="flex flex-wrap justify-end gap-2">
            {canApprove ? (
              <>
                <Button size="sm" disabled={approveItem.isPending || selectedDrawerItem.status !== 'pending'} onClick={() => approveOne(itemId(selectedDrawerItem), true)}>通过该明细</Button>
                <Button size="sm" variant="outline" disabled={approveItem.isPending || selectedDrawerItem.status !== 'pending'} onClick={() => approveOne(itemId(selectedDrawerItem), false)}>拒绝该明细</Button>
              </>
            ) : null}
            {canApprove && selectedDrawerItem.status === 'cancel_requested' ? (
              <div className="flex gap-2"><Button size="sm" disabled={reviewCancellation.isPending} onClick={() => reviewCancellationRequest(itemId(selectedDrawerItem), true)}>通过取消</Button><Button size="sm" variant="outline" disabled={reviewCancellation.isPending} onClick={() => reviewCancellationRequest(itemId(selectedDrawerItem), false)}>驳回申请</Button></div>
            ) : null}
            {canApprove && selectedDrawerItem.status === 'approved' && new Date(selectedDrawerItem.start_time).getTime() + 15 * 60 * 1000 <= Date.now() ? (
              <Button size="sm" variant="destructive" disabled={markNoShow.isPending} onClick={() => markNoShowItem(itemId(selectedDrawerItem))}>标记爽约</Button>
            ) : null}
            {canChangePlan ? (
              <Button size="sm" variant="outline" disabled={!canAdjustItemStatus(selectedDrawerItem.status)} onClick={() => { openPlanEditor(selectedDrawerItem); setDrawerItemId(''); }}>调整时间</Button>
            ) : null}
          </div>
        ) : undefined}
      >
        {selectedDrawerItem ? (
          <div className="grid gap-4 text-sm">
            <OpsPermissionHint
              title="明细操作边界"
              permissions={canApprove && canChangePlan
                ? '当前账号可审批并调整该明细；后台仍会复核是否本人预约、是否越权。'
                : canApprove
                  ? '当前账号仅可审批，不能改变用户预约计划。'
                  : canChangePlan
                    ? '当前账号仅可调整时间，不能审批通过或驳回。'
                    : '当前账号只读，不能处理该明细。'}
            />
            <div className="grid gap-3 rounded-3xl border bg-muted/20 p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">设备</p>
                <p className="mt-1 font-black">{selectedDrawerItem.device_name || selectedDrawerItem.device_code || <CompactId value={selectedDrawerItem.device_id} prefix="DEV" />}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">状态</p>
                <p className="mt-1"><span className={`badge-pill badge-${STATUS_TONE[selectedDrawerItem.status] ?? 'muted'}`}>{STATUS_LABEL[selectedDrawerItem.status] ?? selectedDrawerItem.status}</span></p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">申请人</p>
                <p className="mt-1 font-semibold">{selectedDrawerItem.user_name || activeBatch.user_name || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">联系方式</p>
                <p className="mt-1 font-semibold">{selectedDrawerItem.user_phone || activeBatch.user_phone || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">时段</p>
                <div className="mt-1"><OpsTimeBlock label={compactTimeRange(selectedDrawerItem.start_time, selectedDrawerItem.end_time)} subLabel={slotDisplayName(selectedDrawerItem.slot_key)} title={fullDateTimeRange(selectedDrawerItem.start_time, selectedDrawerItem.end_time)} /></div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">设备状态</p>
                <p className="mt-1 font-semibold">{selectedDrawerItem.device_status ? STATUS_LABEL[selectedDrawerItem.device_status] ?? selectedDrawerItem.device_status : '未返回状态'}</p>
              </div>
            </div>

            <section className="rounded-3xl border bg-card p-4">
              <OpsSectionHeader
                eyebrow="Risk Check"
                title="风险预检"
                description={selectedDrawerSignals.length ? '以下信号来自审批预检，处理前建议逐项确认。' : '当前明细没有阻断信号，仍需按权限和设备状态处理。'}
                action={<OpsRiskBadge level={riskBadgeLevel(risk?.level, risk?.safe)}>{risk?.safe ? '低风险' : signalLevelLabel(risk?.level)}</OpsRiskBadge>}
              />
              <div className="mt-3 grid gap-2">
                {selectedDrawerSignals.length ? selectedDrawerSignals.map((signal, index) => (
                  <div key={`drawer-risk-${signal.type ?? index}`} className="rounded-2xl border bg-muted/20 p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`badge-pill ${signalBadgeTone(signal.level)}`}>{signalLevelLabel(signal.level)}</span>
                      <span className="font-black">{RISK_TYPE_LABEL[signal.type || ''] || signal.device_code || '审批信号'}</span>
                    </div>
                    <p className="mt-1 leading-5 text-muted-foreground">{riskSignalText(signal)}</p>
                    {Array.isArray(signal.evidence) && signal.evidence.length ? <p className="mt-1 text-muted-foreground">依据：{signal.evidence.map(localizeReservationText).join('；')}</p> : null}
                  </div>
                )) : (
                  <OpsEmptyState title="暂无异常信号" description="没有发现未归还、冲突或设备异常信号。" className="py-5" />
                )}
              </div>
            </section>

            {selectedDrawerItem.admin_note ? (
              <section className="rounded-3xl border bg-card p-4">
                <p className="text-xs font-black uppercase tracking-wider text-primary">已有备注</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedDrawerItem.admin_note}</p>
              </section>
            ) : null}
          </div>
        ) : null}
      </OpsDetailDrawer>
    </>
  );
}

export function AdminReservationsPage() {
  const initialParams = new URLSearchParams(window.location.search);
  const [status, setStatus] = useState(initialParams.get('status') ?? '');
  const [scope, setScope] = useState(initialParams.get('scope') ?? '');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { data, isLoading, error } = useAdminReservationBatches(status || undefined, scope || undefined);
  const capability = useCapability();
  const batches = data?.batches ?? [];
  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.id === selectedBatchId) ?? batches[0],
    [batches, selectedBatchId]
  );





  const stats = useMemo(() => ({
    total: batches.length,
    pending: batches.reduce((sum, batch) => sum + (batch.pending_count ?? (batch.status === 'pending' ? 1 : 0)), 0),
    approved: batches.reduce((sum, batch) => sum + (batch.approved_count ?? 0), 0),
    rejected: batches.reduce((sum, batch) => sum + (batch.rejected_count ?? 0), 0)
  }), [batches]);

  function setBatchNote(batchId: string, value: string) {
    setNotes((old) => ({ ...old, [batchId]: value }));
  }

  return (
    <div className="flex flex-col gap-4">
      <OpsPageHeader
        eyebrow="IDBS 5.0 · 审批中枢"
        title="预约审批工作台"
        description="以批次队列、风险预检、详情抽屉和权限边界为核心，集中完成预约审核、改期沟通和操作留痕。"
        aside={(
          <div className="grid grid-cols-2 gap-3">
            <OpsMetricCard label="批次" value={stats.total} tone="info" />
            <OpsMetricCard label="待审" value={stats.pending} tone="warning" />
            <OpsMetricCard label="通过" value={stats.approved} tone="success" />
            <OpsMetricCard label="拒绝" value={stats.rejected} tone="danger" />
          </div>
        )}
      >
        <OpsBadge tone="info">详情不跳转</OpsBadge>
        <OpsBadge tone="warning">风险预检</OpsBadge>
        <OpsBadge tone="success">操作留痕</OpsBadge>
      </OpsPageHeader>

      <OpsDataToolbar
        title="审批队列"
        description="按状态和时间范围快速定位，详情区保留风险、沟通和审计信息。"
        filters={(
          <>
            <OpsBadge tone={status ? 'default' : 'muted'}>{status ? STATUS_LABEL[status] ?? status : '全部状态'}</OpsBadge>
            <OpsBadge tone={scope ? 'info' : 'muted'}>{SCOPES.find((item) => item.key === scope)?.label || '全部范围'}</OpsBadge>
            <OpsBadge tone="warning">待审 {stats.pending}</OpsBadge>
          </>
        )}
        meta={'批次 ' + stats.total}
      />

      {(!capability.canApproveReservations || !capability.canChangeReservationPlan) ? (
        <OpsPermissionHint
          permissions={!capability.canApproveReservations && capability.canChangeReservationPlan
            ? '当前账号可调整预约时间，但不能审批通过或驳回。'
            : capability.canApproveReservations && !capability.canChangeReservationPlan
              ? '当前账号可审批预约，但不能改变用户预约计划。'
              : '只读模式：当前账号未被授予预约审批或改期权限。'}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4">
          <Card className="ops-card">
            <CardContent className="p-4">
              <div className="ops-section-title">
                <div>
                  <h2>筛选队列</h2>
                  <p>按范围和状态定位。</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {SCOPES.map((s) => (
                  <Button key={s.key || 'all'} size="sm" variant={scope === s.key ? 'default' : 'outline'} onClick={() => setScope(s.key)}>
                    {s.label}
                  </Button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {STATUS_FILTERS.map((s) => (
                  <Button key={s || 'all'} size="sm" variant={status === s ? 'default' : 'outline'} onClick={() => setStatus(s)}>
                    {s ? STATUS_LABEL[s] ?? s : '全部状态'}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-2 xl:max-h-[calc(100vh-260px)] xl:overflow-auto xl:pr-1">
            {batches.map((batch) => (
              <BatchCard key={batch.id} batch={batch} active={selectedBatch?.id === batch.id} onSelect={() => setSelectedBatchId(batch.id)} />
            ))}
            {isLoading ? <p className="rounded-2xl border bg-card/70 p-5 text-center text-sm text-muted-foreground">加载中…</p> : null}
            {error ? <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-center text-sm text-destructive">加载失败：{toFriendlyError(error)}</p> : null}
            {!isLoading && !error && batches.length === 0 ? (
              <div className="rounded-3xl border bg-card/70 p-8 text-center text-muted-foreground">
                <ClipboardCheck className="mx-auto mb-2 h-8 w-8 opacity-60" />
                暂无预约批次
              </div>
            ) : null}
          </div>
        </aside>

        <ApprovalDetail
          batch={selectedBatch}
          scope={scope}
          note={selectedBatch ? notes[selectedBatch.id] ?? '' : ''}
          setNote={(value) => selectedBatch && setBatchNote(selectedBatch.id, value)}
        />
      </div>
    </div>
  );
}

