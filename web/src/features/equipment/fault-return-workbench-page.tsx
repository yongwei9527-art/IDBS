import { briefDateTime } from '@/lib/time-format';
import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { useAdminFaults, useNotifyFaultAffectedUsers, useResolveFault, type AdminFaultRow } from '@/features/platform/operations-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildChatSearch } from '@/features/chat/chat-context';
import { useCapability } from '@/features/auth/permissions';
import { toFriendlyError } from '@/lib/friendly-error';
import { OpsEmptyState, OpsPageHeader, OpsPermissionHint } from '@/components/ops/design-system';

const STATUS_LABEL: Record<string, string> = { pending: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭' };
const STATUS_TONE: Record<string, string> = { pending: 'badge-warn', processing: 'badge-info', resolved: 'badge-success', closed: 'badge-muted' };
const STATUS_FILTERS = ['', 'pending', 'processing', 'resolved', 'closed'];
const SEVERITY_LABEL: Record<string, string> = { low: '轻微', normal: '普通', high: '严重', urgent: '紧急' };

function formatTime(value?: string | null) {
  if (!value) return '-';
  return briefDateTime(value);
}

function resolveNote(notes: Record<string, string>, report: AdminFaultRow) {
  return notes[report.id] ?? report.admin_note ?? '';
}

function normalizePhotos(value: AdminFaultRow['photos']): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String).slice(0, 5);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String).slice(0, 5);
    } catch {
      return value ? [value] : [];
    }
  }
  return [];
}

function adviceText(report: AdminFaultRow) {
  if (report.auto_action === 'cancel_future') return '停约并通知';
  if (report.auto_action === 'maintenance') return '维护巡检';
  return '转处理';
}

function impactText(report: AdminFaultRow) {
  const using = report.active_borrow?.user_name
    ? `使用中 ${report.active_borrow.user_name}`
    : '空闲';
  const today = Number(report.today_reservation_count || 0);
  const future = Number(report.future_reservation_count || 0);
  const parts = [using];
  if (today > 0) parts.push(`今${today}`);
  if (future > 0) parts.push(`后${future}`);
  if (today === 0 && future === 0) parts.push('无预约');
  return parts.join(' · ');
}

function briefDescription(report: AdminFaultRow, max = 36) {
  const type = String(report.issue_type || '').trim();
  const desc = String(report.description || '').trim();
  if (!desc) return type || '故障';
  if (!type) return desc.length > max ? `${desc.slice(0, max)}…` : desc;
  let body = desc;
  if (body.startsWith(type)) body = body.slice(type.length).replace(/^[：:\s]+/, '');
  if (!body) return type;
  return body.length > max ? `${body.slice(0, max)}…` : body;
}

