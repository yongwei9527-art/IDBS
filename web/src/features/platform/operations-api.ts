import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { friendlyApiMessage, request, tokenStore } from '@/lib/api';
import { QUERY_STALE } from '@/lib/query-defaults';

// ---------- Dashboard ----------

export interface AdminDashboard {
  kpi: {
    device_total: number;
    available_devices: number;
    in_use_devices: number;
    abnormal_devices: number;
    pending_users: number;
    pending_reservations: number;
    today_reservations: number;
    week_usage_count: number;
    unread_chat_messages: number;
    unread_chat_conversations: number;
  };
  device_status: Record<string, number>;
}

export function useAdminDashboard() {
  return useQuery({
    queryKey: ['admin-dashboard'],
    staleTime: QUERY_STALE.approvalQueue,
    queryFn: () => request<AdminDashboard>('/admin/dashboard')
  });
}

export interface AdminReturnTask {
  id: string;
  device_id: string;
  device_code: string;
  device_name: string;
  user_name: string;
  status: 'in_use' | 'return_pending' | 'abnormal_pending' | string;
  expected_return_time?: string | null;
  return_time?: string | null;
  return_condition?: string | null;
  return_note?: string | null;
  return_archive_photos?: string[];
  return_material_required?: boolean;
  return_material_deadline?: string | null;
  return_supplement_note?: string | null;
  return_supplement_photos?: string[];
  return_supplemented_at?: string | null;
  return_material_late?: boolean;
  is_overdue?: boolean;
}

export interface AdminReturnTaskSummary {
  overdue_borrows: number;
  pending_acceptance: number;
  abnormal_returns: number;
}

export function useAdminReturnTasks(enabled = true) {
  return useQuery({
    queryKey: ['admin-return-tasks'],
    staleTime: QUERY_STALE.faultWorkbench,
    queryFn: () => request<{ tasks: AdminReturnTask[]; summary: AdminReturnTaskSummary }>('/admin/return-tasks'),
    enabled
  });
}

export function useReviewReturnTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; approved: boolean; review_note?: string }) => request<{ message?: string; status: string }>(`/admin/return-tasks/${encodeURIComponent(vars.id)}/review`, { method: 'PATCH', body: JSON.stringify({ approved: vars.approved, review_note: vars.review_note ?? '' }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-return-tasks'] }); qc.invalidateQueries({ queryKey: ['admin-dashboard'] }); qc.invalidateQueries({ queryKey: ['admin-devices'] }); }
  });
}
// ---------- Users ----------

export interface AdminUser {
  id: string;
  name: string;
  phone: string;
  role: string;
  status: string;
  student_no?: string;
  wechat_nickname?: string | null;
  wechat_bound?: boolean;
  wechat_openid_masked?: string;
  is_banned?: boolean;
  created_at?: string;
  updated_at?: string;
  last_login_at?: string;
  approved_at?: string | null;
  disabled_reason?: string | null;
  [key: string]: unknown;
}

export interface UserFulfillmentProfile {
  normal_completed_count: number;
  cancelled_count: number;
  no_show_count: number;
  overdue_count: number;
  abnormal_return_count: number;
  pending_material_count: number;
  material_default_count: number;
  latest_no_show_reason?: string | null;
  restriction_status: 'normal' | 'restricted' | string;
  restriction_reason?: string | null;
  restriction_until?: string | null;
}

export interface AdminUserDetail {
  user: AdminUser;
  fulfillment?: UserFulfillmentProfile;
  reservations?: Array<Record<string, unknown>>;
  borrows?: Array<Record<string, unknown>>;
  fault_reports?: Array<Record<string, unknown>>;
  requests?: Array<Record<string, unknown>>;
  activity?: Array<Record<string, unknown>>;
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin-users'],
    queryFn: () => request<{ users: AdminUser[] }>('/admin/users').then((r) => r.users)
  });
}

export function useAdminUserDetail(id?: string) {
  return useQuery({
    queryKey: ['admin-user-detail', id ?? ''],
    queryFn: () => request<AdminUserDetail>(`/admin/users/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id)
  });
}

export function useSetUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; status: string; reason?: string }) =>
      request(`/admin/users/${vars.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: vars.status, reason: vars.reason, admin_note: vars.reason })
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-user-detail', vars.id] });
    }
  });
}

export function useSetUserBan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; banned: boolean }) =>
      request(`/admin/users/${vars.id}/ban`, { method: 'PUT', body: JSON.stringify({ is_banned: vars.banned }) }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-user-detail', vars.id] });
    }
  });
}

