import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/lib/api';

export type MaterialRequestStatus = 'pending' | 'approved' | 'rejected' | 'fulfilled' | 'cancelled';

export interface MaterialRequestRow {
  id: string;
  user_id?: string;
  user_name?: string;
  user_student_no?: string;
  item_name: string;
  quantity: number;
  unit: string;
  purpose?: string | null;
  status: MaterialRequestStatus;
  admin_note?: string | null;
  reviewed_at?: string | null;
  fulfilled_at?: string | null;
  created_at?: string;
  updated_at?: string;
  can_cancel?: boolean;
  can_review?: boolean;
}

export interface CreateMaterialRequestPayload {
  item_name: string;
  quantity: number;
  unit: string;
  purpose?: string;
}

export function useMyMaterialRequests() {
  return useQuery({
    queryKey: ['my-material-requests'],
    queryFn: () => request<{ requests?: MaterialRequestRow[] } | MaterialRequestRow[]>('/material-requests'),
    select: (data) => Array.isArray(data) ? data : data.requests ?? []
  });
}

export function useCreateMaterialRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateMaterialRequestPayload) => request<{ message?: string; request?: MaterialRequestRow }>('/material-requests', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-material-requests'] })
  });
}

export function useCancelMaterialRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<{ message?: string }>(`/material-requests/${encodeURIComponent(id)}/cancel`, {
      method: 'PATCH',
      body: '{}'
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-material-requests'] })
  });
}

export function useAdminMaterialRequests(status?: MaterialRequestStatus | '') {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
  return useQuery({
    queryKey: ['admin-material-requests', status ?? ''],
    queryFn: () => request<{ requests?: MaterialRequestRow[] } | MaterialRequestRow[]>(`/admin/material-requests${suffix}`),
    select: (data) => Array.isArray(data) ? data : data.requests ?? []
  });
}

export function useReviewMaterialRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; status: Extract<MaterialRequestStatus, 'approved' | 'rejected' | 'fulfilled'>; admin_note?: string }) =>
      request<{ message?: string }>(`/admin/material-requests/${encodeURIComponent(payload.id)}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status: payload.status, admin_note: payload.admin_note ?? '' })
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-material-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['my-material-requests'] });
    }
  });
}
