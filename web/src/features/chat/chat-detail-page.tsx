import { useMemo, useState, useRef, useEffect, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ImagePlus, Info, Link2, LogOut, MessageSquare, SendHorizonal, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useActionDialog } from '@/components/ui/action-dialog';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/features/auth/use-auth';
import { uploadImage } from '@/lib/api';
import { useWs } from '@/lib/ws';
import {
  useAddChatParticipants,
  useChatThread,
  useChatUsers,
  useDissolveChatConversation,
  useLeaveChatConversation,
  useMarkChatRead,
  useRemoveChatParticipant,
  useSendChatMessage,
  type ChatConversation,
  type ChatMessage,
  type ChatUser
} from './chat-api';
import { chatCardLabel, isChatCardMessage, parseChatContext, type ChatContextCard } from './chat-context';
import { cn } from '@/lib/utils';
import { toFriendlyError } from '@/lib/friendly-error';
import { formatCompactId } from '@/components/ui/compact-id';

function contextIdPrefix(type?: string) {
  return ({ device: 'DEV', reservation: 'RSV', fault: 'FLT', request: 'REQ' } as Record<string, string>)[type || ''] || 'REF';
}

function chatRoleLabel(role?: string | null) {
  const labels: Record<string, string> = { owner: '群主', admin: '管理员', member: '成员', super_admin: '最高权限管理员', user: '用户' };
  if (!role) return '成员';
  return labels[role] || (/[^\x00-\x7F]/.test(role) ? role : '成员');
}

