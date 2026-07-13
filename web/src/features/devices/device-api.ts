import { request } from '@/lib/api';

export interface Device {
  id: string;
  device_code: string;
  name: string;
  category?: string;
  location?: string;
  manager?: string;
  status: string;
  description?: string;
  usage_notice?: string;
  cover_photo?: string;
  allow_reservation?: boolean;
  last_return_time?: string;
  last_condition?: string;
  reservation_slot_keys?: string[];
  reservation_slot_options?: ReservationSlotOption[];
  current_borrow?: DeviceBorrowSnapshot | null;
  next_reservation?: DeviceReservationSnapshot | null;
  last_record?: Record<string, unknown> | null;
}

export interface DeviceReservationSnapshot {
  id?: string;
  item_id?: string;
  reservation_id?: string;
  batch_id?: string;
  device_id?: string;
  device_code?: string;
  device_name?: string;
  user_id?: string;
  user_name?: string;
  user_phone?: string;
  user_student_no?: string;
  start_time?: string;
  end_time?: string;
  reservation_date?: string;
  slot_key?: string;
  status?: string;
  purpose?: string;
  admin_note?: string;
  [key: string]: unknown;
}

export interface DeviceBorrowSnapshot {
  id?: string;
  device_id?: string;
  device_code?: string;
  user_id?: string;
  user_name?: string;
  user_phone?: string;
  borrow_time?: string;
  expected_return_time?: string;
  return_time?: string;
  status?: string;
  [key: string]: unknown;
}

export interface DeviceFaultSnapshot {
  id?: string;
  issue_type?: string;
  severity?: string;
  status?: string;
  description?: string;
  admin_note?: string;
  created_at?: string;
  resolved_at?: string;
  [key: string]: unknown;
}

export interface DeviceDetail {
  device: Device;
  reservations: DeviceReservationSnapshot[];
  occupancy_14_days: DeviceReservationSnapshot[];
  recent_fault_reports: DeviceFaultSnapshot[];
  current_borrow: DeviceBorrowSnapshot | null;
  next_reservation: DeviceReservationSnapshot | null;
  last_record?: Record<string, unknown> | null;
}

export interface DeviceTimeSlot {
  id?: string;
  slot_key: string;
  label: string;
  start_time: string;
  end_time: string;
  crosses_day: boolean;
  sort_order: number;
  enabled: boolean;
  capacity?: number;
}

export interface ReservationSlotOption {
  key: string;
  label?: string;
  start?: string;
  end?: string;
  start_time?: string;
  end_time?: string;
  crosses_midnight?: boolean;
  enabled?: boolean;
  [key: string]: unknown;
}

function normalizeDeviceDetail(data: Device | DeviceDetail | { device?: Device } & Partial<DeviceDetail>): DeviceDetail {
  const device = 'device' in data && data.device ? data.device : data as Device;
  return {
    device,
    reservations: 'reservations' in data && Array.isArray(data.reservations) ? data.reservations : [],
    occupancy_14_days: 'occupancy_14_days' in data && Array.isArray(data.occupancy_14_days) ? data.occupancy_14_days : [],
    recent_fault_reports: 'recent_fault_reports' in data && Array.isArray(data.recent_fault_reports) ? data.recent_fault_reports : [],
    current_borrow: ('current_borrow' in data ? data.current_borrow : device.current_borrow) ?? null,
    next_reservation: ('next_reservation' in data ? data.next_reservation : device.next_reservation) ?? null,
    last_record: 'last_record' in data ? data.last_record : device.last_record
  };
}

export async function listDevices() {
  const data = await request<Device[] | { devices?: Device[]; list?: Device[] }>('/devices');
  if (Array.isArray(data)) return data;
  return data.devices ?? data.list ?? [];
}

export async function getDeviceDetail(deviceCode: string) {
  const data = await request<Device | DeviceDetail | ({ device?: Device } & Partial<DeviceDetail>)>(`/devices/${encodeURIComponent(deviceCode)}`);
  return normalizeDeviceDetail(data);
}

export async function listReservationSlots(deviceCodes?: string[]) {
  const qs = new URLSearchParams();
  if (deviceCodes?.length) qs.set('device_codes', deviceCodes.join(','));
  const data = await request<ReservationSlotOption[] | { presets?: ReservationSlotOption[]; all_presets?: ReservationSlotOption[] }>(
    `/reservation-slots${qs.toString() ? `?${qs}` : ''}`
  );
  return Array.isArray(data) ? data : data.presets ?? data.all_presets ?? [];
}
