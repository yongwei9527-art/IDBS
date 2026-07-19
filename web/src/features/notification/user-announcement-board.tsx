import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronUp, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  fetchSystemNotice,
  isSystemNoticeRead,
  markSystemNoticeRead,
  SYSTEM_NOTICE_QUERY_KEY,
  SYSTEM_NOTICE_READ_EVENT,
  systemNoticeVersion
} from './system-notice';

export function UserAnnouncementBoard() {
  const [expanded, setExpanded] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: SYSTEM_NOTICE_QUERY_KEY,
    queryFn: fetchSystemNotice,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  });
  const version = systemNoticeVersion(data);

  useEffect(() => {
    setExpanded(false);
    const syncReadState = () => setAcknowledged(isSystemNoticeRead(data));
    syncReadState();
    window.addEventListener(SYSTEM_NOTICE_READ_EVENT, syncReadState);
    window.addEventListener('storage', syncReadState);
    return () => {
      window.removeEventListener(SYSTEM_NOTICE_READ_EVENT, syncReadState);
      window.removeEventListener('storage', syncReadState);
    };
  }, [data, version]);

  if (isLoading) return <div className="h-16 animate-pulse rounded-xl border border-border/70 bg-muted/25" aria-label="公告加载中" />;
  if (!data?.enabled || !String(data.content || '').trim()) return null;

  const content = String(data.content || '').trim();
  const canCollapse = content.length > 90 || content.includes('\n');
  const acknowledge = () => {
    markSystemNoticeRead(data);
    setAcknowledged(true);
  };

  return (
    <section className="user-announcement relative overflow-hidden border bg-card" aria-label="实验室公告栏">
      <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
      <div className="flex flex-col gap-3 p-3 pl-4 sm:flex-row sm:items-center">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/[0.07] text-primary">
          <Megaphone className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-primary">公告</span>
            <h2 className="truncate text-sm font-semibold text-foreground">{data.title || '实验室使用公告'}</h2>
            {!acknowledged ? <span className="user-announcement-new">新</span> : null}
          </div>
          <p className={`mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground ${!expanded && canCollapse ? 'line-clamp-1' : ''}`}>{content}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 self-end sm:self-center">
          {canCollapse ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>
              {expanded ? <><ChevronUp className="h-4 w-4" />收起</> : <><ChevronDown className="h-4 w-4" />展开</>}
            </Button>
          ) : null}
          {!acknowledged ? (
            <Button type="button" size="sm" variant="outline" onClick={acknowledge}>
              <Check className="h-4 w-4" />知道了
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
