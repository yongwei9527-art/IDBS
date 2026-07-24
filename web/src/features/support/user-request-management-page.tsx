import { briefDateTime } from '@/lib/time-format';
import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CompactId } from '@/components/ui/compact-id';
import { OpsBadge, OpsEmptyState, OpsPageHeader, OpsPermissionHint } from '@/components/ops/design-system';
import { PERMISSIONS, useCapability } from '@/features/auth/permissions';
import { buildChatSearch } from '@/features/chat/chat-context';
import { useAdminUserRequests, useReviewUserRequest, type AdminUserRequestRow } from '@/features/platform/operations-api';
import { toFriendlyError } from '@/lib/friendly-error';

const STATUS_LABEL: Record<string, string> = {
  pending: '待确认',
  confirmed: '已确认',
  change_requested: '申请修改中',
  rejected: '已驳回',
  closed: '已关闭',
  cancelled: '已撤回'
};
const STATUS_TONE: Record<string, string> = {
  pending: 'warn',
  confirmed: 'success',
  change_requested: 'info',
  rejected: 'danger',
  closed: 'muted',
  cancelled: 'muted'
};
const STATUS_FILTERS = ['', 'pending', 'confirmed', 'change_requested', 'rejected', 'closed', 'cancelled'];

const CATEGORY_LABEL: Record<string, string> = {
  feature: '功能建议',
  reservation: '预约/借还',
  device: '设备相关',
  account: '账号/权限',
  rule: '规则说明',
  maintenance: '维护排查',
  ui: '交互体验',
  access: '访问权限',
  safety: '安全归还',
  other: '其他'
};
const CATEGORY_FILTERS = ['', 'reservation', 'device', 'maintenance', 'safety', 'rule', 'ui', 'account', 'access', 'feature', 'other'];

const PRIORITY_LABEL: Record<string, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急'
};
const PRIORITY_TONE: Record<string, string> = {
  low: 'muted',
  normal: 'info',
  high: 'warn',
  urgent: 'danger'
};
const PRIORITY_FILTERS = ['', 'urgent', 'high', 'normal', 'low'];

function formatDate(v?: string | null) {
  if (!v) return '—';
  return briefDateTime(v);
}

function friendlyError(error: unknown) {
  return toFriendlyError(error, '系统暂时无法完成请求，请稍后重试');
}

function requestAgeInfo(row: AdminUserRequestRow) {
  const created = new Date(row.created_at).getTime();
  if (!created || Number.isNaN(created)) {
    return { label: '未知', hours: 0, tone: 'muted' as const };
  }
  const hours = Math.max(0, Math.round((Date.now() - created) / 36e5));
  let label = '刚刚';
  if (hours >= 24) label = `${Math.round(hours / 24)} 天`;
  else if (hours >= 1) label = `${hours} 小时`;
  // open items aging: >3d danger, >1d warn, else normal
  const open = row.status === 'pending' || row.status === 'change_requested';
  let tone: 'normal' | 'warn' | 'danger' | 'muted' = 'normal';
  if (!open) tone = 'muted';
  else if (hours >= 72) tone = 'danger';
  else if (hours >= 24) tone = 'warn';
  return { label, hours, tone };
}

