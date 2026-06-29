(function attachCalendarUi(global) {
  function localDate(value) {
    const date = new Date(value);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
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
    return events.reduce((map, event) => {
      const key = localDate(event.start_time);
      if (!map[key]) map[key] = [];
      map[key].push(event);
      return map;
    }, {});
  }

  function renderMonth(container, events, monthText, options = {}) {
    const { first, start } = monthRange(monthText);
    const grouped = groupByDate(events);
    const admin = options.admin ? '&admin=1' : '';
    const days = [];
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = localDate(date);
      const dayEvents = grouped[key] || [];
      const outside = date.getMonth() !== first.getMonth();
      days.push(`
        <a class="calendar-day ${outside ? 'muted-day' : ''}" href="calendar-detail.html?date=${encodeURIComponent(key)}${admin}">
          <span class="calendar-date">${date.getDate()}</span>
          <div class="calendar-events">
            ${dayEvents.slice(0, 4).map((event) => `<span class="calendar-dot" style="background:${escapeHtml(event.color || '#5d7f73')}" title="${escapeHtml(event.device_name || event.device_code)}"></span>`).join('')}
            ${dayEvents.length > 4 ? `<span class="calendar-more">+${dayEvents.length - 4}</span>` : ''}
          </div>
          <div class="calendar-popover">
            <strong>${escapeHtml(key)} 使用安排</strong>
            ${dayEvents.length ? dayEvents.map((event) => `
              <div class="calendar-popover-row">
                <span class="calendar-dot" style="background:${escapeHtml(event.color || '#5d7f73')}"></span>
                <span>${escapeHtml(event.device_code)} ${escapeHtml(event.device_name || '')}<br><small>${escapeHtml(fmtTime(event.start_time))} - ${escapeHtml(fmtTime(event.end_time))}</small></span>
              </div>
            `).join('') : '<p class="muted">当天暂无预约或使用记录。</p>'}
          </div>
        </a>
      `);
    }
    container.innerHTML = `
      <div class="calendar-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
      <div class="calendar-grid">${days.join('')}</div>
    `;
  }

  global.CalendarUi = { localDate, monthRange, groupByDate, renderMonth };
})(window);
