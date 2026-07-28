import { useState, type FormEvent } from 'react';
import { PackageCheck, RotateCcw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OpsEmptyState, OpsPageHeader } from '@/components/ops/design-system';
import { briefDateTime } from '@/lib/time-format';
import { toFriendlyError } from '@/lib/friendly-error';
import {
  useCancelMaterialRequest,
  useCreateMaterialRequest,
  useMyMaterialRequests,
  type MaterialRequestStatus
} from './material-request-api';

const STATUS: Record<MaterialRequestStatus, { label: string; className: string }> = {
  pending: { label: '待处理', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  approved: { label: '已批准', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  rejected: { label: '已驳回', className: 'bg-red-500/15 text-red-700 dark:text-red-300' },
  fulfilled: { label: '已发放', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  cancelled: { label: '已撤回', className: 'bg-muted text-muted-foreground' }
};

export function MaterialRequestPage() {
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [purpose, setPurpose] = useState('');
  const requests = useMyMaterialRequests();
  const create = useCreateMaterialRequest();
  const cancel = useCancelMaterialRequest();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(quantity);
    if (!itemName.trim() || !unit.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error('请填写材料名称、有效数量和单位。');
      return;
    }
    try {
      const result = await create.mutateAsync({ item_name: itemName.trim(), quantity: amount, unit: unit.trim(), purpose: purpose.trim() });
      toast.success(result.message || '材料清单申请已提交。');
      setItemName('');
      setQuantity('');
      setUnit('');
      setPurpose('');
    } catch (error) {
      toast.error(toFriendlyError(error));
    }
  }

  async function withdraw(id: string) {
    try {
      const result = await cancel.mutateAsync(id);
      toast.success(result.message || '已撤回材料申请。');
    } catch (error) {
      toast.error(toFriendlyError(error));
    }
  }

  return (
    <div className="space-y-4">
      <OpsPageHeader
        eyebrow="材料服务"
        title="材料清单申请"
        description="提交实验或使用前所需材料；管理员会在此处反馈批准、驳回或发放状态。"
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">新建申请</CardTitle>
            <p className="text-sm text-muted-foreground">每项材料单独提交，便于按库存发放。</p>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={submit}>
              <label className="block text-sm font-medium">材料名称
                <input value={itemName} onChange={(event) => setItemName(event.target.value)} maxLength={120} required placeholder="例如：425 水泥" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" />
              </label>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] gap-3">
                <label className="block text-sm font-medium">数量
                  <input value={quantity} onChange={(event) => setQuantity(event.target.value)} type="number" min="0.001" max="1000000" step="0.001" required placeholder="例如：2" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" />
                </label>
                <label className="block text-sm font-medium">单位
                  <input value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={30} required placeholder="袋、kg、件…" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" />
                </label>
              </div>
              <label className="block text-sm font-medium">用途说明 <span className="font-normal text-muted-foreground">（可选）</span>
                <textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={1000} rows={4} placeholder="说明实验、课程或使用目的" className="mt-1 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm" />
              </label>
              <Button type="submit" className="w-full sm:w-auto" disabled={create.isPending}><Send />{create.isPending ? '提交中…' : '提交申请'}</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">我的申请</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">待处理申请可自行撤回。</p>
            </div>
            <Button size="icon" variant="ghost" aria-label="刷新材料申请" title="刷新" onClick={() => void requests.refetch()}><RotateCcw /></Button>
          </CardHeader>
          <CardContent>
            {requests.isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p> : null}
            {requests.error ? <p className="py-8 text-center text-sm text-destructive">{toFriendlyError(requests.error)}</p> : null}
            {!requests.isLoading && !requests.error && !requests.data?.length ? <OpsEmptyState icon={<PackageCheck />} title="还没有材料申请" description="填写左侧清单后，管理员会在这里更新处理状态。" /> : null}
            <div className="space-y-3">
              {requests.data?.map((row) => {
                const status = STATUS[row.status] ?? STATUS.pending;
                return <article key={row.id} className="rounded-xl border bg-muted/20 p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{row.item_name} <span className="text-muted-foreground">· {row.quantity} {row.unit}</span></p>
                      {row.purpose ? <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{row.purpose}</p> : null}
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{briefDateTime(row.created_at)}</span>
                    {row.can_cancel ? <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => void withdraw(row.id)}>撤回</Button> : null}
                  </div>
                  {row.admin_note ? <p className="mt-2 rounded-md bg-background/80 px-2.5 py-2 text-sm text-muted-foreground">管理员备注：{row.admin_note}</p> : null}
                </article>;
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
