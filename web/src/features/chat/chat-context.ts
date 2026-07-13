import { formatCompactId } from '@/components/ui/compact-id';

export type ChatContextType = 'device' | 'reservation' | 'fault' | 'request';

export interface ChatContextParams {
  targetUserId?: string;
  contactAdmin?: boolean;
  type?: ChatContextType | string;
  title?: string;
  detail?: string;
  deviceCode?: string;
  deviceName?: string;
  userName?: string;
  userPhone?: string;
  status?: string;
  description?: string;
  issueType?: string;
  reservationId?: string;
  batchId?: string;
  faultId?: string;
  requestId?: string;
  startTime?: string;
  endTime?: string;
}

export interface ChatContextCard {
  type: ChatContextType;
  message_type: 'device_card' | 'reservation_card' | 'fault_card' | 'user_request_card';
  title: string;
  detail: string;
  content: string;
  related_type: string;
  related_id: string;
  prefill: string;
  metadata: Record<string, string>;
}

export const CHAT_CARD_TYPES = ['device_card', 'reservation_card', 'fault_card', 'user_request_card'] as const;

function firstQueryValue(...values: Array<string | null | undefined>) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function read(search: URLSearchParams, key: string) {
  return search.get(key) || '';
}

function put(out: Record<string, string>, key: string, value: unknown) {
  const text = String(value ?? '').trim();
  if (text) out[key] = text;
}

export function buildChatSearch(params: ChatContextParams = {}) {
  const out: Record<string, string> = {};
  put(out, 'user_id', params.targetUserId);
  if (params.contactAdmin) out.contact_admin = '1';
  put(out, 'context_type', params.type);
  put(out, 'context_title', params.title);
  put(out, 'detail', params.detail);
  put(out, 'device_code', params.deviceCode);
  put(out, 'device_name', params.deviceName);
  put(out, 'user_name', params.userName);
  put(out, 'user_phone', params.userPhone);
  put(out, 'status', params.status);
  put(out, 'description', params.description);
  put(out, 'issue_type', params.issueType);
  put(out, 'reservation_id', params.reservationId);
  put(out, 'batch_id', params.batchId);
  put(out, 'fault_id', params.faultId);
  put(out, 'request_id', params.requestId);
  put(out, 'start_time', params.startTime);
  put(out, 'end_time', params.endTime);
  return out;
}

export function preserveChatContextSearch(searchString = window.location.search) {
  const search = new URLSearchParams(searchString);
  search.delete('user_id');
  search.delete('target_user_id');
  search.delete('contact_admin');
  search.delete('admin_contact');
  const out: Record<string, string> = {};
  search.forEach((value, key) => put(out, key, value));
  return out;
}

export function parseChatTarget(searchString = window.location.search) {
  const search = new URLSearchParams(searchString);
  const userId = read(search, 'user_id') || read(search, 'target_user_id');
  const contactAdmin = ['1', 'true'].includes(String(read(search, 'contact_admin') || read(search, 'admin_contact')).toLowerCase());
  return { userId, contactAdmin };
}

export function parseChatContext(searchString = window.location.search): ChatContextCard | null {
  const search = new URLSearchParams(searchString);
  const initialContextType = read(search, 'context_type');
  const initialContextTitle = read(search, 'context_title');
  const initialDeviceCode = read(search, 'device_code');
  const initialReservationId = read(search, 'reservation_id');
  const initialBatchId = read(search, 'batch_id') || read(search, 'reservation_batch_id');
  const initialFaultId = read(search, 'fault_id') || read(search, 'report_id');
  const initialRequestId = read(search, 'request_id') || read(search, 'user_request_id');
  const deviceCode = firstQueryValue(initialDeviceCode, read(search, 'device'));
  const common = {
    device_code: deviceCode,
    device_name: read(search, 'device_name'),
    user_name: read(search, 'user_name'),
    user_phone: read(search, 'user_phone'),
    status: read(search, 'status'),
    title: initialContextTitle,
    detail: read(search, 'detail')
  };
  const inferredType = initialFaultId ? 'fault' : initialRequestId ? 'request' : (initialReservationId || initialBatchId) ? 'reservation' : deviceCode ? 'device' : '';
  const contextType = ({
    fault_report: 'fault',
    user_request: 'request',
    reservation_batch: 'reservation',
    reservation_item: 'reservation'
  } as Record<string, string>)[initialContextType] || initialContextType || inferredType;

  const faultRef = deviceCode || formatCompactId(initialFaultId, 8, 4, 'FLT');
  const requestRef = formatCompactId(initialRequestId, 8, 4, 'REQ');
  const reservationRef = formatCompactId(initialReservationId || initialBatchId, 8, 4, 'RSV');

  if (contextType === 'fault') {
    return {
      type: 'fault',
      message_type: 'fault_card',
      title: initialContextTitle || `故障报备 ${faultRef}`.trim(),
      detail: read(search, 'issue_type') || read(search, 'description') || read(search, 'detail') || '设备故障处理沟通',
      content: initialContextTitle || `故障卡片：${faultRef || '待处理'}`,
      related_type: 'fault_report',
      related_id: initialFaultId || deviceCode,
      prefill: `关于故障报备 ${faultRef}：`,
      metadata: { ...common, fault_id: initialFaultId, issue_type: read(search, 'issue_type'), description: read(search, 'description') }
    };
  }
  if (contextType === 'request') {
    return {
      type: 'request',
      message_type: 'user_request_card',
      title: initialContextTitle || `需求上报 ${requestRef}`.trim(),
      detail: read(search, 'description') || read(search, 'detail') || '用户需求处理沟通',
      content: initialContextTitle || `需求卡片：${requestRef || '待处理'}`,
      related_type: 'user_request',
      related_id: initialRequestId,
      prefill: `关于需求上报 ${requestRef}：`,
      metadata: { ...common, request_id: initialRequestId, description: read(search, 'description') }
    };
  }
  if (contextType === 'reservation') {
    const id = initialReservationId || initialBatchId;
    return {
      type: 'reservation',
      message_type: 'reservation_card',
      title: initialContextTitle || `预约 ${reservationRef}`.trim(),
      detail: [deviceCode, read(search, 'start_time'), read(search, 'end_time')].filter(Boolean).join(' · ') || read(search, 'detail') || '预约审批沟通',
      content: initialContextTitle || `预约卡片：${reservationRef || deviceCode || '待确认'}`,
      related_type: initialBatchId ? 'reservation_batch' : 'reservation',
      related_id: id,
      prefill: `关于预约 ${deviceCode || reservationRef}：`,
      metadata: { ...common, reservation_id: initialReservationId, batch_id: initialBatchId, start_time: read(search, 'start_time'), end_time: read(search, 'end_time') }
    };
  }
  if (contextType === 'device') {
    return {
      type: 'device',
      message_type: 'device_card',
      title: initialContextTitle || `设备 ${deviceCode}`,
      detail: read(search, 'device_name') || read(search, 'detail') || '设备咨询沟通',
      content: initialContextTitle || `设备卡片：${deviceCode}`,
      related_type: 'device',
      related_id: deviceCode,
      prefill: `咨询设备 ${deviceCode}：`,
      metadata: { ...common }
    };
  }
  return null;
}

export function isChatCardMessage(type?: string) {
  return CHAT_CARD_TYPES.includes(type as (typeof CHAT_CARD_TYPES)[number]);
}

export function chatCardLabel(type?: string) {
  return ({
    device_card: '设备',
    reservation_card: '预约',
    fault_card: '故障',
    user_request_card: '需求'
  } as Record<string, string>)[type || ''] || '业务';
}
