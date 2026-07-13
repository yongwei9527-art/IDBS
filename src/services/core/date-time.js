function formatDateForTimezone(date, timeZone = 'Asia/Shanghai') {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

function formatDateTimeForTimezone(value, timeZone = 'Asia/Shanghai') {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date).replace(/\//g, '-');
}

function compactClockForTimezone(value, timeZone = 'Asia/Shanghai') {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
  const [hour = '', minute = ''] = text.split(':');
  const safeHour = String(Number(hour));
  return minute === '00' ? `${safeHour}点` : `${safeHour}点${minute}`;
}

function shortDateForTimezone(value, timeZone = 'Asia/Shanghai') {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'numeric', day: 'numeric' }).formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const day = parts.find((part) => part.type === 'day')?.value || '';
  return month && day ? `${month}/${day}` : formatDateForTimezone(date, timeZone);
}

function compactTimeRangeForTimezone(startTime, endTime, timeZone = 'Asia/Shanghai') {
  return `${compactClockForTimezone(startTime, timeZone)}-${compactClockForTimezone(endTime, timeZone)}`;
}

function compactDateTimeRangeForTimezone(startTime, endTime, timeZone = 'Asia/Shanghai') {
  const dateText = shortDateForTimezone(startTime, timeZone);
  return `${dateText} · ${compactTimeRangeForTimezone(startTime, endTime, timeZone)}`;
}

function durationMinutes(startTime, endTime) {
  return Math.max(0, Math.round((new Date(endTime) - new Date(startTime)) / 60000));
}

module.exports = {
  compactClockForTimezone,
  compactDateTimeRangeForTimezone,
  compactTimeRangeForTimezone,
  durationMinutes,
  formatDateForTimezone,
  formatDateTimeForTimezone,
  shortDateForTimezone
};