function matchesText(row: AdminUserRequestRow, keyword: string) {
  const text = [
    row.title,
    row.description,
    row.user_name,
    row.user_phone,
    row.user_student_no,
    row.device_code,
    row.device_name,
    row.admin_note,
    row.change_request_note,
    row.id
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes(keyword.trim().toLowerCase());
}

export function AdminRequestsPage() {
  const capability = useCapability();
  const canReviewGeneralRequests = capability.can(PERMISSIONS.USER_MANAGE);
  const canReviewRequest = (row: AdminUserRequestRow) => canReviewGeneralRequests || (row.category === 'reservation' && capability.canApproveReservations);
  const nav = useNavigate();
  const initialParams = new URLSearchParams(window.location.search);
  const [status, setStatus] = useState(initialParams.get('status') ?? '');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [keyword, setKeyword] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState('');
  const { data, isLoading, error } = useAdminUserRequests(status || undefined);
  const review = useReviewUserRequest();
  const rows = data?.requests ?? [];

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (category && row.category !== category) return false;
    if (priority && row.priority !== priority) return false;
    if (keyword.trim() && !matchesText(row, keyword)) return false;
    return true;
  }), [category, keyword, priority, rows]);

  const stats = useMemo(() => ({
    visible: filteredRows.length,
    pending: rows.filter((r) => r.status === 'pending').length,
    change: rows.filter((r) => r.status === 'change_requested').length,
    urgent: rows.filter((r) => r.priority === 'urgent' || r.priority === 'high').length
  }), [filteredRows.length, rows]);

  function setRowNote(id: string, note: string) {
    setNotes((prev) => ({ ...prev, [id]: note }));
  }

  function handleReview(row: AdminUserRequestRow, nextStatus: string) {
    review.mutate(
      { id: row.id, status: nextStatus, admin_note: notes[row.id] ?? row.admin_note ?? '' },
      {
        onSuccess: () => {
          toast.success('诉求状态已更新');
          setExpandedId('');
        },
        onError: (e) => toast.error(`处理失败：${friendlyError(e)}`)
      }
    );
  }

  function openChat(row: AdminUserRequestRow) {
    if (!row.user_id) return;
    nav({
      to: '/chat',
      search: buildChatSearch({
        targetUserId: row.user_id,
        type: 'request',
        title: `诉求沟通：${row.title}`,
        description: row.description,
        detail: row.description,
        deviceCode: row.device_code,
        deviceName: row.device_name,
        userName: row.user_name,
        userPhone: row.user_phone,
        status: row.status,
        requestId: row.id
      })
    } as any);
  }

  return (
    <div className="ops-page-stack request-page">
      <OpsPageHeader
        title="用户诉求"
        className="ops-page-header--compact"
        children={(
          <div className="flex flex-wrap items-center gap-2">
            <OpsBadge tone="warning">待确认 {stats.pending}</OpsBadge>
            <OpsBadge tone="danger">高优先 {stats.urgent}</OpsBadge>
            <OpsBadge tone="info">修改 {stats.change}</OpsBadge>
            <span className="text-xs text-muted-foreground">显示 {stats.visible}</span>
          </div>
        )}
      />

      {!canReviewGeneralRequests && !capability.canApproveReservations ? (
        <OpsPermissionHint permissions="通用诉求需用户管理权限；预约类诉求需预约审批权限。" />
      ) : null}

      <section className="request-panel">
        <div className="request-toolbar">
          <div className="ops-segment-group flex flex-wrap gap-1">
            {STATUS_FILTERS.map((item) => (
              <Button key={item || 'all'} size="sm" variant={status === item ? 'default' : 'outline'} onClick={() => setStatus(item)}>
                {item ? STATUS_LABEL[item] : '全部'}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索标题/用户/设备"
              className="h-8 w-48"
              clearable
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-8 rounded-md border border-input bg-card px-2 text-sm"
              aria-label="类别"
            >
              {CATEGORY_FILTERS.map((item) => (
                <option key={item || 'all'} value={item}>{item ? CATEGORY_LABEL[item] : '全部类别'}</option>
              ))}
            </select>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="h-8 rounded-md border border-input bg-card px-2 text-sm"
              aria-label="优先级"
            >
              {PRIORITY_FILTERS.map((item) => (
                <option key={item || 'all'} value={item}>{item ? PRIORITY_LABEL[item] : '全部优先级'}</option>
              ))}
            </select>
            {(status || category || priority || keyword) ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setStatus('');
                  setCategory('');
                  setPriority('');
                  setKeyword('');
                }}
              >
                清空
              </Button>
            ) : null}
          </div>
        </div>

        {isLoading ? <p className="p-8 text-center text-sm text-muted-foreground">加载中…</p> : null}
        {error ? <p className="p-8 text-center text-sm text-destructive">加载失败：{friendlyError(error)}</p> : null}
        {!isLoading && !error && filteredRows.length === 0 ? (
          <OpsEmptyState title="暂无匹配诉求" description="可放宽状态、类别、优先级或关键词后再查看。" />
        ) : null}

        <div className="request-list">
          {filteredRows.map((row) => {
            const expanded = expandedId === row.id;
            const canAct = canReviewRequest(row);
            const note = notes[row.id] ?? row.admin_note ?? '';
            const age = requestAgeInfo(row);
            const statusTone = STATUS_TONE[row.status] ?? 'muted';
            return (
              <article key={row.id} className={`request-row request-row--${statusTone} ${expanded ? 'request-row--open' : ''}`}>
                <div className="request-main">
                  <div className="request-body min-w-0 flex-1">
                    <h3 className="request-title" title={row.title}>{row.title}</h3>
                    <div className="request-tags">
                      <span className={`badge-pill badge-${statusTone}`}>{STATUS_LABEL[row.status] ?? row.status}</span>
                      <span className={`badge-pill badge-${PRIORITY_TONE[row.priority] ?? 'muted'}`}>{PRIORITY_LABEL[row.priority] ?? row.priority}</span>
                      <span className="badge-pill badge-muted">{CATEGORY_LABEL[row.category] ?? row.category}</span>
                      <span className={`request-age request-age--${age.tone}`} title={`提交于 ${formatDate(row.created_at)}`}>
                        等待 {age.label}
                      </span>
                    </div>
                    <p className="request-desc line-clamp-2">{row.description}</p>
                    <p className="request-meta-line">
                      <span>{row.user_name || '—'}</span>
                      {row.user_phone ? <span className="request-meta-sep">/</span> : null}
                      {row.user_phone ? <span>{row.user_phone}</span> : null}
                      {row.device_code ? (
                        <>
                          <span className="request-meta-dot">·</span>
                          <span>{row.device_code} {row.device_name || ''}</span>
                        </>
                      ) : null}
                      <span className="request-meta-dot">·</span>
                      <span>{formatDate(row.created_at)}</span>
                    </p>
                    {row.change_request_note ? (
                      <p className="request-change-note line-clamp-2">用户修改申请：{row.change_request_note}</p>
                    ) : null}
                  </div>
                  <div className="request-actions">
                    {canAct && (row.status === 'pending' || row.status === 'change_requested') ? (
                      <Button size="sm" className="request-action-primary" disabled={review.isPending} onClick={() => handleReview(row, 'confirmed')}>确认</Button>
                    ) : null}
                    <Button size="sm" variant="outline" className="request-action-secondary" onClick={() => setExpandedId(expanded ? '' : row.id)}>
                      {expanded ? '收起' : '处理'}
                    </Button>
                    {row.user_id ? (
                      <Button size="sm" variant="ghost" className="request-action-link" onClick={() => openChat(row)}>
                        <MessageSquare className="h-3.5 w-3.5" /> 沟通
                      </Button>
                    ) : null}
                  </div>
                </div>

                {expanded ? (
                  <div className="request-expand">
                    <div className="request-meta">
                      <span>编号 <CompactId value={row.id} prefix="REQ" /></span>
                      <span>学号/工号 {row.user_student_no || '—'}</span>
                      {row.admin_note ? <span>原备注 {row.admin_note}</span> : null}
                    </div>
                    {canAct ? (
                      <>
                        <label className="block text-xs text-muted-foreground">
                          处理意见
                          <textarea
                            value={note}
                            onChange={(e) => setRowNote(row.id, e.target.value)}
                            rows={2}
                            placeholder="填写处理备注（会同步给用户）"
                            className="mt-1 w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground"
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {(row.status === 'pending' || row.status === 'change_requested') ? (
                            <>
                              <Button size="sm" disabled={review.isPending} onClick={() => handleReview(row, 'confirmed')}>确认</Button>
                              <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => handleReview(row, 'rejected')}>驳回</Button>
                            </>
                          ) : null}
                          {(row.status === 'confirmed' || row.status === 'change_requested') ? (
                            <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => handleReview(row, 'pending')}>退回待修改</Button>
                          ) : null}
                          {row.status !== 'closed' && row.status !== 'cancelled' ? (
                            <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => handleReview(row, 'closed')}>关闭</Button>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        只读：{row.category === 'reservation' ? '预约类诉求需要预约审批权限。' : '处理该诉求需要用户管理权限。'}
                      </p>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
