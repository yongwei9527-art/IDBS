import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, Clock3, Info, Search, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useActionDialog } from '@/components/ui/action-dialog';
import { slotDisplayName, tinyTimeRange } from '@/lib/time-format';
import { createReservation, precheckReservation, type ReservationPlanGroup } from './reservation-api';
import { listDevices, listReservationSlots, type Device, type ReservationSlotOption } from '../devices/device-api';
import { toFriendlyError } from '@/lib/friendly-error';
import { OpsPageHeader } from '@/components/ops/design-system';

const DISABLED_STATUS = new Set(['maintenance', 'disabled', 'abnormal_pending']);

const STATUS_LABEL: Record<string, string> = {
  available: '可预约',
  in_use: '使用中',
  reserved: '已预约',
  maintenance: '维护中',
  disabled: '已停用',
  abnormal_pending: '异常待处理'
};

const SLOT_TONES: Record<string, { dot: string; bg: string; border: string; text: string; name: string }> = {
  morning: { dot: 'bg-sky-500', bg: 'bg-sky-500/10', border: 'border-sky-400/60', text: 'text-sky-700 dark:text-sky-300', name: '上午' },
  afternoon: { dot: 'bg-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-400/60', text: 'text-amber-700 dark:text-amber-300', name: '下午' },
  evening: { dot: 'bg-violet-500', bg: 'bg-violet-500/10', border: 'border-violet-400/60', text: 'text-violet-700 dark:text-violet-300', name: '晚上' },
  night: { dot: 'bg-slate-700', bg: 'bg-slate-500/10', border: 'border-slate-400/60', text: 'text-slate-700 dark:text-slate-300', name: '夜间' },
  daytime: { dot: 'bg-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-400/60', text: 'text-emerald-700 dark:text-emerald-300', name: '白天' },
  default: { dot: 'bg-primary', bg: 'bg-primary/10', border: 'border-primary/50', text: 'text-primary', name: '时段' }
};

function nextDateString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function isDeviceReservable(device: Device) {
  return device.allow_reservation !== false && !DISABLED_STATUS.has(device.status);
}

function slotKey(slot: ReservationSlotOption) {
  return slot.key || String(slot.slot_key ?? '');
}

function slotLabel(slot: ReservationSlotOption) {
  const key = slotKey(slot);
  const name = slotDisplayName(key, slot.label);
  const start = slot.start ?? slot.start_time ?? '';
  const end = slot.end ?? slot.end_time ?? '';
  const range = start && end ? `（${tinyTimeRange(start, end, { crossesNextDay: Boolean(slot.crosses_midnight) })}）` : '';
  return `${name}${range}`;
}

function slotTime(slot: ReservationSlotOption) {
  const start = slot.start ?? slot.start_time ?? '';
  const end = slot.end ?? slot.end_time ?? '';
  return start && end ? tinyTimeRange(start, end, { crossesNextDay: Boolean(slot.crosses_midnight) }) : '';
}

function slotTone(slotOrKey: ReservationSlotOption | string) {
  const key = typeof slotOrKey === 'string' ? slotOrKey : slotKey(slotOrKey);
  return SLOT_TONES[key] ?? SLOT_TONES.default;
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((x) => x !== value) : [...values, value];
}

