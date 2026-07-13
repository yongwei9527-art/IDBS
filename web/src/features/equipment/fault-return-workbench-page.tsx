import { briefDateTime } from '@/lib/time-format';
import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { useAdminFaults, useResolveFault, type AdminFaultRow } from '@/features/platform/operations-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildChatSearch } from '@/features/chat/chat-context';
import { useCapability } from '@/features/auth/permissions';
import { toFriendlyError } from '@/lib/friendly-error';
import { OpsEmptyState, OpsMetricCard, OpsPageHeader, OpsPermissionHint } from '@/components/ops/design-system';

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

export function AdminFaultsPage() {
  const nav = useNavigate();
  const capability = useCapability();
  const initialParams = new URLSearchParams(window.location.search);
  const [status, setStatus] = useState(initialParams.get('status') ?? '');
  const [deviceCode, setDeviceCode] = useState(initialParams.get('device_code') ?? initialParams.get('device') ?? '');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { data, isLoading, error } = useAdminFaults(status || undefined, deviceCode || undefined);
  const reports = data?.reports ?? [];
  const resolve = useResolveFault();
  const canManage = capability.canManageFaults;

  const metrics = useMemo(() => {
    const count = (key: string) => reports.filter((item) => item.status === key).length;
    return [
      { label: '当前列表', value: reports.length, hint: deviceCode ? `设备 ${deviceCode}` : '全部设备' },
      { label: '待处理', value: count('pending'), hint: '需要尽快分派' },
      { label: '处理中', value: count('processing'), hint: '维护中或跟进中' },
      { label: '已闭环', value: count('resolved') + count('closed'), hint: '解决/关闭' }
    ];
  }, [deviceCode, reports]);

  function updateNote(id: string, value: string) {
    setNotes((current) => ({ ...current, [id]: value }));
  }


  function handleUpdate(report: AdminFaultRow, nextStatus: 'processing' | 'resolved' | 'closed', options: { setAvailable?: boolean; keepMaintenance?: boolean } = {}) {
    const adminNote = resolveNote(notes, report).trim();
    resolve.mutate(
      { id: report.id, status: nextStatus, admin_note: adminNote, set_available: options.setAvailable, keep_maintenance: options.keepMaintenance },
      {
        onSuccess: () => toast.success(`故障已${nextStatus === 'processing' ? '标记为处理中' : nextStatus === 'closed' ? '关闭' : '标记为已解决'}`),
        onError: (e) => toast.error(`操作失败：${toFriendlyError(e)}`)
      }
    );
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
      issueType: report.issue_type,
      description: report.description,
      status: report.status,
      title: `故障沟通：${report.device_code || report.device_name || report.issue_type}`
    });
    nav({ to: '/chat', search } as any);
  }

  return (
    <div className="flex flex-col gap-4">
      <OpsPageHeader
        eyebrow="IDBS 5.0 · 故障与归还闭环"
        title="故障处理与设备恢复"
        description="集中处理设备故障、异常归还、维修备注和恢复开放动作；恢复设备会影响后续预约排期，未授权管理员仅可查看。"
        aside={
          <div className="space-y-3 text-sm text-white/72">
            <p className="font-black text-white">处理边界</p>
            <p>故障处理需要设备维护、故障管理或归还复核权限；解决并恢复会同步影响设备可预约状态。</p>
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((item, index) => (
          <OpsMetricCard
            key={item.label}
            label={item.label}
            value={item.value}
            hint={item.hint}
            tone={index === 1 ? 'warning' : index === 2 ? 'info' : index === 3 ? 'success' : 'default'}
            loading={isLoading}
          />
        ))}
      </div>

      <Card className="ops-card">
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-base">筛选与定位</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">按状态或设备定位。</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={deviceCode} onChange={(event) => setDeviceCode(event.target.value)} placeholder="设备编码，如 DEMO-HPLC-001" clearable onClear={() => setDeviceCode('')} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((s) => (
              <Button key={s || 'all'} size="sm" variant={status === s ? 'default' : 'outline'} onClick={() => setStatus(s)}>
                {s ? STATUS_LABEL[s] ?? s : '全部'}
              </Button>
            ))}
          </div>
          {!canManage && (
            <OpsPermissionHint title="只读模式" permissions="当前账号未开通故障处理或设备维护权限">
              处理故障需要相应授权；未授权管理员不会看到处理按钮，后端接口也会拒绝越权。
            </OpsPermissionHint>
          )}
        </CardContent>
      </Card>

      {isLoading && <p className="py-8 text-center text-muted-foreground">加载故障记录中…</p>}
      {error && <p className="py-8 text-center text-destructive">加载失败：{toFriendlyError(error)}</p>}
      {!isLoading && reports.length === 0 && <OpsEmptyState title="暂无匹配故障记录" description="可切换状态或设备编码后继续查看。" />}

      <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
        {reports.map((report) => {
          const note = resolveNote(notes, report);
          const photos = normalizePhotos(report.photos);
          const canProcess = report.status === 'pending';
          const canResolve = report.status === 'pending' || report.status === 'processing';
          return (
            <Card key={report.id} className="ops-card overflow-hidden">
              <CardHeader className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{report.device_code || '-'} · {report.device_name || report.issue_type}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">{report.device_location || '位置未填写'} · {formatTime(report.created_at)}</p>
                  </div>
                  <span className={`badge-pill ${STATUS_TONE[report.status] ?? 'badge-muted'}`}>{STATUS_LABEL[report.status] ?? report.status}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-0">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Mini label="上报人" value={report.user_name || '-'} />
                  <Mini label="联系方式" value={report.user_phone || '-'} />
                  <Mini label="严重程度" value={SEVERITY_LABEL[report.severity || ''] ?? report.severity ?? '-'} />
                </div>
                <div className="rounded-2xl bg-muted/30 p-3 text-sm">
                  <p className="font-semibold">{report.issue_type}</p>
                  <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{report.description || '-'}</p>
                </div>
                {photos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {photos.map((url, idx) => (
                      <a key={`${url}-${idx}`} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border bg-muted">
                        <img src={url} alt={`故障照片 ${idx + 1}`} className="h-20 w-20 object-cover" />
                      </a>
                    ))}
                  </div>
                )}
                {canManage ? (
                  <label className="block text-sm">
                    <span className="text-muted-foreground">处理备注</span>
                    <textarea
                      value={note}
                      onChange={(event) => updateNote(report.id, event.target.value)}
                      rows={3}
                      placeholder="记录处理过程、维修结果、是否恢复开放等"
                      className="mt-1 w-full rounded-2xl border bg-card px-3 py-2 text-sm"
                    />
                  </label>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openChat(report)}>
                    <MessageSquare className="mr-1 h-4 w-4" /> 沟通
                  </Button>
                  {canManage && canProcess && <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => handleUpdate(report, 'processing', { keepMaintenance: true })}>转处理中</Button>}
                  {canManage && canResolve && <Button size="sm" disabled={resolve.isPending} onClick={() => handleUpdate(report, 'resolved', { setAvailable: true })}>解决并恢复</Button>}
                  {canManage && canResolve && <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => handleUpdate(report, 'resolved', { keepMaintenance: true })}>解决但维护</Button>}
                  {canManage && report.status !== 'closed' && <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => handleUpdate(report, 'closed', { keepMaintenance: true })}>关闭</Button>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/30 p-3 text-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-semibold">{value}</p>
    </div>
  );
}


