import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Clock, MessageSquare, MonitorSmartphone, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompactId } from '@/components/ui/compact-id';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildChatSearch } from '@/features/chat/chat-context';
import { compactTimeRange, fullDateTimeRange } from '@/lib/time-format';
import { getCalendarDay, type CalendarEvent } from './reservation-api';
import { toFriendlyError } from '@/lib/friendly-error';

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

function readDateFromPath() {
  const value = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
}

function statusBadge(status: string) {
  return <span className={`badge-pill badge-${STATUS_TONE[status] ?? 'muted'}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function eventKey(e: CalendarEvent) {
  return e.event_id || e.id || e.item_id || e.record_id || e.reservation_id || `${e.source_type || e.type || 'event'}-${e.device_code || e.device_id}-${e.start_time}-${e.end_time}`;
}

function eventPrefix(event: CalendarEvent) {
  return event.source_type === 'borrow' || event.type === 'borrow' ? 'BOR' : 'RSV';
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

function EventCard({ event }: { event: CalendarEvent }) {
  const nav = useNavigate();
  const color = event.color || deviceColor(event.device_code || event.device_id);
  return (
    <Card className="ops-card overflow-hidden">
      <CardContent className="relative flex flex-col gap-3 p-4 pl-5 lg:flex-row lg:items-start lg:justify-between">
        <span className="absolute left-0 top-0 h-full w-1.5" style={{ backgroundColor: color }} aria-hidden />
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-3.5 w-3.5 rounded" style={{ backgroundColor: color }} />
            <MonitorSmartphone className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">{event.device_code} · {event.device_name}</h3>
            {statusBadge(event.status)}
          </div>
          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <p className="flex items-center gap-2" title={fullDateTimeRange(event.start_time, event.end_time)}><Clock className="h-4 w-4" />{compactTimeRange(event.start_time, event.end_time)}</p>
            <p className="flex items-center gap-2"><UserRound className="h-4 w-4" />{event.user_name || '—'}{event.user_phone ? ` / ${event.user_phone}` : ''}</p>
          </div>
          {event.purpose && <p className="rounded-xl bg-muted/70 p-2 text-sm text-muted-foreground">用途：{event.purpose}</p>}
          <p className="text-xs text-muted-foreground">{sourceLabel(event.source_type || event.type)} · <CompactId value={eventKey(event)} prefix={eventPrefix(event)} /></p>
        </div>
        {event.user_id && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => nav({
              to: '/chat',
              search: buildChatSearch({
                targetUserId: event.user_id,
                type: 'reservation',
                title: `预约沟通：${event.device_code}`,
                detail: event.purpose || '预约使用沟通',
                deviceCode: event.device_code,
                deviceName: event.device_name,
                userName: event.user_name,
                userPhone: event.user_phone,
                status: event.status,
                reservationId: event.event_id,
                startTime: event.start_time,
                endTime: event.end_time
              })
            } as any)}
          >
            <MessageSquare className="h-4 w-4" />联系使用人
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function CalendarDetailPage() {
  const nav = useNavigate();
  const date = readDateFromPath();
  const month = new URLSearchParams(window.location.search).get('month') || date.slice(0, 7);
  const { data: events = [], isLoading, error } = useQuery({
    queryKey: ['calendar-day-detail', date],
    queryFn: () => getCalendarDay(date)
  });
  const deviceCount = new Set(events.map((event) => event.device_code || event.device_id).filter(Boolean)).size;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <button onClick={() => nav({ to: '/calendar', search: { month } } as any)} className="inline-flex w-fit items-center gap-2 rounded-full bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 返回日历
      </button>

      <section className="ops-hero p-5 md:p-6">
        <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-white/70">DAY DETAIL</p>
            <h1 className="mt-1 flex items-center gap-2 text-3xl font-bold text-white">
              <CalendarDays className="h-7 w-7" />{date} 使用详情
            </h1>
            <p className="mt-2 text-sm text-white/72">看当天设备占用。</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-sm text-white">
            <div className="rounded-2xl bg-white/12 px-4 py-3"><b>{events.length}</b><span className="ml-1 text-white/62">安排</span></div>
            <div className="rounded-2xl bg-white/12 px-4 py-3"><b>{deviceCount}</b><span className="ml-1 text-white/62">设备</span></div>
          </div>
        </div>
      </section>

      {isLoading && <Card className="ops-card"><CardContent className="py-8 text-center text-muted-foreground">加载中…</CardContent></Card>}
      {error && <Card className="ops-card"><CardContent className="py-8 text-center text-destructive">加载失败：{toFriendlyError(error)}</CardContent></Card>}

      {!isLoading && !error && (
        <Card className="ops-card">
          <CardHeader>
            <CardTitle className="text-base">当天安排（{events.length}）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {events.map((event) => <EventCard key={eventKey(event)} event={event} />)}
            {events.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">当天暂无占用</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