export function useUnbindUserWechat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/admin/users/${id}/wechat-binding`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-user-detail', id] });
    }
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/admin/users/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-user-detail', id] });
    }
  });
}

// ---------- Devices ----------

export interface AdminDevice {
  id: string;
  device_code: string;
  name: string;
  category?: string;
  status: string;
  location?: string;
  manager?: string;
  allow_reservation?: boolean;
  description?: string;
  usage_notice?: string;
  cover_photo?: string;
  instruction_photos?: string[];
  reservation_slot_keys?: string[];
  reservation_slot_options?: ReservationSlotOption[];
  return_mode?: 'confirm_only' | 'image_optional' | 'image_required' | string;
  return_require_note?: boolean;
  current_borrow?: Record<string, unknown> | null;
  next_reservation?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ReservationSlotOption {
  key: string;
  label?: string;
  start?: string;
  end?: string;
  start_time?: string;
  end_time?: string;
  crosses_midnight?: boolean;
  [key: string]: unknown;
}

export interface AdminDevicePayload {
  device_code: string;
  name: string;
  category?: string;
  location?: string;
  manager?: string;
  status?: string;
  allow_reservation?: boolean;
  description?: string;
  usage_notice?: string;
  cover_photo?: string;
  instruction_photos?: string[];
  reservation_slot_keys?: string[] | ReservationSlotOption[];
  return_mode?: 'confirm_only' | 'image_optional' | 'image_required' | string;
  return_require_note?: boolean;
}

export interface AdminDeviceDetail {
  device: AdminDevice;
  reservations?: Array<Record<string, unknown>>;
  borrows?: Array<Record<string, unknown>>;
  fault_reports?: Array<Record<string, unknown>>;
  can_view_return_archive?: boolean;
}

export function useAdminDevices() {
  return useQuery({
    queryKey: ['admin-devices'],
    queryFn: () => request<{ list: AdminDevice[]; total: number }>('/admin/devices')
  });
}

export function useAdminDeviceDetail(id?: string) {
  return useQuery({
    queryKey: ['admin-device-detail', id ?? ''],
    queryFn: () => request<AdminDeviceDetail>(`/admin/devices/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id)
  });
}

export function useReservationSlotOptions() {
  return useQuery({
    queryKey: ['reservation-slot-options'],
    queryFn: async () => {
      const data = await request<ReservationSlotOption[] | { presets?: ReservationSlotOption[]; all_presets?: ReservationSlotOption[] }>('/reservation-slots');
      return Array.isArray(data) ? data : (data.presets ?? data.all_presets ?? []);
    }
  });
}

export function useCreateAdminDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: AdminDevicePayload) =>
      request<{ device?: AdminDevice; message?: string }>('/admin/devices', { method: 'POST', body: JSON.stringify(vars) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-devices'] })
  });
}

export function useUpdateAdminDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: AdminDevicePayload & { id: string }) => {
      const { id, ...body } = vars;
      return request<{ device?: AdminDevice; message?: string }>(`/admin/devices/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body)
      });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin-devices'] });
      qc.invalidateQueries({ queryKey: ['admin-device-detail', vars.id] });
    }
  });
}

export function useSetAdminDeviceAvailable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request(`/admin/devices/${encodeURIComponent(id)}/availability`, {
        method: 'PATCH',
        body: JSON.stringify({ available: true, device_id: id })
      }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['admin-devices'] });
      qc.invalidateQueries({ queryKey: ['admin-device-detail', id] });
    }
  });
}

// ---------- Fault reports ----------

export interface AdminFaultRow {
  id: string;
  device_code?: string;
  device_name?: string;
  device_location?: string;
  user_name?: string;
  user_phone?: string;
  user_student_no?: string;
  device_id: string;
  user_id?: string;
  issue_type: string;
  severity?: string;
  photos?: string[] | string | null;
  status: string;
  description?: string;
  admin_note?: string;
  created_at: string;
  resolved_at?: string;
  future_reservation_count?: number;
  today_reservation_count?: number;
  active_borrow?: { record_id?: string; user_name?: string; user_phone?: string; expected_return_time?: string } | null;
  [key: string]: unknown;
}

export function useAdminFaults(status?: string, deviceCode?: string) {
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (deviceCode) qs.set('device_code', deviceCode);
  const query = qs.toString();
  return useQuery({
    queryKey: ['admin-faults', status ?? '', deviceCode ?? ''],
    staleTime: QUERY_STALE.faultWorkbench,
    queryFn: () => request<{ reports: AdminFaultRow[] }>(`/admin/fault-reports${query ? `?${query}` : ''}`)
  });
}

export function useNotifyFaultAffectedUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<{ current_user_notified?: boolean; future_reservation_count?: number }>(`/admin/fault-reports/${encodeURIComponent(id)}/notify-affected`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-faults'] })
  });
}

export function useResolveFault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; status: string; admin_note?: string; set_available?: boolean; keep_maintenance?: boolean }) =>
      request(`/admin/fault-reports/${vars.id}/resolve`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: vars.status,
          admin_note: vars.admin_note ?? '',
          set_available: vars.set_available ?? false,
          keep_maintenance: vars.keep_maintenance ?? false
        })
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-faults'] })
  });
}

// ---------- User requests / demands ----------

export interface AdminUserRequestRow {
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
  [key: string]: unknown;
}

export function useAdminUserRequests(status?: string) {
  return useQuery({
    queryKey: ['admin-user-requests', status ?? ''],
    queryFn: () =>
      request<{ requests: AdminUserRequestRow[] }>(`/admin/user-requests${status ? `?status=${encodeURIComponent(status)}` : ''}`)
  });
}

export function useReviewUserRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; status: string; admin_note?: string }) =>
      request(`/admin/user-requests/${encodeURIComponent(vars.id)}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status: vars.status, admin_note: vars.admin_note ?? '' })
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-user-requests'] })
  });
}

