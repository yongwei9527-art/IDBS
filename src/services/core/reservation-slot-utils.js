const { AppError } = require('../../lib/app-error');

const RESERVATION_SLOT_PRESETS = [
  { key: 'morning', label: '上午 8:00-12:00', start: '08:00', end: '12:00', type: 'base' },
  { key: 'afternoon', label: '下午 12:00-17:00', start: '12:00', end: '17:00', type: 'base' },
  { key: 'evening', label: '傍晚 17:00-22:00', start: '17:00', end: '22:00', type: 'base' },
  { key: 'night', label: '夜间 22:00-次日 8:00', start: '22:00', end: '08:00', crosses_midnight: true, type: 'base' },
  { key: 'daytime', label: '白天 8:00-22:00（14小时）', start: '08:00', end: '22:00', type: 'shortcut' }
];

const DEFAULT_RESERVATION_SLOT_KEYS = RESERVATION_SLOT_PRESETS.map((item) => item.key);

function parseDates(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError('时间格式不正确。', { status: 400, code: 2001 });
  }
  if (end <= start) {
    throw new AppError('结束时间必须晚于开始时间。', { status: 400, code: 2001 });
  }
  if (start < new Date(Date.now() - 5 * 60_000)) {
    throw new AppError('不能预约已过去的时间段。', { status: 400, code: 3001 });
  }
  return { start, end };
}

function normalizeSlotTimeText(value, fallback = '') {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeReservationSlotOption(item) {
  const raw = typeof item === 'string' ? { key: item } : (item || {});
  const rawKey = raw.key || raw.slot_key;
  const preset = RESERVATION_SLOT_PRESETS.find((slot) => slot.key === rawKey) || {};
  const key = String(rawKey || preset.key || '').trim();
  if (!key || !RESERVATION_SLOT_PRESETS.some((slot) => slot.key === key)) return null;
  const start = normalizeSlotTimeText(raw.start || raw.start_time, preset.start);
  const end = normalizeSlotTimeText(raw.end || raw.end_time, preset.end);
  return {
    ...preset,
    key,
    label: String(raw.label || preset.label || key).trim().slice(0, 80),
    start,
    end,
    crosses_midnight: raw.crosses_midnight === true || raw.crosses_day === true || (start && end && end <= start),
    type: raw.type || preset.type || 'base'
  };
}

function normalizeReservationSlotOptions(value, fallback = RESERVATION_SLOT_PRESETS) {
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch (_) {
      raw = value.split(',');
    }
  }
  const list = Array.isArray(raw) ? raw : [];
  const unique = [];
  for (const item of list) {
    const option = normalizeReservationSlotOption(item);
    if (option && !unique.some((slot) => slot.key === option.key)) unique.push(option);
  }
  return unique.length ? unique : fallback.map(normalizeReservationSlotOption).filter(Boolean);
}

function getReservationSlotPreset(key, devices = []) {
  for (const device of devices || []) {
    const option = normalizeReservationSlotOptions(device.reservation_slot_keys, []).find((item) => item.key === key);
    if (option) return option;
  }
  return RESERVATION_SLOT_PRESETS.find((item) => item.key === key) || null;
}

function reservationSlotTimesMatch(first = {}, second = {}) {
  const left = normalizeReservationSlotOption(first);
  const right = normalizeReservationSlotOption(second);
  if (!left || !right) return false;
  return left.key === right.key
    && left.start === right.start
    && left.end === right.end
    && Boolean(left.crosses_midnight) === Boolean(right.crosses_midnight);
}

function normalizeReservationSlotKeys(value, fallback = DEFAULT_RESERVATION_SLOT_KEYS) {
  const valid = normalizeReservationSlotOptions(value, []).map((slot) => slot.key);
  return valid.length ? valid : [...fallback];
}

function withReservationSlotOptions(device = {}) {
  const reservationSlotOptions = normalizeReservationSlotOptions(device.reservation_slot_keys);
  const reservationSlotKeys = reservationSlotOptions.map((slot) => slot.key);
  return {
    ...device,
    reservation_slot_keys: reservationSlotKeys,
    reservation_slot_options: reservationSlotOptions
  };
}

function addDaysToDateText(dateText, days) {
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function slotToDateRange(dateText, slot) {
  const endDate = slot.crosses_midnight ? addDaysToDateText(dateText, 1) : dateText;
  return {
    key: slot.key,
    label: slot.label,
    ...parseDates(`${dateText}T${slot.start}:00+08:00`, `${endDate}T${slot.end}:00+08:00`)
  };
}

function assertNoOverlappingSlots(slots) {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start < sorted[index - 1].end) {
      throw new AppError('选择的时间段存在重叠，请重新选择。', { status: 400, code: 2001 });
    }
  }
}

function parseReservationDates(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,，、]+/);
  const dates = raw.map((item) => String(item || '').trim()).filter(Boolean);
  const unique = [...new Set(dates)];
  for (const dateText of unique) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      throw new AppError(`预约日期格式不正确：${dateText}`, { status: 400, code: 2001 });
    }
  }
  return unique;
}

function buildReservationSlotsFromKeys(payload, devices = []) {
  const dateTexts = parseReservationDates(
    payload.reservation_dates || payload.reservationDates || payload.reservation_date || payload.reservationDate || payload.dates
  );
  if (!dateTexts.length) {
    throw new AppError('请选择预约日期。', { status: 400, code: 2001 });
  }

  const slotKeys = normalizeReservationSlotKeys(payload.slot_keys || payload.slotKeys, []);
  if (!slotKeys.length) {
    throw new AppError('请选择预约时间段。', { status: 400, code: 2001 });
  }

  for (const device of devices || []) {
    const allowedKeys = normalizeReservationSlotKeys(device.reservation_slot_keys);
    const blockedKey = slotKeys.find((key) => !allowedKeys.includes(key));
    if (blockedKey) {
      throw new AppError(`设备 ${device.device_code || ''} 不支持所选时间段，请重新选择。`, { status: 409, code: 3001 });
    }
  }

  for (const key of slotKeys) {
    const configuredSlots = (devices || [])
      .map((device) => normalizeReservationSlotOptions(device.reservation_slot_keys, []).find((slot) => slot.key === key))
      .filter(Boolean);
    const firstSlot = configuredSlots[0];
    const incompatibleSlot = firstSlot && configuredSlots.find((slot) => !reservationSlotTimesMatch(firstSlot, slot));
    if (incompatibleSlot) {
      throw new AppError(`所选设备的 ${key} 时间段不一致，请分开预约。`, { status: 409, code: 3001 });
    }
  }

  const slots = [];
  for (const dateText of dateTexts) {
    slots.push(...slotKeys.map((key) => slotToDateRange(dateText, getReservationSlotPreset(key, devices))));
  }
  assertNoOverlappingSlots(slots);
  return slots;
}

module.exports = {
  RESERVATION_SLOT_PRESETS,
  DEFAULT_RESERVATION_SLOT_KEYS,
  parseDates,
  normalizeSlotTimeText,
  normalizeReservationSlotOption,
  normalizeReservationSlotOptions,
  getReservationSlotPreset,
  reservationSlotTimesMatch,
  normalizeReservationSlotKeys,
  withReservationSlotOptions,
  addDaysToDateText,
  slotToDateRange,
  assertNoOverlappingSlots,
  parseReservationDates,
  buildReservationSlotsFromKeys
};
