import { useNavigate } from '@tanstack/react-router';
import { CalendarDays, Grid2X2, List, MessageSquare, RotateCcw, Search, Tag } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listDevices, type Device } from './device-api';
import { buildChatSearch } from '@/features/chat/chat-context';
import { shortDate, compactTimeRange, tinyTimeRange } from '@/lib/time-format';
import { OpsBadge, OpsDataToolbar, OpsEmptyState, OpsPageHeader, OpsRiskBadge, OpsTimeBlock } from '@/components/ops/design-system';
import { toFriendlyError } from '@/lib/friendly-error';

const STATUS_LABEL: Record<string, string> = {
  available: '可预约',
  in_use: '使用中',
  reserved: '已预约',
  maintenance: '维护中',
  disabled: '已停用',
  abnormal_pending: '异常待处理'
};
const STATUS_TONE: Record<string, string> = {
  available: 'success',
  in_use: 'info',
  reserved: 'warn',
  maintenance: 'danger',
  disabled: 'muted',
  abnormal_pending: 'danger'
};

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'available', label: '可预约' },
  { value: 'in_use', label: '使用中' },
  { value: 'reserved', label: '已预约' },
  { value: 'maintenance', label: '维护中' },
  { value: 'disabled', label: '已停用' },
  { value: 'abnormal_pending', label: '异常待处理' }
];

const AVAILABILITY_OPTIONS = [
  { value: '', label: '全部设备' },
  { value: 'reservable', label: '当前可预约' },
  { value: 'today_free', label: '今日无占用' },
  { value: 'week_free', label: '本周有空档' },
  { value: 'fault', label: '故障/维护/停用' }
];

const QUICK_FILTERS = [
  { label: '全部', status: '', availability: '' },
  { label: '可预约', status: 'available', availability: '' },
  { label: '使用中', status: 'in_use', availability: '' },
  { label: '维修中', status: 'maintenance', availability: '' },
  { label: '异常/停用', status: '', availability: 'fault' }
];

type DeviceView = 'card' | 'table';

interface DeviceFilters {
  keyword: string;
  status: string;
  category: string;
  availability: string;
}

function initialFilters(): DeviceFilters {
  if (typeof window === 'undefined') return { keyword: '', status: '', category: '', availability: '' };
  const params = new URLSearchParams(window.location.search);
  return {
    keyword: params.get('keyword') || '',
    status: params.get('status') || '',
    category: params.get('category') || '',
    availability: params.get('availability') || ''
  };
}

function initialView(): DeviceView {
  if (typeof window === 'undefined') return 'card';
  return window.localStorage.getItem('IDBS_DEVICE_VIEW') === 'table' ? 'table' : 'card';
}

function formatTime(value?: string | null) {
  if (!value) return '';
  return shortDate(value) + ' ' + compactTimeRange(value, null);
}

function isSameLocalDate(value?: string | null, date = new Date()) {
  if (!value) return false;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return false;
  return target.toLocaleDateString('zh-CN') === date.toLocaleDateString('zh-CN');
}

function isWithinDays(value: string | null | undefined, days: number) {
  if (!value) return false;
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return false;
  const start = Date.now();
  const end = start + days * 24 * 60 * 60 * 1000;
  return target >= start && target <= end;
}

function nextUseText(device: Device) {
  if (device.next_reservation?.start_time) return formatTime(device.next_reservation.start_time);
  if (device.status === 'available') return '当前可预约';
  if (device.status === 'maintenance') return '维护后开放';
  if (device.status === 'disabled') return '已停用';
  if (device.status === 'abnormal_pending') return '异常待处理';
  return '暂无排期';
}

function lifecycleLabel(status?: string) {
  if (status === 'maintenance') return '维护';
  if (status === 'abnormal_pending') return '异常';
  if (status === 'disabled') return '停用';
  if (status === 'in_use') return '使用';
  if (status === 'reserved') return '已约';
  return '可约';
}

function riskLevel(device: Device): 'low' | 'medium' | 'high' | 'critical' {
  if (device.status === 'disabled' || device.status === 'abnormal_pending') return 'critical';
  if (device.status === 'maintenance') return 'high';
  if (device.allow_reservation === false || device.status === 'in_use') return 'medium';
  return 'low';
}

