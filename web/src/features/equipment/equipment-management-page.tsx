import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, Archive, Boxes, CalendarDays, CheckCircle2, Edit3, ImagePlus, Search, ShieldAlert, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import {
  useAdminDeviceDetail,
  useAdminDevices,
  useCreateAdminDevice,
  useReservationSlotOptions,
  useSetAdminDeviceAvailable,
  useUpdateAdminDevice,
  type AdminDevice,
  type ReservationSlotOption
} from '@/features/platform/operations-api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useActionDialog } from '@/components/ui/action-dialog';
import { Input } from '@/components/ui/input';
import { uploadImage } from '@/lib/api';
import { useCapability } from '@/features/auth/permissions';
import { compactTimeRange, slotDisplayName, tinyTimeRange } from '@/lib/time-format';
import { briefDateTime } from '@/lib/time-format';
import { OpsBadge, OpsDataToolbar, OpsEmptyState, OpsMetricCard, OpsPageHeader, OpsPermissionHint, OpsRiskBadge, OpsSectionHeader, OpsTimeBlock } from '@/components/ops/design-system';
import { toFriendlyError } from '@/lib/friendly-error';

const STATUS_LABEL: Record<string, string> = {
  available: '可预约',
  reserved: '已预约',
  in_use: '使用中',
  maintenance: '维修中',
  abnormal_pending: '异常待处理',
  disabled: '停用'
};

const STATUS_TONE: Record<string, string> = {
  available: 'success',
  reserved: 'info',
  in_use: 'info',
  maintenance: 'warn',
  abnormal_pending: 'danger',
  disabled: 'muted'
};

const STATUS_OPTIONS = ['available', 'reserved', 'in_use', 'maintenance', 'abnormal_pending', 'disabled'];

const RETURN_MODE_LABEL: Record<string, string> = {
  confirm_only: '确认归还',
  image_optional: '图片选传',
  image_required: '图片必传'
};

interface DeviceForm {
  device_code: string;
  name: string;
  category: string;
  location: string;
  manager: string;
  status: string;
  allow_reservation: boolean;
  return_mode: string;
  return_require_note: boolean;
  description: string;
  usage_notice: string;
  cover_photo: string;
  reservation_slot_keys: string[];
}

const EMPTY_FORM: DeviceForm = {
  device_code: '',
  name: '',
  category: '',
  location: '',
  manager: '',
  status: 'available',
  allow_reservation: true,
  return_mode: 'image_required',
  return_require_note: false,
  description: '',
  usage_notice: '',
  cover_photo: '',
  reservation_slot_keys: []
};

