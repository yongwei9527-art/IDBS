import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '@/lib/api';

export interface Notification {
  id: string;
  type: string;
  title: string;
  content: string;
  level: 'info' | 'warning' | 'success' | 'error';
  action_url?: string;
  is_read: boolean;
  created_at: string;
}

export interface PushNotificationStatus {
  configured: boolean;
  active_device_count: number;
}

export async function registerPushDevice(token: string) {
  return request<{ registered: boolean; platform: 'android' }>('/notifications/push-devices', {
    method: 'POST',
    body: JSON.stringify({ token, platform: 'android' })
  });
}

export async function unregisterPushDevice(token: string, accessToken?: string | null) {
  return request<{ revoked: boolean }>('/notifications/push-devices', {
    method: 'DELETE',
    token: accessToken || undefined,
    body: JSON.stringify({ token })
  });
}

export function usePushNotificationStatus() {
  return useQuery({
    queryKey: ['notifications', 'push-status'],
    queryFn: () => request<PushNotificationStatus>('/notifications/push-status'),
    staleTime: 15_000,
    retry: false
  });
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
    mutationFn: (ids: string[]) => request('/notifications/read', { method: 'PATCH', body: JSON.stringify({ ids }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); }
  });
}