export function ReservePage() {
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(window.location.search);
  const initialDevice = (searchParams.get('device') || searchParams.get('device_code') || searchParams.get('code') || '').trim();
  const [selectedCodes, setSelectedCodes] = useState<string[]>(initialDevice ? [initialDevice] : []);
  const [activeStep, setActiveStep] = useState<1 | 2>(initialDevice ? 2 : 1);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [dateInput, setDateInput] = useState(nextDateString());
  const [selectedSlotKeys, setSelectedSlotKeys] = useState<string[]>([]);
  const [purpose, setPurpose] = useState('');
  const [search, setSearch] = useState('');
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [acknowledgedNotices, setAcknowledgedNotices] = useState<string[]>([]);
  const { confirm, ActionDialog } = useActionDialog();

  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: listDevices });
  const slotsQuery = useQuery({
    queryKey: ['reservation-slots', selectedCodes.join(',')],
    queryFn: () => listReservationSlots(selectedCodes)
  });

  const devices = devicesQuery.data ?? [];
  const slots = slotsQuery.data ?? [];

  const filteredDevices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) =>
      [d.name, d.device_code, d.category, d.location].some((x) => String(x ?? '').toLowerCase().includes(q))
    );
  }, [devices, search]);

  const selectedDevices = useMemo(
    () => selectedCodes.map((code) => devices.find((d) => d.device_code === code)).filter(Boolean) as Device[],
    [devices, selectedCodes]
  );

  const availableSlotKeys = useMemo(() => slots.map(slotKey).filter(Boolean), [slots]);
  const selectedSlotLabels = slots.filter((slot) => selectedSlotKeys.includes(slotKey(slot))).map(slotLabel);
  const totalItems = selectedCodes.length * selectedDates.length * selectedSlotKeys.length;

  function showUsageNotice(device: Device) {
    const notice = String(device.usage_notice || '').trim();
    if (!notice) return;
    void confirm({
      title: `${device.name} 使用注意事项`,
      description: <div className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{notice}</div>,
      confirmText: '我已了解',
      cancelText: '关闭',
      tone: 'warning'
    });
  }

  function toggleDevice(device: Device) {
    if (!isDeviceReservable(device)) return;
    const isAdding = !selectedCodes.includes(device.device_code);
    setSelectedCodes((values) => toggleValue(values, device.device_code));
    setSelectedSlotKeys([]);
    if (isAdding && String(device.usage_notice || '').trim() && !acknowledgedNotices.includes(device.device_code)) {
      setAcknowledgedNotices((values) => [...values, device.device_code]);
      showUsageNotice(device);
    }
  }

  function continueToSchedule() {
    if (!selectedCodes.length) {
      toast.error('请至少选择一台设备');
      return;
    }
    setDevicePickerOpen(false);
    setActiveStep(2);
    window.scrollTo({ top: 0 });
  }

  function returnToDeviceSelection() {
    setActiveStep(1);
    window.scrollTo({ top: 0 });
  }

  function addDate() {
    if (!dateInput) return;
    setSelectedDates((values) => (values.includes(dateInput) ? values : [...values, dateInput].sort()));
  }

  function removeDate(date: string) {
    setSelectedDates((values) => values.filter((x) => x !== date));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!selectedCodes.length || !selectedDates.length || !selectedSlotKeys.length) {
      toast.error('请先选择设备、日期和时段');
      return;
    }

    const group: ReservationPlanGroup = {
      device_codes: selectedCodes,
      reservation_dates: [...selectedDates].sort(),
      slot_keys: selectedSlotKeys
    };
    const payload = {
      device_codes: group.device_codes,
      reservation_dates: group.reservation_dates,
      slot_keys: group.slot_keys,
      reservation_groups: [group],
      purpose: purpose.trim()
    };

    setLoading(true);
    try {
      const check = await precheckReservation(payload);
      if (check.ok === false || (check.conflicts?.length ?? 0) > 0) {
        const conflict = check.conflicts?.[0] as { reason?: string } | undefined;
        throw new Error(conflict?.reason || '所选设备、日期或时段存在冲突，请调整后再提交');
      }
      await createReservation(payload);
      toast.success('预约已提交，等待管理员审核');
      navigate({ to: '/me/reservations' } as any);
    } catch (err) {
      toast.error(`预约失败：${toFriendlyError(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="ops-page-stack mx-auto max-w-6xl">
      <ActionDialog />
      <OpsPageHeader
        title="预约设备"
      />

      <ol className="grid grid-cols-3 overflow-hidden rounded-lg border border-border/60 bg-card text-center text-xs" aria-label={'\u9884\u7ea6\u6d41\u7a0b'}>
        {[['1', '\u9009\u8bbe\u5907'], ['2', '\u9009\u65e5\u671f'], ['3', '\u63d0\u4ea4\u9884\u7ea6']].map(([step, label]) => (
          <li key={step} className="flex min-h-10 items-center justify-center gap-1.5 border-r border-border/60 px-2 last:border-r-0">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{step}</span>
            <span className="truncate font-medium">{label}</span>
          </li>
        ))}
      </ol>
      <div className="rounded-lg border border-amber-300/50 bg-amber-50/70 px-4 py-3 text-sm text-amber-950 dark:border-amber-400/25 dark:bg-amber-950/20 dark:text-amber-100">
        <p className="font-semibold">预约提醒</p>
        <p className="mt-1 text-xs leading-5">开始前 1 天可自行取消；当天取消需管理员审批。预约开始前 30 分钟会提醒；近 90 天累计 2 次爽约将暂停新预约。</p>
      </div>

      {activeStep === 1 ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_20rem]">
          <Card className="ops-card rounded-xl border-border/60 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Tag className="h-4 w-4 text-primary" /> 选择设备
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setDevicePickerOpen(true);
                  }}
                  onFocus={() => setDevicePickerOpen(true)}
                  onBlur={() => window.setTimeout(() => setDevicePickerOpen(false), 120)}
                  placeholder="输入设备名称、编号、分类或位置"
                  prefix={<Search className="h-4 w-4" />}
                  clearable
                  role="combobox"
                  aria-expanded={devicePickerOpen}
                  aria-controls="reservation-device-options"
                  aria-autocomplete="list"
                />
                {devicePickerOpen ? (
                  <div id="reservation-device-options" role="listbox" aria-multiselectable="true" className="absolute z-30 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl">
                    {filteredDevices.map((device) => {
                      const selected = selectedCodes.includes(device.device_code);
                      const reservable = isDeviceReservable(device);
                      return (
                        <button
                          key={device.id || device.device_code}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={!reservable}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => toggleDevice(device)}
                          className={[
                            'flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                            selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/70',
                            !reservable ? 'cursor-not-allowed opacity-50' : ''
                          ].join(' ')}
                        >
                          <span className={['grid h-5 w-5 shrink-0 place-items-center rounded border', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background'].join(' ')} aria-hidden="true">
                            {selected ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{device.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              <span className="font-mono">{device.device_code}</span>
                              {device.category ? ` · ${device.category}` : ''}
                              {device.location ? ` · ${device.location}` : ''}
                            </span>
                          </span>
                          <span className="badge-pill badge-info shrink-0">{STATUS_LABEL[device.status] ?? device.status}</span>
                        </button>
                      );
                    })}
                    {devicesQuery.isLoading ? <p className="px-3 py-5 text-center text-sm text-muted-foreground">设备加载中…</p> : null}
                    {devicesQuery.error ? <p className="px-3 py-5 text-center text-sm text-destructive">设备加载失败：{toFriendlyError(devicesQuery.error)}</p> : null}
                    {!devicesQuery.isLoading && !devicesQuery.error && filteredDevices.length === 0 ? <p className="px-3 py-5 text-center text-sm text-muted-foreground">没有找到匹配设备</p> : null}
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">已选设备</p>
                  <span className="text-xs text-muted-foreground">{selectedCodes.length} 台</span>
                </div>
                {selectedCodes.length ? (
                  <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
                    {selectedCodes.map((code) => {
                      const device = devices.find((item) => item.device_code === code);
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => device ? toggleDevice(device) : setSelectedCodes((values) => values.filter((value) => value !== code))}
                          className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-left text-sm text-primary"
                          title="点击移除"
                        >
                          <span className="truncate font-medium">{device?.name || code}</span>
                          <span className="shrink-0 font-mono text-xs opacity-75">{device ? device.device_code : ''}</span>
                          <span className="shrink-0 text-base" aria-hidden="true">×</span>
                        </button>
                      );
                    })}
                  </div>
                ) : <p className="mt-3 text-sm text-muted-foreground">在上方输入并从下拉列表勾选，可同时预约多台设备。</p>}
              </div>
            </CardContent>
          </Card>

          <aside className="xl:sticky xl:top-4 xl:self-start">
            <Card className="ops-card rounded-xl border-border/60 shadow-none">
              <CardHeader className="pb-3"><CardTitle className="text-base">确认设备</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6 text-muted-foreground">设备选齐后确认，下一步只显示日期和时段选择，不会继续向下展开设备列表。</p>
                {selectedDevices.length ? (
                  <div className="space-y-2">
                    {selectedDevices.map((device) => (
                      <div key={device.device_code} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{device.name}</p>
                            <p className="mt-1 font-mono text-xs text-muted-foreground">{device.device_code}</p>
                          </div>
                          {String(device.usage_notice || '').trim() ? (
                            <Button type="button" size="sm" variant="ghost" onClick={() => showUsageNotice(device)} aria-label={`查看 ${device.name} 使用注意事项`}><Info className="h-4 w-4" /></Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <Button type="button" className="min-h-11 w-full" disabled={!selectedCodes.length} onClick={continueToSchedule}>确认设备，选择时间</Button>
              </CardContent>
            </Card>
          </aside>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_20rem]">
          <div className="flex flex-col gap-4">
            <Card className="ops-card rounded-xl border-border/60 shadow-none">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground">已确认设备 · {selectedCodes.length} 台</p>
                  <p className="mt-1 truncate text-sm font-medium">{selectedDevices.map((device) => `${device.name}（${device.device_code}）`).join('、') || selectedCodes.join('、')}</p>
                </div>
                <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={returnToDeviceSelection}>修改设备</Button>
              </CardContent>
            </Card>

            <Card className="ops-card rounded-xl border-border/60 shadow-none">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4 text-primary" /> 选择日期</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input type="date" min={nextDateString()} value={dateInput} onChange={(event) => setDateInput(event.target.value)} />
                  <Button type="button" variant="outline" className="min-h-11" onClick={addDate}>添加日期</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedDates.map((date) => (
                    <button key={date} type="button" onClick={() => removeDate(date)} className="min-h-11 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary" title="点击移除">{date} ×</button>
                  ))}
                  {!selectedDates.length ? <span className="text-sm text-muted-foreground">未选择日期</span> : null}
                </div>
              </CardContent>
            </Card>

            <Card className="ops-card rounded-xl border-border/60 shadow-none">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-primary" /> 选择时段</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={!availableSlotKeys.length} onClick={() => setSelectedSlotKeys(availableSlotKeys)}>全选</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedSlotKeys([])}>清空</Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {slots.map((slot) => {
                    const key = slotKey(slot);
                    const checked = selectedSlotKeys.includes(key);
                    const tone = slotTone(slot);
                    const compactLabel = slotDisplayName(key, slot.label) || tone.name;
                    const timeText = slotTime(slot);
                    return (
                      <label key={key} className={['group flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm transition-colors', checked ? `${tone.border} ${tone.bg} ${tone.text} ring-1 ring-current/20` : 'border-border/60 bg-card hover:border-primary/50'].join(' ')} title={slotLabel(slot)} aria-label={slotLabel(slot)}>
                        <input type="checkbox" className="h-4 w-4 accent-primary" checked={checked} onChange={() => setSelectedSlotKeys((values) => toggleValue(values, key))} />
                        <span className={`h-7 w-7 shrink-0 rounded-lg ${tone.dot} shadow-sm`} aria-hidden="true" />
                        <span className="min-w-0"><span className="block truncate font-semibold">{compactLabel}</span>{timeText ? <span className="block whitespace-nowrap text-[11px] opacity-75">{timeText}</span> : null}</span>
                      </label>
                    );
                  })}
                </div>
                {slotsQuery.isLoading ? <p className="text-sm text-muted-foreground">时段加载中…</p> : null}
                {slotsQuery.error ? <p className="text-sm text-destructive">时段加载失败：{toFriendlyError(slotsQuery.error)}</p> : null}
                {!slotsQuery.isLoading && !slotsQuery.error && slots.length === 0 ? <p className="text-sm text-muted-foreground">暂无可选时段</p> : null}
              </CardContent>
            </Card>
          </div>

          <aside className="flex flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
            <Card className="ops-card rounded-xl border-border/60 shadow-none">
              <CardHeader className="pb-3"><CardTitle className="text-base">预约预览</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div><p className="text-xs font-semibold text-muted-foreground">设备</p><p className="mt-1 text-sm">{selectedDevices.map((device) => `${device.name}（${device.device_code}）`).join('、') || selectedCodes.join('、')}</p></div>
                <div><p className="text-xs font-semibold text-muted-foreground">日期</p><p className="mt-1 text-sm">{selectedDates.length ? selectedDates.join('、') : '未选择'}</p></div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">时段</p>
                  {selectedSlotLabels.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {slots.filter((slot) => selectedSlotKeys.includes(slotKey(slot))).map((slot) => {
                        const tone = slotTone(slot);
                        return <span key={slotKey(slot)} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${tone.border} ${tone.bg} ${tone.text}`} title={slotLabel(slot)}><span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />{slotDisplayName(slotKey(slot), slot.label) || tone.name}</span>;
                      })}
                    </div>
                  ) : <p className="mt-1 text-sm">未选择</p>}
                </div>
                <div className="rounded-lg bg-muted/60 p-4"><p className="text-xs text-muted-foreground">预约明细</p><p className="mt-1 text-2xl font-bold">{totalItems}</p><p className="text-xs text-muted-foreground">设备 × 日期 × 时段</p></div>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">用途说明</span>
                  <textarea className="min-h-24 rounded-md border border-input bg-card px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="预约用途" />
                </label>
                <Button type="submit" className="min-h-11 w-full" disabled={loading || totalItems === 0}>{loading ? '提交中…' : '提交预约'}</Button>
              </CardContent>
            </Card>
          </aside>
        </div>
      )}
    </form>
  );
}