function riskText(device: Device) {
  if (device.status === 'disabled') return '停用';
  if (device.status === 'abnormal_pending') return '异常';
  if (device.status === 'maintenance') return '维护';
  if (device.allow_reservation === false) return '暂停';
  if (device.status === 'in_use') return '使用中';
  return '正常';
}

function slotLabel(slot: NonNullable<Device['reservation_slot_options']>[number]) {
  const start = slot.start ?? slot.start_time;
  const end = slot.end ?? slot.end_time;
  const label = slot.label || slot.key || '时段';
  return start && end ? compactTimeRange(String(start), String(end)) : label;
}

function DeviceSlotBlocks({ device }: { device: Device }) {
  const slots = device.reservation_slot_options ?? [];
  const keys = device.reservation_slot_keys ?? [];
  if (slots.length) {
    return <div className="flex flex-wrap gap-1.5">{slots.slice(0, 4).map((slot) => <OpsTimeBlock key={slot.key} compact label={slot.label || slot.key} title={slotLabel(slot)} />)}{slots.length > 4 ? <span className="rounded-full bg-muted px-2 py-1 text-xs font-black text-primary">+{slots.length - 4}</span> : null}</div>;
  }
  if (keys.length) return <div className="flex flex-wrap gap-1.5">{keys.slice(0, 4).map((key) => <OpsTimeBlock key={key} compact label={key} title={key} />)}{keys.length > 4 ? <span className="rounded-full bg-muted px-2 py-1 text-xs font-black text-primary">+{keys.length - 4}</span> : null}</div>;
  return <span className="text-xs font-semibold text-muted-foreground">系统默认时段</span>;
}

function NextUseBlock({ device, compact = false }: { device: Device; compact?: boolean }) {
  const reservation = device.next_reservation;
  if (reservation?.start_time) {
    const label = tinyTimeRange(String(reservation.start_time), String(reservation.end_time || ''));
    const date = shortDate(reservation.start_time);
    return <OpsTimeBlock compact={compact} label={label} subLabel={compact ? undefined : date} title={date + ' ' + compactTimeRange(String(reservation.start_time), String(reservation.end_time || ''))} />;
  }
  const text = nextUseText(device);
  return <span className={compact ? 'text-xs font-semibold text-muted-foreground' : 'font-bold text-primary'}>{text}</span>;
}

function matchesAvailability(device: Device, mode: string) {
  if (!mode) return true;
  if (mode === 'reservable') return device.allow_reservation !== false && device.status === 'available';
  if (mode === 'today_free') return device.status === 'available' && !isSameLocalDate(device.next_reservation?.start_time);
  if (mode === 'week_free') return device.status === 'available' && !isWithinDays(device.next_reservation?.start_time, 7);
  if (mode === 'fault') return ['maintenance', 'abnormal_pending', 'disabled'].includes(device.status);
  return true;
}

function filterDevices(devices: Device[], filters: DeviceFilters) {
  const keyword = filters.keyword.trim().toLowerCase();
  return devices.filter((device) => {
    const searchable = [device.device_code, device.name, device.location, device.manager, device.category]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');
    if (keyword && !searchable.includes(keyword)) return false;
    if (filters.status && device.status !== filters.status) return false;
    if (filters.category && device.category !== filters.category) return false;
    return matchesAvailability(device, filters.availability);
  });
}


function DeviceActions({ device, compact = false }: { device: Device; compact?: boolean }) {
  const nav = useNavigate();
  const canReserve = device.allow_reservation !== false && device.status === 'available';
  const code = device.device_code;
  return (
    <div className={compact ? 'flex flex-wrap gap-2' : 'mt-auto grid grid-cols-3 gap-2 pt-2'}>
      <Button size="sm" variant="outline" onClick={() => nav({ to: `/devices/${code}` } as any)}>详情</Button>
      <Button size="sm" disabled={!canReserve} onClick={() => nav({ to: '/reserve', search: { device_code: code } } as any)}>预约</Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => nav({ to: '/chat', search: buildChatSearch({ contactAdmin: true, type: 'device', deviceCode: code, deviceName: device.name }) } as any)}
      >
        <MessageSquare className="h-3.5 w-3.5" /> 咨询
      </Button>
    </div>
  );
}

