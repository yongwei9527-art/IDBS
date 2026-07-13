const SLOT_KEY_LABELS: Record<string, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚间',
  night: '夜间',
  daytime: '白天',
  allday: '整天',
  all_day: '整天',
  custom: '自定义'
};

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeParts(value?: string | null) {
  if (!value) return null;
  const date = parseDate(value);
  if (date) return { hour: date.getHours(), minute: date.getMinutes() };
  const match = String(value).match(/(\d{1,2})[:：](\d{2})/);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function compactClock(value?: string | null) {
  const parts = timeParts(value);
  if (!parts) return value ? String(value) : '—';
  return parts.minute === 0 ? `${parts.hour}点` : `${parts.hour}点${String(parts.minute).padStart(2, '0')}`;
}

export function tinyClock(value?: string | null) {
  const parts = timeParts(value);
  if (!parts) return value ? String(value) : '\u2014';
  return parts.minute === 0 ? String(parts.hour) : `${parts.hour}:${String(parts.minute).padStart(2, '0')}`;
}

export function tinyTimeRange(start?: string | null, end?: string | null, options?: { crossesNextDay?: boolean }) {
  if (!start && !end) return '\u2014';
  if (!start) return tinyClock(end);
  if (!end) return tinyClock(start);
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  const crossesNextDay = options?.crossesNextDay || Boolean(startDate && endDate && startDate.toDateString() !== endDate.toDateString());
  return `${tinyClock(start)}-${crossesNextDay ? '\u6b21\u65e5' : ''}${tinyClock(end)}`;
}

export function shortDate(value?: string | null) {
  if (!value) return '—';
  const date = parseDate(value);
  if (!date) return String(value).slice(0, 10) || String(value);
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function compactTimeRange(start?: string | null, end?: string | null, options?: { crossesNextDay?: boolean }) {
  if (!start && !end) return '—';
  if (!start) return compactClock(end);
  if (!end) return compactClock(start);
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  const crossesNextDay = options?.crossesNextDay || Boolean(startDate && endDate && startDate.toDateString() !== endDate.toDateString());
  return `${compactClock(start)}-${crossesNextDay ? '次日 ' : ''}${compactClock(end)}`;
}

/**
 * Formats operational timestamps compactly for dense lists and cards.
 * The current day needs only a clock; dates are retained whenever they add context.
 */
export function briefDateTime(value?: string | null) {
  if (!value) return '—';
  const date = parseDate(value);
  if (!date) return String(value);

  const now = new Date();
  const dayKey = (item: Date) => `${item.getFullYear()}-${item.getMonth()}-${item.getDate()}`;
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  if (dayKey(date) === dayKey(now)) return clock;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return `昨天 ${clock}`;

  const dateText = `${date.getMonth() + 1}/${date.getDate()}`;
  return date.getFullYear() === now.getFullYear()
    ? `${dateText} ${clock}`
    : `${String(date.getFullYear()).slice(-2)}/${dateText} ${clock}`;
}
export function dateTimeText(value?: string | null) {
  if (!value) return '—';
  return briefDateTime(value);
}

export function fullDateTimeRange(start?: string | null, end?: string | null) {
  if (!start && !end) return '—';
  if (!end) return dateTimeText(start);
  const startText = dateTimeText(start);
  const endDate = parseDate(end);
  const endText = endDate ? endDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : String(end);
  return `${startText} - ${endText}`;
}

export function slotDisplayName(key?: string | null, label?: string | null) {
  const normalizedKey = String(key || '').trim();
  if (normalizedKey && SLOT_KEY_LABELS[normalizedKey]) return SLOT_KEY_LABELS[normalizedKey];
  const cleaned = String(label || normalizedKey || '时段')
    .replace(/[（(]?\d{1,2}[:：]\d{2}\s*[-~至]\s*(?:次日\s*)?\d{1,2}[:：]\d{2}[）)]?/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || normalizedKey || '时段';
}
