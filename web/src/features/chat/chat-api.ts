import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '@/lib/api';

export interface ChatUser {
  id: string;
  name: string;
  avatar_url?: string;
  phone?: string;
  student_no?: string;
  role?: string;
  can_announce?: boolean;
  can_kick?: boolean;
  participant_role?: string;
  joined_at?: string;
  last_read_at?: string;
}

export interface ChatConversation {
  id: string;
  type: 'direct' | 'group';
  title?: string;
  created_by?: string;
  system_key?: string | null;
  is_system?: boolean;
  retention_days?: number;
  last_message_preview?: string;
  last_message_type?: string;
  last_message_at?: string;
  latest_message?: { content?: string; created_at?: string; sender_name?: string } | null;
  unread_count?: number;
  participants?: ChatUser[];
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_type: string;
  content: string;
  sender_name?: string;
  sender_phone?: string;
  attachments?: ChatAttachment[];
  metadata?: Record<string, unknown>;
  related_type?: string | null;
  related_id?: string | null;
  created_at: string;
}

export interface ChatAttachment {
  type?: string;
  url?: string;
  name?: string;
  mime?: string;
  size?: number;
}

export interface ChatThread {
  conversation?: ChatConversation;
  messages: ChatMessage[];
  current_user?: ChatUser;
  page?: {
    limit?: number;
    has_more?: boolean;
    next_before?: string | null;
  };
}

export interface CreateConversationPayload {
  type: 'direct' | 'group';
  user_ids?: string[];
  user_id?: string;
  title?: string;
}

export interface SendChatMessagePayload {
  content?: string;
  message_type?: string;
  attachments?: ChatAttachment[];
  metadata?: Record<string, unknown>;
  related_type?: string;
  related_id?: string;
  mention_user_ids?: string[];
  mention_all?: boolean;
}

function normalizeConversation(input: ChatConversation): ChatConversation {
  const latest = input.latest_message;
  return {
    ...input,
    last_message_preview: input.last_message_preview ?? latest?.content ?? '',
    last_message_at: input.last_message_at ?? latest?.created_at ?? ''
  };
}

export function useChatConversations() {
  return useQuery({
    queryKey: ['chat-conversations'],
    queryFn: async () => {
      const data = await request<ChatConversation[] | { conversations?: ChatConversation[] }>('/chat/conversations');
      const conversations = Array.isArray(data) ? data : data.conversations ?? [];
      return conversations.map(normalizeConversation);
    },
    refetchInterval: 15_000
  });
}

export function useChatUsers() {
  return useQuery({
    queryKey: ['chat-users'],
    queryFn: async () => {
      const data = await request<ChatUser[] | { users?: ChatUser[] }>('/chat/users');
      return Array.isArray(data) ? data : data.users ?? [];
    },
    staleTime: 60_000
  });
}

export function useChatThread(conversationId: string) {
  return useQuery({
    queryKey: ['chat-messages', conversationId],
    queryFn: async (): Promise<ChatThread> => {
      const data = await request<ChatMessage[] | ChatThread>(`/chat/conversations/${conversationId}/messages`);
      if (Array.isArray(data)) return { messages: data } satisfies ChatThread;
      return {
        ...data,
        conversation: data.conversation ? normalizeConversation(data.conversation) : undefined,
        messages: data.messages ?? []
      } satisfies ChatThread;
    },
    enabled: !!conversationId,
    refetchInterval: 20_000
  });
}

export function useChatMessages(conversationId: string) {
  const thread = useChatThread(conversationId);
  return {
    ...thread,
    data: thread.data?.messages ?? []
  };
}

export function useSendChatMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: string | SendChatMessagePayload) => {
      const body = typeof payload === 'string' ? { content: payload } : payload;
      const data = await request<ChatMessage | { message?: ChatMessage }>(`/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      return 'message' in data && data.message ? data.message : data as ChatMessage;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    }
  });
}

export function useMarkChatRead(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request(`/chat/conversations/${conversationId}/read`, { method: 'PATCH' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    }
  });
}

export function useCreateChatConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateConversationPayload) => {
      const data = await request<ChatConversation | { conversation?: ChatConversation; existed?: boolean }>('/chat/conversations', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const conversation = 'conversation' in data && data.conversation ? data.conversation : data as ChatConversation;
      return { conversation: normalizeConversation(conversation), existed: 'existed' in data ? data.existed : false };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat-conversations'] })
  });
}

export function useAddChatParticipants(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      request<{ conversation: ChatConversation; added_count?: number }>(`/chat/conversations/${conversationId}/participants`, {
        method: 'POST',
        body: JSON.stringify({ user_ids: userIds })
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    }
  });
}

export function useRemoveChatParticipant(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      request(`/chat/conversations/${conversationId}/participants/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    }
  });
}

export function useLeaveChatConversation(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request(`/chat/conversations/${conversationId}/leave`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    }
  });
}

export function useDissolveChatConversation(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request(`/chat/conversations/${conversationId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['chat-messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    }
  });
}

