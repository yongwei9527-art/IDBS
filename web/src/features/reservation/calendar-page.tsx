import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, ChevronLeft, ChevronRight, Clock3, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { OpsBadge, OpsDataToolbar, OpsEmptyState, OpsPageHeader } from '@/components/ops/design-system';
import { fullDateTimeRange, tinyTimeRange } from '@/lib/time-format';
import { toFriendlyError } from '@/lib/friendly-error';
import { useCapability } from '@/features/auth/permissions';
import { getCalendar, type CalendarEvent } from './reservation-api';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const STATUS_LABEL: Record<string, string> = {
  pending: '待审核', approved: '已通过', rejected: '已驳回', cancelled: '已取消',
  completed: '已完成', in_use: '使用中', returned: '已归还'
};
const STATUS_TONE: Record<string, string> = {
  pending: 'badge-warn', approved: 'badge-success', rejected: 'badge-danger', cancelled: 'badge-muted',
  completed: 'badge-muted', in_use: 'badge-info', returned: 'badge-muted'
};

function formatDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function currentMonth() {
  return formatDay(new Date()).slice(0, 7);
}

function shiftMonth(monthText: string, delta: number) {
  const [year, month] = monthText.split('-').map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
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

function eventDate(event: CalendarEvent) {
  const date = new Date(event.start_time);
  return Number.isNaN(date.getTime()) ? String(event.start_time).slice(0, 10) : formatDay(date);
}

function eventKey(event: CalendarEvent) {
  return event.event_id || event.id || event.item_id || event.record_id || event.reservation_id || `${event.device_id}-${event.start_time}`;
}

function deviceKey(event: CalendarEvent) {
  return String(event.device_code || event.device_id || event.device_name || 'device');
}

function deviceColor(seed = '') {
  const colors = ['#0f8299', '#b7792b', '#4f7f73', '#657da8', '#8b6ea8', '#2f7190', '#8a6d3f', '#5f8172'];
  let hash = 0;
  for (const char of String(seed || 'device')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

function eventName(event: CalendarEvent) {
  return event.device_name || event.device_code || '未命名设备';
}

function EventDialog({ date, events, onClose, onOpenEvent }: { date: string; events: CalendarEvent[]; onClose: () => void; onOpenEvent: (event: CalendarEvent) => void }) {
  useEffect(() => {
    if (!date) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [date, onClose]);

  if (!date) return null;
  return (
    <div className="ui-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="ops-dialog-surface max-h-[82vh] w-full max-w-2xl overflow-hidden" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div>
            <p className="text-xs font-semibold text-primary">当日安排</p>
            <h2 className="mt-1 text-lg font-semibold tabular-nums">{date}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{events.length} 条 · 点击进入业务页</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="关闭"><X className="h-4 w-4" /></Button>
        </div>
        <div className="max-h-[62vh] space-y-2 overflow-y-auto p-4">
          {events.length === 0 ? <OpsEmptyState title="当天暂无安排" description="该日期没有预约或使用记录。" /> : null}
          {events.map((event) => {
            const color = event.color || deviceColor(deviceKey(event));
            return (
              <button key={eventKey(event)} type="button" onClick={() => onOpenEvent(event)} className="calendar-event-row group w-full rounded-xl border p-3 text-left">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <strong className="truncate">{eventName(event)}</strong>
                    {event.device_code ? <span className="font-mono text-xs text-muted-foreground">{event.device_code}</span> : null}
                  </div>
                  <span className="flex items-center gap-2">
                    <span className={`badge-pill ${STATUS_TONE[event.status] ?? 'badge-muted'}`}>{STATUS_LABEL[event.status] ?? event.status}</span>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:text-primary" />
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{tinyTimeRange(event.start_time, event.end_time)}</span>
                  <span className="inline-flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />{event.user_name || '未显示'}</span>
                </div>
                <p className="mt-2 truncate text-xs text-muted-foreground">{event.purpose || '未填写用途'}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CalendarPage() {
  const navigate = useNavigate();
  const capability = useCapability();
  const [month, setMonth] = useState(() => {
    const value = new URLSearchParams(window.location.search).get('month') || '';
    return /^\d{4}-\d{2}$/.test(value) ? value : currentMonth();
  });
  const [deviceFilter, setDeviceFilter] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<CalendarEvent[]>([]);
  const { first, start, end } = useMemo(() => monthRange(month), [month]);
  const startText = formatDay(start);
  const endText = formatDay(end);
  const today = formatDay(new Date());
  const { data: events = [], isLoading, error } = useQuery({
    queryKey: ['calendar-month', startText, endText],
    queryFn: () => getCalendar({ start: startText, end: endText })
  });

  const monthEvents = useMemo(() => events.filter((event) => eventDate(event).slice(0, 7) === month), [events, month]);
  const deviceOptions = useMemo(() => Array.from(monthEvents.reduce((map, event) => {
    const key = deviceKey(event);
    if (!map.has(key)) map.set(key, eventName(event));
    return map;
  }, new Map<string, string>()).entries()), [monthEvents]);
  const visibleEvents = useMemo(() => deviceFilter ? events.filter((event) => deviceKey(event) === deviceFilter) : events, [deviceFilter, events]);
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    visibleEvents.forEach((event) => {
      const key = eventDate(event);
      map.set(key, [...(map.get(key) || []), event]);
    });
    map.forEach((items) => items.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()));
    return map;
  }, [visibleEvents]);
  const days = useMemo(() => Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  }), [start]);

  const activeDays = new Set(monthEvents.map(eventDate)).size;
  const inUseCount = monthEvents.filter((event) => event.status === 'in_use').length;
  const deviceCount = deviceOptions.length;

  function openEvents(date: string, items: CalendarEvent[]) {
    setSelectedDate(date);
    setSelectedEvents(items);
  }

  function openRelatedPage(event: CalendarEvent) {
    const source = String(event.source_type || event.type || 'reservation');
    const isBorrow = source === 'borrow' || ['in_use', 'returned', 'completed'].includes(event.status);
    setSelectedDate('');
    setSelectedEvents([]);
    if (!capability.isAdminLike) {
      navigate({ to: isBorrow ? '/borrow' : '/me/reservations' } as any);
      return;
    }
    if (!isBorrow && capability.canViewReservations) {
      navigate({ to: '/admin/reservations', search: { scope: 'current' } } as any);
      return;
    }
    if (event.device_code && capability.canViewDevices) {
      navigate({ to: '/admin/devices', search: { device_code: event.device_code } } as any);
      return;
    }
    navigate({ to: event.device_code ? '/devices/$code' : '/devices', params: event.device_code ? { code: event.device_code } : undefined } as any);
  }

  return (
    <div className="ops-page-stack calendar-page">
      <OpsPageHeader title="使用日历" className="ops-page-header--compact" />

      <Card className="ops-card overflow-hidden">
        <CardContent className="space-y-4 p-4">
          <OpsDataToolbar
            title={`${month} 月度排期`}
            description="点击日期查看全部，再点记录跳转业务页。"
            meta={(
              <div className="flex flex-wrap items-center gap-2">
                <span>{deviceFilter ? visibleEvents.filter((event) => eventDate(event).slice(0, 7) === month).length : monthEvents.length} 条安排 · {activeDays} 天 · {deviceCount} 台设备</span>
                {inUseCount ? <OpsBadge tone="warning">使用中 {inUseCount}</OpsBadge> : null}
              </div>
            )}
            filters={
              <select value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)} className="h-9 min-w-44 rounded-xl border border-input bg-card px-3 text-sm" aria-label="筛选设备">
                <option value="">全部设备</option>
                {deviceOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            }
            actions={
              <div className="ops-segment-group flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setMonth((value) => shiftMonth(value, -1))}><ChevronLeft className="h-4 w-4" />上月</Button>
                <Button variant="outline" size="sm" onClick={() => setMonth(currentMonth())}>本月</Button>
                <Button variant="outline" size="sm" onClick={() => setMonth((value) => shiftMonth(value, 1))}>下月<ChevronRight className="h-4 w-4" /></Button>
              </div>
            }
          />

          {isLoading ? <p className="rounded-xl bg-muted/40 p-6 text-center text-sm text-muted-foreground">日历加载中…</p> : null}
          {error ? <p className="rounded-xl bg-destructive/10 p-6 text-center text-sm text-destructive">加载失败：{toFriendlyError(error)}</p> : null}

          <div className="calendar-board overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="calendar-weekhead grid grid-cols-7">
                {WEEKDAYS.map((weekday) => <div key={weekday} className="py-2 text-center text-xs font-semibold text-muted-foreground">{weekday}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {days.map((date) => {
                  const key = formatDay(date);
                  const dayEvents = grouped.get(key) || [];
                  const outside = date.getMonth() !== first.getMonth();
                  const isToday = key === today;
                  return (
                    <div key={key} className={`calendar-day-cell relative min-h-[118px] p-1.5 ${outside ? 'calendar-day-cell--outside' : ''} ${isToday ? 'calendar-day-cell--today' : ''} ${dayEvents.length ? 'calendar-day-cell--busy' : ''}`}>
                      <button type="button" className="absolute inset-0 z-0 cursor-pointer" onClick={() => openEvents(key, dayEvents)} aria-label={`查看 ${key} 全部安排`} />
                      <div className="relative z-10 mb-2 flex pointer-events-none items-center justify-between">
                        <span className={`calendar-day-num ${isToday ? 'calendar-day-num--today' : outside ? 'calendar-day-num--outside' : ''}`}>{date.getDate()}</span>
                        {dayEvents.length ? <span className="calendar-day-count">{dayEvents.length}</span> : null}
                      </div>
                      <div className="relative z-10 space-y-1">
                        {dayEvents.slice(0, 3).map((event) => {
                          const color = event.color || deviceColor(deviceKey(event));
                          return (
                            <button key={eventKey(event)} type="button" onClick={() => openEvents(key, dayEvents)} className="calendar-event-chip flex w-full items-center gap-1.5 text-left" title={`${eventName(event)} · ${fullDateTimeRange(event.start_time, event.end_time)}`}>
                              <span className="h-5 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{eventName(event)}</span>
                              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{tinyTimeRange(event.start_time, event.end_time).split('–')[0]}</span>
                            </button>
                          );
                        })}
                        {dayEvents.length > 3 ? <button type="button" onClick={() => openEvents(key, dayEvents)} className="calendar-more-button w-full rounded-lg border border-dashed py-1 text-[10px] font-semibold text-primary">另有 {dayEvents.length - 3} 条</button> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <EventDialog date={selectedDate} events={selectedEvents} onClose={() => { setSelectedDate(''); setSelectedEvents([]); }} onOpenEvent={openRelatedPage} />
    </div>
  );
}
