import { useNotifications, useMarkNotificationsRead, type Notification } from './notification-api';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { toFriendlyError } from '@/lib/friendly-error';
import { briefDateTime } from '@/lib/time-format';
import { OpsPageHeader } from '@/components/ops/design-system';

function levelClasses(level?: string) {
  if (level === 'success') return 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-400/30 dark:bg-emerald-400/10';
  if (level === 'warning') return 'border-amber-200 bg-amber-50/80 dark:border-amber-400/30 dark:bg-amber-400/10';
  if (level === 'error') return 'border-rose-200 bg-rose-50/80 dark:border-rose-400/30 dark:bg-rose-400/10';
  return 'border-sky-200 bg-sky-50/70 dark:border-sky-400/30 dark:bg-sky-400/10';
}

function NotificationItem({ n }: { n: Notification }) {
  const mark = useMarkNotificationsRead();
  const canOpenAction = Boolean(n.action_url && n.action_url.startsWith('/'));
  return (
    <article
      className={cn(
        'ops-list-item p-4',
        n.is_read ? 'bg-card/80 opacity-75' : levelClasses(n.level)
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {!n.is_read ? <span className="badge-pill badge-info">未读</span> : <span className="badge-pill badge-muted">已读</span>}
            <time className="text-xs text-muted-foreground">{briefDateTime(n.created_at)}</time>
          </div>
          <h2 className="mt-2 truncate text-sm font-black text-foreground">{n.title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{n.content}</p>
          {canOpenAction ? (
            <a className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline" href={n.action_url}>
              查看内容 <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
        {!n.is_read ? (
          <Button variant="outline" size="sm" className="shrink-0" disabled={mark.isPending} onClick={() => mark.mutate([n.id])}>
            已读
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function NotificationPage() {
  const { data = [], isLoading, isError, error } = useNotifications();
  const markAll = useMarkNotificationsRead();
  const unread = data.filter((n) => !n.is_read);
  const allIds = unread.map((n) => n.id);

  return (
    <div className="ops-page-stack max-w-4xl">
      <OpsPageHeader
        title="通知中心"
        aside={(
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur">
              <p className="text-xs text-white/65">全部</p>
              <strong className="mt-1 block text-2xl tabular-nums text-white">{data.length}</strong>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur">
              <p className="text-xs text-white/65">未读</p>
              <strong className="mt-1 block text-2xl tabular-nums text-amber-100">{unread.length}</strong>
            </div>
          </div>
        )}
      />

      {unread.length > 0 ? (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => markAll.mutate(allIds)} disabled={markAll.isPending}>
          全部已读
        </Button>
      ) : null}

      {isLoading ? (
        <Card className="ops-card"><CardContent className="py-8 text-center text-muted-foreground">加载中…</CardContent></Card>
      ) : isError ? (
        <Card className="ops-card"><CardContent className="py-8 text-center text-sm text-destructive">{toFriendlyError(error, '通知加载失败')}</CardContent></Card>
      ) : data.length === 0 ? (
        <Card className="ops-card"><CardContent className="py-8 text-center text-muted-foreground">暂无通知</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {unread.length === 0 ? <p className="rounded-2xl border bg-card/70 px-4 py-3 text-center text-xs text-muted-foreground">没有未读通知</p> : null}
          {data.map((n) => <NotificationItem key={n.id} n={n} />)}
        </div>
      )}
    </div>
  );
}

