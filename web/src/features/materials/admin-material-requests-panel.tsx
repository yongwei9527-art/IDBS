import { useMemo, useState } from 'react';
import { PackageCheck, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OpsEmptyState } from '@/components/ops/design-system';
import { briefDateTime } from '@/lib/time-format';
import { toFriendlyError } from '@/lib/friendly-error';
import {
  useAdminMaterialRequests,
  useReviewMaterialRequest,
  type MaterialRequestStatus
} from './material-request-api';

const FILTERS: Array<{ value: MaterialRequestStatus | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待处理' },
  { value: 'approved', label: '已批准' },
  { value: 'rejected', label: '已驳回' },
  { value: 'fulfilled', label: '已发放' },
  { value: 'cancelled', label: '已撤回' }
];
const STATUS_LABEL: Record<MaterialRequestStatus, string> = {
  pending: '待处理', approved: '已批准', rejected: '已驳回', fulfilled: '已发放', cancelled: '已撤回'
};

export function AdminMaterialRequestsPanel() {
  const [status, setStatus] = useState<MaterialRequestStatus | ''>('pending');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { data = [], isLoading, error, refetch } = useAdminMaterialRequests(status);
  const review = useReviewMaterialRequest();
  const counts = useMemo(() => ({ pending: data.filter((item) => item.status === 'pending').length, approved: data.filter((item) => item.status === 'approved').length }), [data]);

  async function update(id: string, nextStatus: Extract<MaterialRequestStatus, 'approved' | 'rejected' | 'fulfilled'>) {
    try {
      const result = await review.mutateAsync({ id, status: nextStatus, admin_note: notes[id] ?? '' });
      toast.success(result.message || '材料申请已更新。');
    } catch (requestError) {
      toast.error(toFriendlyError(requestError));
    }
  }

  return (
    <section className="mt-6">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">材料清单处理</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">批准后可标记为已发放；驳回与已发放的申请不再变更。</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><span>待处理 {counts.pending}</span><span>待发放 {counts.approved}</span><Button size="icon" variant="ghost" aria-label="刷新材料清单" title="刷新" onClick={() => void refetch()}><RotateCcw /></Button></div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-2">
            {FILTERS.map((item) => <Button key={item.value || 'all'} size="sm" variant={status === item.value ? 'default' : 'outline'} onClick={() => setStatus(item.value)}>{item.label}</Button>)}
          </div>
          {isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">加载中…</p> : null}
          {error ? <p className="py-6 text-center text-sm text-destructive">{toFriendlyError(error)}</p> : null}
          {!isLoading && !error && !data.length ? <OpsEmptyState icon={<PackageCheck />} title="没有符合条件的材料申请" description="切换状态筛选，或稍后刷新。" /> : null}
          <div className="space-y-3">
            {data.map((row) => (
              <article key={row.id} className="rounded-xl border bg-muted/20 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{row.item_name} <span className="text-muted-foreground">· {row.quantity} {row.unit}</span></p>
                    <p className="mt-1 text-xs text-muted-foreground">申请人：{row.user_name || '—'}{row.user_student_no ? ` · ${row.user_student_no}` : ''} · {briefDateTime(row.created_at)}</p>
                    {row.purpose ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">用途：{row.purpose}</p> : null}
                  </div>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">{STATUS_LABEL[row.status] ?? row.status}</span>
                </div>
                {row.can_review ? <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <input value={notes[row.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} maxLength={500} placeholder="处理备注（可选）" className="h-9 rounded-md border bg-background px-3 text-sm" />
                  <div className="flex flex-wrap gap-2">
                    {row.status === 'pending' ? <><Button size="sm" disabled={review.isPending} onClick={() => void update(row.id, 'approved')}>批准</Button><Button size="sm" variant="outline" disabled={review.isPending} onClick={() => void update(row.id, 'rejected')}>驳回</Button></> : null}
                    {row.status === 'approved' ? <Button size="sm" disabled={review.isPending} onClick={() => void update(row.id, 'fulfilled')}>标记已发放</Button> : null}
                  </div>
                </div> : null}
                {row.admin_note ? <p className="mt-2 rounded-md bg-background/80 px-2.5 py-2 text-sm text-muted-foreground">处理备注：{row.admin_note}</p> : null}
              </article>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