// ---------- Analytics ----------

export interface AnalyticsTrendRow {
  day: string;
  reservation_count: number;
  borrow_count: number;
  return_count: number;
  fault_count: number;
}
export interface AnalyticsOverview {
  range: { start: string; end: string };
  trend: AnalyticsTrendRow[];
  device_status: { status: string; count: number }[];
  approvals: { status: string; count: number }[];
}
export function useAnalyticsOverview(range?: string) {
  return useQuery({
    queryKey: ['admin-analytics-overview', range ?? ''],
    staleTime: QUERY_STALE.analytics,
    queryFn: () => request<AnalyticsOverview>(`/admin/analytics/overview${range ? `?range=${encodeURIComponent(range)}` : ''}`)
  });
}
export function useAnalyticsDeviceUsage(metric?: string) {
  return useQuery({
    queryKey: ['admin-analytics-device-usage', metric ?? ''],
    queryFn: () => request<{ metric: string; rows: Array<Record<string, unknown>> }>(`/admin/analytics/device-usage${metric ? `?metric=${encodeURIComponent(metric)}` : ''}`)
  });
}
export function useAnalyticsFaults(range?: string) {
  return useQuery({
    queryKey: ['admin-analytics-faults', range ?? ''],
    queryFn: () =>
      request<{ range: { start: string; end: string }; trend: { day: string; count: number }[]; types: { issue_type: string; count: number }[]; devices: { device_code: string; device_name: string; count: number }[] }>(`/admin/analytics/faults${range ? `?range=${encodeURIComponent(range)}` : ''}`)
  });
}

export interface AnalyticsHeatmapRow {
  weekday: number;
  slot_key: string;
  count: number;
}
export function useAnalyticsTimeHeatmap(range?: string) {
  return useQuery({
    queryKey: ['admin-analytics-time-heatmap', range ?? ''],
    queryFn: () =>
      request<{ range: { start: string; end: string }; rows: AnalyticsHeatmapRow[] }>(`/admin/analytics/time-heatmap${range ? `?range=${encodeURIComponent(range)}` : ''}`)
  });
}

export type IntelligenceLevel = 'danger' | 'warning' | 'info' | 'success' | string;

export interface AdminIntelligenceRecommendation {
  id: string;
  level: IntelligenceLevel;
  type: string;
  title: string;
  description: string;
  evidence?: string[];
  action_label?: string;
  action_url?: string;
}

export interface AdminIntelligenceAction extends AdminIntelligenceRecommendation {
  group?: 'urgent' | 'today' | 'optimization' | 'monitor' | string;
  owner_role?: string;
  estimated_impact?: string;
  execution_status?: 'open' | 'done' | 'ignored' | 'delegated' | string;
  execution_note?: string;
  handled_at?: string | null;
  handled_by?: string | null;
  handled_by_name?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
}

export interface AdminIntelligenceActionGroup {
  key: 'urgent' | 'today' | 'optimization' | 'monitor' | string;
  label: string;
  description?: string;
  count: number;
  actions: AdminIntelligenceAction[];
}

export interface AdminIntelligenceHealthSummary {
  score: number;
  level: 'healthy' | 'watch' | 'risk' | 'critical' | string;
  label?: string;
  narrative?: string;
  signals?: Array<{ key?: string; label: string; value: number | string; tone?: IntelligenceLevel | string }>;
}

