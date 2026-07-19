import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, Archive, Boxes, CheckCircle2, Edit3, ImagePlus, Search, ShieldAlert, Wrench } from 'lucide-react';
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
import { compactTimeRange, fullDateTimeRange, slotDisplayName, tinyTimeRange } from '@/lib/time-format';
import { briefDateTime } from '@/lib/time-format';
import { OpsBadge, OpsDataToolbar, OpsDetailDrawer, OpsEmptyState, OpsMetricCard, OpsPageHeader, OpsPermissionHint, OpsSectionHeader, OpsTimeBlock } from '@/components/ops/design-system';
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
const DEVICE_PAGE_SIZE = 9;

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
          <article key={String(row.id ?? index)} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-primary">归还档案</p>
                <h3 className="mt-1 truncate text-sm font-semibold" title={valueText(row.return_archive_folder, '')}>{valueText(row.return_archive_folder, '未生成文件夹')}</h3>
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
  const [formOpen, setFormOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'records' | 'archive' | 'faults'>('overview');
  const [page, setPage] = useState(1);
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
  const totalPages = Math.max(1, Math.ceil(filteredList.length / DEVICE_PAGE_SIZE));
  const visibleList = filteredList.slice((page - 1) * DEVICE_PAGE_SIZE, page * DEVICE_PAGE_SIZE);

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

  useEffect(() => {
    setPage(1);
  }, [keyword, statusFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function patchForm(patch: Partial<DeviceForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function resetForm() {
    setEditingId('');
    setForm(EMPTY_FORM);
  }

  function editDevice(device: AdminDevice) {
    setEditingId(device.id);
    setDetailId('');
    setDetailTab('overview');
    setFormOpen(true);
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
        setFormOpen(false);
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
      <OpsPageHeader title="设备台账" className="ops-page-header--compact">
        {canManage ? <Button size="sm" onClick={() => { resetForm(); setFormOpen(true); }}>新增设备</Button> : null}
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

      <div className="grid gap-4">
        <div className="grid gap-4">
          <Card className="ops-card">
            <CardContent className="p-4">
              <OpsDataToolbar
                title="设备队列"
                description="按状态或关键词快速定位设备。"
                meta={<>显示 {filteredList.length} / {list.length} 台 · 第 {page}/{totalPages} 页</>}
                filters={
                  <>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input className="w-64 pl-9" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索编号、名称、位置" clearable />
                    </div>
                    <div className="ops-segment-group flex flex-wrap gap-1">
                      {[
                        { key: '', label: '全部' },
                        { key: 'available', label: '可预约' },
                        { key: 'in_use', label: '使用中' },
                        { key: 'abnormal', label: '异常/停用' }
                      ].map((item) => (
                        <Button key={item.key || 'all'} size="sm" variant={statusFilter === item.key ? 'default' : 'outline'} onClick={() => setStatusFilter(item.key)}>{item.label}</Button>
                      ))}
                    </div>
                  </>
                }
              />

              <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                {visibleList.map((device) => (
                  <article
                    key={device.id}
                    className={[
                      'rounded-2xl border p-3 transition hover:-translate-y-0.5 hover:shadow-md',
                      detailId === device.id ? 'border-primary bg-primary/5' : 'border-input bg-card/80 hover:border-primary/40'
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-bold text-foreground">{device.name}</p>
                        <p className="mt-1 font-mono text-xs font-semibold text-primary">{device.device_code}</p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <span className={`badge-pill badge-${STATUS_TONE[device.status] ?? 'muted'}`}>{STATUS_LABEL[device.status] ?? device.status}</span>
                        {device.allow_reservation === false ? <span className="badge-pill badge-warn">暂停预约</span> : null}
                      </div>
                    </div>
                    <p className="mt-2 truncate text-xs text-muted-foreground">{device.category || '未分类'} · {device.location || '未知位置'}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-xl bg-muted/40 px-3 py-2"><p className="text-muted-foreground">负责人</p><p className="mt-1 truncate font-semibold text-foreground">{device.manager || '未指定'}</p></div>
                      <div className="rounded-xl bg-muted/40 px-3 py-2"><p className="text-muted-foreground">时段</p><p className="mt-1 truncate font-semibold text-foreground">{slotTotal(device) || '默认'}</p></div>
                      <div className="rounded-xl bg-muted/40 px-3 py-2"><p className="text-muted-foreground">归还</p><p className="mt-1 truncate font-semibold text-foreground">{RETURN_MODE_LABEL[String(device.return_mode || 'image_required')] ?? '图片必传'}</p></div>
                    </div>
                    <div className="mt-3 grid gap-1.5 rounded-xl border bg-muted/20 px-3 py-2 text-xs sm:grid-cols-2">
                      <p className="truncate text-muted-foreground">当前：<strong className="text-foreground">{device.current_borrow ? valueText(device.current_borrow.user_name) : '无人使用'}</strong></p>
                      <p className="truncate text-muted-foreground" title={device.next_reservation ? fullDateTimeRange(String(device.next_reservation.start_time || ''), String(device.next_reservation.end_time || '')) : ''}>下次：<strong className="text-foreground">{device.next_reservation ? `${tinyTimeRange(String(device.next_reservation.start_time || ''), String(device.next_reservation.end_time || ''))} · ${valueText(device.next_reservation.user_name)}` : '暂无预约'}</strong></p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canManage ? <Button size="sm" variant="outline" onClick={() => editDevice(device)}><Edit3 className="h-4 w-4" /> 编辑</Button> : null}
                      <Button size="sm" variant="outline" onClick={() => {
                        if (detailId === device.id) setDetailId('');
                        else { setDetailId(device.id); setDetailTab('overview'); }
                      }}>
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
              {filteredList.length > DEVICE_PAGE_SIZE ? (
                <div className="mt-4 flex items-center justify-end gap-2 border-t pt-4">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</Button>
                  <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</Button>
                </div>
              ) : null}
              {isLoading ? <p className="py-6 text-center text-muted-foreground">加载中…</p> : null}
              {error ? <p className="py-6 text-center text-destructive">加载失败：{toFriendlyError(error)}</p> : null}
              {!isLoading && !error && filteredList.length === 0 ? <OpsEmptyState title="暂无匹配设备" description="可清空筛选条件，或检查设备编号、分类、位置是否录入准确。" /> : null}
            </CardContent>
          </Card>

          <OpsDetailDrawer
            open={Boolean(detailId) && !formOpen}
            title={detail.data?.device ? `${detail.data.device.device_code} ${detail.data.device.name}` : '设备详情'}
            subtitle="状态、预约、使用与故障记录"
            onClose={() => setDetailId('')}
            className="max-w-4xl"
          >
              <div className="grid gap-4">
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

                    <div className="ops-segment-group flex flex-wrap gap-1">
                      {([
                        ['overview', '概况'], ['records', '预约/使用'], ['archive', '归还档案'], ['faults', '故障']
                      ] as const).map(([key, label]) => (
                        <Button key={key} size="sm" variant={detailTab === key ? 'default' : 'outline'} onClick={() => setDetailTab(key)}>{label}</Button>
                      ))}
                    </div>

                    {detailTab === 'overview' ? (
                      <div className="grid gap-3 md:grid-cols-4">
                        <div className="ops-stat-card p-3"><p className="text-xs text-muted-foreground">位置</p><strong>{detail.data.device.location ?? '—'}</strong></div>
                        <div className="ops-stat-card p-3"><p className="text-xs text-muted-foreground">负责人</p><strong>{detail.data.device.manager ?? '—'}</strong></div>
                        <div className="ops-stat-card p-3"><p className="text-xs text-muted-foreground">当前阶段</p><strong>{lifecycleStage(detail.data.device.status)}</strong></div>
                        <div className="ops-stat-card p-3"><p className="text-xs text-muted-foreground">归还规则</p><strong>{RETURN_MODE_LABEL[String(detail.data.device.return_mode || 'image_required')] ?? '图片必传'}{detail.data.device.return_require_note ? ' · 说明必填' : ''}</strong></div>
                      </div>
                    ) : null}
                    {detailTab === 'records' ? (
                      <div className="grid gap-4 xl:grid-cols-2">
                        <section className="grid gap-2"><OpsSectionHeader title="预约记录" /><DetailRows rows={detail.data.reservations} columns={[{ key: 'user_name', label: '用户' }, { key: 'start_time', label: '开始', time: true }, { key: 'end_time', label: '结束', time: true }, { key: 'status', label: '状态' }]} /></section>
                        <section className="grid gap-2"><OpsSectionHeader title="使用历史" /><DetailRows rows={detail.data.borrows} columns={[{ key: 'user_name', label: '用户' }, { key: 'borrow_time', label: '借用', time: true }, { key: 'return_time', label: '归还', time: true }, { key: 'status', label: '状态' }]} /></section>
                      </div>
                    ) : null}
                    {detailTab === 'archive' ? (
                      <section className="grid gap-2">
                        <OpsSectionHeader title="归还图片档案" action={<Archive className="h-4 w-4 text-primary" />} />
                        {canViewReturnArchive && detail.data.can_view_return_archive !== false ? <BorrowArchiveRows rows={detail.data.borrows} /> : <OpsPermissionHint title="归还档案受保护">当前账号没有归还档案查看权限。</OpsPermissionHint>}
                      </section>
                    ) : null}
                    {detailTab === 'faults' ? (
                      <section className="grid gap-2"><OpsSectionHeader title="故障历史" /><DetailRows rows={detail.data.fault_reports} columns={[{ key: 'user_name', label: '报告人' }, { key: 'issue_type', label: '类型' }, { key: 'status', label: '状态' }, { key: 'created_at', label: '时间', time: true }]} /></section>
                    ) : null}
                  </>
                ) : null}
              </div>
          </OpsDetailDrawer>
        </div>

        <OpsDetailDrawer
          open={canManage && formOpen}
          title={editingId ? '编辑设备' : '新增设备'}
          subtitle="设备信息、归还规则与预约时段"
          onClose={() => { setFormOpen(false); resetForm(); }}
        >
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

                <details className="equipment-optional-section rounded-xl border">
                  <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold">说明、须知与封面 <span>选填</span></summary>
                  <div className="grid gap-3 border-t p-3">
                    <label className="grid gap-1 text-sm">
                      设备说明
                      <textarea disabled={!canManage} className="min-h-20 rounded-md border border-input bg-card px-3 py-2 text-sm disabled:opacity-60" value={form.description} onChange={(e) => patchForm({ description: e.target.value })} />
                    </label>
                    <label className="grid gap-1 text-sm">
                      使用须知
                      <textarea disabled={!canManage} className="min-h-20 rounded-md border border-input bg-card px-3 py-2 text-sm disabled:opacity-60" value={form.usage_notice} onChange={(e) => patchForm({ usage_notice: e.target.value })} />
                    </label>
                    <label className="grid gap-1 text-sm">
                      设备封面
                      <Input disabled={!canManage} value={form.cover_photo} onChange={(e) => patchForm({ cover_photo: e.target.value })} placeholder="图片地址" />
                      <span className="ops-upload-zone text-xs">
                        <ImagePlus className="h-4 w-4" /> 上传封面
                        <input disabled={!canManage} className="sr-only" type="file" accept="image/*" onChange={(e) => handleUpload(e.target.files?.[0])} />
                      </span>
                      {form.cover_photo ? <img src={form.cover_photo} alt="设备封面预览" className="h-28 w-full rounded-xl object-cover" /> : null}
                    </label>
                  </div>
                </details>

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
        </OpsDetailDrawer>
      </div>
    </div>
  );
}
