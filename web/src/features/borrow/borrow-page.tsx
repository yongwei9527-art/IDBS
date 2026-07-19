import { useMemo, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronRight, Clock3, ImagePlus, RotateCcw, Settings2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { OpsPageHeader } from '@/components/ops/design-system';
import { briefDateTime } from '@/lib/time-format';
import { toFriendlyError } from '@/lib/friendly-error';
import { uploadImage } from '@/lib/api';
import { extendBorrow, listMyBorrowRecords, precheckBorrowExtension, submitReturn, supplementReturnMaterials, type BorrowRecord } from './borrow-api';

const ABNORMAL_REASON_OPTIONS = [
  { value: 'missing_accessory', label: '配件缺失' },
  { value: 'appearance_damage', label: '外观损坏' },
  { value: 'operation_abnormal', label: '运行异常' },
  { value: 'other', label: '其他异常' }
] as const;

const OVERDUE_REASON_OPTIONS = [
  { value: 'experiment_not_finished', label: '实验尚未结束' },
  { value: 'awaiting_result', label: '等待样品结果' },
  { value: 'forgot_return', label: '忘记归还' },
  { value: 'other', label: '其他原因' }
] as const;

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
    mutationFn: ({ id, expectedReturnTime }: { id: string; expectedReturnTime?: string }) =>
      extendBorrow(id, expectedReturnTime ? { expected_return_time: expectedReturnTime } : {}),
    onSuccess: async (data: BorrowRecord | { record?: BorrowRecord; message?: string }) => {
      toast.success(('message' in data && data.message) || '续约成功');
      setManualRecordId('');
      setManualEnd('');
      await qc.invalidateQueries({ queryKey: ['my-borrow-records'] });
      await qc.invalidateQueries({ queryKey: ['my-reservation-batches'] });
    },
    onError: (error) => toast.error('续约失败：' + toFriendlyError(error))
  });
  const activeRecords = useMemo(
    () => (records.data?.borrows ?? []).filter((record) => record.status === 'in_use'),
    [records.data?.borrows]
  );
  const pendingReturnRecords = useMemo(
    () => (records.data?.borrows ?? []).filter((record) => ['return_pending', 'abnormal_pending'].includes(record.status)),
    [records.data?.borrows]
  );

  async function precheck(record: BorrowRecord, expectedReturnTime?: string) {
    try {
      const result = await precheckBorrowExtension(
        record.id,
        expectedReturnTime ? { expected_return_time: expectedReturnTime } : {}
      );
      if (!result.available) {
        toast.warning(result.reasons.map((item) => item.message).join('；') || '当前条件不满足续约规则');
        return false;
      }
      return true;
    } catch (error) {
      toast.error('续约预检失败：' + toFriendlyError(error));
      return false;
    }
  }

  async function extendDefault(record: BorrowRecord) {
    if (await precheck(record)) extend.mutate({ id: record.id });
  }

  function openManual(record: BorrowRecord) {
    setManualRecordId(record.id);
    setManualEnd(toDatetimeLocal(record.expected_return_time));
  }

  async function submitManual(record: BorrowRecord) {
    if (!manualEnd) {
      toast.warning('请选择新的预计归还时间');
      return;
    }
    const chosen = new Date(manualEnd);
    const currentEnd = new Date(record.expected_return_time || '');
    if (Number.isNaN(chosen.getTime()) || chosen <= currentEnd) {
      toast.warning('新的归还时间须晚于当前预计归还时间');
      return;
    }
    if (await precheck(record, chosen.toISOString())) {
      extend.mutate({ id: record.id, expectedReturnTime: chosen.toISOString() });
    }
  }

  return (
    <div className="ops-page-stack">
      <OpsPageHeader title="设备使用中" />
      <section className="borrow-overview">
        <div className="min-w-0">
          <p className="borrow-overview-label">使用概览</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold tracking-tight">续约与归还</h2>
            <p className="text-sm text-muted-foreground">续约前校验冲突；归还按设备要求提交材料。</p>
          </div>
        </div>
        <div className="borrow-overview-count">
          <CalendarClock className="h-5 w-5" />
          <div><p>当前使用中</p><strong>{activeRecords.length}<span> 台</span></strong></div>
        </div>
      </section>

      {records.isLoading ? <p className="rounded-2xl border bg-muted/30 p-5 text-center text-sm text-muted-foreground">借用记录加载中…</p> : null}
      {records.error ? <p className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-center text-sm text-destructive">借用记录加载失败：{toFriendlyError(records.error)}</p> : null}
      {!records.isLoading && !records.error && activeRecords.length === 0 && pendingReturnRecords.length === 0 ? (
        <Card className="ops-card">
          <CardContent className="flex min-h-56 flex-col items-center justify-center p-6 text-center">
            <Clock3 className="h-9 w-9 text-muted-foreground/60" />
            <p className="mt-3 font-semibold">当前没有使用中的设备</p>
            <p className="mt-1 text-sm text-muted-foreground">开始使用已通过的预约后，可在这里续约或提交归还。</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 2xl:grid-cols-2">
        {activeRecords.map((record, index) => {
          const editing = manualRecordId === record.id;
          return (
            <Card key={record.id} className="ops-card overflow-hidden">
              <CardContent className="p-0">
                <div className="flex items-start justify-between gap-4 p-5 pb-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge-pill badge-success">使用中</span>
                      <span className="text-xs text-muted-foreground">设备 {String(index + 1).padStart(2, '0')}</span>
                    </div>
                    <h2 className="mt-3 truncate text-base font-semibold">{record.device_name || record.device_code || '设备使用中'}</h2>
                    {record.device_code && record.device_name ? <p className="mt-1 text-xs text-muted-foreground">{record.device_code}</p> : null}
                  </div>
                  <Clock3 className="mt-1 h-5 w-5 shrink-0 text-primary" />
                </div>

                <div className="mx-5 grid overflow-hidden rounded-2xl border borrow-time-summary sm:grid-cols-2">
                  <div className="p-4">
                    <p className="text-xs text-muted-foreground">当前预计归还</p>
                    <p className="mt-1 text-base font-semibold tracking-tight">{briefDateTime(record.expected_return_time)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">开始使用：{briefDateTime(record.borrow_time)}</p>
                  </div>
                  <div className="border-t bg-primary/5 p-4 sm:border-l sm:border-t-0">
                    <p className="text-xs text-muted-foreground">剩余可用时间</p>
                    <p className="mt-1 text-base font-semibold tracking-tight text-primary">{durationText(record.expected_return_time)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">续约前检查冲突与限制</p>
                  </div>
                </div>

                <div className="mt-4 border-t p-5">
                  {editing ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" /><p className="font-semibold">手动续约</p></div>
                      <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                        新的预计归还时间
                        <Input type="datetime-local" value={manualEnd} min={toDatetimeLocal(record.expected_return_time)} onChange={(event) => setManualEnd(event.target.value)} />
                      </label>
                      <p className="text-xs leading-5 text-muted-foreground">单次最长 8 小时，提交后再次校验。</p>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => { setManualRecordId(''); setManualEnd(''); }}>取消</Button>
                        <Button type="button" size="sm" disabled={extend.isPending} onClick={() => submitManual(record)}>{extend.isPending ? '检查中…' : '确认续约'}</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button type="button" className="h-11" disabled={extend.isPending} onClick={() => extendDefault(record)}><RotateCcw className="h-4 w-4" />默认续约下一时段</Button>
                      <Button type="button" className="h-11" variant="outline" disabled={extend.isPending} onClick={() => openManual(record)}>手动选择时间<ChevronRight className="h-4 w-4" /></Button>
                    </div>
                  )}
                </div>

                <BorrowReturnPanel record={record} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {pendingReturnRecords.length ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-semibold">归还处理中</h2>
              <p className="mt-1 text-xs text-muted-foreground">设备完成检查前不会重新开放预约；异常记录请及时联系实验室管理员补充材料。</p>
            </div>
            <span className="badge-pill badge-warn">{pendingReturnRecords.length} 条待处理</span>
          </div>
          <div className="grid gap-3 2xl:grid-cols-2">
            {pendingReturnRecords.map((record) => (
              <Card key={record.id} className="ops-card">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`badge-pill ${record.status === 'abnormal_pending' ? 'badge-danger' : 'badge-warn'}`}>
                          {record.status === 'abnormal_pending' ? '异常待处理' : '等待验收'}
                        </span>
                        {record.is_overdue ? <span className="badge-pill badge-danger">逾期归还</span> : null}
                        {record.return_material_required ? <span className="badge-pill badge-warn">待补充材料</span> : null}
                      </div>
                      <p className="mt-2 font-semibold">{record.device_name || record.device_code || '设备归还'}</p>
                      <p className="mt-1 text-xs text-muted-foreground">提交时间：{briefDateTime(record.return_time)}</p>
                      {record.return_note ? <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">说明：{record.return_note}</p> : null}
                    </div>
                    <p className="max-w-52 text-right text-xs leading-5 text-muted-foreground">
                      {record.return_material_required
                        ? `补充截止：${briefDateTime(record.return_material_deadline)}`
                        : record.status === 'abnormal_pending'
                          ? '管理员处理异常后会更新设备状态。'
                          : '验收通过后设备恢复可预约。'}
                    </p>
                  </div>
                  {record.return_material_required ? <ReturnSupplementPanel record={record} /> : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function BorrowReturnPanel({ record }: { record: BorrowRecord }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [condition, setCondition] = useState<'normal' | 'missing_accessory' | 'appearance_damage' | 'operation_abnormal' | 'other'>('normal');
  const [overdueReason, setOverdueReason] = useState<'experiment_not_finished' | 'awaiting_result' | 'forgot_return' | 'other'>('experiment_not_finished');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const isAbnormal = condition !== 'normal';
  const isOverdue = Boolean(record.expected_return_time && new Date(record.expected_return_time).getTime() < Date.now());
  const photoRequired = isAbnormal || Boolean(record.return_photo_required) || record.return_mode === 'image_required';
  const noteRequired = Boolean(record.return_require_note);
  const returnMutation = useMutation({
    mutationFn: () => submitReturn(record.id, {
      return_condition: isAbnormal ? 'abnormal' : 'normal',
      return_note: note.trim(),
      return_photos: photos,
      abnormal_reason_category: isAbnormal ? condition : undefined,
      overdue_reason_category: isOverdue ? overdueReason : undefined
    }),
    onSuccess: async (result) => {
      toast.success(('message' in result && result.message) || '归还已提交');
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['my-borrow-records'] });
      await qc.invalidateQueries({ queryKey: ['my-reservation-batches'] });
    },
    onError: (error) => toast.error('归还提交失败：' + toFriendlyError(error))
  });

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).slice(0, Math.max(0, 5 - photos.length));
    event.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of files) uploaded.push(await uploadImage(file));
      setPhotos((current) => [...current, ...uploaded].slice(0, 5));
    } catch (error) {
      toast.error('照片上传失败：' + toFriendlyError(error));
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit() {
    if (photoRequired && photos.length === 0) {
      toast.warning(isAbnormal ? '异常归还必须上传设备照片' : '该设备要求上传归还照片');
      return;
    }
    if (noteRequired && !note.trim()) {
      toast.warning('该设备要求填写归还说明');
      return;
    }
    returnMutation.mutate();
  }

  return (
    <div className="border-t bg-muted/10 p-5">
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">完成使用后提交归还</p>
            <p className="mt-1 text-xs text-muted-foreground">{record.return_rule_label || '按设备归还规则提交'}{record.return_require_note ? ' · 说明必填' : ''}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => setOpen(true)}><Undo2 className="h-4 w-4" />提交归还</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div><p className="font-semibold">归还确认</p><p className="mt-1 text-xs text-muted-foreground">如实选择设备状态；异常归还将进入管理员处置。</p></div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>收起</Button>
          </div>

          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            设备归还状态
            <select className="h-10 rounded-md border border-input bg-card px-3 text-sm text-foreground" value={condition} onChange={(event) => setCondition(event.target.value as typeof condition)}>
              <option value="normal">正常完好</option>
              {ABNORMAL_REASON_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>

          {isOverdue ? (
            <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
              逾期原因
              <select className="h-10 rounded-md border border-input bg-card px-3 text-sm text-foreground" value={overdueReason} onChange={(event) => setOverdueReason(event.target.value as typeof overdueReason)}>
                {OVERDUE_REASON_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          ) : null}

          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            归还说明{noteRequired ? '（必填）' : '（选填）'}
            <textarea rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="说明设备状态、配件情况或需要管理员关注的问题" className="rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground" />
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground"><span>归还照片{photoRequired ? '（必传）' : '（选传）'}</span><span>{photos.length}/5</span></div>
            {photos.length < 5 ? (
              <label className="ops-upload-zone">
                <ImagePlus className="h-4 w-4" />
                <span>{uploading ? '正在上传…' : '选择设备照片'}</span>
                <input className="sr-only" type="file" accept="image/*" multiple disabled={uploading || returnMutation.isPending} onChange={handleFiles} />
              </label>
            ) : null}
            {photos.length ? (
              <div className="flex flex-wrap gap-2">
                {photos.map((photo, index) => (
                  <div key={photo} className="relative h-20 w-20 overflow-hidden rounded-xl border bg-muted">
                    <img src={photo} alt={`归还照片 ${index + 1}`} className="h-full w-full object-cover" />
                    <button type="button" aria-label={`删除归还照片 ${index + 1}`} onClick={() => setPhotos((current) => current.filter((item) => item !== photo))} className="absolute right-1 top-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] text-white">删除</button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <p className="rounded-xl bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">提交后设备进入归还检查；异常会暂停后续预约，管理员处理后再恢复设备。</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={returnMutation.isPending || uploading} onClick={() => setOpen(false)}>取消</Button>
            <Button type="button" disabled={returnMutation.isPending || uploading} onClick={handleSubmit}>{returnMutation.isPending ? '提交中…' : '确认归还'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReturnSupplementPanel({ record }: { record: BorrowRecord }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const deadlinePassed = Boolean(record.return_material_deadline && new Date(record.return_material_deadline).getTime() < Date.now());
  const mutation = useMutation({
    mutationFn: () => supplementReturnMaterials(record.id, {
      return_supplement_note: note.trim(),
      return_supplement_photos: photos
    }),
    onSuccess: async (result) => {
      toast.success(result.message || '材料已补充');
      await qc.invalidateQueries({ queryKey: ['my-borrow-records'] });
    },
    onError: (error) => toast.error('材料补充失败：' + toFriendlyError(error))
  });

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).slice(0, Math.max(0, 5 - photos.length));
    event.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of files) uploaded.push(await uploadImage(file));
      setPhotos((current) => [...current, ...uploaded].slice(0, 5));
    } catch (error) {
      toast.error('照片上传失败：' + toFriendlyError(error));
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    if (!note.trim() && photos.length === 0) {
      toast.warning('请补充照片或情况说明');
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <div className={`rounded-xl px-3 py-2 text-xs ${deadlinePassed ? 'border border-destructive/30 bg-destructive/5 text-destructive' : 'border border-amber-400/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'}`}>
        {deadlinePassed ? '补充时间已超时，仍可提交；系统会保留超时记录。' : `请在 ${briefDateTime(record.return_material_deadline)} 前补充。`}
      </div>
      <textarea rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="补充设备状态、配件情况或异常说明" className="w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground" />
      <div className="flex flex-wrap items-center gap-2">
        {photos.length < 5 ? (
          <label className="ops-upload-zone flex-1">
            <ImagePlus className="h-4 w-4" />
            <span>{uploading ? '正在上传…' : '补充照片'}</span>
            <input className="sr-only" type="file" accept="image/*" multiple disabled={uploading || mutation.isPending} onChange={handleFiles} />
          </label>
        ) : null}
        <Button type="button" disabled={uploading || mutation.isPending} onClick={submit}>{mutation.isPending ? '提交中…' : '提交补充材料'}</Button>
      </div>
      {photos.length ? (
        <div className="flex flex-wrap gap-2">
          {photos.map((photo, index) => (
            <div key={photo} className="relative h-16 w-16 overflow-hidden rounded-xl border bg-muted">
              <img src={photo} alt={`补充照片 ${index + 1}`} className="h-full w-full object-cover" />
              <button type="button" aria-label={`删除补充照片 ${index + 1}`} onClick={() => setPhotos((current) => current.filter((item) => item !== photo))} className="absolute right-1 top-1 rounded bg-black/65 px-1 text-[10px] text-white">删除</button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
