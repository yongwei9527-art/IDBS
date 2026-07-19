import { request } from '@/lib/api';

export interface SystemNotice {
  enabled?: boolean;
  title?: string;
  content?: string;
  version?: string | number;
}

export const SYSTEM_NOTICE_QUERY_KEY = ['system-notice'] as const;
export const SYSTEM_NOTICE_READ_EVENT = 'idbs:system-notice-read';

export async function fetchSystemNotice() {
  const result = await request<{ notice?: SystemNotice }>('/system/notice');
  return result.notice ?? null;
}

export function systemNoticeVersion(notice?: SystemNotice | null) {
  return String(notice?.version || '1');
}

export function systemNoticeReadKey(notice?: SystemNotice | null) {
  return `IDBS_NOTICE_CLOSED_${systemNoticeVersion(notice)}`;
}

export function isSystemNoticeRead(notice?: SystemNotice | null) {
  if (typeof window === 'undefined' || !notice) return false;
  return window.localStorage.getItem(systemNoticeReadKey(notice)) === '1';
}

export function markSystemNoticeRead(notice?: SystemNotice | null) {
  if (typeof window === 'undefined' || !notice) return;
  window.localStorage.setItem(systemNoticeReadKey(notice), '1');
  window.dispatchEvent(new CustomEvent(SYSTEM_NOTICE_READ_EVENT, {
    detail: { version: systemNoticeVersion(notice) }
  }));
}
