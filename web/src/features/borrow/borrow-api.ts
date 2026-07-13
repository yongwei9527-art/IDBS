import { request } from '@/lib/api';
import type { ReservationItem } from '../reservation/reservation-api';

export interface BorrowRecord {
  id: string;
  device_id: string;
  device_code?: string;
  device_name?: string;
  borrow_time: string;
  expected_return_time?: string;
  return_time?: string;
  return_condition?: string;
  return_note?: string;
  return_photos?: string[];
  return_archive_folder?: string;
  return_archive_photos?: string[];
  user_name?: string;
  user_phone?: string;
  return_mode?: 'confirm_only' | 'image_required' | 'image_optional' | string;
  return_photo_required?: boolean;
  return_rule_label?: string;
  return_require_note?: boolean;
  status: 'in_use' | 'returned' | 'return_pending' | 'abnormal_pending' | 'overdue';
  is_overdue?: boolean;
}

export async function startBorrow(payload: { reservation_item_id?: string; device_code?: string }) {
  const data = await request<BorrowRecord | { record?: BorrowRecord; message?: string }>('/borrow-records', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return ('record' in data && data.record ? data.record : data) as BorrowRecord;
}

export async function extendBorrow(recordId: string, payload: { expected_return_time?: string } = {}) {
  const data = await request<BorrowRecord | { record?: BorrowRecord; message?: string }>(`/borrow-records/${recordId}/extend`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
  return ('record' in data && data.record ? data.record : data) as BorrowRecord;
}

export async function submitReturn(recordId: string, payload: {
  return_condition?: string;
  return_note?: string;
  return_photos?: string[];
  abnormal_reason_category?: 'missing_accessory' | 'appearance_damage' | 'operation_abnormal' | 'other';
  overdue_reason_category?: 'experiment_not_finished' | 'awaiting_result' | 'forgot_return' | 'other';
}) {
  return request<BorrowRecord | { message?: string }>(`/borrow-records/${recordId}/return`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export interface MyBorrowRecords {
  reservations: Array<ReservationItem & { can_cancel?: boolean; batch_status?: string }>;
  borrows: BorrowRecord[];
  require_return_photo?: boolean;
}

export async function listMyBorrowRecords() {
  return request<MyBorrowRecords>('/my-records');
}

export interface FaultReport {
  id: string;
  device_id: string;
  issue_type: string;
  severity?: string;
  reason_category?: string;
  description: string;
  photos?: string[];
  status: string;
  admin_note?: string;
}

export async function reportFault(payload: {
  device_code?: string;
  borrow_record_id?: string;
  issue_type: string;
  severity?: string;
  reason_category?: string;
  description: string;
  photos?: string[];
}) {
  return request<FaultReport>('/fault-reports', {
    method: 'POST',
    body: JSON.stringify({ ...payload, record_id: payload.borrow_record_id })
  });
}





