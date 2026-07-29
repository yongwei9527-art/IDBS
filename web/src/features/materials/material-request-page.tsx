import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClipboardList, PackageCheck, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
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

const MAX_MATERIALS_PER_REQUEST = 20;

const STATUS: Record<MaterialRequestStatus, { label: string; className: string }> = {
  pending: { label: '待处理', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  approved: { label: '已批准', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  rejected: { label: '已驳回', className: 'bg-red-500/15 text-red-700 dark:text-red-300' },
  fulfilled: { label: '已发放', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  cancelled: { label: '已撤回', className: 'bg-muted text-muted-foreground' }
};

type DraftMaterial = {
  id: number;
  itemName: string;
  quantity: number;
  unit: string;
};

function MaterialFormLabel({ children }: { children: ReactNode }) {
  return <label className="block text-xs font-semibold text-muted-foreground">{children}</label>;
}

export function MaterialRequestPage() {
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [purpose, setPurpose] = useState('');
  const [materials, setMaterials] = useState<DraftMaterial[]>([]);
  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const requests = useMyMaterialRequests();
  const create = useCreateMaterialRequest();
  const cancel = useCancelMaterialRequest();

  const totalItems = useMemo(() => materials.length, [materials.length]);
  const isSubmitting = isBatchSubmitting || create.isPending;

  function addMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(quantity);
    if (!itemName.trim() || !unit.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error('请填写材料名称、有效数量和单位。');
      return;
    }

    const normalizedName = itemName.trim();
    const normalizedUnit = unit.trim();
    const duplicate = materials.some((material) => material.itemName === normalizedName && material.unit === normalizedUnit);
    if (!duplicate && materials.length >= MAX_MATERIALS_PER_REQUEST) {
      toast.error(`一次申请最多可包含 ${MAX_MATERIALS_PER_REQUEST} 项材料。`);
      return;
    }

    setMaterials((current) => {
      const existing = current.find((material) => material.itemName === normalizedName && material.unit === normalizedUnit);
      if (existing) {
        return current.map((material) => material.id === existing.id ? { ...material, quantity: material.quantity + amount } : material);
      }
      return [...current, { id: Date.now() + current.length, itemName: normalizedName, quantity: amount, unit: normalizedUnit }];
    });
    setItemName('');
    setQuantity('');
    setUnit('');
  }

  async function submitMaterials() {
    if (submittingRef.current) return;
    if (!materials.length) {
      toast.error('请至少添加一项材料到申请清单。');
      return;
    }

    submittingRef.current = true;
    setIsBatchSubmitting(true);
    try {
      const submitted = new Set<number>();
      const failed: DraftMaterial[] = [];
      for (const material of materials) {
        try {
          await create.mutateAsync({
            item_name: material.itemName,
            quantity: material.quantity,
            unit: material.unit,
            purpose: purpose.trim()
          });
          submitted.add(material.id);
        } catch {
          failed.push(material);
        }
      }

      if (submitted.size) {
        setMaterials((current) => current.filter((material) => !submitted.has(material.id)));
        toast.success(`已提交 ${submitted.size} 项材料申请。`);
      }
      if (failed.length) {
        toast.error(`${failed.length} 项材料未收到成功确认，已保留在清单中；请先刷新记录确认后再重试，避免重复申请。`);
      } else {
        setPurpose('');
      }
    } finally {
      submittingRef.current = false;
      setIsBatchSubmitting(false);
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
    <div className="ops-page-stack mx-auto max-w-6xl">
      <OpsPageHeader
        eyebrow="材料服务"
        title="材料清单申请"
        description="将本次实验所需材料加入同一份清单，确认后一次提交；每项材料仍会独立跟踪库存和发放状态。"
        aside={<span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">待提交 {totalItems} 项</span>}
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.04fr)_minmax(24rem,0.96fr)]">
        <Card className="ops-card overflow-hidden shadow-none">
          <CardHeader className="border-b border-border/70 bg-muted/20 p-5 pb-4">
            <CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4 text-primary" />申请清单</CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">逐项添加材料。提交后，管理员可分别批准或发放每一项。</p>
          </CardHeader>
          <CardContent className="p-5">
            <form className="grid gap-3 sm:grid-cols-[minmax(0,1.25fr)_minmax(6rem,0.55fr)_minmax(5.5rem,0.45fr)_auto] sm:items-end" onSubmit={addMaterial} aria-busy={isSubmitting}>
              <MaterialFormLabel>材料名称
                <input value={itemName} onChange={(event) => setItemName(event.target.value)} maxLength={120} required disabled={isSubmitting} placeholder="例如：425 水泥" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </MaterialFormLabel>
              <MaterialFormLabel>数量
                <input value={quantity} onChange={(event) => setQuantity(event.target.value)} type="number" min="0.001" max="1000000" step="0.001" required disabled={isSubmitting} placeholder="2" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </MaterialFormLabel>
              <MaterialFormLabel>单位
                <input value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={30} required disabled={isSubmitting} placeholder="袋、kg" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </MaterialFormLabel>
              <Button type="submit" variant="outline" className="h-10 gap-1.5" disabled={isSubmitting}><Plus className="h-4 w-4" />添加</Button>
            </form>

            <div className="mt-5 rounded-xl border border-border/70 bg-muted/15">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">本次申请</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">共 {totalItems} 项，支持一次性提交</p>
                </div>
                {materials.length ? <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={isSubmitting} onClick={() => setMaterials([])}>清空清单</Button> : null}
              </div>
              {!materials.length ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">先在上方填写一项材料，然后点击“添加”。</div>
              ) : (
                <ul className="divide-y divide-border/70">
                  {materials.map((material, index) => (
                    <li key={material.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{material.itemName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{material.quantity} {material.unit}</p>
                      </div>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label={`移除 ${material.itemName}`} title="移除" disabled={isSubmitting} onClick={() => setMaterials((current) => current.filter((item) => item.id !== material.id))}><Trash2 className="h-4 w-4" /></Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-5">
              <MaterialFormLabel>用途说明 <span className="font-normal">（可选，将同步给本次所有材料）</span>
                <textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={1000} rows={4} disabled={isSubmitting} placeholder="说明实验、课程或使用目的" className="mt-1.5 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </MaterialFormLabel>
            </div>

            <div className="mt-4 flex flex-col-reverse gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-muted-foreground">提交后每一项都会生成独立记录，便于按库存状态处理。</p>
              <Button type="button" disabled={!materials.length || isSubmitting} onClick={() => void submitMaterials()}><Send className="h-4 w-4" />{create.isPending ? '提交中…' : `提交 ${totalItems} 项申请`}</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="ops-card shadow-none">
          <CardHeader className="flex-row items-start justify-between gap-4 border-b border-border/70 p-5 pb-4">
            <div>
              <CardTitle className="text-base">我的申请记录</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">待处理的申请可以自行撤回。</p>
            </div>
            <Button size="icon" variant="ghost" aria-label="刷新材料申请" title="刷新" onClick={() => void requests.refetch()}><RotateCcw className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent className="p-5">
            {requests.isLoading ? <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p> : null}
            {requests.error ? <p className="py-10 text-center text-sm text-destructive">{toFriendlyError(requests.error)}</p> : null}
            {!requests.isLoading && !requests.error && !requests.data?.length ? <OpsEmptyState icon={<PackageCheck />} title="还没有材料申请" description="将左侧材料加入清单后统一提交，处理状态会显示在这里。" /> : null}
            <div className="space-y-3">
              {requests.data?.map((row) => {
                const status = STATUS[row.status] ?? STATUS.pending;
                return <article key={row.id} className="rounded-xl border border-border/70 bg-muted/15 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{row.item_name} <span className="font-normal text-muted-foreground">· {row.quantity} {row.unit}</span></p>
                      {row.purpose ? <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{row.purpose}</p> : null}
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    <span>{briefDateTime(row.created_at)}</span>
                    {row.can_cancel ? <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => void withdraw(row.id)}>撤回</Button> : null}
                  </div>
                  {row.admin_note ? <p className="mt-3 border-l-2 border-primary/40 bg-background/60 px-3 py-2 text-sm leading-6 text-muted-foreground">管理员备注：{row.admin_note}</p> : null}
                </article>;
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
