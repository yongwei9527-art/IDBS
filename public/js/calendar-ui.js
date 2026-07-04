(function attachCalendarUi(global) {
  const calendarTimeZone = 'Asia/Shanghai';

  function localDateParts(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function timeZoneDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: calendarTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }

  function normalizeDateText(value) {
    const text = String(value || '').trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }

  function localDate(value) {
    if (value instanceof Date) return localDateParts(value);
    const plainDate = normalizeDateText(value);
    if (plainDate && String(value).trim().length <= 10) return plainDate;
    return timeZoneDate(value);
  }

  function monthRange(monthText) {
    const [year, month] = monthText.split('-').map(Number);
    const first = new Date(year, month - 1, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 41);
    return { first, start, end };
  }

  function groupByDate(events = []) {
    const safeEvents = Array.isArray(events) ? events : [];
    return safeEvents.reduce((map, event) => {
      if (!event || !event.start_time) return map;
      const key = localDate(event.start_time);
      if (!map[key]) map[key] = [];
      map[key].push(event);
      return map;
    }, {});
  }

  function stableDeviceColor(value) {
    const palette = ['#5d7f73', '#4f7cac', '#b56b6b', '#a97735', '#7b68a6', '#3c8f8f', '#b05f8f', '#6f8f3f', '#c27a4a', '#4f6f9f'];
    const text = String(value || 'device');
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(index);
      hash |= 0;
    }
    return palette[Math.abs(hash) % palette.length];
  }

  function eventColor(event) {
    return event.color || stableDeviceColor(event.device_code || event.device_id || event.device_name);
  }

  function sortEvents(events = []) {
    return [...events].sort((left, right) => {
      const timeDiff = new Date(left.start_time) - new Date(right.start_time);
      if (timeDiff) return timeDiff;
      return String(left.device_code || '').localeCompare(String(right.device_code || ''), 'zh-CN');
    });
  }

  function shortTimeRange(event) {
    const start = fmtTime(event.start_time).slice(11, 16);
    const end = fmtTime(event.end_time).slice(11, 16);
    return `${start}-${end}`;
  }

  function eventLabel(event) {
    const code = event.device_code || '设备';
    const name = event.device_name ? ` ${event.device_name}` : '';
    return `${code}${name}`;
  }

  function renderEventChip(event) {
    const color = escapeHtml(eventColor(event));
    return `
      <span class="calendar-event-chip" style="--event-color:${color}" title="${escapeHtml(eventLabel(event))}">
        <i></i>
        <b>${escapeHtml(event.device_code || '设备')}</b>
      </span>
    `;
  }

  function chatUserLine(event, adminQuery = '') {
    if (!event.user_name) return '';
    if (!event.user_id) return `<br><small>使用人：${escapeHtml(event.user_name)}</small>`;
    return `<br><small>使用人：<a class="calendar-chat-link" href="chat.html?user_id=${encodeURIComponent(event.user_id)}${adminQuery}">${escapeHtml(event.user_name)}</a></small>`;
  }

  function renderMonth(container, events, monthText, options = {}) {
    const safeEvents = Array.isArray(events) ? events : [];
    const { first, start } = monthRange(monthText);
    const grouped = groupByDate(safeEvents);
    const admin = options.admin ? '&admin=1' : '';
    const back = options.back ? `&back=${encodeURIComponent(options.back)}` : '';
    const chatAdmin = options.admin ? `&admin=1${back}` : '';
    const visibleEventLimit = Number.isFinite(options.visibleEventLimit) ? options.visibleEventLimit : 4;
    const serverToday = normalizeDateText(options.serverToday || options.server_today) || localDate(new Date());
    const days = [];
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = localDate(date);
      const dayEvents = sortEvents(grouped[key] || []);
      const outside = date.getMonth() !== first.getMonth();
      const isPast = serverToday && key < serverToday;
      const isToday = serverToday && key === serverToday;
      const dayClasses = ['calendar-day'];
      if (outside) dayClasses.push('muted-day');
      if (isPast) dayClasses.push('is-past-day');
      if (isToday) dayClasses.push('is-today');
      if (dayEvents.length) dayClasses.push('has-events');
      const detailHref = `calendar-detail.html?date=${encodeURIComponent(key)}&month=${encodeURIComponent(monthText)}${admin}${back}`;
      days.push(`
        <article class="${dayClasses.join(' ')}" data-calendar-date="${escapeHtml(key)}" aria-label="${escapeHtml(key)} ${isToday ? '今天，' : ''}${isPast ? '已过期，' : ''}${dayEvents.length ? `${dayEvents.length} 条使用安排` : '暂无预约'}">
          <span class="calendar-date">${date.getDate()}</span>
          <div class="calendar-events">
            ${dayEvents.length ? dayEvents.slice(0, visibleEventLimit).map(renderEventChip).join('') : '<span class="calendar-empty">暂无预约</span>'}
            ${dayEvents.length > visibleEventLimit ? `<span class="calendar-more">还有 ${dayEvents.length - visibleEventLimit} 条，点开查看</span>` : ''}
          </div>
          <div class="calendar-popover">
            <strong>${escapeHtml(key)} 使用安排</strong>
            ${dayEvents.length ? dayEvents.map((event) => `
              <div class="calendar-popover-row">
                <span class="calendar-dot" style="background:${escapeHtml(eventColor(event))}"></span>
                <span>
                  ${escapeHtml(eventLabel(event))}
                  <br><small>${escapeHtml(fmtTime(event.start_time))} - ${escapeHtml(fmtTime(event.end_time))}</small>
                  ${chatUserLine(event, chatAdmin)}
                </span>
              </div>
            `).join('') : '<p class="muted">当天暂无预约或使用记录。</p>'}
            <a class="calendar-day-link" href="${detailHref}">查看当天详情</a>
          </div>
        </article>
      `);
    }
    const monthEvents = safeEvents.filter((event) => event && event.start_time && localDate(event.start_time).slice(0, 7) === monthText);
    const activeDays = new Set(monthEvents.map((event) => localDate(event.start_time))).size;
    const deviceCount = new Set(monthEvents.map((event) => event.device_code || event.device_id || event.device_name).filter(Boolean)).size;
    container.innerHTML = `
      <div class="calendar-summary" aria-label="本月使用安排概览">
        <span><b>${monthEvents.length}</b> 条安排</span>
        <span><b>${activeDays}</b> 天有预约</span>
        <span><b>${deviceCount}</b> 台设备</span>
      </div>
      <div class="calendar-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
      <div class="calendar-grid">${days.join('')}</div>
    `;
  }

  global.CalendarUi = { localDate, monthRange, groupByDate, renderMonth };
})(window);
