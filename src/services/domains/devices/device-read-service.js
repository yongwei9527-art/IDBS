function createDeviceReadService(context = {}) {
  const {
    activeReservationStatus,
    addReservationSnapshotsToDevices,
    applyReservationVisibility,
    assertText,
    DEFAULT_RESERVATION_SLOT_KEYS,
    fail,
    getById,
    getDeviceByCode,
    getReservationVisibilityConfig,
    normalizeReservationSlotOptions,
    normalizeReservationSlotKeys,
    nowIso,
    ok,
    query,
    queryOne,
    requireAdminRole,
    RESERVATION_SLOT_PRESETS
  } = context;

  function slotTimesMatch(first = {}, second = {}) {
    return first.key === second.key
      && first.start === second.start
      && first.end === second.end
      && Boolean(first.crosses_midnight) === Boolean(second.crosses_midnight);
  }

  function normalizedDeviceSlotOptions(device = {}) {
    return normalizeReservationSlotOptions(device.reservation_slot_keys || RESERVATION_SLOT_PRESETS);
  }

  function metadataArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  async function addRecentReturnPhotos(devices = []) {
    const ids = devices.map((device) => device?.id).filter(Boolean);
    if (!ids.length) return devices;
    const rows = await query(`select id, device_id, return_photo_metadata, return_supplement_photo_metadata
      from borrow_records
      where device_id = any($1::uuid[])
        and return_time is not null
        and (jsonb_array_length(return_photo_metadata) > 0 or jsonb_array_length(return_supplement_photo_metadata) > 0)
      order by return_time desc
      limit 200`, [ids]);
    const now = Date.now();
    const grouped = new Map();
    for (const row of rows || []) {
      const list = grouped.get(row.device_id) || [];
      for (const item of [...metadataArray(row.return_photo_metadata), ...metadataArray(row.return_supplement_photo_metadata)]) {
        if (!item?.url || (item.retain_until && new Date(item.retain_until).getTime() <= now)) continue;
        list.push({
          id: String(item.id || ''),
          record_id: row.id,
          url: String(item.url),
          original_name: String(item.original_name || '\u5f52\u8fd8\u7167\u7247').slice(0, 160),
          abnormal: Boolean(item.abnormal),
          submitted_at: item.submitted_at || null,
          retain_until: item.retain_until || null
        });
        if (list.length >= 6) break;
      }
      grouped.set(row.device_id, list.slice(0, 6));
    }
    return devices.map((device) => ({ ...device, recent_return_photos: grouped.get(device.id) || [] }));
  }

  async function listDevices(filters = {}) {
    let sql = 'select * from devices';
    let countSql = 'select count(*)::int as total from devices';
    const params = [];
    const clauses = ['deleted_at is null'];
    if (filters.status) { params.push(String(filters.status)); clauses.push(`status = $${params.length}`); }
    if (filters.category) { params.push(String(filters.category)); clauses.push(`category = $${params.length}`); }
    if (filters.keyword) {
      params.push(`%${String(filters.keyword).trim()}%`);
      clauses.push(`(device_code ilike $${params.length} or name ilike $${params.length} or coalesce(location, '') ilike $${params.length} or coalesce(manager, '') ilike $${params.length} or coalesce(category, '') ilike $${params.length})`);
    }
    if (clauses.length) {
      const where = ` where ${clauses.join(' and ')}`;
      sql += where;
      countSql += where;
    }
    sql += ' order by created_at desc';
    let total = null;
    const page = Math.max(1, Number(filters.page || 1) || 1);
    const pageSizeRaw = Number(filters.page_size || filters.pageSize || 0) || 0;
    const pageSize = pageSizeRaw ? Math.min(100, Math.max(1, pageSizeRaw)) : 0;
    if (pageSize) {
      total = Number((await queryOne(countSql, params))?.total || 0);
      params.push(pageSize);
      sql += ` limit $${params.length}`;
      params.push((page - 1) * pageSize);
      sql += ` offset $${params.length}`;
    }
    const rows = await query(sql, params);
    const snapshots = await addReservationSnapshotsToDevices(rows, { fullAccess: false });
    const list = await addRecentReturnPhotos(snapshots);
    return ok({ list, total: total ?? list.length, page, page_size: pageSize || list.length });
  }

  async function getReservationSlotOptions(params = {}) {
    const rawCodes = Array.isArray(params.device_codes)
      ? params.device_codes
      : Array.isArray(params.deviceCodes)
        ? params.deviceCodes
        : String(params.device_codes || params.deviceCodes || params.device_code || params.deviceCode || '')
          .split(',');
    const deviceCodes = rawCodes.map((item) => String(item || '').trim()).filter(Boolean);
    let presets = RESERVATION_SLOT_PRESETS;

    if (deviceCodes.length) {
      const devices = [];
      for (const deviceCode of [...new Set(deviceCodes)]) {
        const device = await getDeviceByCode(deviceCode);
        if (!device) return fail(`设备不存在：${deviceCode}`, 404, 3004);
        devices.push(device);
      }
      const slotOptionsByDevice = devices.map(normalizedDeviceSlotOptions);
      const firstDeviceOptions = slotOptionsByDevice[0] || [];
      presets = firstDeviceOptions.filter((option) => slotOptionsByDevice.every((options) => {
        const candidate = options.find((item) => item.key === option.key);
        return candidate && slotTimesMatch(option, candidate);
      }));
    }

    return ok({
      presets,
      all_presets: RESERVATION_SLOT_PRESETS,
      selected_device_codes: deviceCodes,
      select_all_keys: presets.filter((slot) => slot.type === 'base').map((slot) => slot.key)
    });
  }

  async function getDeviceTimeSlots(params = {}) {
    const deviceId = String(params.device_id || params.deviceId || '').trim();
    const deviceCode = String(params.device_code || params.deviceCode || '').trim();
    let device = null;
    if (deviceId) device = await getById('devices', deviceId);
    if (!device && deviceCode) device = await getDeviceByCode(deviceCode);
    if (!device) return getReservationSlotOptions(params);

    const rows = await query('select * from device_time_slots where device_id = $1 and enabled = true order by sort_order asc, start_time asc', [device.id]);
    if (rows.length) {
      const slots = normalizeReservationSlotOptions(rows.map((row) => ({
        key: row.slot_key,
        label: row.label,
        start: row.start_time,
        end: row.end_time,
        crosses_midnight: row.crosses_day,
        type: row.type,
        sort_order: row.sort_order
      })), []);
      return ok({ device, slots, presets: slots });
    }
    const presets = normalizeReservationSlotOptions(device.reservation_slot_keys).filter((slot) => normalizeReservationSlotKeys(device.reservation_slot_keys).includes(slot.key));
    return ok({ device, slots: presets, presets });
  }

  async function adminListDevices(filters = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['device.manage', 'device.view']);
    const result = await listDevices(filters);
    const list = await addReservationSnapshotsToDevices(result.list || [], { fullAccess: true });
    return ok({ list, devices: list, total: list.length });
  }

  async function getDeviceDetail(params = {}) {
    const code = assertText(params.device_code || params.deviceCode, 'device_code', 50);
    const device = await getDeviceByCode(code);
    if (!device) return fail('设备不存在。', 404, 3004);
    const reservations = await query(`
      select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id,
        b.purpose,
        d.device_code, d.name as device_name,
        u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from reservation_items ri
      join reservation_batches b on b.id = ri.batch_id
      join devices d on d.id = ri.device_id
      join users u on u.id = ri.user_id
      where ri.device_id = $1 and ri.status = any($2) and ri.end_time >= $3
      order by ri.start_time asc
    `, [device.id, activeReservationStatus, nowIso()]);
    const occupancy14Days = await query(`
      select id, start_time, end_time, status, purpose
      from (
        select ri.id, ri.start_time, ri.end_time, ri.status, b.purpose
        from reservation_items ri
        join reservation_batches b on b.id = ri.batch_id
        where ri.device_id = $1
        and ri.status = any($2)
        and ri.start_time >= now()
        and ri.start_time < now() + interval '14 days'
      ) upcoming
      order by start_time asc
    `, [device.id, activeReservationStatus]);
    const recentFaultReports = await query(`
      select id, issue_type, severity, status, description, admin_note, created_at, resolved_at
      from device_fault_reports
      where device_id = $1
      order by created_at desc
      limit 5
    `, [device.id]);
    const visibility = await getReservationVisibilityConfig();
    const snapshots = await addReservationSnapshotsToDevices([device], { fullAccess: false });
    const deviceList = await addRecentReturnPhotos(snapshots);
    return ok({
      device: deviceList[0] || device,
      reservations: (reservations || []).map((row) => applyReservationVisibility(row, visibility)),
      occupancy_14_days: (occupancy14Days || []).map((row) => applyReservationVisibility(row, visibility)),
      recent_fault_reports: recentFaultReports || [],
      current_borrow: deviceList[0]?.current_borrow || null,
      next_reservation: deviceList[0]?.next_reservation || null,
      last_record: deviceList[0]?.last_record || null
    });
  }

  return {
    adminListDevices,
    getDeviceDetail,
    getDeviceTimeSlots,
    getReservationSlotOptions,
    listDevices
  };
}

module.exports = { createDeviceReadService };