function DeviceCard({ device }: { device: Device }) {
  const code = device.device_code;
  const statusTone = STATUS_TONE[device.status] ?? 'muted';
  return (
    <Card className="device-card-v4 group h-full overflow-hidden">
      <div className="relative h-28 overflow-hidden bg-secondary/70">
        {device.cover_photo ? (
          <img src={device.cover_photo} alt={device.name || '设备图片'} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-semibold text-muted-foreground">设备</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent" />
        <span className={`badge-pill badge-${statusTone} absolute right-3 top-3 shadow-sm`}>{STATUS_LABEL[device.status] ?? device.status}</span>
        {device.category && <span className="absolute bottom-3 left-3 rounded-full bg-white/88 px-2.5 py-1 text-[11px] font-bold text-foreground shadow-sm">{device.category}</span>}
      </div>
      <CardContent className="flex min-h-[15.5rem] flex-col gap-3 p-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-black tracking-tight">{device.name}</h2>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Tag className="h-3 w-3" /> <span className="font-mono">{code}</span></p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <InfoPill label="位置" value={device.location || '未填写'} />
          <InfoPill label="负责人" value={device.manager || '未填写'} />
          <InfoPill label="当前" value={device.current_borrow ? `${device.current_borrow.user_name || '-'} ${device.current_borrow.user_phone || ''}` : '空闲'} />
          <div className="rounded-2xl border bg-background/70 px-3 py-2">
            <p className="text-[10px] font-semibold text-muted-foreground">下次</p>
            <div className="mt-1 min-w-0"><NextUseBlock device={device} compact /></div>
          </div>
        </div>

        <div className="rounded-2xl border bg-background/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground">开放时段</span>
            <OpsBadge tone={device.status === 'available' ? 'success' : riskLevel(device) === 'low' ? 'default' : 'warning'}>{lifecycleLabel(device.status)}</OpsBadge>
          </div>
          <DeviceSlotBlocks device={device} />
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          {device.allow_reservation === false && <span className="badge-pill badge-warn">暂停预约</span>}
          {device.next_reservation?.start_time ? <span className="badge-pill badge-info">有排期</span> : <span className="badge-pill badge-success">近期空闲</span>}
          <OpsRiskBadge level={riskLevel(device)}>{riskText(device)}</OpsRiskBadge>
        </div>
        <DeviceActions device={device} />
      </CardContent>
    </Card>
  );
}

function InfoPill({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl border bg-background/70 px-3 py-2">
      <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
      <p className={strong ? 'mt-0.5 truncate font-bold text-primary' : 'mt-0.5 truncate font-semibold text-foreground'} title={value}>{value}</p>
    </div>
  );
}

function DeviceTable({ devices }: { devices: Device[] }) {
  return (
    <Card className="ops-card overflow-hidden">
      <CardContent className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-secondary/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3">设备</th>
              <th className="px-4 py-3">位置</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">负责人</th>
              <th className="px-4 py-3">下次</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.id || device.device_code} className="border-t border-border/70">
                <td className="px-4 py-3">
                  <p className="font-semibold">{device.name || '-'}</p>
                  <p className="font-mono text-xs text-muted-foreground">{device.device_code || '-'}</p>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{device.location || '未填写'}</td>
                <td className="px-4 py-3"><span className={`badge-pill badge-${STATUS_TONE[device.status] ?? 'muted'}`}>{STATUS_LABEL[device.status] ?? device.status}</span></td>
                <td className="px-4 py-3 text-muted-foreground">{device.manager || '未填写'}</td>
                <td className="px-4 py-3"><NextUseBlock device={device} compact /></td>
                <td className="px-4 py-3"><DeviceActions device={device} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function DevicesPage() {
  const nav = useNavigate();
  const [filters, setFilters] = useState<DeviceFilters>(() => initialFilters());
  const [view, setView] = useState<DeviceView>(() => initialView());
  const { data = [], isLoading, error } = useQuery({ queryKey: ['devices'], queryFn: listDevices });

  const categories = useMemo(
    () => [...new Set(data.map((device) => String(device.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [data]
  );

  const filtered = useMemo(() => filterDevices(data, filters), [data, filters]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams();
    if (filters.keyword.trim()) params.set('keyword', filters.keyword.trim());
    if (filters.status) params.set('status', filters.status);
    if (filters.category) params.set('category', filters.category);
    if (filters.availability) params.set('availability', filters.availability);
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
    window.history.replaceState(null, '', nextUrl);
  }, [filters]);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('IDBS_DEVICE_VIEW', view);
  }, [view]);

  const updateFilter = (key: keyof DeviceFilters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const resetFilters = () => setFilters({ keyword: '', status: '', category: '', availability: '' });

  return (
    <div className="ops-page-stack">
      <OpsPageHeader title="设备">
        <Button onClick={() => nav({ to: '/reserve' } as any)}><CalendarDays className="h-4 w-4" /> 发起预约</Button>
        <Button variant="outline" onClick={() => nav({ to: '/me/reservations' } as any)}>我的预约</Button>
        <Button variant="outline" onClick={() => nav({ to: '/calendar' } as any)}>日历</Button>
      </OpsPageHeader>

      <Card className="ops-card">
        <CardContent className="space-y-3 p-3 md:p-4">
          <OpsDataToolbar
            title="设备筛选"
            meta={<>当前 {filtered.length}/{data.length} 台</>}
          />
          <div className="grid gap-2 md:grid-cols-[minmax(240px,1.4fr)_repeat(3,minmax(140px,0.7fr))_auto] md:items-end">
            <label className="space-y-1 text-xs font-bold text-muted-foreground">
              关键词
              <Input
                placeholder="名称、编号、位置、负责人"
                value={filters.keyword}
                onChange={(e) => updateFilter('keyword', e.target.value)}
                clearable
                prefix={<Search className="h-4 w-4" />}
              />
            </label>
            <label className="space-y-1 text-xs font-bold text-muted-foreground">
              状态
              <select className="h-10 w-full rounded-[14px] border border-input bg-card px-3 text-sm" value={filters.status} onChange={(e) => updateFilter('status', e.target.value)}>
                {STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-bold text-muted-foreground">
              分类
              <select className="h-10 w-full rounded-[14px] border border-input bg-card px-3 text-sm" value={filters.category} onChange={(e) => updateFilter('category', e.target.value)}>
                <option value="">全部分类</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-bold text-muted-foreground">
              可用性
              <select className="h-10 w-full rounded-[14px] border border-input bg-card px-3 text-sm" value={filters.availability} onChange={(e) => updateFilter('availability', e.target.value)}>
                {AVAILABILITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <Button variant="outline" onClick={resetFilters}><RotateCcw className="h-4 w-4" /> 重置</Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2" aria-label="常用筛选">
              {QUICK_FILTERS.map((item) => {
                const active = filters.status === item.status && filters.availability === item.availability;
                return (
                  <Button
                    key={`${item.status}-${item.availability}-${item.label}`}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    onClick={() => setFilters((current) => ({ ...current, status: item.status, availability: item.availability }))}
                  >
                    {item.label}
                  </Button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>视图</span>
              <Button type="button" size="sm" variant={view === 'card' ? 'default' : 'outline'} onClick={() => setView('card')}><Grid2X2 className="h-4 w-4" /> 卡片</Button>
              <Button type="button" size="sm" variant={view === 'table' ? 'default' : 'outline'} onClick={() => setView('table')}><List className="h-4 w-4" /> 表格</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && <Card className="ops-card"><CardContent className="py-8 text-center text-muted-foreground">设备加载中…</CardContent></Card>}
      {error && <Card className="ops-card"><CardContent className="py-8 text-center text-destructive">设备加载失败：{toFriendlyError(error)}</CardContent></Card>}
      {!isLoading && !error && filtered.length === 0 && (
        <Card className="ops-card"><CardContent className="p-4"><OpsEmptyState title="没有匹配设备" description="可清空筛选条件，或尝试按分类、状态、可用性重新查找。" /></CardContent></Card>
      )}
      {!isLoading && !error && filtered.length > 0 && (
        view === 'table' ? <DeviceTable devices={filtered} /> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{filtered.map((device) => <DeviceCard key={device.id || device.device_code} device={device} />)}</div>
      )}
    </div>
  );
}


