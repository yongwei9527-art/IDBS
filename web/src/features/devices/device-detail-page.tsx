import { briefDateTime } from '@/lib/time-format';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Clock,
  FileText,
  MapPin,
  MessageSquare,
  Tag,
  UserRound
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  getDeviceDetail,
  type DeviceBorrowSnapshot,
  type DeviceFaultSnapshot,
  type DeviceReservationSnapshot
} from './device-api';
import { buildChatSearch } from '@/features/chat/chat-context';
import { compactTimeRange, fullDateTimeRange } from '@/lib/time-format';
import { toFriendlyError } from '@/lib/friendly-error';
import { OpsBadge, OpsMetricCard, OpsRiskBadge, OpsSectionHeader, OpsTimeBlock } from '@/components/ops/design-system';

const STATUS_LABEL: Record<string, string> = {
  available: '可预约',
  reserved: '已预约',
  in_use: '使用中',
  maintenance: '维护中',
  abnormal_pending: '异常待处理',
  disabled: '停用',
  pending: '待审核',
  approved: '已通过',
  completed: '已完成',
  cancelled: '已取消',
  rejected: '已驳回',
  resolved: '已处理'
};

const STATUS_TONE: Record<string, string> = {
  available: 'badge-success',
  reserved: 'badge-info',
  in_use: 'badge-info',
  maintenance: 'badge-warn',
  abnormal_pending: 'badge-warn',
  disabled: 'badge-muted',
  pending: 'badge-warn',
  approved: 'badge-info',
  completed: 'badge-muted',
  cancelled: 'badge-muted',
  rejected: 'badge-danger',
  resolved: 'badge-success'
};

const FAULT_TYPE_LABEL: Record<string, string> = {
  device_fault: '设备故障',
  abnormal_return: '归还异常',
  other: '其他问题'
};

function formatTime(value?: string) {
  if (!value) return '—';
  return briefDateTime(value);
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' });
}

