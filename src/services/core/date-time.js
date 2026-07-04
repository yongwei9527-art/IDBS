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

function durationMinutes(startTime, endTime) {
  return Math.max(0, Math.round((new Date(endTime) - new Date(startTime)) / 60000));
}

module.exports = {
  durationMinutes,
  formatDateForTimezone,
  formatDateTimeForTimezone
};
