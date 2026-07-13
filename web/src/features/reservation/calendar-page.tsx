import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, MonitorSmartphone, Palette, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompactId, formatCompactId } from '@/components/ui/compact-id';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fullDateTimeRange, tinyTimeRange } from '@/lib/time-format';
import { getCalendar, type CalendarEvent } from './reservation-api';
import { OpsTimeBlock } from '@/components/ops/design-system';
import { toFriendlyError } from '@/lib/friendly-error';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const CN_NUMBERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];
const STATUS_LABEL: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已取消',
  completed: '已完成',
  in_use: '使用中',
  returned: '已归还'
};
const STATUS_TONE: Record<string, string> = {
  pending: 'warn',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'muted',
  completed: 'muted',
  in_use: 'info',
  returned: 'muted'
};

function formatDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(monthText: string, delta: number) {
  const [year, month] = monthText.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(monthText: string) {
  const [year, month] = monthText.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 41);
  return { first, start, end };
}

function eventRange(e: CalendarEvent) {
  return tinyTimeRange(e.start_time, e.end_time);
}

function eventDate(e: CalendarEvent) {
  const d = new Date(e.start_time);
  return Number.isNaN(d.getTime()) ? String(e.start_time).slice(0, 10) : formatDay(d);
}

function eventKey(e: CalendarEvent) {
  return e.event_id || e.id || e.item_id || e.record_id || e.reservation_id || `${e.source_type || e.type || 'event'}-${e.device_code || e.device_id}-${e.start_time}-${e.end_time}`;
}