export function AdminFaultsPage() {
  const nav = useNavigate();
  const capability = useCapability();
  const initialParams = new URLSearchParams(window.location.search);
  const [status, setStatus] = useState(initialParams.get('status') ?? '');
  const [deviceCode, setDeviceCode] = useState(initialParams.get('device_code') ?? initialParams.get('device') ?? '');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState('');
  const { data, isLoading, error } = useAdminFaults(status || undefined, deviceCode || undefined);
  const reports = data?.reports ?? [];
  const resolve = useResolveFault();
  const notifyAffected = useNotifyFaultAffectedUsers();
  const canManage = capability.canManageFaults;

  const stats = useMemo(() => {
    const count = (key: string) => reports.filter((item) => item.status === key).length;
    return {
      total: reports.length,
      pending: count('pending'),
      processing: count('processing'),
      closed: count('resolved') + count('closed')
    };
  }, [reports]);

  function updateNote(id: string, value: string) {
    setNotes((current) => ({ ...current, [id]: value }));
  }

  function handleUpdate(report: AdminFaultRow, nextStatus: 'processing' | 'resolved' | 'closed', options: { setAvailable?: boolean; keepMaintenance?: boolean } = {}) {
    const adminNote = resolveNote(notes, report).trim();
    resolve.mutate(
      { id: report.id, status: nextStatus, admin_note: adminNote, set_available: options.setAvailable, keep_maintenance: options.keepMaintenance },
      {
        onSuccess: () => toast.success(nextStatus === 'processing' ? '已转处理中' : nextStatus === 'closed' ? '已关闭' : '已解决'),
        onError: (e) => toast.error(`操作失败：${toFriendlyError(e)}`)
      }
    );
  }

  function handleNotifyAffected(report: AdminFaultRow) {
    notifyAffected.mutate(report.id, {
      onSuccess: (result: { current_user_notified?: boolean; future_reservation_count?: number }) => {
        const current = result.current_user_notified ? '当前使用人' : '';
        const future = Number(result.future_reservation_count ?? report.future_reservation_count ?? 0) > 0 ? '后续预约用户' : '';
        toast.success('已通知' + ([current, future].filter(Boolean).join('和') || '受影响用户'));
      },
      onError: (error) => toast.error('通知失败：' + toFriendlyError(error))
    });
  }

  function openChat(report: AdminFaultRow) {
    const search = buildChatSearch({
      targetUserId: report.user_id ? String(report.user_id) : undefined,
      userName: report.user_name,
      userPhone: report.user_phone,
      deviceCode: report.device_code,
      deviceName: report.device_name,
      type: 'fault',
      faultId: report.id,
      title: `故障沟通：${report.device_code || report.device_name || '设备'}`,
      detail: report.description || report.issue_type || ''
    });
    nav({ to: '/chat', search } as any);
  }

  return (
    <div className="ops-page-stack fault-workbench-page">
      <OpsPageHeader title="故障处置" className="ops-page-header--compact" />

      {(!canManage && !capability.canViewFaults) ? (
        <OpsPermissionHint permissions="当前账号未被授予故障查看或处理权限。" />
      ) : null}

      <section className="fault-workbench-panel">
        <div className="fault-workbench-toolbar">
          <div className="ops-segment-group flex flex-wrap gap-1">
            {STATUS_FILTERS.map((item) => (
              <Button key={item || 'all'} size="sm" variant={status === item ? 'default' : 'outline'} onClick={() => setStatus(item)}>
                {item ? STATUS_LABEL[item] : '全部'}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={deviceCode}
              onChange={(event) => setDeviceCode(event.target.value.trim())}
              placeholder="设备编号"
              className="h-8 w-36"
              clearable
            />
            <span className="text-xs text-muted-foreground">
              共 {stats.total} · 待处理 {stats.pending} · 处理中 {stats.processing} · 已闭环 {stats.closed}
            </span>
          </div>
        </div>

        {isLoading ? <p className="p-8 text-center text-sm text-muted-foreground">加载中…</p> : null}
        {error ? <p className="p-8 text-center text-sm text-destructive">加载失败：{toFriendlyError(error)}</p> : null}
        {!isLoading && !error && reports.length === 0 ? (
          <OpsEmptyState title="暂无故障单" description="" />
        ) : null}

        <div className="fault-workbench-list">
          {reports.map((report) => {
            const note = resolveNote(notes, report);
            const photos = normalizePhotos(report.photos);
            const canProcess = report.status === 'pending';
            const canResolve = report.status === 'pending' || report.status === 'processing';
            const expanded = expandedId === report.id;
            return (
              <article key={report.id} className={`fault-workbench-row ${expanded ? 'fault-workbench-row--open' : ''}`}>
                <div className="fault-workbench-main">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">
                        {report.device_code || '-'} · {report.device_name || report.issue_type || '故障'}
                      </h3>
                      <span className={`badge-pill ${STATUS_TONE[report.status] ?? 'badge-muted'}`}>{STATUS_LABEL[report.status] ?? report.status}</span>
                      <span className="badge-pill badge-muted">{SEVERITY_LABEL[String(report.severity || '')] ?? (report.severity ? String(report.severity) : '普通')}</span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {formatTime(report.created_at)} · {String(report.user_name || '-')}{report.location ? ` · ${report.location}` : ''}
                    </p>
                    <p className="mt-1 line-clamp-1 text-sm text-foreground">
                      <span className="font-medium">{report.issue_type || '故障'}</span>
                      {report.description ? <span className="text-muted-foreground"> · {briefDescription(report)}</span> : null}
                    </p>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {impactText(report)}
                      <span className="mx-1 opacity-40">|</span>
                      {adviceText(report)}
                    </p>
                  </div>

                  <div className="fault-workbench-actions">
                    <Button size="sm" variant="ghost" onClick={() => setExpandedId(expanded ? '' : report.id)}>
                      {expanded ? '收起' : '处理'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openChat(report)}>
                      <MessageSquare className="h-3.5 w-3.5" /> 沟通
                    </Button>
                    {canManage && canResolve ? (
                      <Button size="sm" disabled={resolve.isPending} onClick={() => handleUpdate(report, 'resolved', { setAvailable: true })}>
                        解决恢复
                      </Button>
                    ) : null}
                  </div>
                </div>

                {expanded ? (
                  <div className="fault-workbench-expand">
                    {report.description ? (
                      <p className="text-sm leading-6 text-foreground">{report.description}</p>
                    ) : null}
                    {report.active_borrow?.user_name ? (
                      <p className="text-xs text-muted-foreground">
                        使用中：{report.active_borrow.user_name}
                        {report.active_borrow.user_phone ? ` ${report.active_borrow.user_phone}` : ''}
                      </p>
                    ) : null}
                    {(Number(report.today_reservation_count || 0) > 0 || Number(report.future_reservation_count || 0) > 0) ? (
                      <p className="text-xs text-muted-foreground">
                        预约影响：今日 {Number(report.today_reservation_count || 0)} · 后续 {Number(report.future_reservation_count || 0)}
                      </p>
                    ) : null}
                    {photos.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {photos.map((url, idx) => (
                          <a key={`${url}-${idx}`} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border">
                            <img src={url} alt={`故障照片 ${idx + 1}`} className="h-14 w-14 object-cover" />
                          </a>
                        ))}
                      </div>
                    ) : null}

                    {canManage ? (
                      <label className="block text-xs text-muted-foreground">
                        处理备注
                        <textarea
                          value={note}
                          onChange={(event) => updateNote(report.id, event.target.value)}
                          rows={2}
                          placeholder="记录处理过程、维修结果、是否恢复开放等"
                          className="mt-1 w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground"
                        />
                      </label>
                    ) : null}

                    <div className="flex flex-wrap gap-1.5">
                      {canManage && (report.active_borrow?.user_name || Number(report.future_reservation_count || 0) > 0) ? (
                        <Button size="sm" variant="outline" disabled={notifyAffected.isPending} onClick={() => handleNotifyAffected(report)}>通知用户</Button>
                      ) : null}
                      {canManage && canProcess ? (
                        <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => handleUpdate(report, 'processing', { keepMaintenance: true })}>转处理并停约</Button>
                      ) : null}
                      {canManage && canResolve ? (
                        <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => handleUpdate(report, 'resolved', { keepMaintenance: true })}>解决·维护</Button>
                      ) : null}
                      {canManage && report.status !== 'closed' ? (
                        <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => handleUpdate(report, 'closed', { keepMaintenance: true })}>关闭</Button>
                      ) : null}
                    </div>
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
