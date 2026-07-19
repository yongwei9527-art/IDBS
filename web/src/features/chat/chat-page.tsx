import { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Pin } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  useChatConversations,
  useChatUsers,
  useCreateChatConversation,
  type ChatConversation
} from './chat-api';
import { parseChatTarget, preserveChatContextSearch } from './chat-context';
import { useWs } from '@/lib/ws';

import { toFriendlyError } from '@/lib/friendly-error';
import { OpsPageHeader } from '@/components/ops/design-system';
import { useAuth } from '@/features/auth/use-auth';

function ConvItem({ c }: { c: ChatConversation }) {
  const nav = useNavigate();
  const preview = c.last_message_preview || '暂无消息';
  const time = c.last_message_at ? new Date(c.last_message_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
  const pinned = c.system_key === 'lab_management' || (c.is_system && ['实验管理群', '实验管理总群'].includes(c.title || ''));
  return (
    <button
      onClick={() => nav({ to: `/chat/${c.id}`, search: preserveChatContextSearch() } as any)}
      className={`ops-list-item flex w-full items-start gap-3 p-3 text-left ${pinned ? 'border-primary/35 bg-primary/[0.05]' : ''}`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium">
            {pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
            <span className="truncate">{c.title || '未命名'}</span>
            {pinned ? <span className="badge-pill badge-info shrink-0">置顶</span> : null}
          </p>
          {time && <p className="shrink-0 text-xs tabular-nums text-muted-foreground">{time}</p>}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{preview}</p>
          {c.unread_count ? (
            <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground">
              {c.unread_count}
            </span>
          ) : null}
          {c.type === 'group' && (
            <span className="shrink-0 text-[10px] text-muted-foreground">{c.participants?.length || 0}人</span>
          )}
          {c.is_temporary_group && c.remaining_label ? (
            <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              {c.remaining_label}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export function ChatConversationList() {
  const { data = [], isLoading } = useChatConversations();
  const { data: users = [] } = useChatUsers();
  const nav = useNavigate();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const ws = useWs();
  const createMutation = useCreateChatConversation();
  const autoStartedRef = useRef(false);
  const isAdministrator = ['super_admin', 'admin'].includes(auth.me?.role || '');

  function startAdminConversation() {
    const admin = users.find((user) => ['super_admin', 'admin'].includes(user.role || ''));
    if (!admin) {
      toast.warning('暂未找到可联系的管理员。');
      return;
    }
    createMutation.mutate(
      { type: 'direct', user_id: admin.id },
      {
        onSuccess: (result) => nav({ to: `/chat/${result.conversation.id}`, search: preserveChatContextSearch() } as any),
        onError: (error) => toast.error(`打开管理员会话失败：${toFriendlyError(error)}`)
      }
    );
  }

  useEffect(() => ws.onMessage((message: any) => {
    if (['new_message', 'conversation_changed', 'conversation_deleted'].includes(message.type)) {
      queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
    }
  }), [queryClient, ws]);

  useEffect(() => {
    if (autoStartedRef.current) return;
    const target = parseChatTarget();
    const targetUserId = target.userId || (target.contactAdmin ? (users.find((u) => ['super_admin', 'admin'].includes(u.role || '')) || users[0])?.id : '');
    if (!target.userId && target.contactAdmin && users.length === 0) return;
    if (!targetUserId) {
      if (target.contactAdmin) {
        autoStartedRef.current = true;
        toast.warning('暂未找到可联系的管理员，请从联系人里手动选择。');
      }
      return;
    }
    autoStartedRef.current = true;
    createMutation.mutate(
      { type: 'direct', user_id: targetUserId },
      {
        onSuccess: (result) => {
          nav({ to: `/chat/${result.conversation.id}`, search: preserveChatContextSearch() } as any);
        },
        onError: (error) => {
          autoStartedRef.current = false;
          toast.error(`打开业务会话失败：${toFriendlyError(error)}`);
        }
      }
    );
  }, [createMutation, nav, users]);

  return (
    <div className="ops-page-stack chat-hub">
      <OpsPageHeader title="消息">
        {!isAdministrator && (
          <Button size="sm" onClick={startAdminConversation} disabled={createMutation.isPending}>
            <MessageSquare className="h-4 w-4" />联系管理员
          </Button>
        )}
      </OpsPageHeader>
      {createMutation.isPending && parseChatTarget().userId ? (
        <Card className="ops-card"><CardContent className="py-4 text-center text-sm text-muted-foreground">正在打开会话…</CardContent></Card>
      ) : null}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : data.length === 0 ? (
        <Card className="ops-card"><CardContent className="py-8 text-center text-muted-foreground">暂无消息</CardContent></Card>
      ) : (
        <div className="grid gap-2">
          {data.map((c) => (<ConvItem key={c.id} c={c} />))}
        </div>
      )}
    </div>
  );
}