export interface AdminIntelligenceRoleFocus {
  role_key: string;
  label: string;
  focus: string;
  highlights?: string[];
  action_url?: string;
}

export interface AdminDeviceRisk {
  device_code: string;
  device_name?: string;
  status?: string;
  risk_score: number;
  usage_count?: number;
  reservation_count?: number;
  fault_count?: number;
  high_fault_count?: number;
  open_fault_count?: number;
  abnormal_return_count?: number;
  overdue_count?: number;
  suggestion?: string;
}

export interface AdminDemandForecastRow {
  weekday: number;
  slot_key: string;
  count: number;
  level: 'high' | 'medium' | 'low' | string;
}

export interface AdminLowUtilizationDevice {
  device_code: string;
  device_name?: string;
  status?: string;
  usage_count?: number;
  reservation_count?: number;
}


export interface AdminExceptionReasonInsight {
  type: 'no_show' | 'overdue' | 'abnormal_return' | string;
  category: string;
  count: number;
  label: string;
  advice: string;
}

export interface AdminIntelligenceData {
  generated_at: string;
  engine?: {
    type: 'rules' | string;
    version: string;
    label: string;
    confidence_basis?: string;
  };
  range?: { start: string; end: string };
  summary: {
    risk_devices: number;
    high_demand_slots: number;
    overdue_or_abnormal: number;
    pending_workload: number;
    low_utilization_devices?: number;
    health_score?: number;
  };
  ops_briefing?: string;
  health_summary?: AdminIntelligenceHealthSummary;
  action_groups?: AdminIntelligenceActionGroup[];
  next_actions?: AdminIntelligenceAction[];
  role_focus?: AdminIntelligenceRoleFocus[];
  recommendations: AdminIntelligenceRecommendation[];
  exception_reason_summary?: AdminExceptionReasonInsight[];
  top_exception_reason?: AdminExceptionReasonInsight | null;
  device_risks: AdminDeviceRisk[];
  demand_forecast: AdminDemandForecastRow[];
  workload: {
    pending_reservations: number;
    pending_users: number;
    pending_faults: number;
    overdue_borrows: number;
  };
  low_utilization_devices?: AdminLowUtilizationDevice[];
}

export function useAdminIntelligence(range = '30d', enabled = true) {
  return useQuery({
    queryKey: ['admin-intelligence', range],
    queryFn: () => request<AdminIntelligenceData>(`/admin/analytics/intelligence?range=${encodeURIComponent(range)}`),
    enabled
  });
}

export interface AdminIntelligenceActionLog {
  id?: string | null;
  action_id: string;
  action_type?: string | null;
  action_title?: string | null;
  status: 'open' | 'done' | 'ignored' | 'delegated' | string;
  note?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  handled_by?: string | null;
  handled_by_name?: string | null;
  handled_at?: string | null;
  created_at?: string;
  updated_at?: string;
  persisted?: boolean;
}

