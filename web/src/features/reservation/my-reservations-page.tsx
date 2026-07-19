import { briefDateTime } from '@/lib/time-format';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CalendarClock, ChevronDown, ChevronUp, MessageSquare, PlayCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useActionDialog } from '@/components/ui/action-dialog';
import { buildChatSearch } from '@/features/chat/chat-context';
import { compactTimeRange, fullDateTimeRange, shortDate, slotDisplayName } from '@/lib/time-format';
import { cancelReservationItem, getBatch, listMyBatches, startReservationBatch, type ReservationItem } from './reservation-api';
import { startBorrow } from '../borrow/borrow-api';
import { toFriendlyError } from '@/lib/friendly-error';
import { CompactId, formatCompactId } from '@/components/ui/compact-id';
import { OpsPageHeader } from '@/components/ops/design-system';

const STATUS_LABEL: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  in_use: '使用中',
  completed: '已完成',
  cancelled: '已取消',
  no_show: '缺席',
  rejected: '已驳回',
  faulted: '异常结束',
  cancel_requested: '取消审批中'
};

const STATUS_TONE: Record<string, string> = {
  pending: 'badge-warn',
  approved: 'badge-info',
  in_use: 'badge-success',
  completed: 'badge-muted',
  cancelled: 'badge-muted',
  no_show: 'badge-danger',
  rejected: 'badge-danger',
  faulted: 'badge-danger',
  cancel_requested: 'badge-warn'
};

function formatTime(value?: string) {
  if (!value) return '—';
  return briefDateTime(value);
}

function formatDateRange(item: ReservationItem) {
  return `${shortDate(item.start_time)} · ${compactTimeRange(item.start_time, item.end_time)}`;
}

function itemId(item: ReservationItem) {
  return item.item_id || item.id;
}

function canCancel(item: ReservationItem) {
  return ['pending', 'approved'].includes(item.status);
}

function canStart(item: ReservationItem) {
  return item.status === 'approved';
}

