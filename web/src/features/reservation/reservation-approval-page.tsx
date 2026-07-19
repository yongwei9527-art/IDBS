import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  ClipboardCheck,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { toFriendlyError } from '@/lib/friendly-error';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActionDialog } from '@/components/ui/action-dialog';
import { CompactId, formatCompactId } from '@/components/ui/compact-id';
import { useCapability } from '@/features/auth/permissions';
import { buildChatSearch } from '@/features/chat/chat-context';
import { briefDateTime, compactTimeRange, fullDateTimeRange, shortDate, slotDisplayName, tinyTimeRange } from '@/lib/time-format';
import {
  OpsBadge,
  OpsDataToolbar,
  OpsDetailDrawer,
  OpsEmptyState,
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
  type AdminReservationItem,
  type AdminReservationRiskItem
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
  if (safe || level === 'safe') return 'approval-risk-panel approval-risk-panel--safe';
  if (level === 'danger') return 'approval-risk-panel approval-risk-panel--danger';
  if (level === 'info') return 'approval-risk-panel approval-risk-panel--info';
  return 'approval-risk-panel approval-risk-panel--warning';
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
  user_unfinished_borrow: '未完成借用',
  user_history: '历史记录',
  device_unavailable: '设备不可约',
  device_status: '设备状态',
  device_risk_score: '设备风险',
  time_conflict: '时间冲突',
  borrow_conflict: '仍在借用',
  peak_slot: '高峰时段',
  repeated_booking: '重复预约',
  overdue_history: '逾期记录',
  no_show_history: '缺席记录'
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
  user_unfinished_borrow: '未完成借用',
  user_history: '历史记录'
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

function compactRiskMessage(signal: AdminReservationRiskItem) {
  const label = RISK_TYPE_LABEL[signal.type || ''] || '';
  if (label) return label;
  const message = riskSignalText(signal)
    .replace(/，建议审批前确认归还情况。?$/, '')
    .replace(/，建议审批前确认故障和维护状态。?$/, '')
    .replace(/，建议结合用途和历史沟通判断。?$/, '')
    .replace(/，建议拒绝或先处理设备状态。?$/, '')
    .replace(/申请人存在未完成借用记录（[^）]*）/, '未完成借用')
    .replace(/申请人近 90 天有 \d+ 条预约\/借还异常记录/, '历史异常')
    .replace(/。$/, '');
  return message || '需确认';
}

function compactEvidence(signal: AdminReservationRiskItem) {
  if (signal.type === 'user_unfinished_borrow') {
    const start = typeof signal.borrow_time === 'string' ? briefDateTime(signal.borrow_time) : '';
    const end = typeof signal.expected_return_time === 'string' ? briefDateTime(signal.expected_return_time) : '';
    if (start && end) return `${start}–${end}`;
    if (start || end) return start || end;
  }
  if (signal.type === 'user_history') {
    const evidence = Array.isArray(signal.evidence) ? signal.evidence : [];
    const parts = evidence.map((value) => {
      const text = localizeReservationText(value)
        .replace('预约取消/拒绝/缺席：', '预约异常')
        .replace('借还逾期/异常：', '借还异常')
        .replace('故障上报：', '故障')
        .replace(/\s*条/g, '')
        .trim();
      // drop pure zero noise like 预约异常0 if others exist
      return text;
    }).filter(Boolean);
    const nonZero = parts.filter((p) => !/(异常|故障)0$/.test(p.replace(/\s/g, '')));
    const use = nonZero.length ? nonZero : parts;
    if (use.length) return use.slice(0, 2).join(' · ');
  }
  const evidence = Array.isArray(signal.evidence) ? signal.evidence.slice(0, 1) : [];
  return evidence.map((value) => {
    const text = localizeReservationText(value);
    const dateEvidence = text.match(/^(借用开始|预计归还)：(.+)$/);
    if (dateEvidence && !Number.isNaN(new Date(dateEvidence[2]).getTime())) {
      return briefDateTime(dateEvidence[2]);
    }
    return text
      .replace('预约取消/拒绝/缺席：', '预约异常')
      .replace('借还逾期/异常：', '借还异常')
      .replace('冲突申请人：', '')
      .replace('冲突状态：', '')
      .replace('借用状态：', '')
      .replace('借用人：', '')
      .replace('设备状态：', '')
      .replace('允许预约：', '可约')
      .trim();
  }).filter(Boolean).join(' · ');
}

function compactRiskTitle(signal: AdminReservationRiskItem) {
  const label = RISK_TYPE_LABEL[signal.type || ''] || '审批信号';
  const message = compactRiskMessage(signal);
  const subject = signal.device_code || label;
  if (message === label || message.startsWith(label)) return signal.device_code ? `${signal.device_code} · ${label}` : label;
  return `${subject} · ${message}`;
}

function uniqueRiskSignals(items: AdminReservationRiskItem[]) {
  const userLevelTypes = new Set(['user_unfinished_borrow', 'user_history', 'overdue_history', 'no_show_history']);
  const map = new Map<string, AdminReservationRiskItem & { _evidenceLines?: string[]; _count?: number }>();
  for (const item of items) {
    const scope = userLevelTypes.has(item.type || '') ? 'user' : `${item.item_id || ''}|${item.device_code || ''}`;
    const key = `${scope}|${item.type || ''}`;
    const evidence = compactEvidence(item);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item, _evidenceLines: evidence ? [evidence] : [], _count: 1 });
      continue;
    }
    existing._count = (existing._count || 1) + 1;
    if (evidence && !(existing._evidenceLines || []).includes(evidence)) {
      existing._evidenceLines = [...(existing._evidenceLines || []), evidence].slice(0, 2);
    }
    if (typeof item.score === 'number') {
      existing.score = Math.max(Number(existing.score || 0), item.score);
    }
    if ((item.level === 'danger') || (item.level === 'warning' && existing.level === 'info')) {
      existing.level = item.level;
    }
  }
  return Array.from(map.values()).map((item) => {
    const lines = item._evidenceLines || [];
    let summary = '';
    if (item.type === 'user_unfinished_borrow' && (item._count || 1) > 1) {
      summary = lines[0] ? `${item._count}笔 · 近 ${lines[0]}` : `${item._count}笔`;
    } else {
      summary = lines[0] || '';
    }
    return {
      ...item,
      evidence: summary ? [summary] : item.evidence
    };
  });
}