export function useUpdateIntelligenceAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      action_id: string;
      status: 'open' | 'done' | 'ignored' | 'delegated' | string;
      note?: string;
      action_title?: string;
      action_type?: string;
      assigned_to?: string | null;
    }) =>
      request<{ action: AdminIntelligenceActionLog; persisted?: boolean }>(`/admin/analytics/intelligence/actions/${encodeURIComponent(vars.action_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: vars.status,
          note: vars.note ?? '',
          action_title: vars.action_title ?? '',
          action_type: vars.action_type ?? '',
          assigned_to: vars.assigned_to ?? null
        })
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-intelligence'] });
      qc.invalidateQueries({ queryKey: ['admin-intelligence-actions'] });
    }
  });
}

// ---------- Reservations (admin approval) ----------

export interface AdminReservationItem {
  id: string;
  item_id?: string;
  reservation_id?: string;
  device_id: string;
  device_code?: string;
  device_name?: string;
  device_status?: string;
  allow_reservation?: boolean;
  user_name?: string;
  user_phone?: string;
  user_student_no?: string;
  start_time: string;
  end_time: string;
  slot_key?: string;
  status: string;
  purpose?: string;
  admin_note?: string;
  batch_status?: string;
  [key: string]: unknown;
}

export interface AdminReservationBatch {
  id: string;
  purpose?: string;
  status: string;
  user_id?: string;
  user_name?: string;
  user_phone?: string;
  device_names?: string | null;
  device_codes?: string | null;
  first_start_time?: string | null;
  last_end_time?: string | null;
  item_count?: number;
  pending_count?: number;
  approved_count?: number;
  rejected_count?: number;
  created_at?: string;
  items?: AdminReservationItem[];
  [key: string]: unknown;
}

export interface AdminReservationRiskItem {
  level?: 'safe' | 'info' | 'warning' | 'danger' | string;
  type?: string;
  message?: string;
  score?: number;
  risk_score?: number;
  item_id?: string;
  device_code?: string;
  device_name?: string;
  start_time?: string;
  end_time?: string;
  evidence?: string[];
  action_url?: string;
  [key: string]: unknown;
}

export interface AdminReservationBatchDetail {
  batch: AdminReservationBatch;
  items: AdminReservationItem[];
  reservations?: AdminReservationItem[];
  approval_logs?: Array<Record<string, unknown>>;
  approval_risk?: {
    level?: 'safe' | 'info' | 'warning' | 'danger' | string;
    safe?: boolean;
    action?: 'approve' | 'manual_review' | 'reject_or_hold' | string;
    action_label?: string;
    risk_score?: number;
    confidence?: number;
    signal_counts?: { danger?: number; warning?: number; info?: number };
    summary?: string;
    recommendation?: string;
    items?: AdminReservationRiskItem[];
  };
}

export function useAdminReservationBatches(status?: string, scope?: string) {
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (scope) qs.set('scope', scope);
  const query = qs.toString();
  return useQuery({
    queryKey: ['admin-reservation-batches', status ?? '', scope ?? ''],
    queryFn: () => request<{ batches: AdminReservationBatch[] }>(`/admin/reservation-batches${query ? `?${query}` : ''}`)
  });
}

export function useAdminReservationBatchDetail(id?: string, scope?: string) {
  const qs = new URLSearchParams();
  if (scope) qs.set('scope', scope);
  const query = qs.toString();
  return useQuery({
    queryKey: ['admin-reservation-batch-detail', id ?? '', scope ?? ''],
    queryFn: () => request<AdminReservationBatchDetail>(`/admin/reservation-batches/${encodeURIComponent(id ?? '')}${query ? `?${query}` : ''}`),
    enabled: Boolean(id)
  });
}

export function useApproveReservationBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; approved: boolean; admin_note?: string }) =>
      request(`/admin/reservation-batches/${vars.id}/approval`, {
        method: 'PATCH',
        body: JSON.stringify({ approved: vars.approved, admin_note: vars.admin_note ?? '' })
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin-reservation-batches'] });
      qc.invalidateQueries({ queryKey: ['admin-reservation-batch-detail', vars.id] });
    }
  });
}

export function useApproveReservationItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; approve: boolean; admin_note?: string }) =>
      request(`/admin/reservation-items/${vars.id}/approval`, {
        method: 'PATCH',
        body: JSON.stringify({ approve: vars.approve, admin_note: vars.admin_note ?? '', reservation_id: vars.id })
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-reservation-batches'] });
      qc.invalidateQueries({ queryKey: ['admin-reservation-batch-detail'] });
    }
  });
}

export function useReviewReservationCancellation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; approved: boolean; admin_note?: string }) => request<{ message?: string; status?: string }>(`/admin/reservation-items/${encodeURIComponent(vars.id)}/cancel-review`, { method: 'PATCH', body: JSON.stringify({ approved: vars.approved, admin_note: vars.admin_note ?? '' }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-reservation-batches'] }); qc.invalidateQueries({ queryKey: ['admin-reservation-batch-detail'] }); qc.invalidateQueries({ queryKey: ['calendar-events'] }); }
  });
}

export function useMarkReservationNoShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; admin_note?: string; no_show_reason_category?: 'forgot' | 'plan_changed' | 'schedule_conflict' | 'other' }) => request<{ message?: string }>('/admin/reservation-items/' + encodeURIComponent(vars.id) + '/no-show', { method: 'PATCH', body: JSON.stringify({ admin_note: vars.admin_note ?? '', no_show_reason_category: vars.no_show_reason_category ?? 'other' }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-reservation-batches'] }); qc.invalidateQueries({ queryKey: ['admin-reservation-batch-detail'] }); }
  });
}

export function useChangeReservationPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; start_time: string; end_time: string; slot_key?: string; admin_note?: string }) =>
      request(`/admin/reservation-items/${encodeURIComponent(vars.id)}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({
          start_time: vars.start_time,
          end_time: vars.end_time,
          slot_key: vars.slot_key,
          admin_note: vars.admin_note ?? ''
        })
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-reservation-batches'] });
      qc.invalidateQueries({ queryKey: ['admin-reservation-batch-detail'] });
      qc.invalidateQueries({ queryKey: ['calendar-events'] });
    }
  });
}

