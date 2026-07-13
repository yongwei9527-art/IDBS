import { briefDateTime } from '@/lib/time-format';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { AlertTriangle, ClipboardList, Edit3, MessageSquare, RotateCcw, Send, UploadCloud, Wrench, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useActionDialog } from '@/components/ui/action-dialog';
import { Input } from '@/components/ui/input';
import { CompactId, formatCompactId } from '@/components/ui/compact-id';
import { uploadImage } from '@/lib/api';
import { reportFault } from '@/features/borrow/borrow-api';
import { buildChatSearch } from '@/features/chat/chat-context';
import {
  useCancelUserRequest,
  useCreateUserRequest,
  useMyFaultReports,
  useMyUserRequests,
  useRequestUserRequestChange,
  useUpdateUserRequest,
  type MyFaultReportRow,
  type UserRequestPayload,
  type UserRequestRow
} from './request-api';
import { toFriendlyError } from '@/lib/friendly-error';
import { OpsPageHeader } from '@/components/ops/design-system';

const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: '待确认',
  confirmed: '已确认',
  change_requested: '申请修改中',
  rejected: '已驳回',
  closed: '已关闭',
  cancelled: '已撤回'
};
const REQUEST_STATUS_TONE: Record<string, string> = {
  pending: 'warn',
  confirmed: 'success',
  change_requested: 'info',
  rejected: 'danger',
  closed: 'muted',
  cancelled: 'muted'
};
const FAULT_STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭'
};
const FAULT_STATUS_TONE: Record<string, string> = {
  pending: 'warn',
  processing: 'info',
  resolved: 'success',
  closed: 'muted'
};
const FAULT_TYPE_LABEL: Record<string, string> = {
  device_fault: '设备故障',
  abnormal_return: '归还异常',
  other: '其他问题'
};
const CATEGORY_OPTIONS = [
  { value: 'feature', label: '功能建议' },
  { value: 'reservation', label: '预约/借还问题' },
  { value: 'device', label: '设备相关' },
  { value: 'account', label: '账号/权限' },
  { value: 'other', label: '其他' }
];
const PRIORITY_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'normal', label: '普通' },
  { value: 'high', label: '高' },
  { value: 'urgent', label: '紧急' }
];
const FAULT_TYPE_OPTIONS = [
  { value: 'device_fault', label: '设备故障' },
  { value: 'abnormal_return', label: '归还异常' },
  { value: 'other', label: '其他问题' }
];
const FAULT_SEVERITY_LABEL: Record<string, string> = {
  low: '轻微',
  normal: '普通',
  high: '严重',
  urgent: '紧急'
};
const FAULT_SEVERITY_OPTIONS = [
  { value: 'low', label: '轻微' },
  { value: 'normal', label: '普通' },
  { value: 'high', label: '严重' },
  { value: 'urgent', label: '紧急' }
];
const FAULT_REASON_OPTIONS = [
  { value: 'human_operation', label: '人为操作' }, { value: 'device_aging', label: '设备老化' }, { value: 'consumable', label: '耗材问题' }, { value: 'unknown', label: '原因待确认' }
];
const AFFECT_CONTINUE_OPTIONS = [
  { value: 'unknown', label: '未确认' },
  { value: 'no', label: '不影响' },
  { value: 'partial', label: '部分影响' },
  { value: 'yes', label: '影响使用' }
];

function formatDate(value?: string | null) {
  if (!value) return '—';
  return briefDateTime(value);
}

