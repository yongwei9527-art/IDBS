import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '@/lib/api';

export interface Notification {
  id: string;
  type: string;
  title: string;
  content: string;
  level: 'info' | 'warning' | 'success';
  action_url?: string;
  is_read: boolean;
  created_at: string;
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const data = await request<Notification[] | { notifications?: Notification[] }>('/notifications');
      return Array.isArray(data) ? data : data.notifications ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 10_000
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      request('/notifications/read', {
        method: 'PATCH',
        body: JSON.stringify({ ids })
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
  });
}