// ---------- Export jobs ----------

export async function downloadExportJob(jobId: string, fileName = 'export.csv') {
  const token = tokenStore.get();
  const response = await fetch(`/api/v5/admin/export-jobs/${encodeURIComponent(jobId)}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(friendlyApiMessage(response.status, String(body?.message || body?.title || '')));
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
export interface ExportJob {
  id: string;
  type: string;
  params?: Record<string, unknown>;
  status: string;
  row_count?: number;
  file_path?: string | null;
  download_url?: string | null;
  error_message?: string | null;
  created_by?: string;
  created_by_name?: string;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  [key: string]: unknown;
}

export function useAdminExportJobs() {
  return useQuery({
    queryKey: ['admin-export-jobs'],
    queryFn: () => request<{ jobs: ExportJob[] }>('/admin/export-jobs')
  });
}

export function useCreateExportJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { type: string; user_id?: string; device_id?: string; start_date?: string; end_date?: string }) =>
      request<{ job: ExportJob }>('/admin/export-jobs', { method: 'POST', body: JSON.stringify(vars) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-export-jobs'] })
  });
}

export function useRunNextExportJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<{ job: ExportJob | null; message: string }>('/admin/export-jobs/run-next', { method: 'POST', body: '{}' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-export-jobs'] })
  });
}

export interface ExportRowsResult {
  type: string;
  rows: Array<Record<string, unknown>>;
  summary?: Record<string, unknown>;
}

export function fetchAdminExportRows(vars: { type: string; user_id?: string; device_id?: string; start_date?: string; end_date?: string }) {
  const qs = new URLSearchParams();
  if (vars.user_id) qs.set('user_id', vars.user_id);
  if (vars.device_id) qs.set('device_id', vars.device_id);
  if (vars.start_date) qs.set('start_date', vars.start_date);
  if (vars.end_date) qs.set('end_date', vars.end_date);
  const query = qs.toString();
  return request<ExportRowsResult>(`/admin/exports/${encodeURIComponent(vars.type)}${query ? `?${query}` : ''}`);
}

// ---------- System config ----------

export interface SecurityConfig {
  config: {
    captcha_expire_minutes?: number;
    captcha_hourly_limit?: number;
    openid_daily_register_limit?: number;
    enable_image_captcha?: boolean;
    require_return_photo?: boolean;
    block_ip_access_enabled?: boolean;
    public_show_reserver_name?: boolean;
    public_show_reserver_phone?: boolean;
    public_show_reserver_student_no?: boolean;
    site_domain?: string;
    system_notice_enabled?: boolean;
    system_notice_title?: string;
    system_notice_content?: string;
    admin_report_enabled?: boolean;
    admin_report_hour?: number;
    admin_report_minute?: number;
    admin_report_timezone?: string;
    wechat_token?: string;
    wechat_app_id?: string;
    wechat_admin_openids?: string;
    has_wechat_app_secret?: boolean;
    has_custom_admin_password: boolean;
    staff_contacts?: StaffContact[];
    [key: string]: unknown;
  };
}
export interface StaffContact {
  key: string;
  label?: string;
  description?: string;
  enabled?: boolean;
  name?: string;
  phone?: string;
  qrcode_url?: string;
  [key: string]: unknown;
}
export interface RoleRow {
  id: string;
  user_id: string;
  role_key: string;
  permissions?: string[];
  note?: string;
  user_name?: string;
  user_phone?: string;
  created_at?: string;
  [key: string]: unknown;
}
export interface PermissionOption {
  key: string;
  label?: string;
  module?: string;
  module_label?: string;
  module_description?: string;
}
export interface PermissionModule {
  key: string;
  label: string;
  description?: string;
  permissions: PermissionOption[];
}
export interface SystemRolesData {
  roles: RoleRow[];
  permissions: PermissionOption[];
  permission_modules?: PermissionModule[];
  role_defaults: Record<string, string[]>;
}

export function useAdminSecurityConfig() {
  return useQuery({ queryKey: ['admin-security-config'],
    staleTime: QUERY_STALE.systemConfig, queryFn: () => request<SecurityConfig>('/admin/system/security-config') });
}
export function useUpdateSecurityConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Record<string, unknown>) =>
      request('/admin/system/security-config', { method: 'PUT', body: JSON.stringify(vars) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-security-config'] })
  });
}
export function useAdminRoles() {
  return useQuery({ queryKey: ['admin-roles'],
    staleTime: QUERY_STALE.systemConfig, queryFn: () => request<SystemRolesData>('/admin/system/roles') });
}
export function useUpsertRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { user_id: string; role_key: string; permissions?: string[]; note?: string }) =>
      request('/admin/system/roles', { method: 'PUT', body: JSON.stringify(vars) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-roles'] })
  });
}
export function useRevokeRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => request(`/admin/system/roles/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-roles'] })
  });
}

