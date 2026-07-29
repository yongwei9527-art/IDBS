import { useEffect, useState } from 'react';
import { useNotifications, useMarkNotificationsRead, type Notification } from './notification-api';
import { BellRing, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { toFriendlyError } from '@/lib/friendly-error';
import { briefDateTime } from '@/lib/time-format';
import { OpsBadge, OpsPageHeader } from '@/components/ops/design-system';
import { getNativeNotificationStatus, requestNativeNotificationPermission, type NativeNotificationStatus } from './native-notifications';

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
          <h2 className="mt-2 truncate text-sm font-semibold text-foreground">{n.title}</h2>
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


function NativeNotificationSettings() {
  const [status, setStatus] = useState<NativeNotificationStatus | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);

  const refresh = () => {
    void getNativeNotificationStatus().then(setStatus);
  };

  useEffect(() => {
    refresh();
  }, []);

  if (status === null || status === 'unsupported') return null;

  const enabled = status === 'granted';
  const denied = status === 'denied';
  const description = enabled
    ? '系统消息提醒已开启。App 在线且实时连接正常时，其他成员的新聊天消息会显示为系统提醒。'
    : denied
      ? '系统通知目前已关闭。请在手机系统设置中为本应用开启通知，然后返回此页重新检查。'
      : '开启后，App 在线时收到其他成员的新聊天消息会显示系统提醒。通知不会包含聊天正文或发送者个人信息。';

  const requestPermission = async () => {
    setIsRequesting(true);
    try {
      setStatus(await requestNativeNotificationPermission());
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="native-notification-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 id="native-notification-title" className="text-sm font-semibold text-foreground">手机消息提醒</h2>
            <OpsBadge tone={enabled ? 'success' : denied ? 'warning' : 'muted'}>{enabled ? '已开启' : denied ? '需在系统设置开启' : '尚未开启'}</OpsBadge>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">为保护隐私，锁屏与横幅只显示通用的新消息提醒。</p>
        </div>
        {enabled ? (
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={refresh}>检查状态</Button>
        ) : denied ? (
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={refresh}>重新检查</Button>
        ) : (
          <Button type="button" size="sm" className="shrink-0" disabled={isRequesting} onClick={() => void requestPermission()}>
            <BellRing className="h-4 w-4" />
            {isRequesting ? '正在请求授权…' : '开启消息提醒'}
          </Button>
        )}
      </div>
    </section>
  );
}

export function NotificationPage() {
  const { data = [], isLoading, isError, error } = useNotifications();
  const markAll = useMarkNotificationsRead();
  const unread = data.filter((n) => !n.is_read);
  const allIds = unread.map((n) => n.id);

  return (
    <div className="ops-page-stack max-w-4xl">
      <OpsPageHeader title="通知中心" className="ops-page-header--compact">
        <OpsBadge tone="muted">全部 {data.length}</OpsBadge>
        <OpsBadge tone={unread.length ? 'warning' : 'success'}>未读 {unread.length}</OpsBadge>
      </OpsPageHeader>

      <NativeNotificationSettings />

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

