import { request } from '@/lib/api';

export interface ReservationBatch {
  id: string;
  device_codes?: string;
  device_names?: string;
  time_slots?: string;
  purpose?: string;
  status: string;
  created_at: string;
  item_count?: number;
  device_count?: number;
  date_count?: number;
  first_start_time?: string;
  last_end_time?: string;
}

export interface ReservationItem {
  id: string;
  batch_id: string;
  device_id: string;
  device_code?: string;
  device_name?: string;
  item_id?: string;
  reservation_id?: string;
  reservation_date: string;
  slot_key: string;
  start_time: string;
  end_time: string;
  status: string;
  purpose?: string;
  admin_note?: string;
}

export interface CalendarEvent {
  event_id?: string;
  id?: string;
  item_id?: string;
  record_id?: string;
  reservation_id?: string;
  device_id: string;
  device_code: string;
  device_name: string;
  user_id?: string;
  user_name?: string;
  user_phone?: string;
  start_time: string;
  end_time: string;
  status: string;
  source_type?: string;
  type?: string;
  slot_key?: string;
  purpose?: string;
  color?: string;
}

export interface ReservationPlanGroup {
  device_codes: string[];
  reservation_dates: string[];
  slot_keys: string[];
}

export interface ReservationPayload {
  device_codes?: string[];
  deviceCodes?: string[];
  device_code?: string;
  deviceCode?: string;
  time_slots?: string[];
  reservation_dates?: string[];
  slot_keys?: string[];
  reservation_groups?: ReservationPlanGroup[];
  reservationGroups?: ReservationPlanGroup[];
  purpose?: string;
}

export async function precheckReservation(payload: ReservationPayload) {
  return request<{ ok: boolean; conflicts?: unknown[] }>('/reservation-batches/precheck', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function createReservation(payload: ReservationPayload) {
  return request<ReservationBatch>('/reservation-batches', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function listMyBatches() {
  const data = await request<ReservationBatch[] | { batches?: ReservationBatch[] }>('/reservation-batches/me');
  return Array.isArray(data) ? data : data.batches ?? [];
}

export async function getBatch(id: string) {
  return request<{ batch: ReservationBatch; items: ReservationItem[] }>(`/reservation-batches/${id}`);
}

export async function cancelReservationItem(id: string, cancelReason = '') {
  return request<{ message?: string; status?: string }>(`/reservation-items/${id}/cancel`, { method: 'PATCH', body: JSON.stringify({ cancel_reason: cancelReason }) });
}

export async function getCalendar(params?: string | { start?: string; end?: string; date?: string }) {
  const qs = new URLSearchParams();
  if (typeof params === 'string') {
    qs.set('date', params);
  } else if (params) {
    if (params.start) qs.set('start', params.start);
    if (params.end) qs.set('end', params.end);
    if (params.date) qs.set('date', params.date);
  }
  const query = qs.toString();
  const data = await request<CalendarEvent[] | { events?: CalendarEvent[] }>(`/calendar${query ? `?${query}` : ''}`);
  return Array.isArray(data) ? data : data.events ?? [];
}

export async function getCalendarDay(date: string) {
  const data = await request<CalendarEvent[] | { events?: CalendarEvent[] }>(`/calendar/days/${encodeURIComponent(date)}`);
  return Array.isArray(data) ? data : data.events ?? [];
}