export interface AdminRuntimeDiagnostics {
  product_version: string;
  process?: { uptime_seconds?: number; node_version?: string; environment?: string; started_at?: string | null };
  readiness?: { status?: 'ready' | 'degraded'; time?: string; database?: { postgres?: boolean; ready?: boolean; latency_ms?: number | null; checked_at?: string }; runtime?: { ready?: boolean; warnings?: string[]; errors?: string[]; mode?: string } };
  components?: { scheduler?: string; realtime_bus?: string; websocket_gateway?: string };
}
export function useAdminRuntimeDiagnostics() {
  return useQuery({
    queryKey: ['admin-runtime-diagnostics'],
    queryFn: () => request<AdminRuntimeDiagnostics>('/admin/system/runtime'),
    refetchInterval: 30_000
  });
}
export interface AdminActivityRow {
  id?: string;
  created_at?: string;
  event_type?: string;
  user_name?: string;
  phone?: string;
  wechat_openid?: string;
  remark?: string;
  [key: string]: unknown;
}
export interface AdminActivitySummary {
  summary: {
    registered_today?: number;
    logged_in_today?: number;
    wechat_bind_today?: number;
    wechat_scan_today?: number;
    [key: string]: unknown;
  };
  rows: AdminActivityRow[];
}
export function useAdminActivitySummary() {
  return useQuery({
    queryKey: ['admin-activity-summary'],
    queryFn: () => request<AdminActivitySummary>('/admin/system/activity-summary')
  });
}

export interface DailyReportSmartSummary {
  risk_devices?: number;
  high_demand_slots?: number;
  overdue_or_abnormal?: number;
  pending_workload?: number;
  today_reservations?: number;
  [key: string]: unknown;
}
export interface DailyReportSmartInsightRecommendation {
  id?: string;
  level?: IntelligenceLevel;
  title: string;
  description: string;
  evidence?: string[];
  action_label?: string;
  [key: string]: unknown;
}
export interface DailyReportSmartInsights {
  generated_at?: string;
  date?: string;
  timeZone?: string;
  summary?: DailyReportSmartSummary;
  workload?: Record<string, number>;
  recommendations?: DailyReportSmartInsightRecommendation[];
  device_risks?: AdminDeviceRisk[];
  peak_slots?: Array<{ slot_key?: string; label?: string; count?: number; [key: string]: unknown }>;
  [key: string]: unknown;
}
export interface DailyReportPreview {
  date?: string;
  count?: number;
  timeZone?: string;
  message: string;
  intelligence_summary?: DailyReportSmartSummary;
  smart_insights?: DailyReportSmartInsights;
  [key: string]: unknown;
}
export interface DailyReportSendResult {
  report_date?: string;
  message?: string;
  sent?: number;
  failed?: number;
  skipped?: boolean;
  reason?: string;
  intelligence_summary?: DailyReportSmartSummary;
  smart_insights?: DailyReportSmartInsights;
  results?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}
export function usePreviewDailyReport() {
  return useMutation({
    mutationFn: (vars: { timezone?: string; date?: string }) => {
      const qs = new URLSearchParams();
      if (vars.timezone) qs.set('timezone', vars.timezone);
      if (vars.date) qs.set('date', vars.date);
      return request<DailyReportPreview>(`/admin/system/reports/daily-usage${qs.toString() ? `?${qs}` : ''}`);
    }
  });
}
export function useSendDailyReport() {
  return useMutation({
    mutationFn: (vars: { timezone?: string; date?: string }) =>
      request<DailyReportSendResult>('/admin/system/reports/daily-usage/send', { method: 'POST', body: JSON.stringify(vars) })
  });
}

// ---------- Audit operation logs ----------

export interface OperationLog {
  id: string;
  operator_id?: string;
  operator_name: string;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  device_id?: string | null;
  record_id?: string | null;
  detail?: string | object | null;
  ip_address?: string | null;
  created_at: string;
  [key: string]: unknown;
}