export function MyReservationsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { confirm, prompt, ActionDialog } = useActionDialog();
  const [activeBatchId, setActiveBatchId] = useState<string>('');
  const { data = [], isLoading, error } = useQuery({ queryKey: ['my-reservation-batches'], queryFn: listMyBatches });
  const detail = useQuery({
    queryKey: ['my-reservation-batch', activeBatchId],
    queryFn: () => getBatch(activeBatchId),
    enabled: Boolean(activeBatchId)
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => cancelReservationItem(id, reason),
    onSuccess: async (result) => {
      toast.success(result.message || (result.status === 'cancel_requested' ? '取消申请已提交' : '预约已取消'));
      await qc.invalidateQueries({ queryKey: ['my-reservation-batches'] });
      if (activeBatchId) await qc.invalidateQueries({ queryKey: ['my-reservation-batch', activeBatchId] });
    },
    onError: (err) => toast.error(`取消失败：${toFriendlyError(err)}`)
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => startBorrow({ reservation_item_id: id }),
    onSuccess: async (record) => {
      toast.success(`已开始使用${record.device_code ? `：${record.device_code}` : ''}，借用记录 ${formatCompactId(record.id, 8, 4, 'BOR')}`);
      await qc.invalidateQueries({ queryKey: ['my-reservation-batches'] });
      if (activeBatchId) await qc.invalidateQueries({ queryKey: ['my-reservation-batch', activeBatchId] });
    },
    onError: (err) => toast.error(`开始使用失败：${toFriendlyError(err)}`)
  });

  const startBatchMutation = useMutation({
    mutationFn: (batchId: string) => startReservationBatch(batchId),
    onSuccess: async (result) => {
      if (result.started_count > 0) toast.success(result.message);
      else if (result.blocked_count > 0) toast.error(result.message);
      else toast.info(result.message);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['my-reservation-batches'] }),
        qc.invalidateQueries({ queryKey: ['my-records'] }),
        qc.invalidateQueries({ queryKey: ['calendar'] }),
        activeBatchId ? qc.invalidateQueries({ queryKey: ['my-reservation-batch', activeBatchId] }) : Promise.resolve()
      ]);
    },
    onError: (err) => toast.error(`批量开始失败：${toFriendlyError(err)}`)
  });

  async function requestCancellation(item: ReservationItem) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const reservationDay = new Date(item.start_time).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const sameDay = reservationDay === today;
    let reason = '';

    if (sameDay) {
      const input = await prompt({
        title: '申请当天取消',
        description: '当天取消不会立即释放时段，需管理员审批。请填写原因，审批结果会在预约状态中更新。',
        placeholder: '如：实验计划调整、临时冲突',
        confirmText: '提交取消申请',
        tone: 'warning',
        required: true,
        maxLength: 500
      });
      if (input === null) return;
      reason = input;
    } else {
      const accepted = await confirm({
        title: '确认取消预约',
        description: '取消后该设备时段会立即释放，提前取消不会计入异常记录。',
        confirmText: '确认取消',
        tone: 'warning'
      });
      if (!accepted) return;
    }

    cancelMutation.mutate({ id: itemId(item), reason });
  }

  return (
    <div className="ops-page-stack reservation-page">
      <ActionDialog />
      <OpsPageHeader title="我的预约" />

      <section className="reservation-rule-note" aria-label="预约规则">
        <p className="font-semibold">预约与爽约规则</p>
        <p>开始前 1 天可自行取消，当天取消需审批；开始前 30 分钟提醒，开始后 30 分钟仍未操作将自动转为使用中。</p>
      </section>

      {data.map((batch) => {
        const open = activeBatchId === batch.id;
        const displayStatus = Number(batch.in_use_count || 0) > 0 ? 'in_use' : batch.status;
        return (
          <Card key={batch.id} className="ops-card">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="flex flex-col gap-3 text-base sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-primary" />
                    <span>{batch.device_names || batch.device_codes || `预约批次 ${formatCompactId(batch.id, 8, 4, 'RSV')}`}</span>
                  </div>
                  <p className="mt-1 text-xs font-normal text-muted-foreground">
                    {batch.item_count ?? 0} 条明细 · {batch.device_count ?? '—'} 台设备 · {batch.date_count ?? '—'} 天
                  </p>
                </div>
                <span className={`badge-pill ${STATUS_TONE[displayStatus] ?? 'badge-muted'}`}>
                  {STATUS_LABEL[displayStatus] ?? displayStatus}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              <div className="reservation-batch-summary grid gap-2 sm:grid-cols-2">
                <p>提交时间：{formatTime(batch.created_at)}</p>
                <p title={fullDateTimeRange(batch.first_start_time, batch.last_end_time)}>预约范围：{shortDate(batch.first_start_time)} · {compactTimeRange(batch.first_start_time, batch.last_end_time)}</p>
                <p className="sm:col-span-2">用途：{batch.purpose || '未填写'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Number(batch.approved_count || 0) > 0 ? (
                  <Button type="button" size="sm" onClick={() => startBatchMutation.mutate(batch.id)} disabled={startBatchMutation.isPending}>
                    <PlayCircle className="h-4 w-4" /> 一键开始本批
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveBatchId(open ? '' : batch.id)}
                >
                  {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {open ? '收起明细' : '查看明细'}
                </Button>
              </div>

              {open ? (
                <div className="space-y-2 reservation-detail-panel p-3">
                  {detail.isLoading ? <p className="py-4 text-center text-sm text-muted-foreground">明细加载中…</p> : null}
                  {detail.error ? <p className="py-4 text-center text-sm text-destructive">明细加载失败：{toFriendlyError(detail.error)}</p> : null}
                  {detail.data?.items?.map((item) => (
                    <div key={itemId(item)} className="flex flex-col gap-3 reservation-detail-item p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium">{item.device_name || item.device_code || <CompactId value={item.device_id} prefix="DEV" />}</p>
                        <p className="mt-1 text-xs text-muted-foreground"><span title={fullDateTimeRange(item.start_time, item.end_time)}>{formatDateRange(item)}</span> · {slotDisplayName(item.slot_key)}</p>
                        {item.admin_note ? <p className="mt-1 text-xs text-muted-foreground">审核备注：{item.admin_note}</p> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`badge-pill ${STATUS_TONE[item.status] ?? 'badge-muted'}`}>
                          {STATUS_LABEL[item.status] ?? item.status}
                        </span>
                        {canStart(item) ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => startMutation.mutate(itemId(item))}
                            disabled={startMutation.isPending}
                          >
                            <PlayCircle className="h-4 w-4" /> 开始使用
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => nav({
                            to: '/chat',
                            search: buildChatSearch({
                              contactAdmin: true,
                              type: 'reservation',
                              title: `预约沟通：${item.device_code || item.device_name || itemId(item)}`,
                              detail: batch.purpose || item.purpose || '预约使用沟通',
                              deviceCode: item.device_code || batch.device_codes,
                              deviceName: item.device_name || batch.device_names,
                              status: item.status || batch.status,
                              reservationId: itemId(item),
                              batchId: batch.id,
                              startTime: item.start_time,
                              endTime: item.end_time
                            })
                          } as any)}
                        >
                          <MessageSquare className="h-4 w-4" /> 联系管理员
                        </Button>
                        {canCancel(item) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void requestCancellation(item)}
                            disabled={cancelMutation.isPending}
                          >
                            <XCircle className="h-4 w-4" /> 取消
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {detail.data && detail.data.items.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">暂无明细</p> : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      {isLoading ? <Card className="ops-card"><CardContent className="py-8 text-center text-muted-foreground">预约记录加载中…</CardContent></Card> : null}
      {error ? <Card className="ops-card"><CardContent className="py-8 text-center text-destructive">加载失败：{toFriendlyError(error)}</CardContent></Card> : null}
      {!isLoading && !error && data.length === 0 ? (
        <Card className="ops-card"><CardContent className="py-8 text-center text-muted-foreground">暂无预约记录</CardContent></Card>
      ) : null}
    </div>
  );
}