function statusBadge(status: string) {
  return <span className={`badge-pill badge-${STATUS_TONE[status] ?? 'muted'}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function deviceColor(seed = '') {
  const colors = ['#2563eb', '#d97706', '#7c3aed', '#059669', '#dc2626', '#0891b2', '#be185d', '#4f46e5', '#65a30d', '#9333ea'];
  let hash = 0;
  for (const char of String(seed || 'device')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

function sourceLabel(source?: string) {
  return source === 'borrow' ? '借用记录' : '预约';
}

function deviceIdentity(event: CalendarEvent) {
  return String(event.device_code || (event.device_id ? formatCompactId(event.device_id, 8, 4, 'DEV') : '') || event.device_name || formatCompactId(eventKey(event), 8, 4, 'EVT'));
}

function chineseDeviceLabel(index: number, event?: CalendarEvent) {
  const name = event?.device_name?.trim();
  if (name && /[\u4e00-\u9fa5]/.test(name)) return name;
  return `设备${CN_NUMBERS[index] ?? index + 1}`;
}

function EventHoverCard({ event, label }: { event: CalendarEvent; label: string }) {
  const color = event.color || deviceColor(event.device_code || event.device_id);
  return (
    <div className="pointer-events-none absolute left-0 top-8 z-50 hidden w-72 rounded-2xl border bg-card/98 p-3 text-left text-xs text-foreground shadow-2xl backdrop-blur group-hover:block group-focus-visible:block">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-3 w-3 rounded" style={{ backgroundColor: color }} />
        <b className="truncate">{label} · {event.device_name || '设备'}</b>
        {statusBadge(event.status)}
      </div>
      <div className="grid gap-1.5 text-muted-foreground">
        <p><b className="text-foreground">时间：</b>{fullDateTimeRange(event.start_time, event.end_time)}</p>
        <p><b className="text-foreground">使用人：</b>{event.user_name || '—'}{event.user_phone ? ` / ${event.user_phone}` : ''}</p>
        <p><b className="text-foreground">来源：</b>{sourceLabel(event.source_type || event.type)}</p>
        <p><b className="text-foreground">序号：</b><CompactId value={eventKey(event)} prefix="EVT" /></p>
        {event.purpose ? <p className="rounded-xl bg-muted p-2"><b className="text-foreground">用途：</b>{event.purpose}</p> : null}
      </div>
    </div>
  );
}

function EventBlock({ event, label, onOpen }: { event: CalendarEvent; label: string; onOpen: (events: CalendarEvent[]) => void }) {
  const color = event.color || deviceColor(event.device_code || event.device_id);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen([event]);
      }}
      className="group relative h-7 min-w-8 rounded-lg border text-[10px] font-black text-white shadow-sm transition hover:-translate-y-px hover:scale-[1.03] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ backgroundColor: color, borderColor: `${color}88` }}
      title={`${label}｜${event.device_name || '设备'}｜${fullDateTimeRange(event.start_time, event.end_time)}｜${STATUS_LABEL[event.status] ?? event.status}`}
      aria-label={`查看 ${label} ${eventRange(event)} 预约详情`}
    >
      <span className="px-1">{label}</span>
      <span className="sr-only">{event.device_name || label} {eventRange(event)}</span>
      <EventHoverCard event={event} label={label} />
    </button>
  );
}

function DayHoverPanel({ date, events, getDeviceLabel, align = 'left' }: { date: string; events: CalendarEvent[]; getDeviceLabel: (event: CalendarEvent) => string; align?: 'left' | 'right' }) {
  const positionClass = align === 'right' ? 'right-2' : 'left-2';
  return (
    <div className={`pointer-events-auto absolute top-[calc(100%-0.25rem)] z-40 hidden w-80 max-w-[calc(100vw-2rem)] rounded-2xl border bg-card/98 p-3 text-left shadow-2xl backdrop-blur sm:w-96 ${positionClass} group-hover/day:block`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <b className="text-sm">{date}</b>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{events.length} 条</span>
      </div>
      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-muted/30 py-4 text-center text-xs text-muted-foreground">当天暂无预约信息</p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-auto pr-1">
          {events.map((event) => {
            const color = event.color || deviceColor(event.device_code || event.device_id);
            return (
              <div key={eventKey(event)} className="rounded-xl bg-muted/50 p-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded" style={{ backgroundColor: color }} />
                  <b className="truncate">{getDeviceLabel(event)} · {event.device_name || '设备'}</b>
                  {statusBadge(event.status)}
                </div>
                <div className="mt-1 grid gap-1 text-muted-foreground sm:grid-cols-2">
                  <OpsTimeBlock compact color={color} label={eventRange(event)} title={fullDateTimeRange(event.start_time, event.end_time)} />
                  <span>{event.user_name || '—'}{event.user_phone ? ` / ${event.user_phone}` : ''}</span>
                  <span>{sourceLabel(event.source_type || event.type)}</span>
                  <span className="truncate">{event.purpose || '未填写用途'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">悬停查看摘要，点击日期或数量打开完整详情。</p>
    </div>
  );
}
function EventPopover({ date, events, onClose, getDeviceLabel }: { date: string; events: CalendarEvent[]; onClose: () => void; getDeviceLabel: (event: CalendarEvent) => string }) {
  useEffect(() => {
    if (!date) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [date, onClose]);

  if (!date) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-3xl border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-primary">预约详情</p>
            <h2 className="mt-1 text-xl font-bold">{date} 预约信息（{events.length}）</h2>
            <p className="mt-1 text-xs text-muted-foreground">当天信息在当前页浮层查看，不再跳转。</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="关闭预约详情">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-[58vh] space-y-3 overflow-auto p-4">
          {events.length === 0 && (
            <div className="rounded-2xl border border-dashed bg-muted/20 py-10 text-center text-sm text-muted-foreground">当天暂无预约信息</div>
          )}
          {events.map((event) => {
            const color = event.color || deviceColor(event.device_code || event.device_id);
            const deviceLabel = getDeviceLabel(event);
            return (
              <div key={eventKey(event)} className="rounded-2xl border bg-muted/20 p-3" style={{ borderColor: `${color}55` }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="h-3 w-3 rounded" style={{ backgroundColor: color }} />
                  <b>{deviceLabel}</b>
                  {event.device_name ? <span className="text-sm text-muted-foreground">{event.device_name}</span> : null}
                  {statusBadge(event.status)}
                </div>
                <div className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                  <p><b className="text-foreground">日期：</b>{eventDate(event)}</p>
                  <p><b className="text-foreground">时间：</b>{fullDateTimeRange(event.start_time, event.end_time)}</p>
                  <p><b className="text-foreground">使用人：</b>{event.user_name || '—'}</p>
                  <p><b className="text-foreground">联系方式：</b>{event.user_phone || '—'}</p>
                  <p><b className="text-foreground">设备：</b>{event.device_name || deviceLabel}</p>
                  <p><b className="text-foreground">设备标识：</b>{event.device_code || (event.device_id ? <CompactId value={event.device_id} prefix="DEV" /> : '—')}</p>
                  <p><b className="text-foreground">来源：</b>{sourceLabel(event.source_type || event.type)}</p>
                  <p><b className="text-foreground">序号：</b><CompactId value={eventKey(event)} prefix="EVT" /></p>
                </div>
                {event.purpose ? <p className="mt-2 rounded-xl bg-muted p-2 text-sm text-muted-foreground">用途：{event.purpose}</p> : null}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t p-4">
          <Button type="button" onClick={onClose}>关闭</Button>
        </div>
      </div>
    </div>
  );
}

export function CalendarPage() {
  const [selectedDate, setSelectedDate] = useState('');
  const [popoverEvents, setPopoverEvents] = useState<CalendarEvent[]>([]);
  const [month, setMonth] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('month') || '';
    return /^\d{4}-\d{2}$/.test(fromUrl) ? fromUrl : currentMonth();
  });
  const { start, end, first } = useMemo(() => monthRange(month), [month]);
  const startText = formatDay(start);
  const endText = formatDay(end);
  const today = formatDay(new Date());
  const { data: events = [], isLoading, error } = useQuery({
    queryKey: ['calendar-month', startText, endText],
    queryFn: () => getCalendar({ start: startText, end: endText })
  });

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach((event) => {
      const key = eventDate(event);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    });
    map.forEach((list) => list.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()));
    return map;
  }, [events]);

  const days = useMemo(() => Array.from({ length: 42 }, (_, index) => {
    const d = new Date(start);
    d.setDate(start.getDate() + index);
    return d;
  }), [start]);

  const monthEvents = events.filter((e) => eventDate(e).slice(0, 7) === month);
  const activeDays = new Set(monthEvents.map(eventDate)).size;
  const deviceCount = new Set(monthEvents.map((e) => e.device_code || e.device_id || e.device_name).filter(Boolean)).size;
  const deviceLegendItems = Array.from(monthEvents.reduce((map, event) => {
    const key = deviceIdentity(event);
    const old = map.get(key);
    map.set(key, old ? { event: old.event, count: old.count + 1 } : { event, count: 1 });
    return map;
  }, new Map<string, { event: CalendarEvent; count: number }>()).values()).slice(0, 12);
  const deviceLegend = deviceLegendItems.map((item) => item.event);
  const deviceLabelMap = new Map(deviceLegend.map((event, index) => [deviceIdentity(event), chineseDeviceLabel(index, event)]));
  const getDeviceLabel = (event: CalendarEvent) => deviceLabelMap.get(deviceIdentity(event)) || chineseDeviceLabel(deviceLegend.length, event);

  function showEvents(dayEvents: CalendarEvent[], date?: string) {
    setSelectedDate(date || (dayEvents[0] ? eventDate(dayEvents[0]) : ''));
    setPopoverEvents(dayEvents);
  }

  function openDay(key: string) {
    setSelectedDate(key);
    setPopoverEvents(grouped.get(key) ?? []);
  }

  return (
    <div className="mx-auto max-w-7xl">
      <section className="ops-hero p-5 md:p-6">
        <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-white/70">设备使用日历</p>
            <h1 className="mt-1 flex items-center gap-2 text-3xl font-bold text-white"><CalendarDays className="h-7 w-7" />使用日历</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/72">色块看占用，点击当前页浮层查看详情。</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm text-white">
            <div className="rounded-2xl bg-white/12 px-4 py-3"><b>{monthEvents.length}</b><span className="ml-1 text-white/62">安排</span></div>
            <div className="rounded-2xl bg-white/12 px-4 py-3"><b>{activeDays}</b><span className="ml-1 text-white/62">天</span></div>
            <div className="rounded-2xl bg-white/12 px-4 py-3"><b>{deviceCount}</b><span className="ml-1 text-white/62">设备</span></div>
          </div>
        </div>
      </section>

      <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_176px]">
        <div className="flex min-w-0 flex-col gap-4">
      <Card className="ops-card">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            {month} 使用安排
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
              <ChevronLeft className="h-4 w-4" />上个月
            </Button>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-9 rounded-[14px] border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="选择月份"
            >
              {Array.from(new Set([month, ...Array.from({ length: 27 }, (_, i) => shiftMonth(currentMonth(), i - 2))])).sort().map((m) => (
                <option key={m} value={m}>{m} 月</option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
              下个月<ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && <p className="rounded-xl bg-muted p-4 text-center text-sm text-muted-foreground">月历加载中…</p>}
          {error && <p className="rounded-xl bg-destructive/10 p-4 text-center text-sm text-destructive">加载失败：{toFriendlyError(error)}</p>}

          <div className="relative grid grid-cols-7 rounded-2xl border bg-card">
            {WEEKDAYS.map((w) => (
              <div key={w} className="border-b bg-muted/60 py-2 text-center text-xs font-medium text-muted-foreground">{w}</div>
            ))}
            {days.map((d) => {
              const key = formatDay(d);
              const dayEvents = grouped.get(key) ?? [];
              const outside = d.getMonth() !== first.getMonth();
              const isToday = key === today;
              return (
                <div
                  key={key}
                  className={[
                    'group/day relative min-h-[118px] border-b border-r p-2 text-left transition hover:z-40 hover:bg-accent/60',
                    outside ? 'bg-muted/25 text-muted-foreground' : 'bg-card',
                    isToday ? 'ring-2 ring-inset ring-primary' : ''
                  ].join(' ')}
                >
                  <div className="mb-2 flex items-center justify-between gap-1">
                    <button type="button" onClick={() => openDay(key)} className="rounded px-1 text-sm font-semibold hover:bg-accent" aria-label={`查看 ${key} 当天详情`}>
                      {d.getDate()}
                    </button>
                    {dayEvents.length > 0 && (
                      <button
                        type="button"
                        onClick={() => showEvents(dayEvents, key)}
                        className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground"
                        title="查看当天全部预约"
                      >
                        {dayEvents.length}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {dayEvents.slice(0, 8).map((event) => <EventBlock key={eventKey(event)} event={event} label={getDeviceLabel(event)} onOpen={(items) => showEvents(items, key)} />)}
                    {dayEvents.length > 8 && (
                      <button type="button" onClick={() => showEvents(dayEvents, key)} className="h-7 rounded-lg border bg-muted px-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                        +{dayEvents.length - 8}
                      </button>
                    )}
                    {!dayEvents.length && <span className="text-[11px] text-muted-foreground">空</span>}
                  </div>
                  <DayHoverPanel date={key} events={dayEvents} getDeviceLabel={getDeviceLabel} align={d.getDay() >= 5 ? 'right' : 'left'} />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="ops-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Palette className="h-4 w-4 text-primary" />本月安排</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {monthEvents.slice(0, 8).map((e) => (
            <button key={eventKey(e)} type="button" onClick={() => openDay(eventDate(e))} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/70 p-3 text-left transition hover:-translate-y-px hover:bg-accent">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-3 w-3 rounded" style={{ backgroundColor: e.color || deviceColor(e.device_code || e.device_id) }} />
                <MonitorSmartphone className="h-4 w-4 text-primary" />
                <span className="font-medium">{getDeviceLabel(e)} · {e.device_name || '设备'}</span>
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <OpsTimeBlock compact color={e.color || deviceColor(e.device_code || e.device_id)} label={`${eventDate(e).slice(5)} ${eventRange(e)}`} title={fullDateTimeRange(e.start_time, e.end_time)} />
                {statusBadge(e.status)}
              </span>
            </button>
          ))}
          {!isLoading && monthEvents.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">本月暂无安排</p>}
        </CardContent>
      </Card>
      <EventPopover date={selectedDate} events={popoverEvents} onClose={() => { setSelectedDate(''); setPopoverEvents([]); }} getDeviceLabel={getDeviceLabel} />
      </div>
      {deviceLegendItems.length > 0 && (
        <aside className="hidden xl:block" aria-label="设备颜色图例">
          <div className="sticky top-24 max-h-[calc(100svh-7rem)] overflow-hidden rounded-3xl border bg-card/95 p-3 shadow-xl backdrop-blur">
            <div className="mb-3 flex items-center gap-2 text-xs font-black text-muted-foreground">
              <Palette className="h-3.5 w-3.5 text-primary" />设备色块
            </div>
            <div className="max-h-[calc(100svh-12rem)] space-y-2 overflow-auto pr-1">
              {deviceLegendItems.map(({ event, count }, index) => {
                const color = event.color || deviceColor(event.device_code || event.device_id);
                return (
                  <button
                    key={deviceIdentity(event)}
                    type="button"
                    onClick={() => showEvents(monthEvents.filter((item) => deviceIdentity(item) === deviceIdentity(event)), month)}
                    className="group flex w-full items-center gap-2 rounded-2xl bg-muted/60 px-2 py-1.5 text-left text-xs font-semibold transition hover:bg-primary/10"
                    title={`${chineseDeviceLabel(index, event)} 本月 ${count} 条安排`}
                  >
                    <span className="h-3 w-3 shrink-0 rounded" style={{ backgroundColor: color }} />
                    <span className="min-w-0 flex-1 truncate">{chineseDeviceLabel(index, event)}</span>
                    <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums group-hover:text-primary">{count}</span>
                  </button>
                );
              })}
            </div>
            {new Set(monthEvents.map(deviceIdentity)).size > deviceLegendItems.length ? (
              <p className="mt-3 rounded-2xl border border-dashed bg-muted/30 px-2 py-2 text-[11px] leading-4 text-muted-foreground">还有更多设备，日历内色块仍可悬停查看。</p>
            ) : null}
          </div>
        </aside>
      )}
      </div>
    </div>
  );
}



