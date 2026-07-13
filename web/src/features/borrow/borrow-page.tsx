import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronRight, Clock3, RotateCcw, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { OpsPageHeader } from '@/components/ops/design-system';
import { briefDateTime } from '@/lib/time-format';
import { toFriendlyError } from '@/lib/friendly-error';
import { extendBorrow, listMyBorrowRecords, type BorrowRecord } from './borrow-api';

function toDatetimeLocal(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function durationText(value?: string) {
  const end = new Date(value || '').getTime();
  if (Number.isNaN(end)) return '时间待确认';
  const minutes = Math.max(0, Math.round((end - Date.now()) / 60_000));
  if (minutes === 0) return '请尽快归还';
  if (minutes < 60) return '约 ' + minutes + ' 分钟';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? '约 ' + hours + ' 小时 ' + rest + ' 分钟' : '约 ' + hours + ' 小时';
}

export function BorrowIndexPage() {
  const qc = useQueryClient();
  const records = useQuery({ queryKey: ['my-borrow-records'], queryFn: listMyBorrowRecords });
  const [manualRecordId, setManualRecordId] = useState('');
  const [manualEnd, setManualEnd] = useState('');
  const extend = useMutation({
    mutationFn: ({ id, expectedReturnTime }: { id: string; expectedReturnTime?: string }) => extendBorrow(id, expectedReturnTime ? { expected_return_time: expectedReturnTime } : {}),
    onSuccess: async (data: BorrowRecord | { record?: BorrowRecord; message?: string }) => {
      toast.success(('message' in data && data.message) || '续约成功');
      setManualRecordId(''); setManualEnd('');
      await qc.invalidateQueries({ queryKey: ['my-borrow-records'] });
      await qc.invalidateQueries({ queryKey: ['my-reservation-batches'] });
    },
    onError: (error) => toast.error('续约失败：' + toFriendlyError(error))
  });
  const activeRecords = useMemo(() => (records.data?.borrows ?? []).filter((record) => record.status === 'in_use'), [records.data?.borrows]);
  function extendDefault(record: BorrowRecord) { extend.mutate({ id: record.id }); }
  function openManual(record: BorrowRecord) { setManualRecordId(record.id); setManualEnd(toDatetimeLocal(record.expected_return_time)); }
  function submitManual(record: BorrowRecord) {
    if (!manualEnd) { toast.warning('请选择新的归还时间。'); return; }
    const chosen = new Date(manualEnd); const currentEnd = new Date(record.expected_return_time || '');
    if (Number.isNaN(chosen.getTime()) || chosen <= currentEnd) { toast.warning('新的归还时间需晚于当前预计归还时间。'); return; }
    extend.mutate({ id: record.id, expectedReturnTime: chosen.toISOString() });
  }
  return (
    <div className="ops-page-stack">
      <OpsPageHeader title="设备使用中" description="在一个页面查看归还时间、确认下一时段是否空闲并完成续约。" />
      <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-6">
          <div className="min-w-0"><p className="text-xs font-bold tracking-wide text-primary">续约说明</p><h2 className="mt-1 text-lg font-black tracking-tight">续约不占用他人的预约时段</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">默认按原预约时长续至下一时段；也可自选归还时间。系统会在提交时同时检查后续预约与设备维护安排。</p></div>
          <div className="flex items-center gap-3 rounded-2xl bg-primary/8 px-4 py-3 text-primary"><CalendarClock className="h-5 w-5" /><div><p className="text-xs font-semibold">当前使用中</p><p className="text-xl font-black leading-6">{activeRecords.length} 台</p></div></div>
        </div>
        <div className="grid border-t bg-muted/20 text-xs text-muted-foreground sm:grid-cols-3"><p className="px-5 py-3"><b className="mr-1 text-foreground">01</b> 默认续约下一个时段</p><p className="border-t px-5 py-3 sm:border-l sm:border-t-0"><b className="mr-1 text-foreground">02</b> 支持手动选择归还时间</p><p className="border-t px-5 py-3 sm:border-l sm:border-t-0"><b className="mr-1 text-foreground">03</b> 冲突时自动保护原预约</p></div>
      </section>
      {records.isLoading ? <p className="rounded-2xl border bg-muted/30 p-5 text-center text-sm text-muted-foreground">借用记录加载中…</p> : null}
      {records.error ? <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-center text-sm text-destructive">借用记录加载失败：{toFriendlyError(records.error)}</p> : null}
      {!records.isLoading && !records.error && activeRecords.length === 0 ? <Card className="ops-card"><CardContent className="flex min-h-56 flex-col items-center justify-center p-6 text-center"><Clock3 className="h-9 w-9 text-muted-foreground/60" /><p className="mt-3 font-semibold">当前没有使用中的设备</p><p className="mt-1 text-sm text-muted-foreground">开始使用已通过的预约后，可在这里查看时间与续约。</p></CardContent></Card> : null}
      <div className="grid gap-4 2xl:grid-cols-2">
        {activeRecords.map((record, index) => {
          const editing = manualRecordId === record.id;
          return <Card key={record.id} className="ops-card overflow-hidden"><CardContent className="p-0">
            <div className="flex items-start justify-between gap-4 p-5 pb-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="badge-pill badge-success">使用中</span><span className="text-xs text-muted-foreground">设备 {String(index + 1).padStart(2, '0')}</span></div><h2 className="mt-3 truncate text-lg font-black">{record.device_name || record.device_code || '设备使用中'}</h2>{record.device_code && record.device_name ? <p className="mt-1 text-xs text-muted-foreground">{record.device_code}</p> : null}</div><Clock3 className="mt-1 h-5 w-5 shrink-0 text-primary" /></div>
            <div className="mx-5 grid overflow-hidden rounded-2xl border bg-muted/25 sm:grid-cols-2"><div className="p-4"><p className="text-xs text-muted-foreground">当前预计归还</p><p className="mt-1 text-lg font-black tracking-tight">{briefDateTime(record.expected_return_time)}</p><p className="mt-1 text-xs text-muted-foreground">开始使用：{briefDateTime(record.borrow_time)}</p></div><div className="border-t bg-primary/5 p-4 sm:border-l sm:border-t-0"><p className="text-xs text-muted-foreground">剩余可用时间</p><p className="mt-1 text-lg font-black tracking-tight text-primary">{durationText(record.expected_return_time)}</p><p className="mt-1 text-xs text-muted-foreground">续约前请确认仍需继续使用</p></div></div>
            <div className="mt-4 border-t bg-muted/10 p-5">{editing ? <div className="space-y-3"><div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" /><p className="font-semibold">手动续约</p></div><label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">新的预计归还时间<Input type="datetime-local" value={manualEnd} min={toDatetimeLocal(record.expected_return_time)} onChange={(event) => setManualEnd(event.target.value)} /></label><p className="text-xs leading-5 text-muted-foreground">单次最长延长 8 小时；提交后会再次检查预约与维护冲突。</p><div className="flex flex-wrap justify-end gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => { setManualRecordId(''); setManualEnd(''); }}>取消</Button><Button type="button" size="sm" disabled={extend.isPending} onClick={() => submitManual(record)}>{extend.isPending ? '检查中…' : '确认续约'}</Button></div></div> : <div className="grid gap-2 sm:grid-cols-2"><Button type="button" className="h-11" disabled={extend.isPending} onClick={() => extendDefault(record)}><RotateCcw className="h-4 w-4" />默认续约下一时段</Button><Button type="button" className="h-11" variant="outline" disabled={extend.isPending} onClick={() => openManual(record)}>手动选择时间<ChevronRight className="h-4 w-4" /></Button></div>}</div>
          </CardContent></Card>;
        })}
      </div>
    </div>
  );
}
