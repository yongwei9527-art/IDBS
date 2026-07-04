function createReservationReadService(context = {}) {
  const {
    activeReservationStatus,
    addNamesToReservations,
    applyReservationVisibility,
    assertText,
    calendarColor,
    calendarRange,
    currentReservationDateCondition,
    fail,
    getById,
    getReservationVisibilityConfig,
    historicalReservationTimeCondition,
    includePastReservations,
    nowIso,
    ok,
    query,
    queryOne,
    requireAdminRole,
    requireUser
  } = context;

  function calendarServerMeta(serverNow = nowIso()) {
    const serverDate = new Date(serverNow);
    const safeDate = Number.isNaN(serverDate.getTime()) ? new Date() : serverDate;
    return {
      server_now: serverNow,
      server_today: new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(safeDate),
      server_timezone: 'Asia/Shanghai'
    };
  }

  async function getCalendarEvents(params = {}, token) {
    let fullAccess = false;
    try {
      await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['reservation.view', 'device.view', 'stats.view']);
      fullAccess = true;
    } catch (_) {
      await requireUser(token);
    }

    const { start, end } = calendarRange(params);
    const serverNow = nowIso();
    const serverMeta = calendarServerMeta(serverNow);
    const visibility = fullAccess ? { showName: true, showPhone: true, showStudentNo: true } : await getReservationVisibilityConfig();
    const rows = await query(`
      select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id,
        b.purpose,
        d.device_code, d.name as device_name,
        u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from reservation_items ri
      join reservation_batches b on b.id = ri.batch_id
      join devices d on d.id = ri.device_id
      join users u on u.id = ri.user_id
      where ri.status = any($1) and ri.start_time < $3 and ri.end_time > $2
      order by ri.start_time asc
    `, [activeReservationStatus, start, end]);
    const borrowRows = await query(`
      select b.*, d.device_code, d.name as device_name, u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from borrow_records b
      join devices d on d.id = b.device_id
      join users u on u.id = b.user_id
      where b.reservation_id is null and b.status = any($1) and b.borrow_time < $3 and coalesce(b.expected_return_time, b.return_time, now()) > $2
      order by b.borrow_time asc
    `, [['in_use', 'abnormal_pending', 'overdue'], start, end]);

    const reservationEvents = rows.map((row) => {
      const visible = applyReservationVisibility(row, visibility, fullAccess);
      return {
        id: row.id,
        type: 'reservation_item',
        status: row.status,
        title: `${row.device_code} ${row.device_name}`,
        device_id: row.device_id,
        device_code: row.device_code,
        device_name: row.device_name,
        user_id: visible.user_name ? row.user_id : '',
        user_name: visible.user_name,
        user_phone: visible.user_phone,
        user_student_no: visible.user_student_no,
        start_time: row.start_time,
        end_time: row.end_time,
        purpose: row.purpose || '',
        color: calendarColor(row.device_code)
      };
    });
    const borrowEvents = borrowRows.map((row) => {
      const visible = applyReservationVisibility(row, visibility, fullAccess);
      return {
        id: row.id,
        type: 'borrow',
        status: row.status,
        title: `${row.device_code} ${row.device_name}`,
        device_id: row.device_id,
        device_code: row.device_code,
        device_name: row.device_name,
        user_id: visible.user_name ? row.user_id : '',
        user_name: visible.user_name,
        user_phone: visible.user_phone,
        user_student_no: visible.user_student_no,
        start_time: row.borrow_time,
        end_time: row.expected_return_time || row.return_time || serverNow,
        purpose: '现场借用',
        color: calendarColor(row.device_code)
      };
    });
    return ok({ events: [...reservationEvents, ...borrowEvents], range: { start, end }, full_access: fullAccess, ...serverMeta });
  }

  async function getCalendarDay(params = {}, token) {
    const date = assertText(params.date || params.reservation_date, 'date', 20).slice(0, 10);
    const start = `${date}T00:00:00+08:00`;
    const end = `${date}T23:59:59+08:00`;
    return getCalendarEvents({ start: start.slice(0, 10), end: end.slice(0, 10) }, token);
  }

  async function adminListReservations(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['reservation.approve', 'reservation.view']);
    const scope = String(params.scope || params.view || '').trim().toLowerCase();
    const historyScope = ['history', 'past', 'completed'].includes(scope);
    const currentScope = ['current', 'active'].includes(scope);
    let where = '';
    if (historyScope) where = `where ${historicalReservationTimeCondition('ri')}`;
    else if (currentScope) where = `where ${currentReservationDateCondition('ri')}`;
    else if (!includePastReservations(params)) where = `where ri.status = 'pending' and ${currentReservationDateCondition('ri')}`;
    const data = await query(`
      select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id,
        b.purpose,
        d.device_code, d.name as device_name,
        u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from reservation_items ri
      join reservation_batches b on b.id = ri.batch_id
      join devices d on d.id = ri.device_id
      join users u on u.id = ri.user_id
      ${where}
      order by ri.start_time asc, ri.created_at desc
    `);
    return ok({ reservations: await addNamesToReservations(data || []) });
  }

  async function listReservationBatches(params = {}, token) {
    const user = await requireUser(token);
    const rows = await query(`
      select b.*,
        count(ri.id)::int as item_count,
        count(distinct ri.device_id)::int as device_count,
        count(distinct (ri.start_time at time zone 'Asia/Shanghai')::date)::int as date_count
      from reservation_batches b
      left join reservation_items ri on ri.batch_id = b.id
      where b.user_id = $1
      group by b.id
      order by b.created_at desc
    `, [user.id]);
    return ok({ batches: rows || [] });
  }

  async function getReservationBatch(params = {}, token) {
    const user = await requireUser(token);
    const batchId = assertText(params.id || params.batch_id || params.batchId, 'batch_id', 60);
    const batch = await getById('reservation_batches', batchId);
    if (!batch) return fail('Reservation batch not found', 404, 3004);
    if (batch.user_id !== user.id && !['admin', 'super_admin'].includes(user.role)) return fail('Cannot view another user batch', 403, 1003);
    const reservations = await query(`
      select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id,
        d.device_code, d.name as device_name, u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from reservation_items ri
      join devices d on d.id = ri.device_id
      join users u on u.id = ri.user_id
      where ri.batch_id = $1
      order by ri.start_time asc
    `, [batchId]);
    return ok({ batch, items: reservations, reservations });
  }

  async function adminListReservationBatches(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['reservation.approve', 'reservation.view']);
    const status = String(params.status || '').trim();
    const scope = String(params.scope || params.view || '').trim().toLowerCase();
    const historyScope = ['history', 'past', 'completed'].includes(scope);
    const currentScope = ['current', 'active'].includes(scope);
    const includePast = includePastReservations(params);
    const clauses = [];
    const values = [];
    if (status) { values.push(status); clauses.push(`b.status = $${values.length}`); }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const statusScopeCondition = historyScope
      ? historicalReservationTimeCondition('ri')
      : (currentScope || !includePast ? currentReservationDateCondition('ri') : 'true');
    let having = '';
    if (historyScope) {
      having = `having count(ri.id) > 0 and bool_and(${historicalReservationTimeCondition('ri')})`;
    } else if (currentScope) {
      having = `having count(*) filter (where ${currentReservationDateCondition('ri')}) > 0`;
    } else if (!includePast) {
      having = `having count(*) filter (where ri.status = 'pending' and ${currentReservationDateCondition('ri')}) > 0`;
    }
    const rows = await query(`
      select b.*, u.name as user_name, u.phone as user_phone,
        string_agg(distinct d.name, '、') filter (where ${statusScopeCondition}) as device_names,
        string_agg(distinct d.device_code, '、') filter (where ${statusScopeCondition}) as device_codes,
        string_agg(distinct (d.name || '｜' || d.device_code || '｜' || to_char(ri.start_time at time zone 'Asia/Shanghai', 'YYYY/MM/DD HH24:MI') || ' - ' || to_char(ri.end_time at time zone 'Asia/Shanghai', 'HH24:MI')), ';;') filter (where ${statusScopeCondition}) as reservation_preview_rows,
        string_agg(distinct (to_char(ri.start_time at time zone 'Asia/Shanghai', 'YYYY/MM/DD HH24:MI') || ' - ' || to_char(ri.end_time at time zone 'Asia/Shanghai', 'HH24:MI')), ';;') filter (where ${statusScopeCondition}) as reservation_times,
        min(ri.start_time) filter (where ${statusScopeCondition}) as first_start_time,
        max(ri.end_time) filter (where ${statusScopeCondition}) as last_end_time,
        count(*) filter (where ${statusScopeCondition})::int as item_count,
        count(distinct ri.device_id) filter (where ${statusScopeCondition})::int as device_count,
        count(distinct (ri.start_time at time zone 'Asia/Shanghai')::date) filter (where ${statusScopeCondition})::int as date_count,
        count(*) filter (where ${currentReservationDateCondition('ri')})::int as current_item_count,
        count(*) filter (where ${historicalReservationTimeCondition('ri')})::int as history_item_count,
        bool_or(${currentReservationDateCondition('ri')}) as has_current_item,
        bool_and(${historicalReservationTimeCondition('ri')}) as is_history,
        count(*) filter (where ri.status = 'pending' and ${statusScopeCondition})::int as pending_count,
        count(*) filter (where ri.status = 'approved' and ${statusScopeCondition})::int as approved_count,
        count(*) filter (where ri.status = 'rejected' and ${statusScopeCondition})::int as rejected_count
      from reservation_batches b
      join users u on u.id = b.user_id
      join reservation_items ri on ri.batch_id = b.id
      join devices d on d.id = ri.device_id
      ${where}
      group by b.id, u.name, u.phone
      ${having}
      order by b.created_at desc
    `, values);
    return ok({ batches: rows || [] });
  }

  async function adminGetReservationBatch(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['reservation.approve', 'reservation.view']);
    const batchId = assertText(params.id || params.batch_id || params.batchId, 'batch_id', 60);
    const scope = String(params.scope || params.view || '').trim().toLowerCase();
    const historyScope = ['history', 'past', 'completed'].includes(scope);
    const currentScope = ['current', 'active'].includes(scope);
    const includePast = includePastReservations(params);
    let reservationDateWhere = '';
    if (historyScope) reservationDateWhere = ` and ${historicalReservationTimeCondition('ri')}`;
    else if (currentScope || !includePast) reservationDateWhere = ` and ${currentReservationDateCondition('ri')}`;
    const batch = await queryOne('select b.*, u.name as user_name, u.phone as user_phone, u.student_no as user_student_no from reservation_batches b join users u on u.id = b.user_id where b.id = $1', [batchId]);
    if (!batch) return fail('Reservation batch not found', 404, 3004);
    const reservations = await query(`
      select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id,
        d.device_code, d.name as device_name, u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from reservation_items ri
      join devices d on d.id = ri.device_id
      join users u on u.id = ri.user_id
      where ri.batch_id = $1${reservationDateWhere}
      order by ri.start_time asc
    `, [batchId]);
    return ok({ batch, items: reservations, reservations });
  }

  return {
    adminGetReservationBatch,
    adminListReservationBatches,
    adminListReservations,
    getCalendarDay,
    getCalendarEvents,
    getReservationBatch,
    listReservationBatches
  };
}

module.exports = { createReservationReadService };