function MessageBubble({ msg, isMine }: { msg: ChatMessage; isMine: boolean }) {
  const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
  const imageAttachments = attachments.filter((item) => item.url && (msg.message_type === 'image' || item.type === 'image' || item.mime?.startsWith('image/')));
  const isCard = isChatCardMessage(msg.message_type);
  const metadata = msg.metadata && typeof msg.metadata === 'object' && !Array.isArray(msg.metadata) ? msg.metadata : {};
  const cardTitle = msg.content || String(metadata.title || chatCardLabel(msg.message_type));
  const cardDetail = String(metadata.description || metadata.detail || metadata.device_name || metadata.issue_type || metadata.status || '');
  const chips = [
    metadata.device_code ? `设备 ${metadata.device_code}` : '',
    metadata.reservation_id ? `预约 ${formatCompactId(String(metadata.reservation_id), 8, 4, 'RSV')}` : '',
    metadata.batch_id ? `批次 ${formatCompactId(String(metadata.batch_id), 8, 4, 'RSV')}` : '',
    metadata.fault_id ? `故障 ${formatCompactId(String(metadata.fault_id), 8, 4, 'FLT')}` : '',
    metadata.request_id ? `需求 ${formatCompactId(String(metadata.request_id), 8, 4, 'REQ')}` : '',
    msg.related_id && ![metadata.device_code, metadata.reservation_id, metadata.batch_id, metadata.fault_id, metadata.request_id].includes(msg.related_id) ? formatCompactId(String(msg.related_id), 8, 4, 'REF') : ''
  ].filter(Boolean).map(String);
  if (msg.message_type === 'system') {
    return (
      <div className="flex justify-center py-1">
        <p className="max-w-[90%] rounded-full bg-muted px-3 py-1 text-center text-[11px] leading-5 text-muted-foreground">
          {msg.content}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[75%] rounded-lg px-3 py-2 text-sm', isMine ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
        {!isMine && msg.sender_name && <p className="mb-0.5 text-xs font-medium text-muted-foreground">{msg.sender_name}</p>}
        {isCard && (
          <div className="mb-1 rounded-lg border bg-background/90 p-3 text-foreground shadow-sm">
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-primary"><Link2 className="h-3.5 w-3.5" />{chatCardLabel(msg.message_type)}卡片</p>
            <p className="font-semibold">{cardTitle}</p>
            {cardDetail ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{cardDetail}</p> : null}
            {chips.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {chips.map((chip) => <span key={chip} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{chip}</span>)}
              </div>
            ) : null}
          </div>
        )}
        {imageAttachments.length > 0 && (
          <div className="mb-2 grid gap-2">
            {imageAttachments.map((item, index) => (
              <a key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border bg-background/40">
                <img src={item.url} alt={item.name || msg.content || '聊天图片'} className="max-h-64 w-full object-contain" />
              </a>
            ))}
          </div>
        )}
        {msg.content && !isCard && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
        <p className="mt-1 text-right text-[10px] tabular-nums opacity-60">
          {new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

export function ChatDetailPage() {
  const location = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const id = (location.pathname.split('/').pop() || '').split('?')[0];
  const auth = useAuth();
  const { confirm, ActionDialog } = useActionDialog();
  const thread = useChatThread(id);
  const conversation = thread.data?.conversation;
  const messages = thread.data?.messages ?? [];
  const currentUser = thread.data?.current_user;
  const sendMutation = useSendChatMessage(id);
  const markRead = useMarkChatRead(id);
  const leaveConversation = useLeaveChatConversation(id);
  const dissolveConversation = useDissolveChatConversation(id);
  const ws = useWs();
  const [input, setInput] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [activeContext, setActiveContext] = useState<ChatContextCard | null>(() => parseChatContext());
  const [contextCardSent, setContextCardSent] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const title = conversationTitle(conversation);

  useEffect(() => {
    ws.subscribe(`chat:${id}`);
    const unsub = ws.onMessage((m: any) => {
      if ((m.type === 'new_message' || m.type === 'conversation_changed') && m.channel === `chat:${id}`) {
        qc.invalidateQueries({ queryKey: ['chat-messages', id] });
        qc.invalidateQueries({ queryKey: ['chat-conversations'] });
      }
      if (m.type === 'conversation_deleted' && m.payload?.conversation_id === id) {
        qc.invalidateQueries({ queryKey: ['chat-conversations'] });
        toast.info('该会话已解散');
        nav({ to: '/chat' } as any);
      }
    });
    return () => { ws.unsubscribe(`chat:${id}`); unsub(); };
  }, [id, nav, qc, ws]);

  useEffect(() => { if (id) markRead.mutate(); }, [id]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    const nextContext = parseChatContext();
    setActiveContext(nextContext);
    setContextCardSent(false);
    if (nextContext?.prefill && !input.trim()) setInput(nextContext.prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, window.location.search]);

  function send(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    const text = input;
    setInput('');
    sendMutation.mutate(text, {
      onError: (error) => {
        setInput(text);
        toast.error(`发送失败：${toFriendlyError(error)}`);
      }
    });
  }

  async function sendImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.warning('请选择图片文件');
      return;
    }
    setUploadingImage(true);
    try {
      const url = await uploadImage(file);
      if (!url) throw new Error('图片上传未返回 URL');
      sendMutation.mutate({
        message_type: 'image',
        content: file.name || '图片',
        attachments: [{ type: 'image', url, name: file.name, mime: file.type, size: file.size }]
      }, {
        onSuccess: () => toast.success('图片已发送'),
        onError: (error) => toast.error(`图片发送失败：${toFriendlyError(error)}`)
      });
    } catch (error) {
      toast.error(`图片上传失败：${toFriendlyError(error)}`);
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function sendContextCard() {
    if (!activeContext) return;
    sendMutation.mutate({
      message_type: activeContext.message_type,
      content: activeContext.content,
      metadata: activeContext.metadata,
      related_type: activeContext.related_type,
      related_id: activeContext.related_id
    }, {
      onSuccess: () => {
        setContextCardSent(true);
        toast.success('业务卡片已发送');
      },
      onError: (error) => toast.error(`卡片发送失败：${toFriendlyError(error)}`)
    });
  }

  async function leaveGroup() {
    const ok = await confirm({
      title: '确认退出群聊',
      description: '退出后将不再接收该群聊消息，如需再次加入需要群主或管理员邀请。',
      confirmText: '确认退出',
      tone: 'warning'
    });
    if (!ok) return;
    leaveConversation.mutate(undefined, {
      onSuccess: () => {
        toast.success('已退出群聊');
        nav({ to: '/chat' } as any);
      },
      onError: (error) => toast.error(`退出失败：${toFriendlyError(error)}`)
    });
  }

  async function dissolveGroup() {
    const ok = await confirm({
      title: '确认解散群聊',
      description: '群聊解散后成员将无法继续访问该会话，该操作不可撤销。',
      confirmText: '确认解散',
      tone: 'danger'
    });
    if (!ok) return;
    dissolveConversation.mutate(undefined, {
      onSuccess: () => {
        toast.success('群聊已解散');
        nav({ to: '/chat' } as any);
      },
      onError: (error) => toast.error(`解散失败：${toFriendlyError(error)}`)
    });
  }

  return (
    <div className="mx-auto grid h-[calc(100vh-6rem)] max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <ActionDialog />
      <div className="ops-card flex min-h-0 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <button onClick={() => nav({ to: '/chat' } as any)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          {conversation?.type === 'group' ? <Users className="h-4 w-4 text-muted-foreground" /> : <MessageSquare className="h-4 w-4 text-muted-foreground" />}
          <span className="truncate text-sm font-medium">{title}</span>
          {conversation?.type === 'group' && <span className="text-xs text-muted-foreground">{conversation.participants?.length ?? 0} 人</span>}
          {conversation?.is_temporary_group && conversation?.remaining_label ? (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">{conversation.remaining_label}</span>
          ) : null}
          <Button type="button" size="sm" variant="ghost" className="ml-auto lg:hidden" onClick={() => setShowInfo((v) => !v)}>
            <Info className="h-4 w-4" />
          </Button>
        </div>
        {conversation?.is_temporary_group ? (
          <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            临时会话 · {conversation.remaining_label || '2 天后自动结束'}
            {conversation.expires_at
              ? '（' + new Date(conversation.expires_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + '）'
              : ''}
            ，到期后将结束并清除聊天记录。
          </div>
        ) : null}
        {activeContext ? (
          <ChatContextPanel
            context={activeContext}
            sent={contextCardSent}
            sending={sendMutation.isPending}
            onSend={sendContextCard}
            onClear={() => setActiveContext(null)}
          />
        ) : null}
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
          {thread.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">加载消息中…</p>
          ) : messages.length === 0 ? (
            <Card className="ops-card"><CardContent className="py-8 text-center text-muted-foreground">暂无消息</CardContent></Card>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} msg={m} isMine={m.sender_id === auth.me?.id || m.sender_id === currentUser?.id} />)
          )}
        </div>
        <form onSubmit={send} className="flex items-center gap-2 border-t p-2">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => sendImage(event.target.files?.[0])} />
          <Button type="button" size="icon" variant="ghost" disabled={uploadingImage || sendMutation.isPending} onClick={() => fileInputRef.current?.click()}>
            <ImagePlus className="h-4 w-4" />
          </Button>
          <Input placeholder="输入消息…" value={input} onChange={(e) => setInput(e.target.value)} className="flex-1" inputSize="sm" />
          <Button type="submit" size="icon" variant="ghost" disabled={!input.trim() || sendMutation.isPending}>
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </form>
      </div>

      <div className={cn('ops-card min-h-0 overflow-y-auto p-4 lg:block', showInfo ? 'block' : 'hidden')}>
        <ConversationInfo
          conversation={conversation}
          currentUser={(currentUser ?? auth.me) as ChatUser | undefined}
          onLeave={leaveGroup}
          onDissolve={dissolveGroup}
          leaving={leaveConversation.isPending}
          dissolving={dissolveConversation.isPending}
        />
      </div>
    </div>
  );
}

function ChatContextPanel({ context, sent, sending, onSend, onClear }: {
  context: ChatContextCard;
  sent: boolean;
  sending: boolean;
  onSend: () => void;
  onClear: () => void;
}) {
  return (
    <div className="border-b bg-primary/5 px-3 py-2">
      <div className="flex flex-col gap-2 rounded-lg border bg-background/80 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-xs font-semibold text-primary"><Link2 className="h-3.5 w-3.5" />业务上下文 · {chatCardLabel(context.message_type)}</p>
          <p className="mt-1 truncate text-sm font-medium">{context.title}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{context.detail || formatCompactId(context.related_id, 8, 4, contextIdPrefix(context.type)) || '可先发送卡片，把设备/预约/故障/诉求带进聊天。'}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" variant="outline" disabled={sending} onClick={onSend}>
            {sent ? '再次发送卡片' : '发送卡片'}
          </Button>
          <Button type="button" size="icon" variant="ghost" onClick={onClear} title="移除上下文">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConversationInfo({ conversation, currentUser, onLeave, onDissolve, leaving, dissolving }: {
  conversation?: ChatConversation;
  currentUser?: ChatUser;
  onLeave: () => void;
  onDissolve: () => void;
  leaving: boolean;
  dissolving: boolean;
}) {
  const { confirm, ActionDialog } = useActionDialog();
  const usersQuery = useChatUsers();
  const addParticipants = useAddChatParticipants(conversation?.id ?? '');
  const removeParticipant = useRemoveChatParticipant(conversation?.id ?? '');
  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const participants = conversation?.participants ?? [];
  const participantIds = useMemo(() => new Set(participants.map((p) => p.id)), [participants]);
  const meInGroup = participants.find((p) => p.id === currentUser?.id);
  const isGroup = conversation?.type === 'group';
  const isSystem = Boolean(conversation?.is_system || conversation?.system_key);
  const isOwner = Boolean(conversation?.created_by && conversation.created_by === currentUser?.id) || meInGroup?.participant_role === 'owner';
  // 仅最高权限管理员可以管理额外创建的群；固定管理总群由系统维护成员。
  const canManageCustomGroup = isGroup && !isSystem && currentUser?.role === 'super_admin';
  const canKick = canManageCustomGroup;
  const canLeave = canManageCustomGroup && !isOwner;
  const canDissolve = canManageCustomGroup && isOwner;

  const candidates = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return (usersQuery.data ?? [])
      .filter((user) => !participantIds.has(user.id))
      .filter((user) => !kw || [user.name, user.phone, user.role].filter(Boolean).some((value) => String(value).toLowerCase().includes(kw)));
  }, [keyword, participantIds, usersQuery.data]);

  function toggleCandidate(userId: string) {
    setSelectedIds((ids) => ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId]);
  }

  function addSelected() {
    if (!selectedIds.length) {
      toast.warning('请选择要加入的成员');
      return;
    }
    addParticipants.mutate(selectedIds, {
      onSuccess: (data) => {
        toast.success(`已添加 ${data.added_count ?? selectedIds.length} 名成员`);
        setSelectedIds([]);
        setKeyword('');
      },
      onError: (error) => toast.error(`添加失败：${toFriendlyError(error)}`)
    });
  }

  async function remove(user: ChatUser) {
    const ok = await confirm({
      title: '确认移出成员',
      description: `将 ${user.name} 移出当前群聊，对方将不再接收该群聊消息。`,
      confirmText: '确认移出',
      tone: 'warning'
    });
    if (!ok) return;
    removeParticipant.mutate(user.id, {
      onSuccess: () => toast.success('已移出成员'),
      onError: (error) => toast.error(`移出失败：${toFriendlyError(error)}`)
    });
  }

  if (!conversation) return <p className="py-8 text-center text-sm text-muted-foreground">会话信息加载中…</p>;

  return (
    <div className="flex flex-col gap-5">
      <ActionDialog />
      <div>
        <h2 className="text-base font-semibold">会话信息</h2>
        <p className="mt-1 text-sm text-muted-foreground">{conversationTitle(conversation)}</p>
      </div>
      <div className="ops-surface rounded-2xl p-3 text-sm">
        <div className="flex items-center justify-between"><span className="text-muted-foreground">类型</span><span>{conversation.type === 'group' ? '群聊' : '单聊'}</span></div>
        <div className="mt-2 flex items-center justify-between"><span className="text-muted-foreground">成员</span><span>{participants.length} 人</span></div>
        {isSystem && <p className="mt-2 text-xs text-muted-foreground">实验室管理总群由系统维护成员，无需手动管理。</p>}
        {conversation?.is_temporary_group ? (
          <p className="mt-2 text-xs text-amber-700">
            临时会话 · {conversation.remaining_label || "2 天后自动结束"}
            {conversation.expires_at
              ? "（" + new Date(conversation.expires_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) + "）"
              : ""}
            ，到期后系统将结束会话并清除聊天记录。
          </p>
        ) : null}
      </div>
      {isGroup && (
        <div className="flex flex-wrap gap-2">
          {canLeave && <Button size="sm" variant="outline" disabled={leaving} onClick={onLeave}><LogOut className="h-4 w-4" />退出群聊</Button>}
          {canDissolve && <Button size="sm" variant="destructive" disabled={dissolving} onClick={onDissolve}><Trash2 className="h-4 w-4" />解散群聊</Button>}
        </div>
      )}
      <div>
        <h3 className="mb-2 text-sm font-medium">成员</h3>
        <div className="ops-surface max-h-72 overflow-y-auto rounded-2xl">
          {participants.map((member) => (
            <div key={member.id} className="flex items-center gap-2 border-b px-3 py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.name}{member.id === currentUser?.id ? '（我）' : ''}</p>
                <p className="truncate text-xs text-muted-foreground">{member.phone || '-'} · {chatRoleLabel(member.participant_role || member.role)}</p>
              </div>
              {canKick && member.id !== currentUser?.id && member.role !== 'super_admin' && (
                <Button size="sm" variant="ghost" disabled={removeParticipant.isPending} onClick={() => remove(member)}><UserMinus className="h-4 w-4" /></Button>
              )}
            </div>
          ))}
        </div>
      </div>
      {canManageCustomGroup && (
        <div className="border-t pt-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><UserPlus className="h-4 w-4" />添加成员</h3>
          <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索联系人" inputSize="sm" clearable onClear={() => setKeyword('')} />
          <div className="ops-surface mt-2 max-h-48 overflow-y-auto rounded-2xl">
            {usersQuery.isLoading ? <p className="p-3 text-center text-xs text-muted-foreground">加载联系人中…</p>
              : candidates.length === 0 ? <p className="p-3 text-center text-xs text-muted-foreground">暂无可添加联系人</p>
              : candidates.map((user) => (
                <label key={user.id} className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-sm last:border-0 hover:bg-accent/60">
                  <input type="checkbox" checked={selectedIds.includes(user.id)} onChange={() => toggleCandidate(user.id)} />
                  <span className="min-w-0 flex-1 truncate">{user.name} <span className="text-xs text-muted-foreground">{user.phone}</span></span>
                </label>
              ))}
          </div>
          <Button className="mt-2 w-full" size="sm" disabled={addParticipants.isPending || selectedIds.length === 0} onClick={addSelected}>添加选中成员</Button>
        </div>
      )}
    </div>
  );
}

function conversationTitle(conversation?: ChatConversation) {
  if (!conversation) return '会话';
  if (conversation.title) return conversation.title;
  if (conversation.type === 'group') return '群聊';
  const names = conversation.participants?.map((p) => p.name).filter(Boolean) ?? [];
  return names.length ? names.join('、') : '单聊';
}