function valueText(value: unknown, fallback = '—') {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function fmtTime(value: unknown) {
  return briefDateTime(value ? String(value) : null);
}

function slotLabel(slot: ReservationSlotOption) {
  const start = slot.start ?? slot.start_time;
  const end = slot.end ?? slot.end_time;
  const name = slotDisplayName(slot.key, slot.label);
  return start && end ? name + ' ' + compactTimeRange(start, end, { crossesNextDay: Boolean(slot.crosses_midnight) }) : name;
}

function selectedKeysFromDevice(device: AdminDevice) {
  if (Array.isArray(device.reservation_slot_options) && device.reservation_slot_options.length) {
    return device.reservation_slot_options.map((slot) => slot.key).filter(Boolean);
  }
  if (Array.isArray(device.reservation_slot_keys)) return device.reservation_slot_keys.filter(Boolean);
  return [];
}


function deviceRiskLevel(device: AdminDevice): 'low' | 'medium' | 'high' | 'critical' {
  if (device.status === 'disabled') return 'critical';
  if (device.status === 'abnormal_pending') return 'critical';
  if (device.status === 'maintenance') return 'high';
  if (device.allow_reservation === false) return 'medium';
  if (device.status === 'in_use') return 'medium';
  return 'low';
}

function deviceRiskText(device: AdminDevice) {
  if (device.status === 'disabled') return '设备已停用，需复核是否归档或重新启用。';
  if (device.status === 'abnormal_pending') return '存在异常待处理，归还和维护档案需要优先确认。';
  if (device.status === 'maintenance') return '设备维护中，暂不建议开放新的预约。';
  if (device.allow_reservation === false) return '设备已暂停预约，用户端不会开放提交入口。';
  if (device.status === 'in_use') return '设备正在使用，关注预计归还和逾期风险。';
  return '运行正常，可继续开放预约。';
}

function lifecycleStage(status?: string) {
  if (status === 'maintenance') return '维护中';
  if (status === 'abnormal_pending') return '异常待处理';
  if (status === 'disabled') return '停用/归档';
  if (status === 'in_use') return '使用中';
  if (status === 'reserved') return '已预约';
  return '可预约';
}

function lifecycleTone(status?: string) {
  if (status === 'available') return 'success';
  if (status === 'reserved' || status === 'in_use') return 'info';
  if (status === 'maintenance') return 'warning';
  if (status === 'abnormal_pending' || status === 'disabled') return 'danger';
  return 'muted';
}

function lifecycleSteps(status?: string) {
  const active = lifecycleStage(status);
  const base = ['入库', '可预约', '已预约', '使用中', '归还待检', '可预约'];
  if (status === 'maintenance') return ['入库', '可预约', '维护中', '恢复可预约'];
  if (status === 'abnormal_pending') return ['入库', '使用中', '异常待处理', '维护确认', '恢复可预约'];
  if (status === 'disabled') return ['入库', '可预约', '停用/归档'];
  return base.map((step) => (step === '已预约' && active === '已预约') || (step === '使用中' && active === '使用中') ? active : step);
}

function slotTotal(device: AdminDevice) {
  return device.reservation_slot_options?.length ?? device.reservation_slot_keys?.length ?? 0;
}

function DetailRows({ rows, columns }: { rows?: Array<Record<string, unknown>>; columns: Array<{ key: string; label: string; time?: boolean }> }) {
  const visibleRows = rows?.slice(0, 10) ?? [];
  if (!visibleRows.length) return <p className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">暂无记录</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-muted-foreground">
            {columns.map((c) => <th key={c.key} className="px-3 py-2 font-medium">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, idx) => (
            <tr key={String(row.id ?? row.item_id ?? idx)} className="border-b last:border-0">
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2">{c.time ? fmtTime(row[c.key]) : valueText(row[c.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stringArrayValue(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : [trimmed];
    } catch {
      return [trimmed];
    }
  }
  return [];
}

function BorrowArchiveRows({ rows }: { rows?: Array<Record<string, unknown>> }) {
  const visibleRows = (rows ?? [])
    .filter((row) => valueText(row.return_archive_folder, '') || stringArrayValue(row.return_archive_photos).length || stringArrayValue(row.return_photos).length)
    .slice(0, 8);

  if (!visibleRows.length) {
    return <p className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">暂无归还图片档案</p>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {visibleRows.map((row, index) => {
        const archivePhotos = stringArrayValue(row.return_archive_photos);
        const photos = (archivePhotos.length ? archivePhotos : stringArrayValue(row.return_photos)).slice(0, 5);
        return (
          <article key={String(row.id ?? index)} className="rounded-3xl border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wider text-primary">归还档案</p>
                <h3 className="mt-1 truncate text-sm font-black" title={valueText(row.return_archive_folder, '')}>{valueText(row.return_archive_folder, '未生成文件夹')}</h3>
              </div>
              <OpsBadge tone={String(row.return_condition || '').includes('异常') || row.status === 'abnormal_pending' ? 'danger' : 'success'}>
                {STATUS_LABEL[String(row.status || '')] ?? valueText(row.status, '已归还')}
              </OpsBadge>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
              <span>使用人：{valueText(row.user_name)}</span>
              <span>联系方式：{valueText(row.user_phone)}</span>
              <span>归还时间：{fmtTime(row.return_time)}</span>
              {row.return_note ? <span>说明：{valueText(row.return_note)}</span> : null}
            </div>
            {photos.length ? (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {photos.map((photo, photoIndex) => (
                  <a key={photo + photoIndex} href={photo} target="_blank" rel="noreferrer" className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border bg-muted" title="打开归还照片">
                    <img src={photo} alt={'归还照片 ' + (photoIndex + 1)} className="h-full w-full object-cover transition group-hover:scale-105" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-2xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">该记录未上传归还图片。</p>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function AdminDevicesPage() {
  const capability = useCapability();
  const { confirm, ActionDialog } = useActionDialog();
  const { data, isLoading, error } = useAdminDevices();
  const { data: slotOptions = [] } = useReservationSlotOptions();
  const createDevice = useCreateAdminDevice();
  const updateDevice = useUpdateAdminDevice();
  const setAvailable = useSetAdminDeviceAvailable();
  const initialParams = new URLSearchParams(window.location.search);
  const [editingId, setEditingId] = useState('');
  const [detailId, setDetailId] = useState('');
  const [form, setForm] = useState<DeviceForm>(EMPTY_FORM);
  const [statusFilter, setStatusFilter] = useState(initialParams.get('status') ?? '');
  const [keyword, setKeyword] = useState(initialParams.get('device_code') ?? initialParams.get('device') ?? '');
  const [uploading, setUploading] = useState(false);
  const detail = useAdminDeviceDetail(detailId);
  const list = data?.list ?? [];
  const canManage = capability.canManageDevices;
  const canViewReturnArchive = capability.canViewReturnArchive;
  const busy = createDevice.isPending || updateDevice.isPending || uploading;

  const filteredList = useMemo(() => list.filter((device) => {
    const statusMatched = statusFilter === 'abnormal'
      ? ['maintenance', 'disabled', 'abnormal_pending'].includes(device.status)
      : !statusFilter || device.status === statusFilter;
    const q = keyword.trim().toLowerCase();
    const keywordMatched = !q || [device.device_code, device.name, device.location, device.manager, device.category]
      .some((value) => String(value || '').toLowerCase().includes(q));
    return statusMatched && keywordMatched;
  }), [keyword, list, statusFilter]);

  const statusCounts = useMemo(() => list.reduce<Record<string, number>>((acc, device) => {
    const key = device.status || 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {}), [list]);

  const health = {
    total: list.length,
    available: statusCounts.available ?? 0,
    inUse: statusCounts.in_use ?? 0,
    abnormal: (statusCounts.maintenance ?? 0) + (statusCounts.disabled ?? 0) + (statusCounts.abnormal_pending ?? 0)
  };


  useEffect(() => {
    if (!keyword || detailId || !list.length) return;
    const target = list.find((device) => device.device_code === keyword);
    if (target?.id) setDetailId(target.id);
  }, [detailId, keyword, list]);

  function patchForm(patch: Partial<DeviceForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function resetForm() {
    setEditingId('');
    setForm(EMPTY_FORM);
  }

  function editDevice(device: AdminDevice) {
    setEditingId(device.id);
    setDetailId(device.id);
    setForm({
      device_code: device.device_code ?? '',
      name: device.name ?? '',
      category: device.category ?? '',
      location: device.location ?? '',
      manager: device.manager ?? '',
      status: device.status || 'available',
      allow_reservation: device.allow_reservation !== false,
      return_mode: device.return_mode || 'image_required',
      return_require_note: Boolean(device.return_require_note),
      description: device.description ?? '',
      usage_notice: device.usage_notice ?? '',
      cover_photo: device.cover_photo ?? '',
      reservation_slot_keys: selectedKeysFromDevice(device)
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleUpload(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file);
      patchForm({ cover_photo: url });
      toast.success('封面图片已上传');
    } catch (e) {
      toast.error(`上传失败：${toFriendlyError(e)}`);
    } finally {
      setUploading(false);
    }
  }

  function toggleSlot(key: string) {
    setForm((prev) => ({
      ...prev,
      reservation_slot_keys: prev.reservation_slot_keys.includes(key)
        ? prev.reservation_slot_keys.filter((item) => item !== key)
        : [...prev.reservation_slot_keys, key]
    }));
  }

  function buildSlotPayload() {
    if (!form.reservation_slot_keys.length) return [];
    return form.reservation_slot_keys.map((key) => slotOptions.find((slot) => slot.key === key) ?? { key });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const payload = {
      device_code: form.device_code.trim(),
      name: form.name.trim(),
      category: form.category.trim(),
      location: form.location.trim(),
      manager: form.manager.trim(),
      status: form.status,
      allow_reservation: form.status === 'available' && form.allow_reservation,
      return_mode: form.return_mode,
      return_require_note: form.return_require_note,
      description: form.description.trim(),
      usage_notice: form.usage_notice.trim(),
      cover_photo: form.cover_photo.trim(),
      reservation_slot_keys: buildSlotPayload()
    };
    if (!payload.device_code || !payload.name) {
      toast.warning('请填写设备编号和设备名称');
      return;
    }
    const callbacks = {
      onSuccess: () => {
        toast.success(editingId ? '设备已更新' : '设备已创建');
        resetForm();
      },
      onError: (e: Error) => toast.error(`保存失败：${toFriendlyError(e)}`)
    };
    if (editingId) updateDevice.mutate({ id: editingId, ...payload }, callbacks);
    else createDevice.mutate(payload, callbacks);
  }

  async function quickStatus(device: AdminDevice, status: 'maintenance' | 'disabled') {
    const ok = await confirm({
      title: '确认调整设备状态',
      description: `设备 ${device.device_code} 将设为${STATUS_LABEL[status]}，用户将不能继续新预约。`,
      confirmText: '确认调整',
      tone: 'warning'
    });
    if (!ok) return;
    updateDevice.mutate(
      { id: device.id, device_code: device.device_code, name: device.name, status, allow_reservation: false },
      {
        onSuccess: () => toast.success('设备状态已更新'),
        onError: (e) => toast.error(`操作失败：${toFriendlyError(e)}`)
      }
    );
  }

  function recover(device: AdminDevice) {
    setAvailable.mutate(device.id, {
      onSuccess: () => toast.success('设备已恢复可预约'),
      onError: (e) => toast.error(`恢复失败：${toFriendlyError(e)}`)
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ActionDialog />
      <OpsPageHeader
        title="设备资产运营中心"
        description="统一查看设备状态、预约时段、归还规则和生命周期风险；维护、停用、恢复等高风险动作只对具备设备管理权限的账号开放。"
        aside={
          <div className="grid grid-cols-2 gap-3">
            <OpsBadge tone="success">可预约 {health.available}</OpsBadge>
            <OpsBadge tone="info">使用中 {health.inUse}</OpsBadge>
            <OpsBadge tone="danger">异常/停用 {health.abnormal}</OpsBadge>
            <OpsBadge tone={canManage ? 'default' : 'muted'}>{canManage ? '可维护' : '只读'}</OpsBadge>
          </div>
        }
      >
        <OpsBadge tone="info"><ShieldAlert className="h-3.5 w-3.5" /> 后端同步复核设备管理权限</OpsBadge>
        <OpsBadge tone="default"><CalendarDays className="h-3.5 w-3.5" /> 时段以紧凑色块展示</OpsBadge>
      </OpsPageHeader>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <OpsMetricCard label="设备总数" value={health.total} hint={`当前筛选前共 ${list.length} 台`} icon={<Boxes className="h-4 w-4" />} />
        <OpsMetricCard label="可预约" value={health.available} hint="用户端可提交预约" tone="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setStatusFilter('available')} />
        <OpsMetricCard label="使用中" value={health.inUse} hint="关注预计归还" tone="info" icon={<Activity className="h-4 w-4" />} onClick={() => setStatusFilter('in_use')} />
        <OpsMetricCard label="异常/停用" value={health.abnormal} hint="维护、停用、异常待处理" tone="danger" icon={<ShieldAlert className="h-4 w-4" />} onClick={() => setStatusFilter('abnormal')} />
      </div>

      {!canManage ? (
        <OpsPermissionHint title="只读设备台账">
          当前账号仅可查看设备状态、归还规则和历史记录，新增、编辑、停用与恢复入口已自动隐藏。
        </OpsPermissionHint>
      ) : null}

      <div className={canManage ? "grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]" : "grid gap-4"}>
        <div className="grid gap-4">
          <Card className="ops-card">
            <CardContent className="p-4">
              <OpsDataToolbar
                title="设备矩阵"
                description="按状态、编号、位置快速定位设备；维护按钮只对具备设备管理权限的账号显示。"
                meta={<>显示 {filteredList.length} / {list.length} 台</>}
                filters={
                  <>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input className="w-64 pl-9" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索编号、名称、位置" clearable />
                    </div>
                    {[
                      { key: '', label: '全部' },
                      { key: 'available', label: '可预约' },
                      { key: 'in_use', label: '使用中' },
                      { key: 'abnormal', label: '异常/停用' }
                    ].map((item) => (
                      <Button key={item.key || 'all'} size="sm" variant={statusFilter === item.key ? 'default' : 'outline'} onClick={() => setStatusFilter(item.key)}>{item.label}</Button>
                    ))}
                  </>
                }
              />

              <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                {filteredList.map((device) => (
                  <article
                    key={device.id}
                    className={[
                      'rounded-3xl border bg-card/80 p-4 transition-all',
                      detailId === device.id ? 'border-primary ring-2 ring-primary/15' : 'border-input hover:border-primary/40'
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-black text-primary">{device.device_code}</span>
                          <span className={`badge-pill badge-${STATUS_TONE[device.status] ?? 'muted'}`}>{STATUS_LABEL[device.status] ?? device.status}</span>
                          <span className={`badge-pill ${device.allow_reservation === false ? 'badge-warn' : 'badge-success'}`}>
                            {device.allow_reservation === false ? '暂停预约' : '可预约'}
                          </span>
                          <span className="badge-pill badge-info">{RETURN_MODE_LABEL[String(device.return_mode || 'image_required')] ?? '图片必传'}</span>
                        </div>
                        <h3 className="mt-2 truncate text-lg font-black">{device.name}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">{device.category || '未分类'} · {device.location || '未知位置'} · {device.manager || '未指定负责人'}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <OpsBadge tone={lifecycleTone(device.status) as any}>{lifecycleStage(device.status)}</OpsBadge>
                          <OpsRiskBadge level={deviceRiskLevel(device)}>{deviceRiskText(device)}</OpsRiskBadge>
                        </div>
                      </div>
                      {device.cover_photo ? (
                        <img src={device.cover_photo} alt={device.name} className="h-16 w-20 rounded-2xl object-cover" />
                      ) : (
                        <div className="flex h-16 w-20 items-center justify-center rounded-2xl bg-muted/50 text-muted-foreground">
                          <Boxes className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <div className="mt-4 grid gap-3 rounded-2xl bg-muted/30 p-3 text-xs text-muted-foreground">
                      <div>
                        <span className="mb-1 block font-bold text-foreground/70">预约时段</span>
                        <div className="flex flex-wrap gap-1.5">
                          {(device.reservation_slot_options ?? []).length ? (
                            (device.reservation_slot_options ?? []).slice(0, 4).map((slot) => (
                              <OpsTimeBlock key={slot.key} compact label={slotDisplayName(slot.key, slot.label)} title={slotLabel(slot)} />
                            ))
                          ) : (device.reservation_slot_keys ?? []).length ? (
                            (device.reservation_slot_keys ?? []).slice(0, 4).map((key) => <OpsTimeBlock key={key} compact label={slotDisplayName(key)} title={key} />)
                          ) : (
                            <span className="text-muted-foreground">系统默认</span>
                          )}
                          {((device.reservation_slot_options?.length ?? device.reservation_slot_keys?.length ?? 0) > 4) ? <span className="rounded-full bg-background px-2 py-1 font-bold text-primary">+{(device.reservation_slot_options?.length ?? device.reservation_slot_keys?.length ?? 0) - 4}</span> : null}
                        </div>
                      </div>
                      <p>归还规则：{RETURN_MODE_LABEL[String(device.return_mode || 'image_required')] ?? '图片必传'}{device.return_require_note ? ' / 说明必填' : ''}</p>
                      <p>当前使用：{device.current_borrow ? `${valueText(device.current_borrow.user_name)} / ${valueText(device.current_borrow.user_phone)}` : '无'}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span>下个预约：</span>
                        {device.next_reservation ? (
                          <OpsTimeBlock
                            compact
                            label={tinyTimeRange(String(device.next_reservation.start_time || ''), String(device.next_reservation.end_time || ''))}
                            subLabel={valueText(device.next_reservation.user_name)}
                            title={valueText(device.next_reservation.user_name) + ' / ' + compactTimeRange(String(device.next_reservation.start_time || ''), String(device.next_reservation.end_time || ''))}
                          />
                        ) : '无'}
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {canManage ? <Button size="sm" variant="outline" onClick={() => editDevice(device)}><Edit3 className="h-4 w-4" /> 编辑</Button> : null}
                      <Button size="sm" variant="outline" onClick={() => setDetailId(detailId === device.id ? '' : device.id)}>
                        <Activity className="h-4 w-4" /> {detailId === device.id ? '收起详情' : '查看详情'}
                      </Button>
                      {canManage && device.status === 'available' ? (
                        <>
                          <Button size="sm" variant="outline" disabled={updateDevice.isPending} onClick={() => quickStatus(device, 'maintenance')}><Wrench className="h-4 w-4" /> 维修</Button>
                          <Button size="sm" variant="destructive" disabled={updateDevice.isPending} onClick={() => quickStatus(device, 'disabled')}>停用</Button>
                        </>
                      ) : canManage ? (
                        <Button size="sm" disabled={setAvailable.isPending} onClick={() => recover(device)}>恢复可预约</Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
              {isLoading ? <p className="py-6 text-center text-muted-foreground">加载中…</p> : null}
              {error ? <p className="py-6 text-center text-destructive">加载失败：{toFriendlyError(error)}</p> : null}
              {!isLoading && !error && filteredList.length === 0 ? <OpsEmptyState title="暂无匹配设备" description="可清空筛选条件，或检查设备编号、分类、位置是否录入准确。" /> : null}
            </CardContent>
          </Card>

          {detailId ? (
            <Card className="ops-card">
              <CardContent className="grid gap-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-primary">设备详情 / 历史</p>
                    <h2 className="mt-1 text-xl font-black">{detail.data?.device ? `${detail.data.device.device_code} ${detail.data.device.name}` : '正在加载设备历史…'}</h2>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setDetailId('')}>关闭</Button>
                </div>
                {detail.isLoading ? <p className="py-4 text-center text-muted-foreground">加载中…</p> : null}
                {detail.error ? <p className="py-4 text-center text-destructive">加载失败：{toFriendlyError(detail.error)}</p> : null}
                {detail.data ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-4">
                      <OpsMetricCard label="生命周期" value={lifecycleStage(detail.data.device.status)} hint={deviceRiskText(detail.data.device)} tone={lifecycleTone(detail.data.device.status) as any} />
                      <OpsMetricCard label="预约时段" value={slotTotal(detail.data.device) || '默认'} hint="用户端以色块展示" tone="info" />
                      <OpsMetricCard label="使用记录" value={detail.data.borrows?.length ?? 0} hint="最近借还闭环" tone="default" />
                      <OpsMetricCard label="故障记录" value={detail.data.fault_reports?.length ?? 0} hint="异常和维护追溯" tone={(detail.data.fault_reports?.length ?? 0) ? 'warning' : 'success'} />
                    </div>

                    <section className="rounded-3xl border bg-muted/20 p-4">
                      <OpsSectionHeader
                        eyebrow="Lifecycle"
                        title="设备生命周期"
                        description="用于快速判断设备从入库、预约、使用、归还检查到维护归档的当前位置。"
                        action={<OpsRiskBadge level={deviceRiskLevel(detail.data.device)} />}
                      />
                      <div className="mt-4 grid gap-2 md:grid-cols-4">
                        {lifecycleSteps(detail.data.device.status).map((step, index, arr) => {
                          const activeStage = lifecycleStage(detail.data.device.status);
                          const activeIndex = arr.findIndex((item) => item === activeStage);
                          const current = step === activeStage;
                          const done = activeIndex < 0 ? index === 0 : index < activeIndex;
                          return (
                            <div key={String(step) + '-' + index} className={['rounded-2xl border p-3 text-sm', current ? 'border-primary bg-primary/10 text-primary' : done ? 'bg-muted/40 text-foreground' : 'bg-background text-muted-foreground'].join(' ')}>
                              <p className="text-xs font-black">{index + 1}</p>
                              <p className="mt-1 font-black">{step}</p>
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="ops-stat-card p-4"><p className="text-xs text-muted-foreground">位置</p><strong>{detail.data.device.location ?? '—'}</strong></div>
                      <div className="ops-stat-card p-4"><p className="text-xs text-muted-foreground">负责人</p><strong>{detail.data.device.manager ?? '—'}</strong></div>
                      <div className="ops-stat-card p-4"><p className="text-xs text-muted-foreground">状态</p><strong>{STATUS_LABEL[detail.data.device.status] ?? detail.data.device.status}</strong></div>
                      <div className="ops-stat-card p-4 md:col-span-3"><p className="text-xs text-muted-foreground">归还规则</p><strong>{RETURN_MODE_LABEL[String(detail.data.device.return_mode || 'image_required')] ?? '图片必传'}{detail.data.device.return_require_note ? ' · 说明必填' : ''}</strong></div>
                    </div>

                    <section className="grid gap-2">
                      <OpsSectionHeader title="预约记录" description="展示近期预约，避免进入详情页后再次跳转。" />
                      <DetailRows rows={detail.data.reservations} columns={[{ key: 'user_name', label: '用户' }, { key: 'start_time', label: '开始', time: true }, { key: 'end_time', label: '结束', time: true }, { key: 'status', label: '状态' }]} />
                    </section>
                    <section className="grid gap-2">
                      <OpsSectionHeader title="使用历史" description="用于确认设备借出、归还和图片档案闭环。" />
                      <DetailRows rows={detail.data.borrows} columns={[{ key: 'user_name', label: '用户' }, { key: 'borrow_time', label: '借用', time: true }, { key: 'return_time', label: '归还', time: true }, { key: 'status', label: '状态' }]} />
                    </section>
                    <section className="grid gap-2">
                      <OpsSectionHeader
                        title="归还图片档案"
                        description="按设备、归还时间、使用人和联系方式自动生成文件夹；图片入口只对归还查看、图片复核或导出权限开放。"
                        action={<Archive className="h-4 w-4 text-primary" />}
                      />
                      {canViewReturnArchive && detail.data.can_view_return_archive !== false ? (
                        <BorrowArchiveRows rows={detail.data.borrows} />
                      ) : (
                        <OpsPermissionHint title="归还档案受保护">
                          当前账号未被授予归还查看、图片复核或归还导出权限；页面已隐藏图片与归档文件夹，后端接口也会同步脱敏。
                        </OpsPermissionHint>
                      )}
                    </section>
                    <section className="grid gap-2">
                      <OpsSectionHeader title="故障历史" description="异常待处理和维护记录会影响用户端预约入口。" />
                      <DetailRows rows={detail.data.fault_reports} columns={[{ key: 'user_name', label: '报告人' }, { key: 'issue_type', label: '类型' }, { key: 'status', label: '状态' }, { key: 'created_at', label: '时间', time: true }]} />
                    </section>
                  </>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>

        {canManage ? (
        <aside className="2xl:sticky 2xl:top-4 2xl:self-start">
          <Card className="ops-card">
            <CardContent className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-primary">设备维护面板</p>
                  <h2 className="mt-1 text-xl font-black">{editingId ? '编辑设备' : '新增设备'}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">不选择预约时段时，后端会使用系统默认时段。</p>
                </div>
                {editingId ? <Button type="button" size="sm" variant="outline" onClick={resetForm}>取消</Button> : null}
              </div>

              {!canManage ? (
                <OpsPermissionHint className="mb-4" title="表单已锁定">当前账号缺少设备维护权限，不能新增、编辑或变更设备预约时段。</OpsPermissionHint>
              ) : null}

              <form className="grid gap-4" onSubmit={handleSubmit}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">设备编号<Input disabled={!canManage} value={form.device_code} onChange={(e) => patchForm({ device_code: e.target.value })} placeholder="如 R200" /></label>
                  <label className="grid gap-1 text-sm">设备名称<Input disabled={!canManage} value={form.name} onChange={(e) => patchForm({ name: e.target.value })} /></label>
                  <label className="grid gap-1 text-sm">
                    状态
                    <select disabled={!canManage} className="h-10 rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60" value={form.status} onChange={(e) => patchForm({ status: e.target.value, allow_reservation: e.target.value === 'available' ? form.allow_reservation : false })}>
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">分类<Input disabled={!canManage} value={form.category} onChange={(e) => patchForm({ category: e.target.value })} /></label>
                  <label className="grid gap-1 text-sm">位置<Input disabled={!canManage} value={form.location} onChange={(e) => patchForm({ location: e.target.value })} /></label>
                  <label className="grid gap-1 text-sm">负责人<Input disabled={!canManage} value={form.manager} onChange={(e) => patchForm({ manager: e.target.value })} /></label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.allow_reservation} disabled={!canManage || form.status !== 'available'} onChange={(e) => patchForm({ allow_reservation: e.target.checked })} />
                    允许预约
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.return_require_note} disabled={!canManage} onChange={(e) => patchForm({ return_require_note: e.target.checked })} />
                    归还说明必填
                  </label>
                  <label className="grid gap-1 text-sm sm:col-span-2">
                    归还规则
                    <select disabled={!canManage} className="h-10 rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60" value={form.return_mode} onChange={(e) => patchForm({ return_mode: e.target.value })}>
                      <option value="confirm_only">确认归还（正常无需图片）</option>
                      <option value="image_optional">图片选传（异常必传）</option>
                      <option value="image_required">图片必传（正常也留档）</option>
                    </select>
                  </label>
                </div>

                <label className="grid gap-1 text-sm">
                  说明
                  <textarea disabled={!canManage} className="min-h-20 rounded-md border border-input bg-card px-3 py-2 text-sm disabled:opacity-60" value={form.description} onChange={(e) => patchForm({ description: e.target.value })} />
                </label>
                <label className="grid gap-1 text-sm">
                  使用须知
                  <textarea disabled={!canManage} className="min-h-20 rounded-md border border-input bg-card px-3 py-2 text-sm disabled:opacity-60" value={form.usage_notice} onChange={(e) => patchForm({ usage_notice: e.target.value })} />
                </label>

                <label className="grid gap-1 text-sm">
                  封面
                  <Input disabled={!canManage} value={form.cover_photo} onChange={(e) => patchForm({ cover_photo: e.target.value })} placeholder="图片地址" />
                  <span className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-dashed px-3 py-3 text-xs text-muted-foreground">
                    <ImagePlus className="h-4 w-4" /> 上传封面
                    <input disabled={!canManage} className="sr-only" type="file" accept="image/*" onChange={(e) => handleUpload(e.target.files?.[0])} />
                  </span>
                  {form.cover_photo ? <img src={form.cover_photo} alt="设备封面预览" className="h-32 w-full rounded-2xl object-cover" /> : null}
                </label>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">允许预约时段</span>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={!canManage} onClick={() => patchForm({ reservation_slot_keys: slotOptions.map((s) => s.key) })}>全选</Button>
                      <Button type="button" size="sm" variant="ghost" disabled={!canManage} onClick={() => patchForm({ reservation_slot_keys: [] })}>默认</Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {slotOptions.map((slot) => {
                      const selected = form.reservation_slot_keys.includes(slot.key);
                      return (
                        <button
                          key={slot.key}
                          type="button"
                          className={`rounded-full border p-0 transition ${selected ? 'border-primary bg-primary/10' : 'border-transparent bg-transparent hover:bg-muted'} disabled:cursor-not-allowed disabled:opacity-60`}
                          disabled={!canManage}
                          onClick={() => toggleSlot(slot.key)}
                          title={slotLabel(slot)}
                        >
                          <OpsTimeBlock compact label={slotDisplayName(slot.key, slot.label)} subLabel={selected ? '已选' : undefined} title={slotLabel(slot)} />
                        </button>
                      );
                    })}
                    {!slotOptions.length ? <span className="text-xs text-muted-foreground">暂无时段</span> : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={!canManage || busy}>{busy ? '保存中…' : editingId ? '保存修改' : '添加设备'}</Button>
                  <Button type="button" variant="outline" disabled={!canManage} onClick={resetForm}>重置</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </aside>
        ) : null}
      </div>
    </div>
  );
}



