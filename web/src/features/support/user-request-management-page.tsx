import { briefDateTime } from '@/lib/time-format';
import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ClipboardCheck, MessageSquare, MessageSquareWarning, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CompactId } from '@/components/ui/compact-id';
import { OpsEmptyState, OpsMetricCard, OpsPageHeader, OpsPermissionHint } from '@/components/ops/design-system';
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
  reservation: '预约/借还问题',
  device: '设备相关',
  account: '账号/权限',
  rule: '规则/安全说明',
  maintenance: '维护排查',
  ui: '交互体验',
  access: '访问/展示权限',
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

function requestAge(row: AdminUserRequestRow) {
  const created = new Date(row.created_at).getTime();
  if (!created || Number.isNaN(created)) return '未知';
  const hours = Math.max(0, Math.round((Date.now() - created) / 36e5));
  if (hours < 1) return '刚刚提交';
  if (hours < 24) return `${hours} 小时`;
  return `${Math.round(hours / 24)} 天`;
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

function RequestActions({
  row,
  note,
  setNote,
  onReview,
  busy,
  canAct
}: {
  row: AdminUserRequestRow;
  note: string;
  setNote: (v: string) => void;
  onReview: (row: AdminUserRequestRow, status: string) => void;
  busy: boolean;
  canAct: boolean;
}) {
  const canReview = canAct && row.status !== 'cancelled';
  return (
    <div className="rounded-2xl border bg-background/70 p-3">
      <p className="text-xs font-bold text-muted-foreground">处理意见</p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="填写处理备注（会同步给用户）"
        rows={4}
        className="mt-2 w-full rounded-[14px] border border-input bg-card px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {(row.status === 'pending' || row.status === 'change_requested') && (
          <>
            <Button size="sm" disabled={busy || !canReview} onClick={() => onReview(row, 'confirmed')}>确认</Button>
            <Button size="sm" variant="outline" disabled={busy || !canReview} onClick={() => onReview(row, 'rejected')}>驳回</Button>
          </>
        )}
        {(row.status === 'confirmed' || row.status === 'change_requested') && (
          <Button size="sm" variant="outline" disabled={busy || !canReview} onClick={() => onReview(row, 'pending')}>
            退回待修改
          </Button>
        )}
        {canReview && row.status !== 'closed' && (
          <Button size="sm" variant="outline" disabled={busy || !canReview} onClick={() => onReview(row, 'closed')}>
            关闭
          </Button>
        )}
      </div>
    </div>
  );
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
    total: rows.length,
    visible: filteredRows.length,
    pending: rows.filter((r) => r.status === 'pending').length,
    change: rows.filter((r) => r.status === 'change_requested').length,
    urgent: rows.filter((r) => r.priority === 'urgent' || r.priority === 'high').length,
    locked: rows.filter((r) => r.locked_at).length
  }), [filteredRows.length, rows]);

  const categoryStats = useMemo(() => CATEGORY_FILTERS.filter(Boolean).map((key) => ({
    key,
    label: CATEGORY_LABEL[key] ?? key,
    count: rows.filter((r) => r.category === key).length
  })), [rows]);

  function setRowNote(id: string, note: string) {
    setNotes((prev) => ({ ...prev, [id]: note }));
  }

  function handleReview(row: AdminUserRequestRow, nextStatus: string) {
    review.mutate(
      { id: row.id, status: nextStatus, admin_note: notes[row.id] ?? row.admin_note ?? '' },
      {
        onSuccess: () => toast.success('诉求状态已更新'),
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
    <div className="flex flex-col gap-6">
      <OpsPageHeader
        eyebrow="IDBS 5.0 · 诉求中心"
        title="用户诉求处理中心"
        description="把需求、预约问题、账号权限和设备反馈统一成可闭环工单；未被授权的管理员只能查看，不能擅自处理或改动用户计划。"
        aside={
          <div className="grid grid-cols-2 gap-3">
            {[
              ['待确认', stats.pending, '需要处理'],
              ['修改申请', stats.change, '用户等待回复'],
              ['高优先级', stats.urgent, '紧急 / 高'],
              ['当前显示', stats.visible, `总计 ${stats.total}`]
            ].map(([label, value, hint]) => (
              <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <p className="text-xs text-white/55">{label}</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-white">{value}</p>
                <p className="mt-1 text-[11px] text-white/50">{hint}</p>
              </div>
            ))}
          </div>
        }
      />

      {!canReviewGeneralRequests && !capability.canApproveReservations && (
        <OpsPermissionHint title="只读模式" permissions="当前账号未开通用户管理或预约审批权限">
          处理诉求需要用户管理权限；预约类诉求可由预约审批权限处理。未授权的处理按钮不会显示，后端接口也会拒绝越权操作。
        </OpsPermissionHint>
      )}

      <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card className="ops-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="h-5 w-5 text-primary" />筛选工作台</CardTitle>
              <p className="text-sm text-muted-foreground">先定位问题，再处理闭环；适合演示数据量较大时排查。</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索标题、用户、设备、备注"
                prefix={<Search className="h-4 w-4" />}
                clearable
                onClear={() => setKeyword('')}
              />
              <div>
                <p className="mb-2 text-xs font-bold text-muted-foreground">状态</p>
                <div className="flex flex-wrap gap-2">
                  {STATUS_FILTERS.map((s) => (
                    <Button key={s || 'all'} size="sm" variant={status === s ? 'default' : 'outline'} onClick={() => setStatus(s)}>
                      {s ? STATUS_LABEL[s] ?? s : '全部'}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-bold text-muted-foreground">
                  类别
                  <select className="mt-2 h-10 w-full rounded-md border bg-card px-3 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
                    {CATEGORY_FILTERS.map((item) => <option key={item || 'all'} value={item}>{item ? CATEGORY_LABEL[item] ?? item : '全部类别'}</option>)}
                  </select>
                </label>
                <label className="text-xs font-bold text-muted-foreground">
                  优先级
                  <select className="mt-2 h-10 w-full rounded-md border bg-card px-3 text-sm" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {PRIORITY_FILTERS.map((item) => <option key={item || 'all'} value={item}>{item ? PRIORITY_LABEL[item] ?? item : '全部优先级'}</option>)}
                  </select>
                </label>
              </div>
              <Button variant="outline" className="w-full" onClick={() => { setStatus(''); setCategory(''); setPriority(''); setKeyword(''); }}>
                清空筛选
              </Button>
            </CardContent>
          </Card>

          <Card className="ops-card">
            <CardHeader><CardTitle className="text-base">类别负载</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {categoryStats.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-sm transition hover:bg-muted ${category === item.key ? 'border-primary bg-primary/5 text-primary' : 'bg-background/70'}`}
                  onClick={() => setCategory(category === item.key ? '' : item.key)}
                >
                  <span>{item.label}</span>
                  <span className="font-black tabular-nums">{item.count}</span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="ops-card border-primary/20 bg-primary/5">
            <CardContent className="p-4 text-sm leading-6">
              <div className="flex items-center gap-2 font-bold text-primary"><ShieldCheck className="h-4 w-4" />权限边界</div>
              <p className="mt-2 text-muted-foreground">通用诉求需要 <strong>用户管理权限</strong>；预约类诉求需要 <strong>预约审批权限</strong>。</p>
            </CardContent>
          </Card>
        </aside>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            {[
              { label: '当前显示', value: stats.visible, hint: '已应用筛选', tone: 'default' as const },
              { label: '待确认', value: stats.pending, hint: '未处理入口', tone: 'warning' as const },
              { label: '修改申请', value: stats.change, hint: '需二次确认', tone: 'info' as const },
              { label: '锁定诉求', value: stats.locked, hint: '已进入确认状态', tone: 'success' as const }
            ].map((item) => (
              <OpsMetricCard key={item.label} label={item.label} value={item.value} hint={item.hint} tone={item.tone} loading={isLoading} />
            ))}
          </div>

          {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">加载诉求列表…</p>}
          {error && <p className="py-8 text-center text-sm text-destructive">加载失败：{friendlyError(error)}</p>}

          <div className="grid gap-4 2xl:grid-cols-2">
            {filteredRows.map((r) => (
              <Card key={r.id} className="ops-card overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="min-w-0 text-base">
                      <span className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 shrink-0 text-primary" /><span className="truncate">{r.title}</span></span>
                    </CardTitle>
                    <span className={`badge-pill badge-${STATUS_TONE[r.status] ?? 'muted'}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">{CATEGORY_LABEL[r.category] ?? r.category}</span>
                    <span className={`badge-pill badge-${PRIORITY_TONE[r.priority] ?? 'muted'}`}>优先级：{PRIORITY_LABEL[r.priority] ?? r.priority}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">已等待：{requestAge(r)}</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{r.description}</p>

                  {r.change_request_note && (
                    <p className="rounded-2xl bg-primary/10 p-3 text-xs leading-5 text-primary">
                      <MessageSquareWarning className="mr-1 inline h-3.5 w-3.5" />用户修改申请：{r.change_request_note}
                    </p>
                  )}
                  {r.admin_note && <p className="rounded-2xl bg-muted p-3 text-xs leading-5">管理员备注：{r.admin_note}</p>}

                  <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                    <Mini label="用户" value={`${r.user_name ?? '—'}${r.user_phone ? ` / ${r.user_phone}` : ''}`} />
                    <Mini label="学号/工号" value={r.user_student_no || '—'} />
                    <Mini label="关联设备" value={r.device_code ? `${r.device_code} ${r.device_name ?? ''}` : '未关联设备'} />
                    <Mini label="提交时间" value={formatDate(r.created_at)} />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <CompactId value={r.id} prefix="REQ" className="text-xs text-muted-foreground" />
                    {r.user_id ? (
                      <Button size="sm" variant="outline" onClick={() => openChat(r)}>
                        <MessageSquare className="mr-1 h-4 w-4" />联系用户
                      </Button>
                    ) : null}
                  </div>

                  {canReviewRequest(r) ? (
                    <RequestActions row={r} note={notes[r.id] ?? r.admin_note ?? ''} setNote={(v) => setRowNote(r.id, v)} onReview={handleReview} busy={review.isPending} canAct={canReviewRequest(r)} />
                  ) : (
                    <div className="rounded-2xl border border-dashed bg-muted/30 p-4 text-xs leading-5 text-muted-foreground">
                      只读模式：{r.category === 'reservation' ? '预约类诉求需要预约审批权限。' : '处理该诉求需要用户管理权限。'}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {!isLoading && filteredRows.length === 0 && (
            <OpsEmptyState title="暂无匹配诉求" description="可放宽状态、类别、优先级或关键词筛选后再查看。" />
          )}
        </div>
      </section>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/30 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-semibold text-foreground">{value}</p>
    </div>
  );
}



