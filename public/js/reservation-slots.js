(function attachReservationSlots(global) {
  const fallbackPresets = [
    { key: 'morning', label: '上午 8:00-12:00', start: '08:00', end: '12:00', type: 'base' },
    { key: 'afternoon', label: '下午 12:00-17:00', start: '12:00', end: '17:00', type: 'base' },
    { key: 'evening', label: '傍晚 17:00-22:00', start: '17:00', end: '22:00', type: 'base' },
    { key: 'night', label: '夜间 22:00-次日 8:00', start: '22:00', end: '08:00', crosses_midnight: true, type: 'base' },
    { key: 'daytime', label: '白天 8:00-22:00（14小时）', start: '08:00', end: '22:00', type: 'shortcut' }
  ];

  function addDays(dateText, days) {
    const [year, month, day] = dateText.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
  }

  function toRange(dateText, preset) {
    const endDate = preset.crosses_midnight ? addDays(dateText, 1) : dateText;
    return {
      key: preset.key,
      label: preset.label,
      start: `${dateText} ${preset.start}`,
      end: `${endDate} ${preset.end}`,
      startTime: new Date(`${dateText}T${preset.start}:00+08:00`),
      endTime: new Date(`${endDate}T${preset.end}:00+08:00`)
    };
  }

  function selectedKeys(container) {
    return [...container.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
  }

  function baseKeys(presets) {
    return presets.filter((preset) => preset.type === 'base').map((preset) => preset.key);
  }

  function renderCheckboxes(container, presets, checkedKeys = [], options = {}) {
    const name = options.name || 'reservation_slot_keys';
    if (!presets.length) {
      container.innerHTML = '<div class="empty-state">当前设备没有可选预约时间段。</div>';
      return;
    }
    container.innerHTML = presets.map((preset) => `
      <label class="slot-card">
        <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(preset.key)}" ${checkedKeys.includes(preset.key) ? 'checked' : ''}>
        <span>
          <strong>${escapeHtml(preset.label)}</strong>
          <small>${escapeHtml(preset.type === 'shortcut' ? '整段快捷选项' : '标准分段')}</small>
        </span>
      </label>
    `).join('');
  }

  function buildRanges(dateText, keys, presets) {
    const presetMap = new Map(presets.map((preset) => [preset.key, preset]));
    return keys.map((key) => presetMap.get(key)).filter(Boolean).map((preset) => toRange(dateText, preset));
  }

  function findOverlap(ranges) {
    const sorted = [...ranges].sort((a, b) => a.startTime - b.startTime);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].startTime < sorted[index - 1].endTime) {
        return [sorted[index - 1], sorted[index]];
      }
    }
    return null;
  }

  function renderPreview(container, dateText, keys, presets) {
    if (!dateText || !keys.length) {
      container.innerHTML = '<p class="muted">请选择预约日期和时间段。</p>';
      return { valid: false, ranges: [] };
    }
    const ranges = buildRanges(dateText, keys, presets);
    const overlap = findOverlap(ranges);
    if (overlap) {
      container.innerHTML = `<div class="alert warn">选择的时间段有重叠：${escapeHtml(overlap[0].label)} 与 ${escapeHtml(overlap[1].label)}，请保留其中一个。</div>`;
      return { valid: false, ranges };
    }
    container.innerHTML = `
      <div class="slot-preview">
        ${ranges.map((range) => `<span class="badge info">${escapeHtml(range.label)}：${escapeHtml(range.start)} - ${escapeHtml(range.end)}</span>`).join('')}
      </div>
    `;
    return { valid: true, ranges };
  }

  global.ReservationSlots = {
    fallbackPresets,
    addDays,
    baseKeys,
    buildRanges,
    findOverlap,
    renderCheckboxes,
    renderPreview,
    selectedKeys
  };
})(window);
