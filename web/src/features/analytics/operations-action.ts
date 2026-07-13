export interface ParsedAdminActionUrl {
  to: string;
  search: Record<string, string>;
}

export function parseAdminActionUrl(url?: string, fallback = '/admin/stats'): ParsedAdminActionUrl {
  const raw = String(url || fallback).trim() || fallback;
  const [pathname, query = ''] = raw.split('?');
  const search: Record<string, string> = {};
  new URLSearchParams(query).forEach((value, key) => {
    if (value) search[key] = value;
  });
  return { to: pathname || fallback, search };
}