function riskEvidenceText(signal: AdminReservationRiskItem) {
  if (Array.isArray(signal.evidence) && signal.evidence.length) {
    return signal.evidence.map((v) => localizeReservationText(v)).filter(Boolean).slice(0, 1).join(' · ');
  }
  return compactEvidence(signal);
}

function riskBadgeLevel(level?: string, safe?: boolean) {
  if (safe || level === 'safe') return 'low' as const;
  if (level === 'danger') return 'high' as const;
  if (level === 'warning') return 'medium' as const;
  if (level === 'critical') return 'critical' as const;
  return 'low' as const;
}

function approvalActionText(action?: string) {
  if (action === 'approve') return '可过';
  if (action === 'manual_review') return '需人工复核';
  if (action === 'reject_or_hold') return '建议暂缓';
  return '待判断';
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
      className={['approval-batch-card w-full text-left', active ? 'approval-batch-card--active' : ''].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{localizeReservationText(batch.purpose) || '未填写用途'}</h3>
        <div className="flex shrink-0 items-center gap-1">
          <span className={`badge-pill badge-${STATUS_TONE[batch.status] ?? 'muted'}`}>{STATUS_LABEL[batch.status] ?? batch.status}</span>
          {batch.pending_count ? <span className="badge-pill badge-warn">{batch.pending_count}</span> : null}
        </div>
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">{batch.user_name || '未知用户'}{batch.user_phone ? ` / ${batch.user_phone}` : ''}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground" title={fullDateTimeRange(batch.first_start_time, batch.last_end_time)}>
        {(batch.device_names || batch.device_codes || '设备未指定')} · {shortDate(batch.first_start_time)} {tinyTimeRange(batch.first_start_time, batch.last_end_time)} · {batch.item_count ?? 0}项
      </p>
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
  const { prompt, ActionDialog } = useActionDialog();
  const canApprove = capability.canApproveReservations;
  const canChangePlan = capability.canChangeReservationPlan;
  const [editingPlanId, setEditingPlanId] = useState('');
  const [drawerItemId, setDrawerItemId] = useState('');
  const [noShowDraft, setNoShowDraft] = useState<{ id: string; category: 'forgot' | 'plan_changed' | 'schedule_conflict' | 'other'; note: string } | null>(null);
  const [planDrafts, setPlanDrafts] = useState<Record<string, { start_time: string; end_time: string; slot_key: string; admin_note: string }>>({});
  const items = detail.data?.items ?? [];
  const risk = detail.data?.approval_risk;
  const selectedDrawerItem = items.find((item) => itemId(item) === drawerItemId);
  const selectedDrawerSignals = selectedDrawerItem
    ? uniqueRiskSignals((risk?.items ?? []).filter((signal) => signal.item_id === itemId(selectedDrawerItem)))
    : [];

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

  async function reviewCancellationRequest(id: string, approved: boolean) {
    const adminNote = await prompt({
      title: approved ? '同意当天取消' : '驳回当天取消',
      description: approved
        ? '同意后预约立即取消并释放设备时段，可补充处理备注。'
        : '驳回后预约恢复原状态，请填写原因供用户查看。',
      placeholder: approved ? '处理备注（可选）' : '请填写驳回原因',
      confirmText: approved ? '同意取消' : '确认驳回',
      tone: approved ? 'default' : 'warning',
      required: !approved,
      maxLength: 500
    });
    if (adminNote === null) return;
    reviewCancellation.mutate(
      { id, approved, admin_note: adminNote },
      {
        onSuccess: (data) => toast.success(data.message || '取消申请已处理'),
        onError: (error) => toast.error(`处理失败：${toFriendlyError(error)}`)
      }
    );
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

  const riskSignals = uniqueRiskSignals(risk?.items ?? []).slice(0, 4);

  return (
    <>
      <ActionDialog />
      <Card className="ops-card approval-detail-card overflow-hidden">
      <CardContent className="approval-detail-body p-0">
        <header className="approval-detail-head">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold leading-6">{localizeReservationText(activeBatch.purpose) || '未填写用途'}</h2>
              <span className={`badge-pill badge-${STATUS_TONE[activeBatch.status] ?? 'muted'}`}>{STATUS_LABEL[activeBatch.status] ?? activeBatch.status}</span>
              {(activeBatch.pending_count ?? 0) > 0 ? <span className="badge-pill badge-warn">待审 {activeBatch.pending_count}</span> : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{activeBatch.user_name || '未知用户'}{activeBatch.user_phone ? ` / ${activeBatch.user_phone}` : ''}</span>
              <span className="hidden sm:inline text-border">|</span>
              <span className="truncate max-w-[18rem]" title={String(activeBatch.device_names || activeBatch.device_codes || '')}>{activeBatch.device_names || activeBatch.device_codes || '设备未指定'}</span>
              <span className="hidden sm:inline text-border">|</span>
              <span title={fullDateTimeRange(activeBatch.first_start_time, activeBatch.last_end_time)}>
                {shortDate(activeBatch.first_start_time)} {tinyTimeRange(activeBatch.first_start_time, activeBatch.last_end_time)}
              </span>
              <span>{activeBatch.item_count ?? 0} 项</span>
            </div>
          </div>
          {activeBatch.user_id ? (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
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
              <MessageSquare className="h-4 w-4" /> 联系
            </Button>
          ) : null}
        </header>

        {risk ? (
          <section className={`approval-risk-strip ${riskPanelTone(risk.level, risk.safe)}`}>
            <div className="approval-risk-strip-head">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {risk.safe ? <ShieldCheck className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
                <span className="text-sm font-semibold">{approvalActionText(risk.action) || localizeReservationText(risk.action_label)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">风险{risk.risk_score ?? 0}</span>
              </div>
            </div>
            {riskSignals.length ? (
              <ul className="approval-risk-list">
                {riskSignals.map((item, index) => {
                  const evidence = riskEvidenceText(item);
                  const title = RISK_TYPE_LABEL[item.type || ''] || compactRiskTitle(item);
                  const fullTitle = `${title}${typeof item.score === 'number' ? ` · +${item.score}` : ''}${evidence ? ` · ${evidence}` : ''}`;
                  return (
                    <li key={`${item.type || 'risk'}-${index}`} className="approval-risk-item" title={fullTitle}>
                      <span className={`badge-pill ${signalBadgeTone(item.level)}`}>{signalLevelLabel(item.level)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">
                          {title}
                          {typeof item.score === 'number' ? <span className="text-muted-foreground"> · +{item.score}</span> : null}
                        </p>
                        {evidence ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{evidence}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        ) : detail.data ? (
          <section className="approval-risk-strip approval-risk-panel--safe">
            <div className="approval-risk-strip-head">
              <ShieldCheck className="h-4 w-4" />
              <span className="text-sm font-medium">无风险 · 可正常审批</span>
            </div>
          </section>
        ) : null}

        <div className="approval-action-bar">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="审批备注（可选）"
            clearable
            className="approval-note-input"
          />
          {canApprove ? (
            <div className="flex shrink-0 gap-2">
              <Button size="sm" disabled={approveBatch.isPending || activeBatch.status !== 'pending'} onClick={() => approveWhole(true)}>
                整批通过
              </Button>
              <Button size="sm" variant="outline" disabled={approveBatch.isPending || activeBatch.status !== 'pending'} onClick={() => approveWhole(false)}>
                整批拒绝
              </Button>
            </div>
          ) : null}
        </div>

        {detail.isLoading ? <p className="p-4 text-center text-sm text-muted-foreground">明细加载中…</p> : null}
        {detail.error ? <p className="p-4 text-center text-sm text-destructive">明细加载失败：{toFriendlyError(detail.error)}</p> : null}

        <div className="approval-item-list">
          {items.map((item) => {
            return (
              <div key={itemId(item)} className="approval-item-row">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{item.device_name || item.device_code || <CompactId value={item.device_id} prefix="DEV" />}</p>
                      <span className={`badge-pill badge-${STATUS_TONE[item.status] ?? 'muted'}`}>{STATUS_LABEL[item.status] ?? item.status}</span>
                      {item.device_status ? <span className="badge-pill badge-muted">{STATUS_LABEL[item.device_status] ?? item.device_status}</span> : null}
                      <span className="badge-pill badge-muted">{slotDisplayName(item.slot_key)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground" title={fullDateTimeRange(item.start_time, item.end_time)}>
                      {shortDate(item.start_time)} {tinyTimeRange(item.start_time, item.end_time)}
                      {item.admin_note ? ` · 备注：${item.admin_note}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setDrawerItemId(itemId(item))}>详情</Button>
                    {canApprove ? (
                      <>
                        <Button size="sm" disabled={approveItem.isPending || item.status !== 'pending'} onClick={() => approveOne(itemId(item), true)}>通过</Button>
                        <Button size="sm" variant="outline" disabled={approveItem.isPending || item.status !== 'pending'} onClick={() => approveOne(itemId(item), false)}>拒绝</Button>
                      </>
                    ) : null}
                    {canChangePlan ? (
                      <Button size="sm" variant="outline" disabled={!canAdjustItemStatus(item.status)} onClick={() => openPlanEditor(item)}>改期</Button>
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
          {detail.data && items.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">暂无明细</p> : null}
        </div>
      </CardContent>
    </Card>

      {noShowDraft ? (
        <div className="ui-dialog-backdrop fixed inset-0 z-[80] flex items-center justify-center p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !markNoShow.isPending) setNoShowDraft(null); }}>
          <div className="ui-dialog-panel w-full max-w-lg border p-5" role="dialog" aria-modal="true" aria-labelledby="no-show-dialog-title">
            <h2 id="no-show-dialog-title" className="text-xl font-semibold">标记爽约</h2>
            <p className="mt-2 text-sm text-muted-foreground">确认用户未到场后再标记。</p>
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
                核实备注
                <textarea className="min-h-24 rounded-xl border bg-background px-3 py-2 text-sm font-normal leading-6" maxLength={500} value={noShowDraft.note} onChange={(event) => setNoShowDraft((current) => current ? { ...current, note: event.target.value } : current)} placeholder="填写核实情况" />
                <span className="text-xs font-normal text-muted-foreground">至少 4 字</span>
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
              title="操作权限"
              permissions={canApprove && canChangePlan
                ? '可审批 · 可调整时间'
                : canApprove
                  ? '仅审批'
                  : canChangePlan
                    ? '仅调整时间'
                    : '只读'}
            />
            <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">设备</p>
                <p className="mt-1 font-semibold">{selectedDrawerItem.device_name || selectedDrawerItem.device_code || <CompactId value={selectedDrawerItem.device_id} prefix="DEV" />}</p>
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

            <section className="rounded-xl border bg-card p-4">
              <OpsSectionHeader
                title="风险"
                action={<OpsRiskBadge level={riskBadgeLevel(risk?.level, risk?.safe)}>{risk?.safe ? '低风险' : signalLevelLabel(risk?.level)}</OpsRiskBadge>}
              />
              <div className="mt-3 grid gap-2">
                {selectedDrawerSignals.length ? selectedDrawerSignals.map((signal, index) => (
                  <div key={`drawer-risk-${signal.type ?? index}`} className="rounded-xl border bg-muted/20 p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`badge-pill ${signalBadgeTone(signal.level)}`}>{signalLevelLabel(signal.level)}</span>
                      <span className="font-semibold">{RISK_TYPE_LABEL[signal.type || ''] || compactRiskTitle(signal)}{typeof signal.score === 'number' ? ` · +${signal.score}` : ''}</span>
                    </div>
                    {compactEvidence(signal) ? <p className="mt-1 truncate text-muted-foreground" title={compactEvidence(signal)}>{compactEvidence(signal)}</p> : null}
                  </div>
                )) : (
                  <OpsEmptyState title="无风险" className="py-5" />
                )}
              </div>
            </section>

            {selectedDrawerItem.admin_note ? (
              <section className="rounded-xl border bg-card p-4">
                <p className="text-xs font-semibold text-primary">已有备注</p>
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
    pending: batches.reduce((sum, batch) => sum + (batch.pending_count ?? (batch.status === 'pending' ? 1 : 0)), 0)
  }), [batches]);

  function setBatchNote(batchId: string, value: string) {
    setNotes((old) => ({ ...old, [batchId]: value }));
  }

  return (
    <div className="ops-page-stack approval-page">
      <OpsPageHeader title="预约审批" className="approval-page-header" />

      <OpsDataToolbar
        filters={(
          <>
            <div className="ops-segment-group flex flex-wrap gap-1">
              {SCOPES.map((item) => (
                <Button key={item.key || 'all'} size="sm" variant={scope === item.key ? 'default' : 'outline'} onClick={() => setScope(item.key)}>{item.label}</Button>
              ))}
            </div>
            <span className="hidden h-6 w-px bg-border sm:block" />
            <div className="ops-segment-group flex flex-wrap gap-1">
              {STATUS_FILTERS.map((item) => (
                <Button key={item || 'all'} size="sm" variant={status === item ? 'default' : 'outline'} onClick={() => setStatus(item)}>{item ? STATUS_LABEL[item] ?? item : '全部状态'}</Button>
              ))}
            </div>
          </>
        )}
        meta={(
          <div className="flex items-center gap-2">
            <OpsBadge tone="warning">待审 {stats.pending}</OpsBadge>
            <span>{stats.total} 批</span>
            <OpsBadge tone={capability.canApproveReservations ? 'info' : 'muted'}>
              {capability.canApproveReservations && capability.canChangeReservationPlan ? '审批及改期' : capability.canApproveReservations ? '仅审批' : capability.canChangeReservationPlan ? '仅改期' : '只读'}
            </OpsBadge>
          </div>
        )}
      />

      {(!capability.canApproveReservations && !capability.canChangeReservationPlan) ? (
        <OpsPermissionHint
          permissions="当前账号未被授予预约审批或改期权限。"
        />
      ) : null}

      <div className="approval-workspace grid gap-4">
        <aside className="min-w-0">
          <div className="approval-queue grid gap-2">
            {batches.map((batch) => (
              <BatchCard key={batch.id} batch={batch} active={selectedBatch?.id === batch.id} onSelect={() => setSelectedBatchId(batch.id)} />
            ))}
            {isLoading ? <p className="rounded-2xl border bg-card/70 p-5 text-center text-sm text-muted-foreground">加载中…</p> : null}
            {error ? <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-center text-sm text-destructive">加载失败：{toFriendlyError(error)}</p> : null}
            {!isLoading && !error && batches.length === 0 ? (
              <div className="rounded-xl border bg-card/70 p-8 text-center text-muted-foreground">
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