function statusBadge(status?: string) {
  if (!status) return null;
  return <span className={`badge-pill ${STATUS_TONE[status] ?? 'badge-muted'}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function lifecycleLabel(status?: string) {
  if (status === 'maintenance') return '维护中';
  if (status === 'abnormal_pending') return '异常待处理';
  if (status === 'disabled') return '停用/归档';
  if (status === 'in_use') return '使用中';
  if (status === 'reserved') return '已预约';
  return '可预约';
}

function riskLevel(status?: string, allowReservation?: boolean): 'low' | 'medium' | 'high' | 'critical' {
  if (status === 'disabled' || status === 'abnormal_pending') return 'critical';
  if (status === 'maintenance') return 'high';
  if (allowReservation === false || status === 'in_use' || status === 'reserved') return 'medium';
  return 'low';
}

function riskText(status?: string, allowReservation?: boolean) {
  if (status === 'disabled') return '设备已停用，暂不开放预约。';
  if (status === 'abnormal_pending') return '存在异常待处理，建议联系管理员确认。';
  if (status === 'maintenance') return '设备维护中，恢复后再预约。';
  if (allowReservation === false) return '设备暂停预约，用户端仅可查看。';
  if (status === 'in_use') return '设备正在使用，请关注后续排期。';
  return '设备状态正常，可按开放时段预约。';
}

function lifecycleSteps(status?: string) {
  if (status === 'maintenance') return ['入库', '可预约', '维护中', '恢复可预约'];
  if (status === 'abnormal_pending') return ['入库', '使用中', '异常待处理', '维护确认', '恢复可预约'];
  if (status === 'disabled') return ['入库', '可预约', '停用/归档'];
  return ['入库', '可预约', '已预约', '使用中', '归还待检', '可预约'];
}

function LifecyclePanel({ status }: { status?: string }) {
  const active = lifecycleLabel(status);
  const steps = lifecycleSteps(status);
  const activeIndex = steps.findIndex((step) => step === active);
  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {steps.map((step, index) => {
        const current = step === active;
        const done = activeIndex < 0 ? index === 0 : index < activeIndex;
        return (
          <div key={String(step) + '-' + index} className={['rounded-2xl border p-3 text-sm', current ? 'border-primary bg-primary/10 text-primary' : done ? 'bg-muted/40 text-foreground' : 'bg-background text-muted-foreground'].join(' ')}>
            <p className="text-xs font-semibold">{index + 1}</p>
            <p className="mt-1 font-semibold">{step}</p>
          </div>
        );
      })}
    </div>
  );
}

function SlotBlocks({ device }: { device: { reservation_slot_options?: Array<{ key: string; label?: string; start?: string; end?: string; start_time?: string; end_time?: string }>; reservation_slot_keys?: string[] } }) {
  const slots = device.reservation_slot_options ?? [];
  const keys = device.reservation_slot_keys ?? [];
  if (slots.length) return <div className="flex flex-wrap gap-1.5">{slots.map((slot) => <OpsTimeBlock key={slot.key} compact label={slot.label || slot.key} title={slot.start || slot.start_time ? compactTimeRange(String(slot.start ?? slot.start_time), String(slot.end ?? slot.end_time ?? '')) : slot.key} />)}</div>;
  if (keys.length) return <div className="flex flex-wrap gap-1.5">{keys.map((key) => <OpsTimeBlock key={key} compact label={key} title={key} />)}</div>;
  return <span className="text-sm text-muted-foreground">系统默认时段</span>;
}

function reservationTitle(item: DeviceReservationSnapshot) {
  return fullDateTimeRange(item.start_time, item.end_time);
}

function userText(row: DeviceReservationSnapshot | DeviceBorrowSnapshot) {
  const name = row.user_name || '预约用户';
  const phone = row.user_phone ? ` / ${row.user_phone}` : '';
  return `${name}${phone}`;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed bg-muted/20 px-4 py-5 text-center text-sm text-muted-foreground">{children}</p>;
}

function ReservationList({ rows, empty }: { rows: DeviceReservationSnapshot[]; empty: string }) {
  if (!rows.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="space-y-2">
      {rows.slice(0, 8).map((item, index) => (
        <div key={String(item.item_id ?? item.id ?? index)} className="rounded-2xl border bg-card/70 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-medium">{reservationTitle(item)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.slot_key ? `时段 ${item.slot_key} · ` : ''}{item.purpose || '未填写用途'}
              </p>
              {item.user_name || item.user_phone ? <p className="mt-1 text-xs text-muted-foreground">{userText(item)}</p> : null}
            </div>
            {statusBadge(item.status)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Occupancy14Days({ rows }: { rows: DeviceReservationSnapshot[] }) {
  if (!rows.length) return <EmptyState>14 天内暂无占用</EmptyState>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.slice(0, 14).map((item, index) => (
        <div key={String(item.item_id ?? item.id ?? index)} className="rounded-2xl border bg-secondary/25 p-3">
          <p className="text-sm font-semibold">{formatDate(item.start_time)}</p>
          <p className="mt-1 text-xs text-muted-foreground"><span title={fullDateTimeRange(item.start_time, item.end_time)}>{compactTimeRange(item.start_time, item.end_time)}</span></p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {statusBadge(item.status)}
            {item.purpose ? <span className="text-xs text-muted-foreground">{item.purpose}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function FaultList({ rows }: { rows: DeviceFaultSnapshot[] }) {
  if (!rows.length) return <EmptyState>暂无故障</EmptyState>;
  return (
    <div className="space-y-2">
      {rows.map((fault, index) => (
        <div key={String(fault.id ?? index)} className="rounded-2xl border bg-card/70 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-medium">{FAULT_TYPE_LABEL[fault.issue_type ?? ''] ?? fault.issue_type ?? '故障上报'}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatTime(fault.created_at)}{fault.resolved_at ? ` · 处理于 ${formatTime(fault.resolved_at)}` : ''}</p>
              {fault.description ? <p className="mt-2 text-sm text-muted-foreground">{fault.description}</p> : null}
              {fault.admin_note ? <p className="mt-1 text-xs text-muted-foreground">处理备注：{fault.admin_note}</p> : null}
            </div>
            {statusBadge(fault.status)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DeviceDetailPage() {
  const nav = useNavigate();
  const code = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() ?? '');
  const { data: detail, isLoading, error } = useQuery({ queryKey: ['device', code], queryFn: () => getDeviceDetail(code), enabled: !!code });
  const device = detail?.device;
  const currentBorrow = detail?.current_borrow ?? device?.current_borrow ?? null;
  const nextReservation = detail?.next_reservation ?? device?.next_reservation ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <button onClick={() => nav({ to: '/devices' } as any)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 返回设备列表
      </button>

      {isLoading ? <Card className="ops-card"><CardContent className="py-8 text-center text-muted-foreground">设备详情加载中…</CardContent></Card> : null}
      {error ? <Card className="ops-card"><CardContent className="py-8 text-center text-destructive">加载失败：{toFriendlyError(error)}</CardContent></Card> : null}

      {device ? (
        <>
          <Card className="ops-card overflow-hidden">
            {device.cover_photo ? <img src={device.cover_photo} alt={device.name} className="h-44 w-full object-cover md:h-52" /> : null}
            <CardHeader className="p-5 pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-2xl">{device.name}</CardTitle>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" />{device.device_code}</span>
                    <span>{device.category || '未分类'}</span>
                    {device.location ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{device.location}</span> : null}
                  </p>
                </div>
                {statusBadge(device.status)}
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border bg-secondary/25 p-3">
                  <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Activity className="h-3 w-3" />当前使用</p>
                  <p className="mt-1 text-sm font-semibold">{currentBorrow ? userText(currentBorrow) : '暂无正在使用'}</p>
                  {currentBorrow ? <p className="mt-1 text-xs text-muted-foreground">借用：{formatTime(currentBorrow.borrow_time)}</p> : null}
                </div>
                <div className="rounded-2xl border bg-secondary/25 p-3">
                  <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><CalendarDays className="h-3 w-3" />下一预约</p>
                  <p className="mt-1 text-sm font-semibold">{nextReservation ? reservationTitle(nextReservation) : '暂无后续预约'}</p>
                  {nextReservation ? <p className="mt-1 text-xs text-muted-foreground">{nextReservation.user_name ? userText(nextReservation) : nextReservation.purpose || '已占用'}</p> : null}
                </div>
                <div className="rounded-2xl border bg-secondary/25 p-3">
                  <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Clock className="h-3 w-3" />最近归还</p>
                  <p className="mt-1 text-sm font-semibold">{formatTime(device.last_return_time)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">状态：{device.last_condition || '未记录'}</p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <OpsMetricCard label="生命周期" value={lifecycleLabel(device.status)} hint={riskText(device.status, device.allow_reservation)} tone={riskLevel(device.status, device.allow_reservation) === 'low' ? 'success' : riskLevel(device.status, device.allow_reservation) === 'medium' ? 'warning' : 'danger'} />
                <OpsMetricCard label="近期预约" value={detail.reservations.length} hint="待使用或进行中" tone="info" />
                <OpsMetricCard label="14天占用" value={detail.occupancy_14_days.length} hint="近两周占用" />
                <OpsMetricCard label="故障记录" value={detail.recent_fault_reports.length} hint="近期上报" tone={detail.recent_fault_reports.length ? 'warning' : 'success'} />
              </div>

              <section className="rounded-xl border bg-muted/20 p-4">
                <OpsSectionHeader
                  title="设备生命周期"
                  action={<OpsRiskBadge level={riskLevel(device.status, device.allow_reservation)} />}
                />
                <div className="mt-4"><LifecyclePanel status={device.status} /></div>
              </section>

              <section className="rounded-xl border bg-background/70 p-4">
                <OpsSectionHeader title="开放预约时段" description="悬停查看完整时段。" action={<OpsBadge tone={device.allow_reservation === false ? 'warning' : 'success'}>{device.allow_reservation === false ? '暂停预约' : '开放预约'}</OpsBadge>} />
                <div className="mt-3"><SlotBlocks device={device} /></div>
              </section>

              {device.description ? <p className="text-sm"><FileText className="mr-1 inline h-3 w-3 text-muted-foreground" />{device.description}</p> : null}
              {device.usage_notice ? <p className="rounded-2xl bg-primary/5 px-3 py-2 text-sm text-muted-foreground">使用须知：{device.usage_notice}</p> : null}

              <div className="flex flex-wrap gap-2">
                <Button disabled={device.allow_reservation === false} onClick={() => nav({ to: '/reserve', search: { device: code } } as any)}>
                  立即预约
                </Button>
                <Button variant="outline" onClick={() => nav({ to: '/faults', search: { device: code } } as any)}>
                  <AlertTriangle className="h-4 w-4" /> 上报故障
                </Button>
                <Button
                  variant="outline"
                  onClick={() => nav({
                    to: '/chat',
                    search: buildChatSearch({
                      contactAdmin: true,
                      type: 'device',
                      title: `设备咨询：${device.device_code}`,
                      detail: device.name,
                      deviceCode: device.device_code,
                      deviceName: device.name,
                      status: device.status
                    })
                  } as any)}
                >
                  <MessageSquare className="h-4 w-4" /> 咨询设备
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="ops-card">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4 text-primary" />14 天占用</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <Occupancy14Days rows={detail.occupancy_14_days} />
              </CardContent>
            </Card>

            <Card className="ops-card">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="flex items-center gap-2 text-base"><UserRound className="h-4 w-4 text-primary" />近期预约</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <ReservationList rows={detail.reservations} empty="暂无待使用或进行中的预约" />
              </CardContent>
            </Card>
          </div>

          <Card className="ops-card">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-primary" />近期故障</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <FaultList rows={detail.recent_fault_reports} />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