function normalizePhotos(value: MyFaultReportRow['photos']): string[] {
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

function Badge({ status, labels, tones }: { status: string; labels: Record<string, string>; tones: Record<string, string> }) {
  return <span className={`badge-pill badge-${tones[status] ?? 'muted'}`}>{labels[status] ?? status}</span>;
}

function SelectLike({
  value,
  onChange,
  options,
  label
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-[14px] border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <Card><CardContent className="py-8 text-center text-muted-foreground">{children}</CardContent></Card>;
}

function RequestForm({
  editing,
  onCancelEdit
}: {
  editing?: UserRequestRow | null;
  onCancelEdit: () => void;
}) {
  const createRequest = useCreateUserRequest();
  const updateRequest = useUpdateUserRequest();
  const [deviceCode, setDeviceCode] = useState(editing?.device_code ?? '');
  const [category, setCategory] = useState(editing?.category ?? 'feature');
  const [priority, setPriority] = useState(editing?.priority ?? 'normal');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');

  const isEditing = Boolean(editing);
  const busy = createRequest.isPending || updateRequest.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const payload: UserRequestPayload = {
      title: title.trim(),
      description: description.trim(),
      category,
      priority,
      device_code: deviceCode.trim() || undefined
    };
    try {
      if (editing) {
        await updateRequest.mutateAsync({ ...payload, id: editing.id });
        toast.success('需求已更新');
        onCancelEdit();
      } else {
        await createRequest.mutateAsync(payload);
        toast.success('需求已提交');
        setTitle('');
        setDescription('');
        setDeviceCode('');
        setPriority('normal');
        setCategory('feature');
      }
    } catch (err) {
      toast.error(`${isEditing ? '更新' : '提交'}失败：${toFriendlyError(err)}`);
    }
  }

  return (
    <Card className="ops-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-5 w-5" />
          {isEditing ? '修改待确认需求' : '提交需求/诉求'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input placeholder="设备编号（可选）" value={deviceCode} onChange={(e) => setDeviceCode(e.target.value)} clearable />
          <div className="grid grid-cols-2 gap-3">
            <SelectLike label="分类" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
            <SelectLike label="优先级" value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} />
          </div>
          <Input placeholder="标题" value={title} onChange={(e) => setTitle(e.target.value)} clearable />
          <textarea
            placeholder="描述问题和期望"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="rounded-[14px] border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !title.trim() || !description.trim()}>
              <Send className="h-4 w-4" />{isEditing ? '保存修改' : '提交需求'}
            </Button>
            {isEditing ? <Button type="button" variant="outline" onClick={onCancelEdit}>取消编辑</Button> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RequestCard({ r, onEdit }: { r: UserRequestRow; onEdit: (r: UserRequestRow) => void }) {
  const nav = useNavigate();
  const { confirm, prompt, ActionDialog } = useActionDialog();
  const cancelRequest = useCancelUserRequest();
  const changeRequest = useRequestUserRequestChange();

  async function cancel() {
    const ok = await confirm({
      title: '确认撤回需求',
      description: '撤回后管理员将不再处理该需求，如仍需协助可以重新提交。',
      confirmText: '确认撤回',
      tone: 'warning'
    });
    if (!ok) return;
    try {
      await cancelRequest.mutateAsync(r.id);
      toast.success('需求已撤回');
    } catch (err) {
      toast.error(`撤回失败：${toFriendlyError(err)}`);
    }
  }

  async function askChange() {
    const reason = (await prompt({
      title: '申请修改需求',
      description: '请说明需要修改的原因，管理员确认后你可以继续编辑。',
      placeholder: '例如：补充设备编号或调整说明内容',
      confirmText: '提交申请',
      required: true,
      maxLength: 120
    }))?.trim();
    if (!reason) return;
    try {
      await changeRequest.mutateAsync({ id: r.id, reason });
      toast.success('修改申请已提交');
    } catch (err) {
      toast.error(`提交失败：${toFriendlyError(err)}`);
    }
  }

  return (
    <Card>
      <ActionDialog />
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{r.title}</h3>
          <Badge status={r.status} labels={REQUEST_STATUS_LABEL} tones={REQUEST_STATUS_TONE} />
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{CATEGORY_OPTIONS.find((o) => o.value === r.category)?.label ?? r.category}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{PRIORITY_OPTIONS.find((o) => o.value === r.priority)?.label ?? r.priority}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.description}</p>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {r.device_code ? <span>设备：{r.device_code} {r.device_name ?? ''}</span> : null}
          <span>提交：{formatDate(r.created_at)}</span>
          {r.updated_at ? <span>更新：{formatDate(r.updated_at)}</span> : null}
        </div>
        {r.admin_note ? <p className="rounded-lg bg-muted p-2 text-xs">管理员备注：{r.admin_note}</p> : null}
        {r.change_request_note ? <p className="rounded-lg bg-primary/10 p-2 text-xs text-primary">修改申请：{r.change_request_note}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => nav({
              to: '/chat',
              search: buildChatSearch({
                contactAdmin: true,
                type: 'request',
                title: `诉求沟通：${r.title}`,
                description: r.description,
                detail: r.description,
                deviceCode: r.device_code,
                deviceName: r.device_name,
                status: r.status,
                requestId: r.id
              })
            } as any)}
          >
            <MessageSquare className="h-4 w-4" />沟通
          </Button>
          {r.status === 'pending' ? (
            <>
              <Button size="sm" variant="outline" disabled={cancelRequest.isPending} onClick={() => onEdit(r)}><Edit3 className="h-4 w-4" />编辑</Button>
              <Button size="sm" variant="outline" disabled={cancelRequest.isPending} onClick={cancel}><XCircle className="h-4 w-4" />撤回</Button>
            </>
          ) : null}
          {r.status === 'confirmed' ? (
            <Button size="sm" variant="outline" disabled={changeRequest.isPending} onClick={askChange}>
              <RotateCcw className="h-4 w-4" />申请修改
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function FaultReportCard({ report }: { report: MyFaultReportRow }) {
  const nav = useNavigate();
  const photos = normalizePhotos(report.photos);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{report.device_code ?? '未知设备'} {report.device_name ?? ''}</h3>
          <Badge status={report.status} labels={FAULT_STATUS_LABEL} tones={FAULT_STATUS_TONE} />
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{FAULT_TYPE_LABEL[report.issue_type] ?? report.issue_type}</span>
          {report.severity ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{FAULT_SEVERITY_LABEL[report.severity] ?? report.severity}</span> : null}
        </div>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{report.description || '未填写描述'}</p>
        {photos.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {photos.map((url, idx) => (
              <a key={`${url}-${idx}`} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-input bg-muted">
                <img src={url} alt={`故障照片 ${idx + 1}`} className="h-20 w-20 object-cover" />
              </a>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {report.device_location ? <span>位置：{report.device_location}</span> : null}
          {report.borrow_record_id ? <span>借用 <CompactId value={report.borrow_record_id} prefix="BOR" /></span> : null}
          <span>提交：{formatDate(report.created_at)}</span>
          {report.resolved_at ? <span>处理：{formatDate(report.resolved_at)}</span> : null}
        </div>
        {report.admin_note ? <p className="rounded-lg bg-muted p-2 text-xs">处理备注：{report.admin_note}</p> : null}
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => nav({
              to: '/chat',
              search: buildChatSearch({
                contactAdmin: true,
                type: 'fault',
                title: `故障沟通：${report.device_code ?? formatCompactId(report.id, 8, 4, 'FLT')}`,
                description: report.description,
                issueType: report.issue_type,
                deviceCode: report.device_code,
                deviceName: report.device_name,
                status: report.status,
                faultId: report.id
              })
            } as any)}
          >
            <MessageSquare className="h-4 w-4" />联系管理员
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function FaultPage() {
  const qc = useQueryClient();
  const initialSearch = new URLSearchParams(window.location.search);
  const initialDevice = initialSearch.get('device') ?? '';
  const initialRecordId = initialSearch.get('recordId') ?? '';
  const [deviceCode, setDeviceCode] = useState(initialDevice);
  const [borrowRecordId, setBorrowRecordId] = useState(initialRecordId);
  const [issueType, setIssueType] = useState('device_fault');
  const [severity, setSeverity] = useState('normal');
  const [reasonCategory, setReasonCategory] = useState('unknown');
  const [affectContinue, setAffectContinue] = useState('unknown');
  const [description, setDescription] = useState('');
  const [faultFiles, setFaultFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingRequest, setEditingRequest] = useState<UserRequestRow | null>(null);
  const { data: requests = [], isLoading: requestsLoading, error: requestsError } = useMyUserRequests();
  const { data: faults = [], isLoading: faultsLoading, error: faultsError } = useMyFaultReports();

  const stats = useMemo(() => ({
    pendingRequests: requests.filter((r) => r.status === 'pending').length,
    confirmedRequests: requests.filter((r) => r.status === 'confirmed').length,
    openFaults: faults.filter((f) => ['pending', 'processing'].includes(f.status)).length,
    resolvedFaults: faults.filter((f) => f.status === 'resolved').length
  }), [faults, requests]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const photos: string[] = [];
      for (const file of faultFiles.slice(0, 5)) {
        const url = await uploadImage(file);
        if (url) photos.push(url);
      }
      const affectText = AFFECT_CONTINUE_OPTIONS.find((o) => o.value === affectContinue)?.label ?? affectContinue;
      const fullDescription = [
        description.trim(),
        `是否影响继续使用：${affectText}`
      ].filter(Boolean).join('\n\n');
      await reportFault({
        device_code: deviceCode.trim() || undefined,
        borrow_record_id: borrowRecordId.trim() || undefined,
        issue_type: issueType.trim(),
        severity,
        reason_category: reasonCategory,
        description: fullDescription,
        photos
      });
      toast.success('故障报备已提交');
      setDescription('');
      setFaultFiles([]);
      setAffectContinue('unknown');
      setSeverity('normal');
      setReasonCategory('unknown');
      await qc.invalidateQueries({ queryKey: ['my-fault-reports'] });
    } catch (err) {
      toast.error(`提交失败：${toFriendlyError(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ops-page-stack">
      <OpsPageHeader
        title="故障报备与需求诉求"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['待处理故障', stats.openFaults],
          ['已解决故障', stats.resolvedFaults],
          ['待确认需求', stats.pendingRequests],
          ['已确认需求', stats.confirmedRequests]
        ].map(([label, value]) => (
          <div key={String(label)} className="ops-stat-card px-4 py-3">
            <p className="text-2xl font-black tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.82fr)_minmax(0,1.18fr)]">
        <div className="space-y-4">
          <Card className="ops-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-5 w-5" />提交故障</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="flex flex-col gap-3">
                <Input placeholder="设备编号" value={deviceCode} onChange={(e) => setDeviceCode(e.target.value)} clearable />
                <Input placeholder="借用记录编号（可选）" value={borrowRecordId} onChange={(e) => setBorrowRecordId(e.target.value)} clearable />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SelectLike label="故障类型" value={issueType} onChange={setIssueType} options={FAULT_TYPE_OPTIONS} />
                  <SelectLike label="严重程度" value={severity} onChange={setSeverity} options={FAULT_SEVERITY_OPTIONS} />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><SelectLike label="初步原因分类" value={reasonCategory} onChange={setReasonCategory} options={FAULT_REASON_OPTIONS} /><SelectLike label="是否影响继续使用" value={affectContinue} onChange={setAffectContinue} options={AFFECT_CONTINUE_OPTIONS} /></div>
                <textarea
                  placeholder="描述现象、时间和影响"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="rounded-[14px] border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">故障照片（最多 5 张）</span>
                  <span className="flex items-center gap-2 rounded-2xl border border-dashed border-input bg-card/70 px-3 py-4 text-muted-foreground">
                    <UploadCloud className="h-4 w-4" /> 选择照片
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => setFaultFiles(Array.from(e.target.files || []).slice(0, 5))}
                      className="sr-only"
                    />
                  </span>
                  {faultFiles.length > 0 ? <span className="text-xs text-muted-foreground">已选 {faultFiles.length} 张</span> : null}
                </label>
                <Button type="submit" disabled={loading || !description.trim() || (!deviceCode.trim() && !borrowRecordId.trim())}>
                  <Wrench className="h-4 w-4" />{loading ? '提交中…' : '提交故障'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <RequestForm key={editingRequest?.id ?? 'new'} editing={editingRequest} onCancelEdit={() => setEditingRequest(null)} />
        </div>

        <div className="space-y-5">
          <section className="ops-card p-4">
            <h2 className="text-base font-black">我的故障</h2>
            {faultsLoading ? <p className="py-6 text-center text-sm text-muted-foreground">加载故障记录…</p> : null}
            {faultsError ? <p className="py-6 text-center text-sm text-destructive">加载失败：{toFriendlyError(faultsError)}</p> : null}
            {!faultsLoading && !faultsError && faults.length === 0 ? <EmptyState>暂无故障记录</EmptyState> : null}
            <div className="space-y-2">
              {faults.map((f) => <FaultReportCard key={f.id} report={f} />)}
            </div>
          </section>

          <section className="ops-card p-4">
            <h2 className="text-base font-black">我的需求</h2>
            {requestsLoading ? <p className="py-6 text-center text-sm text-muted-foreground">加载需求记录…</p> : null}
            {requestsError ? <p className="py-6 text-center text-sm text-destructive">加载失败：{toFriendlyError(requestsError)}</p> : null}
            {!requestsLoading && !requestsError && requests.length === 0 ? <EmptyState>暂无需求记录</EmptyState> : null}
            <div className="space-y-2">
              {requests.map((r) => <RequestCard key={r.id} r={r} onEdit={setEditingRequest} />)}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}



