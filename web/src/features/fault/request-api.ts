import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/lib/api';

export interface MyFaultReportRow {
  id: string;
  device_id?: string;
  device_code?: string;
  device_name?: string;
  device_location?: string;
  borrow_record_id?: string | null;
  reservation_id?: string | null;
  issue_type: string;
  severity?: string;
  description?: string;
  photos?: string[] | string | null;
  status: string;
  admin_note?: string;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string | null;
}

export function useMyFaultReports(status?: string) {
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  const query = qs.toString();
  return useQuery({
    queryKey: ['my-fault-reports', status ?? ''],
    queryFn: async () => {
      const data = await request<MyFaultReportRow[] | { reports?: MyFaultReportRow[] }>(`/fault-reports${query ? `?${query}` : ''}`);
      return Array.isArray(data) ? data : data.reports ?? [];
    }
  });
}
export interface UserRequestRow {
  id: string;
  user_id?: string;
  user_name?: string;
  user_phone?: string;
  user_student_no?: string;
  device_id?: string | null;
  device_code?: string;
  device_name?: string;
  category: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  admin_note?: string;
  change_request_note?: string;
  created_at: string;
  updated_at?: string;
  confirmed_at?: string | null;
  locked_at?: string | null;
}

export interface UserRequestPayload {
  title: string;
  description: string;
  category?: string;
  priority?: string;
  device_code?: string;
}

export function useMyUserRequests() {
  return useQuery({
    queryKey: ['my-user-requests'],
    queryFn: async () => {
      const data = await request<UserRequestRow[] | { requests?: UserRequestRow[] }>('/user-requests');
      return Array.isArray(data) ? data : data.requests ?? [];
    }
  });
}

export function useCreateUserRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: UserRequestPayload) =>
      request<{ request?: UserRequestRow; message?: string }>('/user-requests', {
        method: 'POST',
        body: JSON.stringify(vars)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-user-requests'] })
  });
}

export function useUpdateUserRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: UserRequestPayload & { id: string }) => {
      const { id, ...body } = vars;
      return request(`/user-requests/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body)
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-user-requests'] })
  });
}

export function useCancelUserRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request(`/user-requests/${encodeURIComponent(id)}/cancel`, { method: 'PATCH', body: '{}' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-user-requests'] })
  });
}

export function useRequestUserRequestChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; reason: string }) =>
      request(`/user-requests/${encodeURIComponent(vars.id)}/change-request`, {
        method: 'POST',
        body: JSON.stringify({ reason: vars.reason })
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-user-requests'] })
  });
}