export function useAdminOperationLogs(filters?: {
  operator?: string;
  action?: string;
  keyword?: string;
  risk?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}) {
  const qs = new URLSearchParams();
  if (filters?.operator) qs.set('operator', filters.operator);
  if (filters?.action) qs.set('action', filters.action);
  if (filters?.keyword) qs.set('keyword', filters.keyword);
  if (filters?.risk) qs.set('risk', filters.risk);
  if (filters?.start_date) qs.set('start_date', filters.start_date);
  if (filters?.end_date) qs.set('end_date', filters.end_date);
  if (filters?.limit) qs.set('limit', String(filters.limit));
  if (filters?.offset) qs.set('offset', String(filters.offset));
  const query = qs.toString();
  return useQuery({
    queryKey: ['admin-operation-logs', filters ?? {}],
    queryFn: () => request<{ logs: OperationLog[]; total?: number; has_more?: boolean }>(`/admin/audit/operation-logs${query ? `?${query}` : ''}`)
  });
}

// ---------- Maintenance ----------

export interface MaintenancePlan {
  id: string;
  device_id: string;
  device_code?: string;
  device_name?: string;
  device_status?: string;
  title: string;
  maintenance_type: string;
  interval_days: number;
  next_due_at?: string | null;
  last_completed_at?: string | null;
  status: 'active' | 'paused' | 'archived' | string;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MaintenanceWorkOrder {
  id: string;
  device_id: string;
  device_code?: string;
  device_name?: string;
  plan_id?: string | null;
  plan_title?: string | null;
  maintenance_window_id?: string | null;
  fault_report_id?: string | null;
  title: string;
  maintenance_type: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | string;
  assigned_to?: string | null;
  assignee_name?: string | null;
  description?: string | null;
  result_note?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MaintenanceRecovery {
  requested: boolean;
  recovered: boolean;
  blocked: boolean;
  blockers: string[];
}

export interface MaintenanceOverview {
  summary: {
    active_plans: number;
    overdue_plans: number;
    pending_work_orders: number;
    in_progress_work_orders: number;
    active_windows: number;
    overdue_windows: number;
    overdue_work_orders: number;
  };
  scheduler: {
    status: 'running' | 'success' | 'failed' | 'never_run' | string;
    scheduled_for?: string | null;
    started_at?: string | null;
    finished_at?: string | null;
    error_message?: string | null;
  };
}

export interface MaintenancePlanPayload {
  device_id: string;
  title: string;
  maintenance_type?: string;
  interval_days?: number;
  next_due_at?: string | null;
  status?: 'active' | 'paused' | 'archived';
  notes?: string;
}

export interface MaintenanceWorkOrderPayload {
  device_id: string;
  plan_id?: string | null;
  fault_report_id?: string | null;
  title: string;
  maintenance_type?: string;
  assigned_to?: string | null;
  description?: string;
  window_start: string;
  window_end: string;
}

const maintenanceKey = ['admin-maintenance'];

export function useMaintenanceOverview() {
  return useQuery({
    queryKey: [...maintenanceKey, 'overview'],
    queryFn: () => request<MaintenanceOverview>('/admin/maintenance/overview')
  });
}

export function useMaintenancePlans(status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return useQuery({
    queryKey: [...maintenanceKey, 'plans', status ?? ''],
    queryFn: () => request<{ plans: MaintenancePlan[] }>(`/admin/maintenance/plans${query}`)
  });
}

export function useCreateMaintenancePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: MaintenancePlanPayload) => request<{ message?: string; plan?: MaintenancePlan }>('/admin/maintenance/plans', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: maintenanceKey }); }
  });
}

export function useUpdateMaintenancePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Partial<MaintenancePlanPayload> & { id: string }) => {
      const { id, ...payload } = vars;
      return request<{ message?: string }>(`/admin/maintenance/plans/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: maintenanceKey }); }
  });
}

export function useMaintenanceWorkOrders(status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return useQuery({
    queryKey: [...maintenanceKey, 'work-orders', status ?? ''],
    queryFn: () => request<{ work_orders: MaintenanceWorkOrder[] }>(`/admin/maintenance/work-orders${query}`)
  });
}

export function useCreateMaintenanceWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: MaintenanceWorkOrderPayload) => request<{ message?: string; work_order?: MaintenanceWorkOrder; affected_reservations?: number }>('/admin/maintenance/work-orders', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: maintenanceKey }); qc.invalidateQueries({ queryKey: ['admin-devices'] }); }
  });
}

export function useUpdateMaintenanceWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; status?: MaintenanceWorkOrder['status']; assigned_to?: string | null; result_note?: string; restore_available?: boolean }) => {
      const { id, ...payload } = vars;
      return request<{ message?: string; recovery?: MaintenanceRecovery }>(`/admin/maintenance/work-orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: maintenanceKey }); qc.invalidateQueries({ queryKey: ['admin-devices'] }); }
  });
}
